"""
RS Anime — Telegram Video Downloader Bot (Admin-only)
=====================================================
Send any direct MP4 / M3U8 / MPD / yt-dlp supported URL. The bot probes
available qualities, shows inline buttons, downloads via yt-dlp + ffmpeg,
and uploads back to Telegram with a professional live progress bar.

- Admin-only (OWNER_ID must match)
- No user session / no local bot API server required
- Everything logged verbosely to stdout so `journalctl` / terminal shows it
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import sys
import time
import traceback
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from dotenv import load_dotenv
from pyrogram import Client, filters
from pyrogram.errors import FloodWait, MessageNotModified
from pyrogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

# ---------------------------------------------------------------------------
# Logging (everything to stdout so `python3 bot.py` shows every event)
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
    force=True,
)
# Quiet pyrogram internals, keep our logs loud
logging.getLogger("pyrogram").setLevel(logging.WARNING)
log = logging.getLogger("rs-bot")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
load_dotenv()

API_ID = int(os.getenv("API_ID", "0") or 0)
API_HASH = os.getenv("API_HASH", "").strip()
BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
OWNER_ID = int(os.getenv("OWNER_ID", "0") or 0)
WORK_DIR = Path(os.getenv("WORK_DIR", "./downloads")).resolve()

if not (API_ID and API_HASH and BOT_TOKEN and OWNER_ID):
    log.error("Missing API_ID / API_HASH / BOT_TOKEN / OWNER_ID in .env")
    sys.exit(1)

WORK_DIR.mkdir(parents=True, exist_ok=True)

# Telegram bot upload cap ~ 2000 MB
MAX_UPLOAD_BYTES = 1_950 * 1024 * 1024

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def human_size(n: float) -> str:
    n = float(n or 0)
    for u in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.2f} {u}"
        n /= 1024
    return f"{n:.2f} PB"


def human_time(sec: float) -> str:
    sec = int(max(0, sec))
    h, r = divmod(sec, 3600)
    m, s = divmod(r, 60)
    if h:
        return f"{h}h {m}m {s}s"
    if m:
        return f"{m}m {s}s"
    return f"{s}s"


def bar(pct: float, width: int = 18) -> str:
    pct = max(0.0, min(100.0, pct))
    filled = int(width * pct / 100)
    return "█" * filled + "░" * (width - filled)


def progress_box(title: str, done: float, total: float, speed: float, eta: float) -> str:
    pct = (done / total * 100) if total else 0
    return (
        f"<b>{title}</b>\n"
        f"<code>[{bar(pct)}] {pct:5.1f}%</code>\n"
        f"┏━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"┃ 📦 <b>Size</b>  : <code>{human_size(done)} / {human_size(total)}</code>\n"
        f"┃ 🚀 <b>Speed</b> : <code>{human_size(speed)}/s</code>\n"
        f"┃ ⏱ <b>ETA</b>   : <code>{human_time(eta)}</code>\n"
        f"┗━━━━━━━━━━━━━━━━━━━━━━━━"
    )


# ---------------------------------------------------------------------------
# Job state
# ---------------------------------------------------------------------------
@dataclass
class Job:
    url: str
    formats: List[dict] = field(default_factory=list)
    title: str = "video"
    thumbnail: Optional[str] = None
    cancel: bool = False


JOBS: Dict[str, Job] = {}  # keyed by short id
USER_THUMB: Dict[int, str] = {}


def new_job(url: str) -> str:
    jid = uuid.uuid4().hex[:8]
    JOBS[jid] = Job(url=url)
    return jid


# ---------------------------------------------------------------------------
# yt-dlp: probe formats
# ---------------------------------------------------------------------------
def build_ydl_opts(extra: Optional[dict] = None) -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "nocheckcertificate": True,
        "geo_bypass": True,
        "retries": 20,
        "fragment_retries": 20,
        "concurrent_fragment_downloads": 8,
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0 Safari/537.36"
            ),
            "Referer": "https://www.dailymotion.com/",
        },
    }
    if extra:
        opts.update(extra)
    return opts


def probe_formats(url: str) -> dict:
    """Blocking probe — call via asyncio.to_thread."""
    from yt_dlp import YoutubeDL

    with YoutubeDL(build_ydl_opts()) as ydl:
        info = ydl.extract_info(url, download=False)
    return info or {}


def dailymotion_fallback(url: str) -> Optional[str]:
    m = re.search(r"/video/([A-Za-z0-9]+)", url)
    if m:
        return f"https://www.dailymotion.com/video/{m.group(1)}"
    return None


def pick_quality_list(info: dict) -> List[dict]:
    """Return a de-duplicated list of best video formats sorted by height desc."""
    out: List[dict] = []
    seen = set()
    for f in info.get("formats", []) or []:
        if not f.get("url"):
            continue
        vcodec = f.get("vcodec")
        if vcodec == "none":
            continue
        h = f.get("height") or 0
        proto = f.get("protocol", "")
        key = (h, proto, f.get("format_id"))
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "format_id": f.get("format_id"),
                "height": h,
                "ext": f.get("ext") or "mp4",
                "tbr": f.get("tbr") or 0,
                "filesize": f.get("filesize") or f.get("filesize_approx") or 0,
                "protocol": proto,
            }
        )
    out.sort(key=lambda x: (x["height"] or 0, x["tbr"] or 0), reverse=True)
    # Deduplicate by height, keep the highest bitrate per height
    by_h: Dict[int, dict] = {}
    for f in out:
        h = f["height"] or 0
        if h not in by_h:
            by_h[h] = f
    result = list(by_h.values())
    result.sort(key=lambda x: x["height"] or 0, reverse=True)
    return result[:10]


# ---------------------------------------------------------------------------
# yt-dlp: download with progress
# ---------------------------------------------------------------------------
async def download_format(job: Job, fmt_id: str, out_path: Path, on_progress) -> Path:
    from yt_dlp import YoutubeDL

    loop = asyncio.get_running_loop()
    last_call = [0.0]

    def hook(d: dict):
        try:
            if job.cancel:
                raise Exception("Cancelled by user")
            if d.get("status") == "downloading":
                now = time.time()
                if now - last_call[0] < 2.5:
                    return
                last_call[0] = now
                done = float(d.get("downloaded_bytes") or 0)
                total = float(d.get("total_bytes") or d.get("total_bytes_estimate") or 0)
                speed = float(d.get("speed") or 0)
                eta = float(d.get("eta") or 0)
                asyncio.run_coroutine_threadsafe(on_progress(done, total, speed, eta), loop)
        except Exception as e:
            if "Cancelled" in str(e):
                raise
            log.warning("progress hook error: %s", e)

    opts = build_ydl_opts(
        {
            "format": fmt_id,
            "outtmpl": str(out_path.with_suffix(".%(ext)s")),
            "merge_output_format": "mp4",
            "progress_hooks": [hook],
            "quiet": True,
            "no_warnings": True,
        }
    )

    def run() -> Path:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(job.url, download=True)
            filename = ydl.prepare_filename(info)
            p = Path(filename)
            # yt-dlp may have merged to mp4
            mp4 = p.with_suffix(".mp4")
            if mp4.exists():
                return mp4
            return p

    return await asyncio.to_thread(run)


# ---------------------------------------------------------------------------
# Safe message editor (avoids FloodWait spam)
# ---------------------------------------------------------------------------
async def safe_edit(msg: Message, text: str, reply_markup=None):
    try:
        await msg.edit_text(text, reply_markup=reply_markup, disable_web_page_preview=True)
    except MessageNotModified:
        pass
    except FloodWait as e:
        await asyncio.sleep(int(e.value) + 1)
    except Exception as e:
        log.warning("edit failed: %s", e)


# ---------------------------------------------------------------------------
# Pyrogram bot
# ---------------------------------------------------------------------------
app = Client(
    name="rs_dl_bot",
    api_id=API_ID,
    api_hash=API_HASH,
    bot_token=BOT_TOKEN,
    workdir=str(WORK_DIR),
    in_memory=False,
)

admin_filter = filters.user(OWNER_ID) & filters.private


@app.on_message(filters.command(["start", "help"]) & filters.private)
async def cmd_start(_, m: Message):
    if m.from_user.id != OWNER_ID:
        await m.reply_text("⛔ This bot is private.")
        return
    await m.reply_text(
        "👋 <b>RS Downloader Bot</b>\n\n"
        "Send any direct video URL (MP4 / M3U8 / MPD / Dailymotion CDN, etc.).\n"
        "I'll show quality buttons — pick one, and I'll download + upload it back.\n\n"
        "<b>Commands</b>\n"
        "• /thumb — reply to a photo to set custom thumbnail\n"
        "• /clearthumb — remove your thumbnail\n"
        "• /cancel — cancel current job"
    )


@app.on_message(filters.command("clearthumb") & admin_filter)
async def cmd_clear_thumb(_, m: Message):
    USER_THUMB.pop(m.from_user.id, None)
    await m.reply_text("🗑 Custom thumbnail removed.")


@app.on_message(filters.command("thumb") & admin_filter)
async def cmd_thumb(_, m: Message):
    target = m.reply_to_message if m.reply_to_message and m.reply_to_message.photo else None
    if not target:
        await m.reply_text("Reply to a photo with /thumb to save it.")
        return
    path = WORK_DIR / f"thumb_{m.from_user.id}.jpg"
    await target.download(file_name=str(path))
    USER_THUMB[m.from_user.id] = str(path)
    await m.reply_text("✅ Thumbnail saved. It will be used for future uploads.")


@app.on_message(filters.command("cancel") & admin_filter)
async def cmd_cancel(_, m: Message):
    n = 0
    for job in JOBS.values():
        job.cancel = True
        n += 1
    await m.reply_text(f"🛑 Cancel flag set on {n} job(s).")


URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)


@app.on_message(filters.text & admin_filter & ~filters.command(["start", "help", "thumb", "clearthumb", "cancel"]))
async def handle_url(_, m: Message):
    match = URL_RE.search(m.text or "")
    if not match:
        return
    url = match.group(0)
    log.info("URL received from %s: %s", m.from_user.id, url)

    status = await m.reply_text("🔎 Probing URL…", quote=True)

    info: dict = {}
    error: Optional[str] = None
    try:
        info = await asyncio.to_thread(probe_formats, url)
    except Exception as e:
        error = str(e)
        log.warning("probe failed: %s", error)

    if not info or not info.get("formats"):
        fb = dailymotion_fallback(url)
        if fb and fb != url:
            log.info("Trying Dailymotion page fallback: %s", fb)
            try:
                info = await asyncio.to_thread(probe_formats, fb)
                url = fb
            except Exception as e:
                error = str(e)
                log.error("fallback probe failed: %s", error)

    if not info:
        await safe_edit(status, f"❌ Could not read this URL.\n<code>{error or 'no info'}</code>")
        return

    fmts = pick_quality_list(info)
    if not fmts:
        # Fallback: single "best" option
        fmts = [{"format_id": "best", "height": 0, "ext": "mp4", "tbr": 0, "filesize": 0, "protocol": ""}]

    jid = new_job(url)
    JOBS[jid].formats = fmts
    JOBS[jid].title = (info.get("title") or "video")[:80]

    buttons = []
    row = []
    for idx, f in enumerate(fmts):
        label = f"{f['height']}p" if f["height"] else "Best"
        if f["filesize"]:
            label += f" • {human_size(f['filesize'])}"
        row.append(InlineKeyboardButton(label, callback_data=f"dl|{jid}|{idx}"))
        if len(row) == 2:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    buttons.append([InlineKeyboardButton("❌ Cancel", callback_data=f"x|{jid}")])

    await safe_edit(
        status,
        f"🎬 <b>{JOBS[jid].title}</b>\nPick a quality:",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


@app.on_callback_query(filters.user(OWNER_ID))
async def on_cb(_, cq: CallbackQuery):
    data = cq.data or ""
    parts = data.split("|")
    action = parts[0]

    if action == "x" and len(parts) >= 2:
        job = JOBS.get(parts[1])
        if job:
            job.cancel = True
        await cq.answer("Cancelled.")
        await safe_edit(cq.message, "🛑 Cancelled.")
        return

    if action != "dl" or len(parts) < 3:
        await cq.answer()
        return

    jid, idx = parts[1], int(parts[2])
    job = JOBS.get(jid)
    if not job:
        await cq.answer("Session expired. Resend the URL.", show_alert=True)
        return
    if idx >= len(job.formats):
        await cq.answer("Bad selection.")
        return

    fmt = job.formats[idx]
    await cq.answer(f"Starting {fmt['height'] or 'best'}p…")

    status = cq.message
    tmpdir = WORK_DIR / jid
    tmpdir.mkdir(parents=True, exist_ok=True)
    out_base = tmpdir / re.sub(r"[^\w\- ]+", "_", job.title)[:60]

    async def on_dl_progress(done, total, speed, eta):
        await safe_edit(status, progress_box("⬇️ Downloading", done, total, speed, eta))

    try:
        await safe_edit(status, "⏳ Starting download…")
        file_path = await download_format(job, fmt["format_id"], out_base, on_dl_progress)
        log.info("downloaded: %s (%s)", file_path, human_size(file_path.stat().st_size))

        size = file_path.stat().st_size
        if size > MAX_UPLOAD_BYTES:
            await safe_edit(status, f"⚠️ File is {human_size(size)}, exceeds bot upload cap (~1.95 GB). Aborting.")
            return

        # Upload
        start = time.time()
        last = [0.0]

        async def up_progress(cur, tot):
            now = time.time()
            if now - last[0] < 2.5 and cur < tot:
                return
            last[0] = now
            elapsed = max(0.001, now - start)
            speed = cur / elapsed
            eta = (tot - cur) / speed if speed else 0
            await safe_edit(status, progress_box("⬆️ Uploading", cur, tot, speed, eta))

        thumb = USER_THUMB.get(cq.from_user.id)
        caption = f"🎬 <b>{job.title}</b>\n📐 {fmt['height'] or '?'}p • 💾 {human_size(size)}"

        await cq.message.reply_video(
            video=str(file_path),
            caption=caption,
            thumb=thumb if thumb and os.path.exists(thumb) else None,
            supports_streaming=True,
            progress=up_progress,
        )
        await safe_edit(status, f"✅ <b>Done</b>\n{caption}")
        log.info("upload complete for %s", jid)
    except Exception as e:
        tb = traceback.format_exc()
        log.error("Job %s failed: %s\n%s", jid, e, tb)
        await safe_edit(status, f"❌ <b>Failed</b>\n<code>{str(e)[:500]}</code>")
    finally:
        JOBS.pop(jid, None)
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    log.info("Starting RS Downloader Bot — owner=%s workdir=%s", OWNER_ID, WORK_DIR)
    try:
        app.run()
    except Exception:
        log.error("Bot crashed:\n%s", traceback.format_exc())
        raise
