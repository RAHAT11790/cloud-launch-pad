"""
RS Anime — Telegram Video Downloader Bot
=========================================
Send any direct MP4 / M3U8 / MPD / yt-dlp supported URL. The bot probes available
qualities, shows inline buttons, downloads via yt-dlp + ffmpeg, and uploads back
to Telegram with a live progress bar. Supports up to 2 GB per file (4 GB with a
Premium user session).

Features
--------
* Pyrogram v2 async, fully non-blocking
* Multi-quality picker (auto-detected from the source manifest)
* Live progress bars for both download and upload (rate-limited, no flood)
* Custom thumbnail — send a photo with `/thumb`, the next upload uses it
* HLS / DASH remuxing to MP4 via ffmpeg (copy codec = fast, no re-encode)
* 2 GB safe: auto-splits with ffmpeg if the file exceeds Telegram's cap
* Robust cleanup, retry with backoff, cancel button per job
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import math
import os
import re
import shutil
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from dotenv import load_dotenv
from pyrogram import Client, filters
from pyrogram.enums import ParseMode
from pyrogram.errors import FloodWait, MessageNotModified
from pyrogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
load_dotenv()

API_ID = int(os.getenv("API_ID", "0"))
API_HASH = os.getenv("API_HASH", "")
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
OWNER_ID = int(os.getenv("OWNER_ID") or 0)
USER_SESSION = os.getenv("USER_SESSION", "").strip()
BOT_API_SERVER = os.getenv("BOT_API_SERVER", "").strip()
WORK_DIR = Path(os.getenv("WORK_DIR", "./downloads")).resolve()
WORK_DIR.mkdir(parents=True, exist_ok=True)

# Telegram limits: 2000 MiB for bots (with local Bot API) / 2 GB for users / 4 GB Premium
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024 - 32 * 1024 * 1024  # ~1.97 GB safety
PROGRESS_INTERVAL = 3.0  # seconds between progress edits (avoid FloodWait)

if not (API_ID and API_HASH and BOT_TOKEN):
    raise SystemExit("Set API_ID, API_HASH, BOT_TOKEN in .env")

# ---------------------------------------------------------------------------
# Pyrogram clients
# ---------------------------------------------------------------------------
bot_kwargs: dict = dict(
    name="rs_downloader_bot",
    api_id=API_ID,
    api_hash=API_HASH,
    bot_token=BOT_TOKEN,
    workdir=str(WORK_DIR),
    parse_mode=ParseMode.HTML,
    sleep_threshold=30,
)
if BOT_API_SERVER:
    bot_kwargs["bot_api_server"] = BOT_API_SERVER
bot = Client(**bot_kwargs)

# Optional user client for 2 GB uploads
user: Optional[Client] = None
if USER_SESSION:
    user = Client(
        name="rs_downloader_user",
        api_id=API_ID,
        api_hash=API_HASH,
        session_string=USER_SESSION,
        workdir=str(WORK_DIR),
        parse_mode=ParseMode.HTML,
        sleep_threshold=30,
    )

# ---------------------------------------------------------------------------
# In-memory job state
# ---------------------------------------------------------------------------
@dataclass
class Job:
    job_id: str
    url: str
    chat_id: int
    user_id: int
    status_msg_id: int
    formats: List[dict] = field(default_factory=list)
    cancel: asyncio.Event = field(default_factory=asyncio.Event)
    process: Optional[asyncio.subprocess.Process] = None


JOBS: Dict[str, Job] = {}
THUMBS: Dict[int, Path] = {}  # user_id -> thumbnail path


# ---------------------------------------------------------------------------
# Dailymotion helper — signed CDN manifest URLs are IP + time bound. If the VPS
# gets 403, we automatically retry with the canonical dailymotion.com page URL
# so yt-dlp can mint a fresh token from the VPS's own IP.
# ---------------------------------------------------------------------------
DM_CDN_RE = re.compile(r"dailymotion\.com/cdn/[^?#]*?/video/([a-z0-9]+)\.m3u8", re.IGNORECASE)


def dailymotion_page_fallback(url: str) -> Optional[str]:
    m = DM_CDN_RE.search(url)
    return f"https://www.dailymotion.com/video/{m.group(1)}" if m else None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)


def human_size(n: float) -> str:
    if not n or n < 0:
        return "?"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.2f} {unit}"
        n /= 1024
    return f"{n:.2f} PB"


def bar(pct: float, width: int = 18) -> str:
    pct = max(0.0, min(100.0, pct))
    filled = int(pct * width / 100)
    return "▰" * filled + "▱" * (width - filled)


async def safe_edit(msg: Message, text: str, reply_markup=None) -> None:
    try:
        await msg.edit_text(text, reply_markup=reply_markup, disable_web_page_preview=True)
    except MessageNotModified:
        pass
    except FloodWait as e:
        await asyncio.sleep(e.value + 1)
    except Exception:
        pass


async def run_capture(*args: str, timeout: int = 120) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            proc.kill()
        return 124, "", "timeout"
    return proc.returncode or 0, out.decode(errors="ignore"), err.decode(errors="ignore")


# ---------------------------------------------------------------------------
# yt-dlp probing
# ---------------------------------------------------------------------------
async def probe_formats(url: str) -> List[dict]:
    """Return a de-duplicated list of downloadable video qualities.

    Robust for direct .m3u8 / .mpd / .mp4 links (Dailymotion CDN, custom CDNs)
    and for regular site URLs (YouTube, Vimeo, etc.). If yt-dlp cannot enumerate
    variants, we still return a synthetic 'Best' entry so the user can proceed.
    """
    
    async def _probe(u: str) -> tuple[int, str, str]:
        return await run_capture(
            "yt-dlp", "-J", "--no-warnings", "--no-playlist", "--allow-unplayable-formats",
            "--add-header", "Referer: https://www.dailymotion.com/",
            "--add-header", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            u, timeout=90,
        )

    code, out, err = await _probe(url)
    if code != 0 or not out.strip():
        fb = dailymotion_page_fallback(url)
        if fb:
            code, out, err = await _probe(fb)
    formats: List[dict] = []
    if code == 0 and out.strip():
        try:
            info = json.loads(out)
        except Exception:
            info = {}
        entries = info.get("entries") or [info]
        for entry in entries:
            for f in entry.get("formats") or []:
                if f.get("vcodec") in (None, "none"):
                    continue
                height = f.get("height") or 0
                ext = f.get("ext") or "mp4"
                fmt_id = f.get("format_id")
                fs = f.get("filesize") or f.get("filesize_approx") or 0
                proto = f.get("protocol") or ""
                tbr = f.get("tbr") or 0
                if not fmt_id:
                    continue
                label = f"{height}p" if height else (f.get("format_note") or fmt_id)
                formats.append({
                    "id": fmt_id,
                    "label": label,
                    "height": height,
                    "ext": ext,
                    "protocol": proto,
                    "size": fs,
                    "tbr": tbr,
                })

    # collapse duplicates by height, prefer highest tbr / largest known size
    best: Dict[int, dict] = {}
    for f in formats:
        key = f["height"] or int(f["tbr"] or 0)
        if key not in best or (f["size"] or 0) > (best[key]["size"] or 0):
            best[key] = f
    ordered = sorted(best.values(), key=lambda x: (x["height"] or x["tbr"] or 0), reverse=True)
    # Always add a "Best (auto)" fallback so direct m3u8 / mp4 links always have a button.
    ordered.insert(0, {"id": "best", "label": "Best (auto)", "height": 0, "ext": "mp4", "protocol": "", "size": 0, "tbr": 0})
    return ordered[:8]


# ---------------------------------------------------------------------------
# Download + upload
# ---------------------------------------------------------------------------
async def download_with_ytdlp(job: Job, format_id: str, status: Message) -> Path:
    out_tpl = str(WORK_DIR / f"{job.job_id}.%(ext)s")
    cmd = [
        "yt-dlp",
        "--no-warnings",
        "--no-playlist",
        "--newline",
        "--progress",
        "--concurrent-fragments", "8",
        "--retries", "10",
        "--fragment-retries", "20",
        "--http-chunk-size", "10M",
        "--merge-output-format", "mp4",
        "--hls-prefer-ffmpeg",
        "--add-header", "Referer: https://www.dailymotion.com/",
        "--add-header", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "-f", f"{format_id}+bestaudio/best/{format_id}" if format_id != "best" else "bv*+ba/b/best",
        "-o", out_tpl,
        job.url,
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    job.process = proc

    last_edit = 0.0
    percent_re = re.compile(r"(\d{1,3}\.\d)%\s+of\s+~?\s*([\d.]+\s*[KMGT]?i?B)?.*?at\s+([\d.]+\s*[KMGT]?i?B/s)?.*?ETA\s+(\S+)?")
    assert proc.stdout is not None
    while True:
        if job.cancel.is_set():
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
            raise asyncio.CancelledError()
        line = await proc.stdout.readline()
        if not line:
            break
        text = line.decode(errors="ignore").strip()
        m = percent_re.search(text)
        if m and time.time() - last_edit > PROGRESS_INTERVAL:
            pct = float(m.group(1))
            total = m.group(2) or "?"
            speed = m.group(3) or "?"
            eta = m.group(4) or "?"
            await safe_edit(
                status,
                f"⬇️ <b>Downloading</b>\n<code>{bar(pct)}</code> {pct:.1f}%\n"
                f"📦 {total}   🚀 {speed}   ⏳ {eta}",
                reply_markup=cancel_kb(job.job_id),
            )
            last_edit = time.time()

    rc = await proc.wait()
    if rc != 0:
        raise RuntimeError(f"yt-dlp exited with code {rc}")

    # find produced file
    for p in WORK_DIR.glob(f"{job.job_id}.*"):
        if p.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}:
            return p
    raise RuntimeError("Downloaded file not found")


async def maybe_split(path: Path) -> List[Path]:
    """Split into <2 GB parts using ffmpeg if the file is too large."""
    size = path.stat().st_size
    if size <= MAX_UPLOAD_BYTES:
        return [path]

    # get duration
    code, out, _ = await run_capture(
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", str(path), timeout=30,
    )
    dur = float(out.strip() or 0)
    if dur <= 0:
        return [path]

    parts_count = math.ceil(size / MAX_UPLOAD_BYTES)
    seg = math.ceil(dur / parts_count) + 1
    stem = path.with_suffix("")
    pattern = f"{stem}.part%03d{path.suffix}"
    await run_capture(
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
        "-c", "copy", "-map", "0", "-f", "segment", "-segment_time", str(seg),
        "-reset_timestamps", "1", pattern, timeout=3600,
    )
    parts = sorted(WORK_DIR.glob(f"{path.stem}.part*{path.suffix}"))
    return parts or [path]


def cancel_kb(job_id: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[InlineKeyboardButton("✖ Cancel", callback_data=f"cx|{job_id}")]])


def make_progress(status: Message, label: str, job: Job):
    state = {"t": 0.0}

    async def cb(current: int, total: int):
        if job.cancel.is_set():
            raise asyncio.CancelledError()
        now = time.time()
        if now - state["t"] < PROGRESS_INTERVAL:
            return
        state["t"] = now
        pct = (current / total * 100) if total else 0
        await safe_edit(
            status,
            f"⬆️ <b>{label}</b>\n<code>{bar(pct)}</code> {pct:.1f}%\n"
            f"📦 {human_size(current)} / {human_size(total)}",
            reply_markup=cancel_kb(job.job_id),
        )

    return cb


async def upload_file(job: Job, path: Path, status: Message, caption: str) -> None:
    client = user or bot  # user client handles larger files
    thumb = str(THUMBS[job.user_id]) if THUMBS.get(job.user_id) else None
    parts = await maybe_split(path)

    for idx, part in enumerate(parts, 1):
        label = f"Uploading{' part ' + str(idx) if len(parts) > 1 else ''}"
        cap = caption + (f"\n<b>Part {idx}/{len(parts)}</b>" if len(parts) > 1 else "")
        try:
            await client.send_video(
                chat_id=job.chat_id,
                video=str(part),
                caption=cap,
                supports_streaming=True,
                thumb=thumb,
                progress=make_progress(status, label, job),
            )
        except FloodWait as e:
            await asyncio.sleep(e.value + 1)
            await client.send_video(
                chat_id=job.chat_id, video=str(part), caption=cap,
                supports_streaming=True, thumb=thumb,
                progress=make_progress(status, label, job),
            )
        finally:
            with contextlib.suppress(Exception):
                part.unlink()


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------
def auth_guard(uid: int) -> bool:
    return not OWNER_ID or uid == OWNER_ID


@bot.on_message(filters.command(["start", "help"]))
async def on_start(_, m: Message):
    await m.reply(
        "<b>RS Anime — Video Downloader</b>\n\n"
        "Send any direct video link (MP4 / M3U8 / MPD or a yt-dlp supported URL) "
        "and I'll fetch the available qualities. Pick one and I'll download + upload it here.\n\n"
        "• Up to <b>2 GB</b> per file (auto-split if larger)\n"
        "• Send a photo with caption <code>/thumb</code> to set a custom thumbnail\n"
        "• <code>/clearthumb</code> to remove it\n"
        "• <code>/cancel</code> to abort the current job\n",
    )


@bot.on_message(filters.command("thumb") & filters.photo)
async def on_thumb(_, m: Message):
    if not auth_guard(m.from_user.id):
        return
    path = WORK_DIR / f"thumb_{m.from_user.id}.jpg"
    await m.download(file_name=str(path))
    THUMBS[m.from_user.id] = path
    await m.reply("✅ Thumbnail saved. It will be used for your next upload.")


@bot.on_message(filters.command("clearthumb"))
async def on_clearthumb(_, m: Message):
    p = THUMBS.pop(m.from_user.id, None)
    if p:
        with contextlib.suppress(Exception):
            Path(p).unlink()
    await m.reply("🧹 Thumbnail cleared.")


@bot.on_message(filters.command("cancel"))
async def on_cancel(_, m: Message):
    mine = [j for j in JOBS.values() if j.user_id == m.from_user.id]
    if not mine:
        await m.reply("Nothing to cancel.")
        return
    for j in mine:
        j.cancel.set()
    await m.reply(f"🛑 Cancelling {len(mine)} job(s)…")


@bot.on_message(filters.text & ~filters.command(["start", "help", "thumb", "clearthumb", "cancel"]))
async def on_url(_, m: Message):
    if not auth_guard(m.from_user.id):
        return
    match = URL_RE.search(m.text or "")
    if not match:
        await m.reply("Send a valid https URL.")
        return
    url = match.group(0)

    status = await m.reply("🔎 Probing available qualities…")
    try:
        formats = await probe_formats(url)
    except Exception as e:
        await safe_edit(status, f"❌ Could not read this link.\n<code>{e}</code>")
        return
    if not formats:
        await safe_edit(status, "❌ No downloadable video streams found.")
        return

    job_id = uuid.uuid4().hex[:10]
    JOBS[job_id] = Job(job_id=job_id, url=url, chat_id=m.chat.id, user_id=m.from_user.id, status_msg_id=status.id, formats=formats)

    rows: List[List[InlineKeyboardButton]] = []
    row: List[InlineKeyboardButton] = []
    for i, f in enumerate(formats):
        size = f" · {human_size(f['size'])}" if f["size"] else ""
        row.append(InlineKeyboardButton(f"{f['label']}{size}", callback_data=f"dl|{job_id}|{i}"))
        if len(row) == 2:
            rows.append(row); row = []
    if row: rows.append(row)
    rows.append([InlineKeyboardButton("✖ Cancel", callback_data=f"cx|{job_id}")])

    await safe_edit(status, "🎬 <b>Choose quality:</b>", reply_markup=InlineKeyboardMarkup(rows))


@bot.on_callback_query(filters.regex(r"^cx\|"))
async def on_cx(_, cq: CallbackQuery):
    _, job_id = cq.data.split("|", 1)
    job = JOBS.get(job_id)
    if job:
        job.cancel.set()
    await cq.answer("Cancelling…")


@bot.on_callback_query(filters.regex(r"^dl\|"))
async def on_dl(_, cq: CallbackQuery):
    _, job_id, idx_s = cq.data.split("|", 2)
    job = JOBS.get(job_id)
    if not job:
        await cq.answer("Session expired.", show_alert=True); return
    if job.user_id != cq.from_user.id and not auth_guard(cq.from_user.id):
        await cq.answer("Not your job.", show_alert=True); return

    fmt = job.formats[int(idx_s)]
    await cq.answer(f"Starting {fmt['label']}…")
    status = cq.message
    started = time.time()
    file_path: Optional[Path] = None
    try:
        await safe_edit(status, f"⬇️ Preparing <b>{fmt['label']}</b>…", reply_markup=cancel_kb(job_id))
        file_path = await download_with_ytdlp(job, fmt["id"], status)
        size = file_path.stat().st_size
        await safe_edit(
            status,
            f"✅ Download complete — {human_size(size)}\n⬆️ Uploading to Telegram…",
            reply_markup=cancel_kb(job_id),
        )
        caption = (
            f"🎬 <b>{fmt['label']}</b>\n"
            f"📦 {human_size(size)}\n"
            f"⏱ {int(time.time() - started)}s\n"
            f"🔗 <a href=\"{job.url}\">source</a>"
        )
        await upload_file(job, file_path, status, caption)
        await safe_edit(status, "✅ <b>Done.</b>")
    except asyncio.CancelledError:
        await safe_edit(status, "🛑 Cancelled.")
    except Exception as e:
        await safe_edit(status, f"❌ Failed.\n<code>{e}</code>")
    finally:
        JOBS.pop(job_id, None)
        if file_path and file_path.exists():
            with contextlib.suppress(Exception):
                file_path.unlink()
        for leftover in WORK_DIR.glob(f"{job_id}.*"):
            with contextlib.suppress(Exception):
                leftover.unlink()


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
async def _pre_flight() -> None:
    for tool in ("yt-dlp", "ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise SystemExit(f"Missing required binary: {tool}. Install it before running the bot.")


async def main() -> None:
    await _pre_flight()
    async with bot:
        if user:
            await user.start()
        print("Bot is up. Send a video URL.")
        try:
            await asyncio.Event().wait()
        finally:
            if user:
                await user.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        pass
