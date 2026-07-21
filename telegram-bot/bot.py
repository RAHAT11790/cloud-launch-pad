"""
RS Anime — Telegram Video Downloader Bot (Admin-only, no .env)
==============================================================
সব config নিচে CONFIG block-এ hardcoded। শুধু ৪টা value বদলাও, তারপর:

    pip install -r requirements.txt
    python3 bot.py

Bot শুধু OWNER_ID-এর মালিককেই reply দেবে।
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ═══════════════════════════════════════════════════════════════
# 🔧 CONFIG — এই মানগুলো বদলাও, আর কিছু লাগবে না
# ═══════════════════════════════════════════════════════════════
API_ID    = 1234567                       # https://my.telegram.org/apps
API_HASH  = "your_api_hash_here"          # https://my.telegram.org/apps
BOT_TOKEN = "123456:ABC-DEF..."           # @BotFather থেকে
OWNER_ID  = 123456789                     # @userinfobot — শুধু এই user bot use করতে পারবে

# 🌐 PUBLIC URL (Railway/VPS) — এইটাই তোমার "public IP"-এর কাজ করবে।
# Railway-এর Public Networking domain বসাও (https সহ, শেষে / নেই)।
# উদাহরণ: "https://rsstreambot-production.up.railway.app"
# খালি রাখলে file-server চলবে ঠিকই কিন্তু public link দেবে না।
PUBLIC_URL = "https://rsstreambot-production.up.railway.app"

# HTTP file-server port। Railway auto-set করে $PORT env-এ (usually 8080)।
# TCP Proxy দরকার নেই — Railway এর built-in HTTPS domain-ই যথেষ্ট।
HTTP_PORT  = int(os.environ.get("PORT", "8080"))
# ═══════════════════════════════════════════════════════════════

WORK_DIR   = Path("./downloads").resolve()
PUBLIC_DIR = Path("./public").resolve()     # served over HTTP
MAX_UPLOAD_BYTES = 1_950 * 1024 * 1024    # ~1.95 GB (bot upload cap)

# ── Logging: সব stdout-এ, log-এ সব দেখা যাবে ──────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
    force=True,
)
logging.getLogger("pyrogram").setLevel(logging.WARNING)
log = logging.getLogger("rs-bot")

# ── Sanity check ──────────────────────────────────────────────
if (
    not isinstance(API_ID, int) or API_ID <= 0
    or not API_HASH or "your_api_hash" in API_HASH
    or not BOT_TOKEN or "ABC-DEF" in BOT_TOKEN
    or not isinstance(OWNER_ID, int) or OWNER_ID <= 0
):
    log.error("❌ CONFIG ঠিক নেই। bot.py-এর উপরে API_ID / API_HASH / BOT_TOKEN / OWNER_ID বসাও।")
    sys.exit(1)

WORK_DIR.mkdir(parents=True, exist_ok=True)
PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

# ── Pyrogram import (installed check) ─────────────────────────
try:
    from pyrogram import Client, filters
    from pyrogram.errors import FloodWait, MessageNotModified
    from pyrogram.types import (
        CallbackQuery,
        InlineKeyboardButton,
        InlineKeyboardMarkup,
        Message,
    )
except ImportError as e:
    log.error("❌ Pyrogram install হয়নি: %s\n   চালাও:  pip install -r requirements.txt", e)
    sys.exit(1)

try:
    import yt_dlp  # noqa: F401
except ImportError as e:
    log.error("❌ yt-dlp install হয়নি: %s", e)
    sys.exit(1)

try:
    from aiohttp import web  # HTTP file server
except ImportError as e:
    log.error("❌ aiohttp install হয়নি: %s\n   চালাও:  pip install -r requirements.txt", e)
    sys.exit(1)


# ═══════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════
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


def bar(pct: float, width: int = 22) -> str:
    pct = max(0.0, min(100.0, pct))
    filled = int(width * pct / 100)
    return "█" * filled + "░" * (width - filled)


def progress_box(title: str, done: float, total: float, speed: float, eta: float) -> str:
    """Professional monospace box (Telegram <pre> keeps it aligned)."""
    pct = (done / total * 100) if total else 0
    line = "─" * 30
    body = (
        f"┌{line}┐\n"
        f"│ {title:<28} │\n"
        f"├{line}┤\n"
        f"│ [{bar(pct)}] {pct:5.1f}% │\n"
        f"├{line}┤\n"
        f"│ 📦 Size  : {human_size(done)} / {human_size(total)}\n"
        f"│ 🚀 Speed : {human_size(speed)}/s\n"
        f"│ ⏱  ETA   : {human_time(eta)}\n"
        f"└{line}┘"
    )
    return f"<pre>{body}</pre>"


# ═══════════════════════════════════════════════════════════════
# Job state
# ═══════════════════════════════════════════════════════════════
@dataclass
class Job:
    url: str
    formats: List[dict] = field(default_factory=list)
    title: str = "video"
    cancel: bool = False


JOBS: Dict[str, Job] = {}
USER_THUMB: Dict[int, str] = {}


# ═══════════════════════════════════════════════════════════════
# yt-dlp helpers
# ═══════════════════════════════════════════════════════════════
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0 Safari/537.36"
)


def default_headers(url: str) -> Dict[str, str]:
    ref = "https://www.dailymotion.com/" if "dailymotion" in url else ""
    origin = "https://www.dailymotion.com" if "dailymotion" in url else ""
    h = {
        "User-Agent": BROWSER_UA,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if ref:
        h["Referer"] = ref
    if origin:
        h["Origin"] = origin
    return h


def build_ydl_opts(url: str, extra: Optional[dict] = None) -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "nocheckcertificate": True,
        "geo_bypass": True,
        "retries": 20,
        "fragment_retries": 20,
        "concurrent_fragment_downloads": 8,
        "http_headers": default_headers(url),
    }
    if extra:
        opts.update(extra)
    return opts


def is_direct_manifest(url: str) -> bool:
    u = url.lower().split("?", 1)[0]
    return u.endswith(".m3u8") or u.endswith(".mpd") or "/manifest/" in u


def http_get(url: str, headers: Dict[str, str], timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def parse_m3u8_variants(manifest_text: str, base_url: str) -> List[dict]:
    lines = manifest_text.splitlines()
    variants: List[dict] = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("#EXT-X-STREAM-INF"):
            bw = 0
            height = 0
            m = re.search(r"BANDWIDTH=(\d+)", line)
            if m:
                bw = int(m.group(1))
            m = re.search(r"RESOLUTION=\d+x(\d+)", line)
            if m:
                height = int(m.group(1))
            j = i + 1
            while j < len(lines) and (not lines[j].strip() or lines[j].startswith("#")):
                j += 1
            if j < len(lines):
                sub = lines[j].strip()
                full = urllib.parse.urljoin(base_url, sub)
                variants.append({"height": height, "bandwidth": bw, "url": full})
            i = j
        i += 1
    by_h: Dict[int, dict] = {}
    for v in sorted(variants, key=lambda x: (x["height"], x["bandwidth"]), reverse=True):
        by_h.setdefault(v["height"], v)
    return sorted(by_h.values(), key=lambda x: x["height"], reverse=True)


def probe_direct_manifest(url: str) -> dict:
    """Fetch master HLS manifest directly (bypass yt-dlp extractors)."""
    headers = default_headers(url)
    raw = http_get(url, headers, timeout=20)
    text = raw.decode("utf-8", errors="ignore")
    if "#EXTM3U" not in text:
        raise RuntimeError("Not a valid HLS manifest (no #EXTM3U)")

    variants = parse_m3u8_variants(text, url)
    if not variants:
        variants = [{"height": 0, "bandwidth": 0, "url": url}]

    formats = [{
        "format_id": f"hls-{i}",
        "height": v["height"],
        "ext": "mp4",
        "tbr": (v["bandwidth"] / 1000) if v["bandwidth"] else 0,
        "filesize": 0,
        "url": v["url"],
    } for i, v in enumerate(variants)]

    title = re.sub(r"[^\w\-]+", "_", urllib.parse.urlparse(url).path.split("/")[-1] or "video")[:60] or "video"
    return {"title": title, "formats": formats, "_direct_hls": True}


def probe_formats(url: str) -> dict:
    if is_direct_manifest(url):
        return probe_direct_manifest(url)
    from yt_dlp import YoutubeDL
    with YoutubeDL(build_ydl_opts(url)) as ydl:
        return ydl.extract_info(url, download=False) or {}


def dailymotion_fallback(url: str) -> Optional[str]:
    m = re.search(r"/video/([A-Za-z0-9]+)", url)
    return f"https://www.dailymotion.com/video/{m.group(1)}" if m else None


def pick_quality_list(info: dict) -> List[dict]:
    if info.get("_direct_hls"):
        return info["formats"][:10]
    out: List[dict] = []
    for f in info.get("formats", []) or []:
        if not f.get("url") or f.get("vcodec") == "none":
            continue
        out.append({
            "format_id": f.get("format_id"),
            "height": f.get("height") or 0,
            "ext": f.get("ext") or "mp4",
            "tbr": f.get("tbr") or 0,
            "filesize": f.get("filesize") or f.get("filesize_approx") or 0,
            "url": f.get("url"),
        })
    by_h: Dict[int, dict] = {}
    for f in sorted(out, key=lambda x: (x["height"], x["tbr"]), reverse=True):
        by_h.setdefault(f["height"], f)
    return sorted(by_h.values(), key=lambda x: x["height"], reverse=True)[:10]


_hls_duration: Dict[str, float] = {}


async def ffmpeg_download_hls(variant_url: str, referer: str, out_base: Path, on_progress, cancel_flag) -> Path:
    """Download an HLS variant via ffmpeg → mp4 (stream copy, no re-encode)."""
    headers_line = (
        f"Referer: {referer}\r\n"
        f"User-Agent: {BROWSER_UA}\r\n"
        f"Origin: {referer.rstrip('/')}\r\n"
    )
    out_file = out_base.with_suffix(".mp4")
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "info", "-nostdin", "-y",
        "-headers", headers_line,
        "-user_agent", BROWSER_UA,
        "-referer", referer,
        "-reconnect", "1", "-reconnect_streamed", "1",
        "-reconnect_delay_max", "10",
        "-i", variant_url,
        "-c", "copy",
        "-bsf:a", "aac_adtstoasc",
        "-movflags", "+faststart",
        "-progress", "pipe:1",
        str(out_file),
    ]
    log.info("ffmpeg start: %s → %s", variant_url[:80], out_file.name)

    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )

    duration = [0.0]
    tail: List[str] = []

    async def pump_err():
        assert proc.stderr is not None
        while True:
            line = await proc.stderr.readline()
            if not line:
                break
            s = line.decode(errors="ignore").rstrip()
            if "Duration:" in s and duration[0] == 0:
                m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", s)
                if m:
                    duration[0] = int(m.group(1))*3600 + int(m.group(2))*60 + float(m.group(3))
            tail.append(s)
            if len(tail) > 60:
                tail.pop(0)

    err_task = asyncio.create_task(pump_err())

    start = time.time()
    last = 0.0
    total_us = 0
    assert proc.stdout is not None
    try:
        while True:
            if cancel_flag():
                proc.kill()
                raise RuntimeError("Cancelled by user")
            raw = await proc.stdout.readline()
            if not raw:
                break
            line = raw.decode(errors="ignore").strip()
            if line.startswith("out_time_us="):
                try:
                    total_us = int(line.split("=", 1)[1])
                except ValueError:
                    pass
            elif line == "progress=end":
                break
            now = time.time()
            if now - last >= 2.0:
                last = now
                secs = total_us / 1_000_000
                done = out_file.stat().st_size if out_file.exists() else 0
                pct_time = (secs / duration[0]) if duration[0] else 0
                est_total = int(done / pct_time) if pct_time > 0.01 else 0
                elapsed = max(0.001, now - start)
                speed = done / elapsed
                eta = (est_total - done) / speed if (est_total and speed) else 0
                try:
                    await on_progress(done, est_total, speed, eta)
                except Exception:
                    pass
    finally:
        rc = await proc.wait()
        err_task.cancel()

    if rc != 0 or not out_file.exists() or out_file.stat().st_size == 0:
        raise RuntimeError(f"ffmpeg failed (rc={rc}):\n" + "\n".join(tail[-15:])[:800])
    return out_file


async def download_format(job: "Job", fmt: dict, out_base: Path, on_progress) -> Path:
    # HLS variant → ffmpeg
    if fmt.get("url") and (".m3u8" in fmt["url"] or "/manifest/" in fmt["url"]):
        referer = "https://www.dailymotion.com/" if "dailymotion" in fmt["url"] else job.url
        return await ffmpeg_download_hls(fmt["url"], referer, out_base, on_progress, lambda: job.cancel)

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

    opts = build_ydl_opts(job.url, {
        "format": fmt["format_id"],
        "outtmpl": str(out_base.with_suffix(".%(ext)s")),
        "merge_output_format": "mp4",
        "progress_hooks": [hook],
    })

    def run() -> Path:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(job.url, download=True)
            filename = ydl.prepare_filename(info)
            p = Path(filename)
            mp4 = p.with_suffix(".mp4")
            return mp4 if mp4.exists() else p

    return await asyncio.to_thread(run)


# ═══════════════════════════════════════════════════════════════
# Pyrogram client
# ═══════════════════════════════════════════════════════════════
app = Client(
    name="rs_dl_bot",
    api_id=API_ID,
    api_hash=API_HASH,
    bot_token=BOT_TOKEN,
    workdir=str(WORK_DIR),
    parse_mode=__import__("pyrogram").enums.ParseMode.HTML,
    in_memory=False,
)


async def safe_edit(msg: Message, text: str, reply_markup=None):
    try:
        await msg.edit_text(text, reply_markup=reply_markup, disable_web_page_preview=True)
    except MessageNotModified:
        pass
    except FloodWait as e:
        await asyncio.sleep(int(e.value) + 1)
    except Exception as e:
        log.warning("edit failed: %s", e)


ADMIN_ONLY = filters.user(OWNER_ID) & filters.private


@app.on_message(filters.command(["start", "help"]) & filters.private)
async def cmd_start(_, m: Message):
    log.info("/start from user %s (@%s)", m.from_user.id, m.from_user.username)
    if m.from_user.id != OWNER_ID:
        await m.reply_text(f"⛔ Private bot. Your id: <code>{m.from_user.id}</code>")
        return
    await m.reply_text(
        "👋 <b>RS Downloader Bot</b>\n\n"
        "যেকোনো direct video URL পাঠাও (MP4 / M3U8 / MPD / Dailymotion CDN…)।\n"
        "Quality button আসবে — pick করলে download + upload হয়ে যাবে।\n\n"
        "<b>Commands</b>\n"
        "• /thumb — reply to a photo\n"
        "• /clearthumb — thumbnail remove\n"
        "• /cancel — running job বাতিল\n"
    )


@app.on_message(filters.command("clearthumb") & ADMIN_ONLY)
async def cmd_clear_thumb(_, m: Message):
    USER_THUMB.pop(m.from_user.id, None)
    await m.reply_text("🗑 Thumbnail removed.")


@app.on_message(filters.command("thumb") & ADMIN_ONLY)
async def cmd_thumb(_, m: Message):
    target = m.reply_to_message if m.reply_to_message and m.reply_to_message.photo else None
    if not target:
        await m.reply_text("একটা photo-এ reply করে /thumb পাঠাও।")
        return
    path = WORK_DIR / f"thumb_{m.from_user.id}.jpg"
    await target.download(file_name=str(path))
    USER_THUMB[m.from_user.id] = str(path)
    await m.reply_text("✅ Thumbnail saved।")


@app.on_message(filters.command("cancel") & ADMIN_ONLY)
async def cmd_cancel(_, m: Message):
    n = 0
    for job in JOBS.values():
        job.cancel = True
        n += 1
    await m.reply_text(f"🛑 Cancel flag set on {n} job(s).")


URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)


@app.on_message(
    filters.text & ADMIN_ONLY
    & ~filters.command(["start", "help", "thumb", "clearthumb", "cancel"])
)
async def handle_url(_, m: Message):
    match = URL_RE.search(m.text or "")
    if not match:
        return
    url = match.group(0)
    log.info("URL from %s: %s", m.from_user.id, url)
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
            log.info("Dailymotion page fallback: %s", fb)
            try:
                info = await asyncio.to_thread(probe_formats, fb)
                url = fb
            except Exception as e:
                error = str(e)
                log.error("fallback probe failed: %s", error)

    if not info:
        await safe_edit(status, f"❌ URL পড়া গেল না।\n<code>{(error or 'no info')[:300]}</code>")
        return

    fmts = pick_quality_list(info)
    if not fmts:
        fmts = [{"format_id": "best", "height": 0, "ext": "mp4", "tbr": 0, "filesize": 0}]

    jid = uuid.uuid4().hex[:8]
    JOBS[jid] = Job(url=url, formats=fmts, title=(info.get("title") or "video")[:80])

    buttons, row = [], []
    for idx, f in enumerate(fmts):
        label = f"{f['height']}p" if f["height"] else "Best"
        if f["filesize"]:
            label += f" • {human_size(f['filesize'])}"
        row.append(InlineKeyboardButton(label, callback_data=f"dl|{jid}|{idx}"))
        if len(row) == 2:
            buttons.append(row); row = []
    if row:
        buttons.append(row)
    buttons.append([InlineKeyboardButton("❌ Cancel", callback_data=f"x|{jid}")])

    await safe_edit(
        status,
        f"🎬 <b>{JOBS[jid].title}</b>\n\nQuality select করো:",
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
        await cq.answer(); return

    jid, idx = parts[1], int(parts[2])
    job = JOBS.get(jid)
    if not job:
        await cq.answer("Session expired. আবার URL পাঠাও।", show_alert=True)
        return
    if idx >= len(job.formats):
        await cq.answer("Bad selection."); return

    fmt = job.formats[idx]
    await cq.answer(f"Starting {fmt['height'] or 'best'}p…")

    status = cq.message
    tmpdir = WORK_DIR / jid
    tmpdir.mkdir(parents=True, exist_ok=True)
    out_base = tmpdir / re.sub(r"[^\w\- ]+", "_", job.title)[:60]

    async def on_dl_progress(done, total, speed, eta):
        await safe_edit(status, progress_box("⬇️  DOWNLOADING", done, total, speed, eta))

    try:
        await safe_edit(status, "⏳ Starting download…")
        file_path = await download_format(job, fmt, out_base, on_dl_progress)
        size = file_path.stat().st_size
        log.info("downloaded: %s (%s)", file_path, human_size(size))

        if size > MAX_UPLOAD_BYTES:
            await safe_edit(status, f"⚠️ File {human_size(size)} — bot upload cap (~1.95 GB) ছাড়িয়েছে।")
            return

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
            await safe_edit(status, progress_box("⬆️  UPLOADING", cur, tot, speed, eta))

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
        log.info("upload complete: %s", jid)
    except Exception as e:
        log.error("Job %s failed:\n%s", jid, traceback.format_exc())
        await safe_edit(status, f"❌ <b>Failed</b>\n<code>{str(e)[:500]}</code>")
    finally:
        JOBS.pop(jid, None)
        shutil.rmtree(tmpdir, ignore_errors=True)


# ═══════════════════════════════════════════════════════════════
# Startup
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    log.info("🚀 Starting RS Downloader Bot — owner=%s workdir=%s", OWNER_ID, WORK_DIR)
    try:
        app.run()
    except Exception:
        log.error("Bot crashed:\n%s", traceback.format_exc())
        raise
