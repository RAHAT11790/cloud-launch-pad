"""
========================================================================
  AV FILE-TO-LINK PRO  ·  Single-File Edition
========================================================================
  All-in-one Telegram File-To-Link + HD Streaming Bot.

  Original multi-file source (~3800 lines / 29 files) consolidated
  into this single bot.py per user request.

  Only two files required:
      1. bot.py            (this file)
      2. requirements.txt

  All configuration is hard-coded in the CONFIG block below.
  No .env file is used. No user session / MULTI_TOKEN needed.

  HTTP -> HTTPS auto-conversion:
      If PUBLIC_URL starts with http:// (e.g. bot-hosting.net:PORT),
      the bot launches a Cloudflare "trycloudflare.com" quick tunnel
      in the background and rewrites every generated link to that
      HTTPS URL automatically. Downloads cloudflared binary on first
      run if it is not present.

  Features preserved from the original source:
      - Private file  -> instant Stream + Download link
      - Channel post  -> auto-attach Stream / Download / Get-File buttons
      - Group /link   -> convert replied file to link
      - HD in-browser streaming page (video / audio / other)
      - Byte-range streaming (resumable downloads, HTML5 seek)
      - Force-Subscribe (AUTH_CHANNEL) lock
      - Ban / Unban users, block channels
      - Premium subscription (/add_premium /remove_premium /myplan)
      - File rate limit for non-premium users
      - Password-protected link (/password  ->  /p/<token>)
      - Batch mode (/batch  ->  encoded start deep-link)
      - Broadcast / Pin-broadcast to all users
      - Stats, file stats, restart, delfile
      - Referral & points system
      - Verify / Shortener 2-level gate (optional; ON/OFF flags below)
========================================================================
"""

# =========================================================================
# 1.  CONFIGURATION  ·  EDIT ONLY THESE 9 VALUES
# =========================================================================

# --- Telegram credentials ------------------------------------------------
BOT_TOKEN     = "70917168:AAF8TzmnNYW721xIUUuseLU41xa5bRA"
API_ID        = 12000656
API_HASH      = "d927c13beaaf5110f2c071273"
ADMIN_ID      = 5977931010                # single admin numeric ID
BOT_SESSION   = "AVBotz"                  # pyrogram session file name
PORT          = 8080                      # local aiohttp port

# --- Database ------------------------------------------------------------
DATABASE_URL  = "mongodb+srv://user:pass@cluster.mongodb.net/?appName=AVBotz"
DATABASE_NAME = "AVBotz"

# --- Public URL (must end with '/') --------------------------------------
# If http://  ->  auto wrapped through Cloudflare Quick Tunnel to HTTPS
# If https:// ->  used as-is (no tunnel launched)
PUBLIC_URL    = "http://de3.bot-hosting.net:20508/"

# =========================================================================
# 2.  OPTIONAL FEATURE FLAGS  (safe defaults — change only if you know)
# =========================================================================

BIN_CHANNEL     = -1002114619001   # channel where files are stored
LOG_CHANNEL     = -1002114619001   # new-user / event log channel
PREMIUM_LOGS    = -1002114619001   # premium activity log
SUPPORT_GROUP   = -1002114619001   # support group id (0 to disable)
AUTH_CHANNEL    = []               # e.g. [-1001234567890]  for force-sub

FSUB            = False            # Force-subscribe on/off
IS_VERIFY       = False            # Shortener verification on/off
IS_SHORTLINK    = False            # Shortlink the generated URLs
SHORTLINK_URL   = "mdiskshortner.link"
SHORTLINK_API   = ""

ENABLE_LIMIT      = True
MAX_FILES         = 5              # non-premium files / window
RATE_LIMIT_TIMEOUT= 600            # seconds
BATCH_LIMIT       = 60
MAINTENANCE_MODE  = False

CHANNEL_LINK    = "https://t.me/AV_BOTz_UPDATE"
SUPPORT_LINK    = "https://t.me/AV_SUPPORT_GROUP"
OWNER_USERNAME  = "BOT_OWNER26"
TIMEZONE        = "Asia/Kolkata"

BOT_VERSION     = "v5.0-single-file"

# =========================================================================
# 3.  IMPORTS
# =========================================================================
import os
import re
import sys
import math
import time
import json
import glob
import base64
import random
import string
import shutil
import signal
import secrets
import asyncio
import logging
import mimetypes
import platform
import subprocess
import traceback
import urllib.parse
import html
from datetime import datetime, timedelta, date, timezone
from typing import Any, Dict, List, Optional, Union, AsyncGenerator

# --- third-party ---------------------------------------------------------
try:
    import pytz
    import aiohttp
    from aiohttp import web
    from aiohttp.http_exceptions import BadStatusLine
    import motor.motor_asyncio
    from pyrogram import Client, filters, enums, idle, __version__ as pyro_ver
    from pyrogram import utils as pyro_utils, raw
    from pyrogram.raw.all import layer
    from pyrogram.errors import (
        FloodWait, UserIsBlocked, InputUserDeactivated, PeerIdInvalid,
        AuthBytesInvalid, UserNotParticipant, ChatAdminRequired
    )
    from pyrogram.file_id import FileId, FileType, ThumbnailSource
    from pyrogram.session import Session, Auth
    from pyrogram.types import (
        Message, CallbackQuery,
        InlineKeyboardMarkup, InlineKeyboardButton,
        ReplyKeyboardRemove,
    )
except ImportError as e:
    print(f"[FATAL] Missing dependency: {e}\n"
          f"        Run:  pip install -r requirements.txt")
    sys.exit(1)


# =========================================================================
# 4.  LOGGING
# =========================================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)-14s | %(message)s",
    datefmt="%H:%M:%S",
)
for noisy in ("pyrogram", "aiohttp", "aiohttp.web", "aiohttp.access",
              "motor", "asyncio"):
    logging.getLogger(noisy).setLevel(logging.ERROR)

log = logging.getLogger("avbotz")


# =========================================================================
# 5.  GLOBAL STATE  (replaces utils.temp)
# =========================================================================
class temp:
    ME:      Optional[int] = None
    U_NAME:  Optional[str] = None
    B_NAME:  Optional[str] = None
    B_LINK:  Optional[str] = None
    USERS_CANCEL           = False

START_TIME = time.time()
RATE_LIMIT: Dict[int, List[float]] = {}   # user_id -> [count, last_ts]
MULTI_CLIENT               = False
multi_clients: Dict[int, Client] = {}
work_loads:    Dict[int, int]    = {}
class_cache:   Dict[Client, Any] = {}
BROADCAST_LOCK = asyncio.Lock()

# PUBLIC_URL is mutable — cloudflare tunnel will rewrite it at runtime
URL = PUBLIC_URL if PUBLIC_URL.endswith("/") else PUBLIC_URL + "/"

# Database must never block Telegram handlers. If MongoDB is not configured
# yet, the bot automatically falls back to an in-memory store so /start and
# file-to-link generation still work instantly.
DB_TIMEOUT = 2


# =========================================================================
# 6.  HTTP -> HTTPS  (Cloudflare Quick Tunnel wrapper)
# =========================================================================
CF_BIN = os.path.join(os.getcwd(), "cloudflared")


def _cloudflared_download_url() -> str:
    system = platform.system().lower()
    mach   = platform.machine().lower()
    base   = "https://github.com/cloudflare/cloudflared/releases/latest/download/"
    if system == "linux":
        if "aarch64" in mach or "arm64" in mach:
            return base + "cloudflared-linux-arm64"
        if "arm" in mach:
            return base + "cloudflared-linux-arm"
        return base + "cloudflared-linux-amd64"
    if system == "darwin":
        return base + "cloudflared-darwin-amd64.tgz"
    if system == "windows":
        return base + "cloudflared-windows-amd64.exe"
    return base + "cloudflared-linux-amd64"


async def _ensure_cloudflared():
    """Download cloudflared binary once if missing."""
    if os.path.isfile(CF_BIN) and os.access(CF_BIN, os.X_OK):
        return True
    if shutil.which("cloudflared"):
        # System already has it
        return True
    url = _cloudflared_download_url()
    log.info(f"⏬ Downloading cloudflared -> {url}")
    try:
        async with aiohttp.ClientSession() as sess:
            async with sess.get(url, timeout=aiohttp.ClientTimeout(total=180)) as r:
                if r.status != 200:
                    log.error(f"cloudflared download HTTP {r.status}")
                    return False
                with open(CF_BIN, "wb") as f:
                    async for chunk in r.content.iter_chunked(1 << 16):
                        f.write(chunk)
        os.chmod(CF_BIN, 0o755)
        log.info("✅ cloudflared downloaded")
        return True
    except Exception as e:
        log.error(f"cloudflared download failed: {e}")
        return False


async def start_https_tunnel(local_port: int) -> Optional[str]:
    """
    Launch `cloudflared tunnel --url http://localhost:PORT` and capture
    the assigned https://<xxx>.trycloudflare.com URL from stderr.
    Returns the URL (with trailing '/') or None on failure.
    """
    ok = await _ensure_cloudflared()
    if not ok:
        return None
    bin_path = CF_BIN if os.path.isfile(CF_BIN) else "cloudflared"
    args = [
        bin_path, "tunnel",
        "--no-autoupdate",
        "--url", f"http://localhost:{local_port}",
    ]
    log.info(f"🚇 Starting Cloudflare Quick Tunnel ...")
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    async def _reader() -> Optional[str]:
        pattern = re.compile(r"https://[a-z0-9\-]+\.trycloudflare\.com")
        deadline = time.time() + 45
        while time.time() < deadline:
            try:
                line = await asyncio.wait_for(proc.stdout.readline(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            if not line:
                await asyncio.sleep(0.2)
                continue
            text = line.decode(errors="ignore").strip()
            if text:
                logging.getLogger("cloudflared").debug(text)
            m = pattern.search(text)
            if m:
                return m.group(0)
        return None

    found = await _reader()

    async def _drain():
        try:
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
        except Exception:
            pass
    asyncio.create_task(_drain())

    if not found:
        log.error("❌ Could not detect Cloudflare tunnel URL within 45s.")
        return None
    log.info(f"🔒 HTTPS tunnel live -> {found}")
    return found.rstrip("/") + "/"


async def maybe_upgrade_url_to_https():
    """If PUBLIC_URL is plain HTTP, spawn Cloudflare tunnel and rewrite URL."""
    global URL
    if URL.lower().startswith("https://"):
        log.info(f"🌐 PUBLIC_URL already HTTPS: {URL}")
        return
    log.info(f"🌐 PUBLIC_URL is HTTP ({URL}) — wrapping via Cloudflare ...")
    https_url = await start_https_tunnel(PORT)
    if https_url:
        URL = https_url
        log.info(f"✅ Runtime URL rewritten to HTTPS: {URL}")
    else:
        log.warning("⚠️  Keeping original HTTP URL (tunnel unavailable).")


# =========================================================================
# 7.  UTILITIES  (humanbytes / readable-time / size / shortener stub)
# =========================================================================
def humanbytes(size) -> str:
    if not size:
        return "0 B"
    size = float(size)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024.0:
            return f"{size:.2f} {unit}"
        size /= 1024.0
    return f"{size:.2f} PB"

get_size = humanbytes  # alias


def get_readable_time(seconds: int) -> str:
    if not seconds:
        return "0s"
    parts, units = [], [("d", 86400), ("h", 3600), ("m", 60), ("s", 1)]
    for label, sec in units:
        if seconds >= sec:
            v, seconds = divmod(int(seconds), sec)
            parts.append(f"{v}{label}")
    return " ".join(parts) or "0s"


async def get_shortlink(link: str) -> str:
    """Optional shortener. Returns original link if not configured."""
    if not (IS_SHORTLINK and SHORTLINK_API and SHORTLINK_URL):
        return link
    if not link.startswith("https"):
        link = link.replace("http", "https", 1)
    try:
        req = f"https://{SHORTLINK_URL}/api"
        async with aiohttp.ClientSession() as s:
            async with s.get(req, params={"api": SHORTLINK_API, "url": link},
                             ssl=False,
                             timeout=aiohttp.ClientTimeout(total=10)) as r:
                data = await r.json(content_type=None)
                return data.get("shortenedUrl") or data.get("shortlink") or link
    except Exception as e:
        log.warning(f"shortener failed: {e}")
        return link


async def auto_delete_message(msg, delay: int = 600):
    try:
        await asyncio.sleep(delay)
        await msg.delete()
    except Exception:
        pass


def encode_batch(payload: str) -> str:
    """base64-url-safe encode without padding (matches original decode())."""
    return base64.urlsafe_b64encode(payload.encode()).decode().strip("=")


def decode_batch(payload: str) -> str:
    payload += "=" * (-len(payload) % 4)
    try:
        return base64.urlsafe_b64decode(payload).decode()
    except Exception:
        return ""


# =========================================================================
# 8.  DATABASE  (Motor / MongoDB)
# =========================================================================
class _MemoryDeleteResult:
    def __init__(self, deleted_count: int):
        self.deleted_count = deleted_count


class _MemoryCursor:
    def __init__(self, docs: List[dict]):
        self.docs = list(docs)
        self.i = 0

    async def to_list(self, length=None):
        return self.docs if length is None else self.docs[:length]

    def __aiter__(self):
        self.i = 0
        return self

    async def __anext__(self):
        if self.i >= len(self.docs):
            raise StopAsyncIteration
        item = self.docs[self.i]
        self.i += 1
        return item


class _MemoryCollection:
    def __init__(self, key: str = "id"):
        self.key = key
        self.docs: List[dict] = []

    @staticmethod
    def _match(doc: dict, query: Optional[dict]) -> bool:
        if not query:
            return True
        for k, v in query.items():
            cur = doc.get(k)
            if isinstance(v, dict):
                if "$gt" in v and not (cur is not None and cur > v["$gt"]):
                    return False
                continue
            if cur != v:
                return False
        return True

    async def find_one(self, query=None):
        for d in self.docs:
            if self._match(d, query):
                return dict(d)
        return None

    def find(self, query=None):
        return _MemoryCursor([dict(d) for d in self.docs if self._match(d, query)])

    async def insert_one(self, data: dict):
        self.docs.append(dict(data))
        return data


    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        patch = update.get("$set", update)
        for d in self.docs:
            if self._match(d, query):
                d.update(patch)
                return d
        if upsert:
            new_doc = dict(query)
            new_doc.update(patch)
            self.docs.append(new_doc)
            return new_doc
        return None

    async def delete_one(self, query: dict):
        before = len(self.docs)
        for i, d in enumerate(self.docs):
            if self._match(d, query):
                del self.docs[i]
                break
        return _MemoryDeleteResult(before - len(self.docs))

    async def delete_many(self, query: dict):
        before = len(self.docs)
        self.docs = [d for d in self.docs if not self._match(d, query)]
        return _MemoryDeleteResult(before - len(self.docs))

    async def count_documents(self, query=None):
        return len([d for d in self.docs if self._match(d, query)])


def _database_url_is_placeholder(url: str) -> bool:
    value = (url or "").strip().lower()
    return (not value or "user:pass" in value or "cluster.mongodb.net" in value
            or value in {"mongodb://", "mongodb+srv://"})


class Database:
    def __init__(self):
        self.client = None
        self.db = None
        self.memory_mode = _database_url_is_placeholder(DATABASE_URL)
        if self.memory_mode:
            log.warning("MongoDB is not configured — using in-memory database fallback.")
            self._use_memory_collections()
            return
        try:
            self.client = motor.motor_asyncio.AsyncIOMotorClient(
                DATABASE_URL,
                serverSelectionTimeoutMS=3000,
                connectTimeoutMS=3000,
                socketTimeoutMS=5000,
                retryWrites=True,
            )
            self.db = self.client[DATABASE_NAME]
            self.users            = self.db.users
            self.blocked_users    = self.db.blocked_users
            self.blocked_channels = self.db.blocked_channels
            self.files            = self.db.files
            self.refers           = self.db.refers
            self.protected_links  = self.db.protected_links
        except Exception as e:
            log.warning(f"MongoDB init failed — using in-memory fallback: {e}")
            self.memory_mode = True
            self._use_memory_collections()

    def _use_memory_collections(self):
        self.users            = _MemoryCollection("id")
        self.blocked_users    = _MemoryCollection("user_id")
        self.blocked_channels = _MemoryCollection("channel_id")
        self.files            = _MemoryCollection("file_id")
        self.refers           = _MemoryCollection("user_id")
        self.protected_links  = _MemoryCollection("token")

    async def _safe(self, label: str, action, default=None):
        try:
            return await asyncio.wait_for(action(), timeout=DB_TIMEOUT)
        except Exception as e:
            log.warning(f"DB {label} failed; continuing without blocking bot: {e}")
            return default

    # ---- basic user store ----
    async def add_user(self, uid: int, name: str):
        if not await self.is_user_exist(uid):
            await self._safe("add_user", lambda: self.users.insert_one({"id": int(uid), "name": name}))

    async def is_user_exist(self, uid: int) -> bool:
        return bool(await self._safe("is_user_exist", lambda: self.users.find_one({"id": int(uid)}), None))

    async def total_users_count(self) -> int:
        return int(await self._safe("total_users_count", lambda: self.users.count_documents({}), 0) or 0)

    async def get_all_users(self):
        return self.users.find({})

    async def delete_user(self, uid: int):
        await self._safe("delete_user", lambda: self.users.delete_many({"id": int(uid)}))

    # ---- premium ----
    async def update_user(self, data: dict):
        await self._safe("update_user", lambda: self.users.update_one({"id": data["id"]}, {"$set": data}, upsert=True))

    async def get_user(self, uid: int):
        return await self._safe("get_user", lambda: self.users.find_one({"id": int(uid)}), None)

    async def has_premium_access(self, uid: int) -> bool:
        u = await self.get_user(uid)
        if not u:
            return False
        exp = u.get("expiry_time")
        if not isinstance(exp, datetime):
            return False
        if datetime.now() <= exp:
            return True
        await self._safe("expire_premium", lambda: self.users.update_one({"id": int(uid)}, {"$set": {"expiry_time": None}}))
        return False

    async def remove_premium_access(self, uid: int) -> bool:
        await self._safe("remove_premium", lambda: self.users.update_one({"id": int(uid)}, {"$set": {"expiry_time": None}}))
        return True

    async def all_premium_count(self) -> int:
        return int(await self._safe("all_premium_count", lambda: self.users.count_documents({"expiry_time": {"$gt": datetime.now()}}), 0) or 0)

    # ---- ban / unban users ----
    async def is_user_blocked(self, uid: int) -> bool:
        return bool(await self._safe("is_user_blocked", lambda: self.blocked_users.find_one({"user_id": int(uid)}), None))

    async def block_user(self, uid: int, reason: str = ""):
        await self._safe("block_user", lambda: self.blocked_users.update_one(
            {"user_id": int(uid)},
            {"$set": {"user_id": int(uid), "reason": reason,
                      "blocked_at": datetime.utcnow()}},
            upsert=True))

    async def unblock_user(self, uid: int):
        await self._safe("unblock_user", lambda: self.blocked_users.delete_one({"user_id": int(uid)}))

    async def total_blocked_count(self) -> int:
        return int(await self._safe("total_blocked_count", lambda: self.blocked_users.count_documents({}), 0) or 0)

    # ---- ban channels ----
    async def is_channel_blocked(self, cid: int) -> bool:
        return bool(await self._safe("is_channel_blocked", lambda: self.blocked_channels.find_one({"channel_id": int(cid)}), None))

    async def block_channel(self, cid: int, reason: str = ""):
        await self._safe("block_channel", lambda: self.blocked_channels.update_one(
            {"channel_id": int(cid)},
            {"$set": {"channel_id": int(cid), "reason": reason,
                      "blocked_at": datetime.utcnow()}},
            upsert=True))

    async def unblock_channel(self, cid: int):
        await self._safe("unblock_channel", lambda: self.blocked_channels.delete_one({"channel_id": int(cid)}))

    async def total_blocked_channels(self) -> int:
        return int(await self._safe("total_blocked_channels", lambda: self.blocked_channels.count_documents({}), 0) or 0)

    # ---- referral / points ----
    async def get_refer_points(self, uid: int) -> int:
        u = await self._safe("get_refer_points", lambda: self.refers.find_one({"user_id": int(uid)}), None)
        return u.get("points", 0) if u else 0

    async def set_refer_points(self, uid: int, pts: int):
        await self._safe("set_refer_points", lambda: self.refers.update_one({"user_id": int(uid)},
                                     {"$set": {"points": pts}}, upsert=True))

    async def change_points(self, uid: int, amount: int) -> int:
        pts = max(0, await self.get_refer_points(uid) + amount)
        await self.set_refer_points(uid, pts)
        return pts

    async def is_user_in_refer(self, uid: int) -> bool:
        return bool(await self._safe("is_user_in_refer", lambda: self.refers.find_one({"user_id": int(uid)}), None))

    # ---- protected links ----
    async def add_protected_link(self, token, url, password, title, channel_link):
        await self._safe("add_protected_link", lambda: self.protected_links.insert_one({
            "token": token, "url": url, "password": password,
            "title": title, "channel_link": channel_link}))

    async def get_protected_link(self, token):
        return await self._safe("get_protected_link", lambda: self.protected_links.find_one({"token": token}), None)

    async def delete_protected_link(self, token) -> bool:
        r = await self._safe("delete_protected_link", lambda: self.protected_links.delete_one({"token": token}), _MemoryDeleteResult(0))
        return r.deleted_count > 0

    async def get_link_by_url(self, url):
        return await self._safe("get_link_by_url", lambda: self.protected_links.find_one({"url": url}), None)

    async def update_protected_link(self, token, password, title, channel_link):
        await self._safe("update_protected_link", lambda: self.protected_links.update_one(
            {"token": token},
            {"$set": {"password": password, "title": title,
                      "channel_link": channel_link}}))

    async def get_all_protected_links(self):
        return self.protected_links.find({})


db = Database()


# =========================================================================
# 9.  FORCE-SUBSCRIBE HELPER
# =========================================================================
async def is_user_joined(client: Client, message: Message) -> bool:
    """Returns True if user is member of every AUTH_CHANNEL."""
    if not (FSUB and AUTH_CHANNEL):
        return True
    uid = message.from_user.id
    if uid == ADMIN_ID:
        return True
    missing = []
    for ch in AUTH_CHANNEL:
        try:
            m = await client.get_chat_member(ch, uid)
            if m.status in (enums.ChatMemberStatus.LEFT,
                            enums.ChatMemberStatus.BANNED):
                missing.append(ch)
        except UserNotParticipant:
            missing.append(ch)
        except Exception as e:
            log.warning(f"FSUB check err {ch}: {e}")
    if not missing:
        return True
    btns = []
    for ch in missing:
        try:
            invite = await client.export_chat_invite_link(ch)
        except Exception:
            invite = CHANNEL_LINK
        btns.append([InlineKeyboardButton("🔔 Join Channel", url=invite)])
    btns.append([InlineKeyboardButton("♻️ Try Again", url=f"https://t.me/{temp.U_NAME}?start=start")])
    await message.reply_text(
        f"<b>ʜᴇʏ {message.from_user.mention}!\n\n"
        f"ᴘʟᴇᴀsᴇ ᴊᴏɪɴ ᴏᴜʀ ᴜᴘᴅᴀᴛᴇs ᴄʜᴀɴɴᴇʟ ᴛᴏ ᴜsᴇ ᴍᴇ 😊</b>",
        reply_markup=InlineKeyboardMarkup(btns), quote=True)
    return False


# =========================================================================
# 10.  FILE-RATE-LIMIT HELPER
# =========================================================================
async def is_user_allowed(uid: int):
    if not ENABLE_LIMIT or uid == ADMIN_ID:
        return True, 0
    if await db.has_premium_access(uid):
        return True, 0
    now = time.time()
    if uid in RATE_LIMIT:
        cnt, ts = RATE_LIMIT[uid]
        if cnt >= MAX_FILES and (now - ts) < RATE_LIMIT_TIMEOUT:
            return False, int(RATE_LIMIT_TIMEOUT - (now - ts))
        elif cnt >= MAX_FILES:
            RATE_LIMIT[uid] = [1, now]
        else:
            RATE_LIMIT[uid][0] += 1
    else:
        RATE_LIMIT[uid] = [1, now]
    return True, 0


# =========================================================================
# 11.  BYTE-STREAMER  (streams Telegram file bytes over HTTP with ranges)
# =========================================================================
class FileNotFound(Exception):
    message = "File not found"


class InvalidHash(Exception):
    message = "Invalid hash"


def _get_media(msg: Message):
    for k in ("audio", "document", "photo", "sticker",
              "animation", "video", "voice", "video_note"):
        m = getattr(msg, k, None)
        if m:
            return m
    return None


def get_hash(msg: Message) -> str:
    m = _get_media(msg)
    return getattr(m, "file_unique_id", "")[:6]


def get_name(msg: Message) -> str:
    m = _get_media(msg)
    return getattr(m, "file_name", "") or ""


async def get_file_ids(client: Client, chat_id: int, msg_id: int) -> FileId:
    msg = await client.get_messages(chat_id, msg_id)
    if not msg or msg.empty:
        raise FileNotFound
    media = _get_media(msg)
    if not media:
        raise FileNotFound
    fid = FileId.decode(media.file_id)
    setattr(fid, "file_size", getattr(media, "file_size", 0))
    setattr(fid, "mime_type", getattr(media, "mime_type", ""))
    setattr(fid, "file_name", getattr(media, "file_name", ""))
    setattr(fid, "unique_id", media.file_unique_id)
    return fid


class ByteStreamer:
    def __init__(self, client: Client):
        self.client = client
        self.cached: Dict[int, FileId] = {}
        self.clean_timer = 30 * 60
        try:
            asyncio.create_task(self._clean())
        except RuntimeError:
            pass

    async def _clean(self):
        while True:
            await asyncio.sleep(self.clean_timer)
            self.cached.clear()

    async def get_file_properties(self, msg_id: int) -> FileId:
        if msg_id not in self.cached:
            self.cached[msg_id] = await get_file_ids(self.client, BIN_CHANNEL, msg_id)
        return self.cached[msg_id]

    async def _media_session(self, file_id: FileId) -> Session:
        cl = self.client
        sess = cl.media_sessions.get(file_id.dc_id)
        if sess is not None:
            return sess
        if file_id.dc_id != await cl.storage.dc_id():
            sess = Session(cl, file_id.dc_id,
                           await Auth(cl, file_id.dc_id,
                                      await cl.storage.test_mode()).create(),
                           await cl.storage.test_mode(),
                           is_media=True)
            await sess.start()
            for _ in range(6):
                exp = await cl.invoke(
                    raw.functions.auth.ExportAuthorization(dc_id=file_id.dc_id))
                try:
                    await sess.send(raw.functions.auth.ImportAuthorization(
                        id=exp.id, bytes=exp.bytes))
                    break
                except AuthBytesInvalid:
                    continue
            else:
                await sess.stop()
                raise AuthBytesInvalid
        else:
            sess = Session(cl, file_id.dc_id,
                           await cl.storage.auth_key(),
                           await cl.storage.test_mode(),
                           is_media=True)
            await sess.start()
        cl.media_sessions[file_id.dc_id] = sess
        return sess

    @staticmethod
    async def _location(file_id: FileId):
        t = file_id.file_type
        if t == FileType.CHAT_PHOTO:
            if file_id.chat_id > 0:
                peer = raw.types.InputPeerUser(
                    user_id=file_id.chat_id,
                    access_hash=file_id.chat_access_hash)
            else:
                if file_id.chat_access_hash == 0:
                    peer = raw.types.InputPeerChat(chat_id=-file_id.chat_id)
                else:
                    peer = raw.types.InputPeerChannel(
                        channel_id=pyro_utils.get_channel_id(file_id.chat_id),
                        access_hash=file_id.chat_access_hash)
            return raw.types.InputPeerPhotoFileLocation(
                peer=peer, volume_id=file_id.volume_id,
                local_id=file_id.local_id,
                big=file_id.thumbnail_source == ThumbnailSource.CHAT_PHOTO_BIG)
        if t == FileType.PHOTO:
            return raw.types.InputPhotoFileLocation(
                id=file_id.media_id, access_hash=file_id.access_hash,
                file_reference=file_id.file_reference,
                thumb_size=file_id.thumbnail_size)
        return raw.types.InputDocumentFileLocation(
            id=file_id.media_id, access_hash=file_id.access_hash,
            file_reference=file_id.file_reference,
            thumb_size=file_id.thumbnail_size)

    async def yield_file(self, file_id, index, offset,
                         first_cut, last_cut, part_count, chunk_size):
        work_loads[index] = work_loads.get(index, 0) + 1
        current = 1
        try:
            sess = await self._media_session(file_id)
            loc  = await self._location(file_id)
            r = await sess.send(raw.functions.upload.GetFile(
                location=loc, offset=offset, limit=chunk_size))
            if isinstance(r, raw.types.upload.File):
                while True:
                    ch = r.bytes
                    if not ch:
                        break
                    if part_count == 1:
                        yield ch[first_cut:last_cut]
                    elif current == 1:
                        yield ch[first_cut:]
                    elif current == part_count:
                        yield ch[:last_cut]
                    else:
                        yield ch
                    current += 1
                    offset += chunk_size
                    if current > part_count:
                        break
                    r = await sess.send(raw.functions.upload.GetFile(
                        location=loc, offset=offset, limit=chunk_size))
        except (TimeoutError, AttributeError) as e:
            log.error(f"yield_file err: {e}")
        except Exception as e:
            log.error(f"yield_file unexpected: {e}")
        finally:
            work_loads[index] = max(0, work_loads.get(index, 1) - 1)


# =========================================================================
# 12.  AIOHTTP  ROUTES  (streaming + watch + protected links)
# =========================================================================
routes = web.RouteTableDef()


HTML_WATCH = r"""<!doctype html>
<html><head><meta charset="utf-8">
<title>{name} · AV Watch</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{{margin:0;background:#0b0d10;color:#e6e9ef;font-family:system-ui,Segoe UI,Roboto,sans-serif}}
  .wrap{{max-width:960px;margin:0 auto;padding:16px}}
  h1{{font-size:1.05rem;margin:.4rem 0 .8rem}}
  video,audio{{width:100%;background:#000;border-radius:10px}}
  .row{{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}}
  a.btn{{flex:1;text-align:center;padding:12px 14px;border-radius:10px;
        background:#2b6cb0;color:#fff;text-decoration:none;font-weight:600}}
  a.btn.alt{{background:#38a169}}
  .meta{{opacity:.75;font-size:.9rem;margin-top:8px}}
</style></head>
<body><div class="wrap">
  <h1>🎬 {name}</h1>
  {player}
  <div class="row">
    <a class="btn"     href="{src}">⬇ Direct Download</a>
    <a class="btn alt" href="{tglink}">📩 Get on Telegram</a>
  </div>
  <div class="meta">Size: {size} · Powered by AV FTL Bot</div>
</div></body></html>"""


HTML_PROTECTED = r"""<!doctype html>
<html><head><meta charset="utf-8"><title>{title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{{margin:0;background:#0b0d10;color:#e6e9ef;font-family:system-ui,sans-serif;
       min-height:100vh;display:flex;align-items:center;justify-content:center}}
  .card{{background:#161a20;padding:26px 22px;border-radius:14px;max-width:380px;width:92%}}
  h2{{margin:0 0 10px}}
  input{{width:100%;padding:12px;border-radius:8px;border:1px solid #2c313a;
        background:#0f1216;color:#fff;font-size:1rem;box-sizing:border-box}}
  button{{width:100%;margin-top:10px;padding:12px;border:0;border-radius:8px;
         background:#3182ce;color:#fff;font-size:1rem;font-weight:600;cursor:pointer}}
  .err{{color:#fc8181;margin-top:8px}}
  a{{color:#63b3ed}}
</style></head>
<body><form class="card" method="POST" action="/p/{token}">
  <h2>🔒 {title}</h2>
  <p>Enter password to continue.</p>
  <input type="password" name="password" placeholder="6-digit password" required>
  <button>Unlock</button>
  {err_html}{ch_html}
</form></body></html>"""


@routes.get("/", allow_head=True)
async def _root(_req):
    return web.json_response({
        "server_status": "running",
        "uptime": get_readable_time(time.time() - START_TIME),
        "bot": "@" + (temp.U_NAME or ""),
        "connected_clients": len(multi_clients),
        "public_url": URL,
        "version": BOT_VERSION,
    })


@routes.get(r"/p/{token}", allow_head=True)
async def _protected_view(req: web.Request):
    token = req.match_info["token"]
    data = await db.get_protected_link(token)
    if not data:
        return web.Response(status=404, text="Link not found.")
    ch = data.get("channel_link")
    ch_html = f'<p style="margin-top:12px"><a href="{ch}">Get password</a></p>' if ch else ""
    return web.Response(text=HTML_PROTECTED.format(
        title=data.get("title", "Protected Link"),
        token=token, err_html="", ch_html=ch_html),
        content_type="text/html")


@routes.post(r"/p/{token}")
async def _protected_verify(req: web.Request):
    token = req.match_info["token"]
    form  = await req.post()
    data  = await db.get_protected_link(token)
    if not data:
        return web.Response(status=404, text="Link invalid.")
    if form.get("password") == data["password"]:
        raise web.HTTPFound(data["url"])
    ch = data.get("channel_link")
    ch_html  = f'<p style="margin-top:12px"><a href="{ch}">Get password</a></p>' if ch else ""
    err_html = '<div class="err">❌ Wrong password!</div>'
    return web.Response(text=HTML_PROTECTED.format(
        title=data.get("title", "Protected Link"),
        token=token, err_html=err_html, ch_html=ch_html),
        content_type="text/html")


@routes.get(r"/watch/{path:.+}", allow_head=True)
async def _watch(req: web.Request):
    try:
        path = req.match_info["path"]
        m = re.search(r"^([a-zA-Z0-9_-]{6})(\d+)$", path)
        if m:
            secure_hash, msg_id = m.group(1), int(m.group(2))
        else:
            msg_id      = int(re.search(r"(\d+)", path).group(1))
            secure_hash = req.rel_url.query.get("hash", "")
        html = await _render_watch_page(msg_id, secure_hash)
        return web.Response(text=html, content_type="text/html")
    except InvalidHash as e:
        raise web.HTTPForbidden(text=e.message)
    except FileNotFound as e:
        raise web.HTTPNotFound(text=e.message)
    except (AttributeError, BadStatusLine, ConnectionResetError):
        return web.Response(status=400, text="Bad request")
    except Exception as e:
        log.exception("watch err")
        raise web.HTTPInternalServerError(text=str(e))


@routes.get(r"/{path:.+}", allow_head=True)
async def _stream(req: web.Request):
    try:
        path = req.match_info["path"]
        m = re.search(r"^([a-zA-Z0-9_-]{6})(\d+)$", path)
        if m:
            secure_hash, msg_id = m.group(1), int(m.group(2))
        else:
            msg_id      = int(re.search(r"(\d+)", path).group(1))
            secure_hash = req.rel_url.query.get("hash", "")
        return await _media_streamer(req, msg_id, secure_hash)
    except InvalidHash as e:
        raise web.HTTPForbidden(text=e.message)
    except FileNotFound as e:
        raise web.HTTPNotFound(text=e.message)
    except (AttributeError, BadStatusLine, ConnectionResetError):
        return web.Response(status=400, text="Bad request")
    except Exception as e:
        log.exception("stream err")
        raise web.HTTPInternalServerError(text=str(e))


async def _render_watch_page(msg_id: int, secure_hash: str) -> str:
    idx    = min(work_loads, key=work_loads.get)
    client = multi_clients[idx]
    fid    = await get_file_ids(client, BIN_CHANNEL, msg_id)
    if fid.unique_id[:6] != secure_hash:
        raise InvalidHash
    raw_name = fid.file_name or f"File_{msg_id}"
    name     = raw_name.replace("_", " ")
    src      = urllib.parse.urljoin(
        URL, f"{msg_id}/{urllib.parse.quote_plus(str(raw_name))}?hash={secure_hash}")
    tag  = (fid.mime_type or "").split("/")[0]
    size = humanbytes(fid.file_size)
    if tag == "video":
        player = f'<video controls playsinline preload="metadata" src="{src}"></video>'
    elif tag == "audio":
        player = f'<audio controls preload="metadata" src="{src}"></audio>'
    else:
        player = f'<p>Direct download only for this file type.</p>'
    tglink = f"https://t.me/{temp.U_NAME}?start=file_{msg_id}"
    return HTML_WATCH.format(name=name, player=player, src=src,
                             tglink=tglink, size=size)


async def _media_streamer(req: web.Request, msg_id: int, secure_hash: str):
    range_header = req.headers.get("Range", 0)
    idx = min(work_loads, key=work_loads.get)
    fclient = multi_clients[idx]
    tg = class_cache.get(fclient) or ByteStreamer(fclient)
    class_cache[fclient] = tg
    fid = await tg.get_file_properties(msg_id)
    if fid.unique_id[:6] != secure_hash:
        raise InvalidHash
    file_size = fid.file_size

    if range_header:
        fr, un = range_header.replace("bytes=", "").split("-")
        fr = int(fr); un = int(un) if un else file_size - 1
    else:
        fr = req.http_range.start or 0
        un = (req.http_range.stop or file_size) - 1

    if un > file_size or fr < 0 or un < fr:
        return web.Response(status=416, body="416: Range not satisfiable",
                            headers={"Content-Range": f"bytes */{file_size}"})

    chunk = 1024 * 1024
    un     = min(un, file_size - 1)
    offset = fr - (fr % chunk)
    fcut   = fr - offset
    lcut   = un % chunk + 1
    length = un - fr + 1
    parts  = math.ceil(un / chunk) - math.floor(offset / chunk)
    body   = tg.yield_file(fid, idx, offset, fcut, lcut, parts, chunk)

    mime = fid.mime_type
    name = fid.file_name
    disp = "attachment"
    if mime:
        if not name:
            try:
                name = f"{secrets.token_hex(2)}.{mime.split('/')[1]}"
            except Exception:
                name = f"{secrets.token_hex(2)}.unknown"
    else:
        if name:
            mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
        else:
            mime = "application/octet-stream"
            name = f"{secrets.token_hex(2)}.unknown"

    return web.Response(
        status=206 if range_header else 200,
        body=body,
        headers={
            "Content-Type":        mime,
            "Content-Range":       f"bytes {fr}-{un}/{file_size}",
            "Content-Length":      str(length),
            "Content-Disposition": f'{disp}; filename="{name}"',
            "Accept-Ranges":       "bytes",
        })


# =========================================================================
# 13.  PYROGRAM  CLIENT
# =========================================================================
pyro_utils.MIN_CHANNEL_ID = -1009147483647  # allow big channel IDs

app = Client(
    name=BOT_SESSION,
    api_id=API_ID, api_hash=API_HASH,
    bot_token=BOT_TOKEN,
    workers=50, sleep_threshold=60,
    # Always start a fresh in-memory bot session. This prevents stale .session
    # files / locked sessions from starting successfully but silently missing
    # /start and media updates on cheap VPS/Railway/bot-hosting panels.
    in_memory=True,
    parse_mode=enums.ParseMode.HTML,
)


# =========================================================================
# 14.  HANDLERS  ·  /start  /help  /about  /stats  /ping  /restart
# =========================================================================
START_TXT = (
    "<b>👋 ʜᴇʏ {name},</b>\n\n"
    "<b>ɪ ᴀᴍ ᴛʜᴇ ᴜʟᴛɪᴍᴀᴛᴇ ꜰɪʟᴇ-ᴛᴏ-ʟɪɴᴋ ʙᴏᴛ! 🤖</b>\n\n"
    "📂 sᴇɴᴅ ᴀɴʏ ꜰɪʟᴇ / ᴠɪᴅᴇᴏ ᴀɴᴅ ɢᴇᴛ ɪɴsᴛᴀɴᴛ:\n"
    "  • 🚀 ʜɪɢʜ-sᴘᴇᴇᴅ ᴅᴏᴡɴʟᴏᴀᴅ ʟɪɴᴋ\n"
    "  • 📺 ʜᴅ sᴛʀᴇᴀᴍɪɴɢ ʟɪɴᴋ\n"
    "  • ⚡ ɴᴏ ʙᴜꜰꜰᴇʀɪɴɢ · ɴᴏ ᴀᴅs\n\n"
    "<i>ᴀᴅᴅ ᴍᴇ ᴛᴏ ʏᴏᴜʀ ᴄʜᴀɴɴᴇʟ ᴀs ᴀᴅᴍɪɴ ꜰᴏʀ ᴀᴜᴛᴏ-ʙᴜᴛᴛᴏɴs.</i>"
)

HELP_TXT = (
    "<b>⚙️ ʜᴏᴡ ᴛᴏ ᴜsᴇ</b>\n\n"
    "1. sᴇɴᴅ ᴀ ꜰɪʟᴇ / ᴠɪᴅᴇᴏ ɪɴ ᴘʀɪᴠᴀᴛᴇ  →  ɢᴇᴛ ʟɪɴᴋ\n"
    "2. ᴀᴅᴅ ᴍᴇ ᴀs ᴀᴅᴍɪɴ ɪɴ ʏᴏᴜʀ ᴄʜᴀɴɴᴇʟ  →  ᴀᴜᴛᴏ ʙᴜᴛᴛᴏɴs\n"
    "3. ɪɴ ɢʀᴏᴜᴘ, /link ᴀs ʀᴇᴘʟʏ ᴛᴏ ᴀ ꜰɪʟᴇ\n\n"
    "<b>ᴄᴏᴍᴍᴀɴᴅs</b>\n"
    "/start · /help · /about · /myplan · /password [pw] [url] · /batch"
)

ABOUT_TXT = (
    "<b>╔══❰ {n} ❱\n"
    "║ ᴠᴇʀꜱɪᴏɴ  : {v}\n"
    "║ ʟɪʙʀᴀʀʏ  : Pyrogram v{pv}\n"
    "║ ᴜᴘᴛɪᴍᴇ   : {up}\n"
    "║ ᴏᴡɴᴇʀ    : @{ow}\n"
    "╚══════════════════</b>"
)


def _home_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("• ᴜᴘᴅᴀᴛᴇs •", url=CHANNEL_LINK),
         InlineKeyboardButton("• sᴜᴘᴘᴏʀᴛ •", url=SUPPORT_LINK)],
        [InlineKeyboardButton("• ʜᴇʟᴘ •",  callback_data="help"),
         InlineKeyboardButton("• ᴀʙᴏᴜᴛ •", callback_data="about")],
        [InlineKeyboardButton("💎 ʙᴜʏ ᴘʀᴇᴍɪᴜᴍ", callback_data="premium_info")],
        [InlineKeyboardButton("🎁 ʀᴇꜰᴇʀ & ᴇᴀʀɴ", callback_data="refer")],
    ])


async def safe_reply_text(message: Message, text: str, **kwargs):
    try:
        return await asyncio.wait_for(message.reply_text(text, **kwargs), timeout=20)
    except Exception as e:
        log.warning(f"reply failed in chat {getattr(message.chat, 'id', '?')}: {e}")
        try:
            kwargs.pop("quote", None)
            return await asyncio.wait_for(app.send_message(message.chat.id, text, **kwargs), timeout=20)
        except Exception as e2:
            log.error(f"send fallback failed: {e2}")
            return None


async def safe_edit_text(message: Message, text: str, **kwargs):
    try:
        return await asyncio.wait_for(message.edit_text(text, **kwargs), timeout=20)
    except Exception as e:
        log.warning(f"edit failed: {e}")
        return await safe_reply_text(message, text, **kwargs)


async def ensure_user_record(client: Client, message: Message) -> bool:
    if not message.from_user:
        return False
    uid = message.from_user.id
    name = message.from_user.first_name or "User"
    fresh = not await db.is_user_exist(uid)
    if fresh:
        await db.add_user(uid, name)
        if LOG_CHANNEL:
            try:
                await client.send_message(
                    LOG_CHANNEL,
                    f"<b>#NEW_USER</b>\nID: <code>{uid}</code>\nName: {message.from_user.mention}")
            except Exception as e:
                log.warning(f"new-user log failed: {e}")
    return fresh


def _media_from_message(m: Message):
    return (m.document or m.video or m.audio or m.animation or
            m.voice or m.video_note or m.photo)


def _media_name(media, msg_id: int) -> str:
    return (getattr(media, "file_name", None) or
            f"Telegram_File_{msg_id}")


def _media_size(media) -> str:
    return humanbytes(getattr(media, "file_size", 0) or 0)


def _safe_html(value: Any) -> str:
    return html.escape(str(value or ""), quote=True)


async def _store_in_bin(source: Message, status: Optional[Message] = None) -> Optional[Message]:
    try:
        return await source.forward(chat_id=BIN_CHANNEL)
    except FloodWait as fw:
        await asyncio.sleep(fw.value + 1)
        return await source.forward(chat_id=BIN_CHANNEL)
    except Exception as e:
        log.error(f"BIN_CHANNEL forward failed: {e}")
        if status:
            await safe_edit_text(
                status,
                "❌ <b>Storage channel error.</b>\n\n"
                "Bot must be admin in BIN_CHANNEL and allowed to post files.\n"
                f"Error: <code>{str(e)[:180]}</code>")
        else:
            await safe_reply_text(
                source,
                "❌ Storage channel error. Bot must be admin in BIN_CHANNEL.")
        return None


async def build_file_links(stored_msg: Message, file_name: str):
    h = get_hash(stored_msg)
    safe_name = urllib.parse.quote_plus(file_name)
    stream   = f"{URL}watch/{stored_msg.id}/{safe_name}?hash={h}"
    download = f"{URL}{stored_msg.id}/{safe_name}?hash={h}"
    tglink   = f"https://t.me/{temp.U_NAME}?start=file_{stored_msg.id}"
    if IS_SHORTLINK:
        stream, download, tglink = await asyncio.gather(
            get_shortlink(stream), get_shortlink(download), get_shortlink(tglink))
    return h, stream, download, tglink


async def save_file_record(uid: int, file_name: str, file_size: str, file_id: int, h: str):
    await db._safe("save_file_record", lambda: db.files.insert_one({
        "user_id": uid, "file_name": file_name, "file_size": file_size,
        "file_id": file_id, "hash": h, "timestamp": time.time()}))


@app.on_message(filters.private & filters.command("start", prefixes=["/", "!", "."]), group=-100)
async def h_start(client: Client, message: Message):
    try:
        if not message.from_user:
            return
        uid  = message.from_user.id
        argv = message.command[1] if len(message.command) > 1 else None

        if MAINTENANCE_MODE and uid != ADMIN_ID:
            return await safe_reply_text(message, "🚧 ʙᴏᴛ ɪs ᴜɴᴅᴇʀ ᴍᴀɪɴᴛᴇɴᴀɴᴄᴇ")

        if await db.is_user_blocked(uid):
            return await safe_reply_text(message, "🚫 ʏᴏᴜ ᴀʀᴇ ʙᴀɴɴᴇᴅ ꜰʀᴏᴍ ᴜsɪɴɢ ᴛʜɪs ʙᴏᴛ.")

        is_referral = bool(argv and argv.startswith("reff_"))
        if FSUB and not is_referral:
            if not await is_user_joined(client, message):
                return

        fresh = await ensure_user_record(client, message)

        # --- referral deep-link ---
        if is_referral:
            try:
                inviter_id = int(argv.split("_", 1)[1])
            except Exception:
                return await safe_reply_text(message, "Invalid refer link.")
            if inviter_id == uid or not fresh:
                return await safe_reply_text(message, "Refer link cannot be used.")
            if await db.is_user_in_refer(uid):
                return await safe_reply_text(message, "Already invited.")
            pts_new = await db.change_points(inviter_id, 10)
            await db.set_refer_points(uid, 0)
            try:
                await client.send_message(inviter_id, f"✈️ New Referral!\n{message.from_user.mention} joined.\n➕10  ·  Total: {pts_new}")
            except Exception:
                pass
            if pts_new >= 100:
                await db.set_refer_points(inviter_id, 0)
                exp = datetime.now() + timedelta(days=30)
                await db.update_user({"id": inviter_id, "expiry_time": exp})
                try:
                    await client.send_message(inviter_id, "🎉 100 points reached — 1 Month Premium activated!")
                except Exception:
                    pass
            return await safe_reply_text(message, f"You joined via {inviter_id}'s referral link 🎁")

        # --- file / batch deep-link ---
        if argv and argv.startswith("file_"):
            try:
                fid = int(argv.split("_", 1)[1])
            except Exception:
                return await safe_reply_text(message, "Invalid file link.")
            try:
                await client.copy_message(uid, BIN_CHANNEL, fid)
            except Exception as e:
                return await safe_reply_text(message, f"❌ {e}")
            return

        if argv and argv != "start":
            payload = decode_batch(argv)
            if payload.startswith("batch-"):
                try:
                    _, s, e = payload.split("-")
                    s, e = int(s), int(e)
                except Exception:
                    return await safe_reply_text(message, "Invalid batch link.")
                if e - s > BATCH_LIMIT:
                    return await safe_reply_text(message, f"Batch limit is {BATCH_LIMIT} files")
                status = await safe_reply_text(message, "🔄 Sending batch...")
                sent = 0
                for i in range(s, e + 1):
                    try:
                        await client.copy_message(uid, BIN_CHANNEL, i)
                        sent += 1
                        await asyncio.sleep(1)
                    except FloodWait as fw:
                        await asyncio.sleep(fw.value + 1)
                    except Exception:
                        pass
                if status:
                    await safe_edit_text(status, f"✅ Sent {sent}/{e - s + 1} files.")
                return

        # --- default welcome ---
        await safe_reply_text(
            message,
            START_TXT.format(name=message.from_user.mention),
            reply_markup=_home_kb(), disable_web_page_preview=True)
    except Exception as e:
        log.exception("/start handler failed")
        await safe_reply_text(message, f"❌ Start command error: <code>{str(e)[:180]}</code>")


@app.on_message(filters.command("help", prefixes=["/", "!", "."]), group=-90)
async def h_help(_c, m: Message):
    await safe_reply_text(m, HELP_TXT, reply_markup=InlineKeyboardMarkup(
        [[InlineKeyboardButton("• ᴄʟᴏsᴇ •", callback_data="close")]]))


@app.on_message(filters.command("about", prefixes=["/", "!", "."]), group=-90)
async def h_about(_c, m: Message):
    await safe_reply_text(m, ABOUT_TXT.format(
        n=temp.B_NAME, v=BOT_VERSION, pv=pyro_ver,
        up=get_readable_time(time.time() - START_TIME),
        ow=OWNER_USERNAME),
        reply_markup=InlineKeyboardMarkup(
        [[InlineKeyboardButton("• ᴄʟᴏsᴇ •", callback_data="close")]]))


@app.on_message(filters.command("ping", prefixes=["/", "!", "."]), group=-90)
async def h_ping(_c, m: Message):
    t = time.time()
    r = await safe_reply_text(m, "pinging...")
    if r:
        await safe_edit_text(r, f"🏓 Pong! `{round((time.time()-t)*1000)}ms`")


@app.on_message(filters.command("stats") & filters.user(ADMIN_ID))
async def h_stats(client: Client, m: Message):
    tu = await db.total_users_count()
    tp = await db.all_premium_count()
    tb = await db.total_blocked_count()
    tc = await db.total_blocked_channels()
    tf = await db.files.count_documents({})
    tl = await db.protected_links.count_documents({})
    await safe_reply_text(m,
        f"<b>📊 sᴛᴀᴛs</b>\n\n"
        f"👥 ᴜsᴇʀs        : <code>{tu}</code>\n"
        f"💎 ᴘʀᴇᴍɪᴜᴍ    : <code>{tp}</code>\n"
        f"🚫 ʙʟᴏᴄᴋᴇᴅ    : <code>{tb}</code>\n"
        f"🚷 ʙʟᴏᴄᴋ ᴄʜ  : <code>{tc}</code>\n"
        f"📁 ꜰɪʟᴇs        : <code>{tf}</code>\n"
        f"🔒 ᴘʀᴏᴛᴇᴄᴛᴇᴅ : <code>{tl}</code>\n"
        f"🌐 ᴜʀʟ         : <code>{URL}</code>\n"
        f"⏰ ᴜᴘᴛɪᴍᴇ    : <code>{get_readable_time(time.time()-START_TIME)}</code>")


@app.on_message(filters.command("restart") & filters.user(ADMIN_ID))
async def h_restart(_c, m: Message):
    await m.reply_text("♻️ Restarting...")
    os.execv(sys.executable, [sys.executable, *sys.argv])


# =========================================================================
# 15.  HANDLERS  ·  BAN / UNBAN  &  BROADCAST
# =========================================================================
@app.on_message(filters.command("ban") & filters.user(ADMIN_ID))
async def h_ban(_c, m: Message):
    if len(m.command) < 2:
        return await m.reply_text("Usage: /ban <user_id> [reason]")
    try:
        uid = int(m.command[1])
    except ValueError:
        return await m.reply_text("Invalid ID.")
    reason = " ".join(m.command[2:]) or "No reason"
    await db.block_user(uid, reason)
    await m.reply_text(f"✅ Banned <code>{uid}</code>\nReason: {reason}")


@app.on_message(filters.command("unban") & filters.user(ADMIN_ID))
async def h_unban(_c, m: Message):
    if len(m.command) < 2:
        return await m.reply_text("Usage: /unban <user_id>")
    try:
        uid = int(m.command[1])
    except ValueError:
        return await m.reply_text("Invalid ID.")
    await db.unblock_user(uid)
    await m.reply_text(f"✅ Unbanned <code>{uid}</code>")


@app.on_message(filters.command("blocked") & filters.user(ADMIN_ID))
async def h_blocked(_c, m: Message):
    cur = await db.blocked_users.find({}).to_list(length=None)
    if not cur:
        return await m.reply_text("No blocked users.")
    txt = "\n".join(f"• <code>{u['user_id']}</code> — {u.get('reason','')}" for u in cur[:50])
    await m.reply_text(f"<b>Blocked ({len(cur)}):</b>\n{txt}")


async def _broadcast_worker(client, message, is_pin):
    if BROADCAST_LOCK.locked():
        return await message.reply("A broadcast is already running.")
    users = await db.get_all_users()
    total = await db.total_users_count()
    src   = message.reply_to_message
    sts   = await message.reply_text("<b>📢 Broadcasting…</b>")
    ok = fail = done = 0
    t0 = time.time()
    async with BROADCAST_LOCK:
        async for u in users:
            if temp.USERS_CANCEL:
                temp.USERS_CANCEL = False
                break
            try:
                sent = await src.copy(chat_id=int(u["id"]))
                if is_pin:
                    try: await sent.pin(both_sides=True)
                    except: pass
                ok += 1
            except FloodWait as fw:
                await asyncio.sleep(fw.value)
                continue
            except (InputUserDeactivated, UserIsBlocked, PeerIdInvalid):
                await db.delete_user(int(u["id"]))
                fail += 1
            except Exception:
                fail += 1
            done += 1
            if done % 25 == 0:
                try:
                    await sts.edit(
                        f"📢 <b>Broadcast</b>\nTotal: {total}\nDone: {done}\nOK: {ok}\nFail: {fail}",
                        reply_markup=InlineKeyboardMarkup(
                            [[InlineKeyboardButton("CANCEL", callback_data="bcast_cancel")]]))
                except Exception:
                    pass
    await sts.edit(
        f"✅ <b>Broadcast complete</b>\n\n"
        f"Total: {total}\nDone: {done}\n✅ OK: {ok}\n❌ Failed: {fail}\n"
        f"⏱ {get_readable_time(int(time.time()-t0))}")


@app.on_message(filters.command("broadcast") & filters.user(ADMIN_ID) & filters.reply)
async def h_broadcast(c, m):        await _broadcast_worker(c, m, False)


@app.on_message(filters.command("pin_broadcast") & filters.user(ADMIN_ID) & filters.reply)
async def h_pin_broadcast(c, m):    await _broadcast_worker(c, m, True)


# =========================================================================
# 16.  HANDLERS  ·  PREMIUM
# =========================================================================
def _parse_duration(text: str) -> int:
    """
    Accepts pairs like '1 day' '3 month' '2 year' '30 min' '5 hour'
    Returns seconds. 0 on failure.
    """
    try:
        n, unit = text.strip().split()
        n = int(n); unit = unit.lower().rstrip("s")
    except Exception:
        return 0
    return {"min": 60, "hour": 3600, "day": 86400,
            "month": 2592000, "year": 31536000}.get(unit, 0) * n


@app.on_message(filters.command("add_premium") & filters.user(ADMIN_ID))
async def h_add_premium(client, m: Message):
    # /add_premium <user_id> <n> <unit>
    if len(m.command) != 4:
        return await m.reply_text(
            "Usage: /add_premium <user_id> <n> <min|hour|day|month|year>")
    try:
        uid = int(m.command[1])
    except Exception:
        return await m.reply_text("Invalid user id.")
    secs = _parse_duration(f"{m.command[2]} {m.command[3]}")
    if secs <= 0:
        return await m.reply_text("Invalid duration.")
    exp = datetime.now() + timedelta(seconds=secs)
    await db.update_user({"id": uid, "expiry_time": exp})
    tz = pytz.timezone(TIMEZONE)
    await m.reply_text(
        f"✅ Premium added\nID: <code>{uid}</code>\n"
        f"Expires: <code>{exp.astimezone(tz).strftime('%d-%m-%Y %I:%M %p')}</code>")
    try:
        await client.send_message(uid, f"🎉 You got Premium until {exp.strftime('%d-%m-%Y')}!")
    except Exception:
        pass
    try:
        await client.send_message(
            PREMIUM_LOGS,
            f"#PREMIUM_ADDED\nID: <code>{uid}</code>\nExpires: {exp}")
    except Exception:
        pass


@app.on_message(filters.command("remove_premium") & filters.user(ADMIN_ID))
async def h_rm_premium(client, m: Message):
    if len(m.command) != 2:
        return await m.reply_text("Usage: /remove_premium <user_id>")
    try:
        uid = int(m.command[1])
    except Exception:
        return await m.reply_text("Invalid id.")
    await db.remove_premium_access(uid)
    await m.reply_text("✅ Premium removed.")
    try:
        await client.send_message(uid, "😕 Your premium access was removed.")
    except Exception:
        pass


@app.on_message(filters.command("myplan"))
async def h_myplan(_c, m: Message):
    u = await db.get_user(m.from_user.id)
    exp = (u or {}).get("expiry_time")
    if isinstance(exp, datetime) and datetime.now() <= exp:
        tz = pytz.timezone(TIMEZONE)
        left = exp - datetime.now()
        await m.reply_text(
            f"💎 <b>Premium Active</b>\n"
            f"Expires: <code>{exp.astimezone(tz).strftime('%d-%m-%Y %I:%M %p')}</code>\n"
            f"Left: <code>{get_readable_time(int(left.total_seconds()))}</code>")
    else:
        await m.reply_text("😕 You are not a premium user.")


# =========================================================================
# 17.  HANDLERS  ·  PASSWORD-PROTECTED LINK
# =========================================================================
@app.on_message(filters.command("password") & filters.private)
async def h_password(client, m: Message):
    try:
        parts = m.text.split(None, 2)
        if len(parts) < 3:
            return await m.reply_text(
                "❌ Format: /password <6-char-pass> <url>[|title[|channel_link]]")
        pw = parts[1]
        if len(pw) != 6:
            return await m.reply_text("Password must be exactly 6 characters.")
        raw = parts[2].split("|")
        url          = raw[0].strip()
        title        = raw[1].strip() if len(raw) > 1 else "Protected Link"
        channel_link = raw[2].strip() if len(raw) > 2 else None

        exist = await db.get_link_by_url(url)
        if exist:
            token = exist["token"]
            await db.update_protected_link(token, pw, title, channel_link)
            action = "Updated"
        else:
            token = secrets.token_urlsafe(8)
            await db.add_protected_link(token, url, pw, title, channel_link)
            action = "Created"
        base = URL if URL.endswith("/") else URL + "/"
        short = f"{base}p/{token}"
        await m.reply_text(
            f"🔒 <b>Password Link {action}</b>\n\n"
            f"Password : <code>{pw}</code>\n"
            f"Title    : {title}\n"
            f"Link     : {short}",
            disable_web_page_preview=True)
    except Exception as e:
        await m.reply_text(f"❌ {e}")


@app.on_message(filters.command("delete_pass") & filters.user(ADMIN_ID) & filters.private)
async def h_delpass(_c, m: Message):
    if len(m.command) < 2:
        return await m.reply_text("Usage: /delete_pass <token-or-full-link>")
    inp = m.command[1]
    token = inp.split("/p/")[-1].split("?")[0] if "/p/" in inp else inp.strip()
    ok = await db.delete_protected_link(token)
    await m.reply_text("✅ Deleted." if ok else "❌ Token not found.")


# =========================================================================
# 18.  HANDLERS  ·  PRIVATE FILES  →  GENERATE LINK
# =========================================================================
FILE_CAPTION_TXT = (
    "<i><u>ʏᴏᴜʀ ʟɪɴᴋ ɢᴇɴᴇʀᴀᴛᴇᴅ !</u></i>\n\n"
    "<b>📧 ꜰɪʟᴇ ɴᴀᴍᴇ :</b> <i><a href=\"{s}\">{n}</a></i>\n"
    "<b>📦 ꜰɪʟᴇ sɪᴢᴇ :</b> <i>{sz}</i>\n\n"
    "<b>🖥 sᴛʀᴇᴀᴍ  :</b> <code>{s}</code>\n"
    "<b>📥 ᴅᴏᴡɴʟᴏᴀᴅ :</b> <code>{d}</code>\n\n"
    "<b>🚸 ɴᴏᴛᴇ : ʟɪɴᴋ ᴡᴏɴ'ᴛ ᴇxᴘɪʀᴇ ᴛɪʟʟ ɪ ᴅᴇʟᴇᴛᴇ 🤡</b>"
)


@app.on_message(
    filters.private
    & ~filters.command(["start", "help", "about", "ping", "stats", "restart", "ban", "unban", "blocked", "broadcast", "pin_broadcast", "add_premium", "remove_premium", "myplan", "password", "delete_pass", "batch", "files", "delfile"], prefixes=["/", "!", "."])
    & (filters.document | filters.video | filters.audio | filters.animation | filters.voice | filters.video_note | filters.photo),
    group=-80,
)
async def h_file_private(client: Client, m: Message):
    status = None
    try:
        if not m.from_user:
            return
        uid = m.from_user.id
        if MAINTENANCE_MODE and uid != ADMIN_ID:
            return await safe_reply_text(m, "🚧 Maintenance mode.")
        if await db.is_user_blocked(uid):
            return await safe_reply_text(m, "🚫 You are banned.")
        if FSUB and not await is_user_joined(client, m):
            return
        await ensure_user_record(client, m)
        ok, wait = await is_user_allowed(uid)
        if not ok:
            return await safe_reply_text(
                m,
                f"🚫 You have sent {MAX_FILES} files. Please try after "
                f"<b>{wait}s</b>.", quote=True)

        media = _media_from_message(m)
        if not media:
            return await safe_reply_text(m, "❌ Please send a video, audio, or document file.")
        fname = _media_name(media, m.id)
        fsize = _media_size(media)

        status = await safe_reply_text(m, "⚡ <b>Generating your stream links...</b>", quote=True)
        fwd = await _store_in_bin(m, status)
        if not fwd:
            return

        h, stream, download, tglink = await build_file_links(fwd, fname)
        await save_file_record(uid, fname, fsize, fwd.id, h)

        try:
            await fwd.reply_text(
                f"Requested by: {m.from_user.mention} (<code>{uid}</code>)\n"
                f"Stream: {stream}", quote=True, disable_web_page_preview=True)
        except Exception as e:
            log.warning(f"bin note failed: {e}")

        text = FILE_CAPTION_TXT.format(
            s=_safe_html(stream),
            n=_safe_html(fname),
            sz=_safe_html(fsize),
            d=_safe_html(download),
        )
        kb = InlineKeyboardMarkup([
            [InlineKeyboardButton("• sᴛʀᴇᴀᴍ •",   url=stream),
             InlineKeyboardButton("• ᴅᴏᴡɴʟᴏᴀᴅ •", url=download)],
            [InlineKeyboardButton("• ɢᴇᴛ ꜰɪʟᴇ •", url=tglink),
             InlineKeyboardButton("• ᴅᴇʟᴇᴛᴇ •", callback_data=f"delfile_{fwd.id}")],
            [InlineKeyboardButton("• ᴄʟᴏsᴇ •", callback_data="close")]])
        if status:
            await safe_edit_text(status, text, disable_web_page_preview=True, reply_markup=kb)
        else:
            await safe_reply_text(m, text, disable_web_page_preview=True, reply_markup=kb)
    except Exception as e:
        log.exception("private file handler failed")
        msg = f"❌ Link generate failed: <code>{str(e)[:180]}</code>"
        if status:
            await safe_edit_text(status, msg)
        else:
            await safe_reply_text(m, msg)


# =========================================================================
# 19.  HANDLERS  ·  CHANNEL AUTO-BUTTONS
# =========================================================================
@app.on_message(filters.channel & (filters.document | filters.video) & ~filters.forwarded, group=-1)
async def h_file_channel(client: Client, m: Message):
    try:
        cid = m.chat.id
        if str(cid).startswith("-100") and await db.is_channel_blocked(cid):
            try: await client.leave_chat(cid)
            except: pass
            return
        media = m.document or m.video
        fname = media.file_name if media else f"File_{m.id}"
        fwd = await m.forward(chat_id=BIN_CHANNEL)
        h   = get_hash(fwd)
        stream   = f"{URL}watch/{fwd.id}/{urllib.parse.quote_plus(fname)}?hash={h}"
        download = f"{URL}{fwd.id}?hash={h}"
        tglink   = f"https://t.me/{temp.U_NAME}?start=file_{fwd.id}"
        if IS_SHORTLINK:
            stream, download, tglink = await asyncio.gather(
                get_shortlink(stream), get_shortlink(download), get_shortlink(tglink))
        try:
            await client.edit_message_reply_markup(
                chat_id=cid, message_id=m.id,
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("• sᴛʀᴇᴀᴍ •",   url=stream),
                     InlineKeyboardButton("• ᴅᴏᴡɴʟᴏᴀᴅ •", url=download)],
                    [InlineKeyboardButton("• ɢᴇᴛ ꜰɪʟᴇ •", url=tglink)]]))
        except Exception as e:
            log.warning(f"channel edit err: {e}")
    except FloodWait as fw:
        await asyncio.sleep(fw.value)
    except Exception:
        log.exception("channel handler error")


@app.on_message(filters.command("link") & filters.group & filters.reply)
async def h_group_link(client: Client, m: Message):
    r = m.reply_to_message
    if not (r and (r.document or r.video)):
        return await m.reply_text("Reply to a file/video with /link")
    st = await m.reply_text("🔄 Generating…")
    try:
        fwd = await r.forward(BIN_CHANNEL)
    except Exception as e:
        return await st.edit(f"❌ {e}")
    media = r.document or r.video
    fname = media.file_name or f"File_{fwd.id}"
    h     = get_hash(fwd)
    stream   = f"{URL}watch/{fwd.id}/{urllib.parse.quote_plus(fname)}?hash={h}"
    download = f"{URL}{fwd.id}?hash={h}"
    tglink   = f"https://t.me/{temp.U_NAME}?start=file_{fwd.id}"
    if IS_SHORTLINK:
        stream, download, tglink = await asyncio.gather(
            get_shortlink(stream), get_shortlink(download), get_shortlink(tglink))
    await st.edit(
        f"📂 <b>{fname}</b>\n\n🔗 Links ready!",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("• sᴛʀᴇᴀᴍ •",   url=stream),
             InlineKeyboardButton("• ᴅᴏᴡɴʟᴏᴀᴅ •", url=download)],
            [InlineKeyboardButton("• ɢᴇᴛ ꜰɪʟᴇ •", url=tglink)]]))


# =========================================================================
# 20.  HANDLERS  ·  BATCH  &  FILE LIST
# =========================================================================
@app.on_message(filters.command("batch") & filters.private)
async def h_batch(client, m: Message):
    if len(m.command) != 3:
        return await m.reply_text(
            "Usage:\n<code>/batch first_msg_link last_msg_link</code>\n\n"
            "Or:\n<code>/batch first_id last_id</code>  (numeric bin ids)")
    def _mid(x: str) -> Optional[int]:
        if x.isdigit(): return int(x)
        m = re.search(r"/(\d+)$", x)
        return int(m.group(1)) if m else None
    a, b = _mid(m.command[1]), _mid(m.command[2])
    if not (a and b) or b < a:
        return await m.reply_text("Invalid ids/links.")
    if b - a > BATCH_LIMIT:
        return await m.reply_text(f"Batch max = {BATCH_LIMIT}")
    payload = encode_batch(f"batch-{a}-{b}")
    link = f"https://t.me/{temp.U_NAME}?start={payload}"
    await m.reply_text(f"✅ Batch link:\n{link}", disable_web_page_preview=True)


@app.on_message(filters.command("files") & filters.private)
async def h_files(_c, m: Message):
    uid = m.from_user.id
    files = await db.files.find({"user_id": uid}).to_list(length=100)
    if not files:
        return await m.reply_text("You haven't uploaded any files.")
    lines = [f"• <a href='{URL}watch/{f['file_id']}?hash={f['hash']}'>{f['file_name'][:40]}</a>"
             for f in files[:30]]
    await m.reply_text(f"📁 <b>Your files ({len(files)}):</b>\n" + "\n".join(lines),
                       disable_web_page_preview=True)


@app.on_message(filters.command("delfile") & filters.user(ADMIN_ID))
async def h_delfile(_c, m: Message):
    if len(m.command) < 2:
        return await m.reply_text("Usage: /delfile <user_id>")
    try: uid = int(m.command[1])
    except: return await m.reply_text("Invalid id.")
    n = await db.files.count_documents({"user_id": uid})
    await db.files.delete_many({"user_id": uid})
    await m.reply_text(f"Deleted {n} file records for {uid}")


# =========================================================================
# 21.  HANDLERS  ·  CALLBACK QUERIES
# =========================================================================
@app.on_callback_query()
async def h_cb(client: Client, q: CallbackQuery):
    data = q.data or ""
    try:
        if data == "close":
            return await q.message.delete()
        if data == "help":
            return await q.message.edit_text(
                HELP_TXT, reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("• ʜᴏᴍᴇ •",  callback_data="home"),
                      InlineKeyboardButton("• ᴄʟᴏsᴇ •", callback_data="close")]]))
        if data == "about":
            return await q.message.edit_text(
                ABOUT_TXT.format(n=temp.B_NAME, v=BOT_VERSION, pv=pyro_ver,
                                 up=get_readable_time(time.time()-START_TIME),
                                 ow=OWNER_USERNAME),
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("• ʜᴏᴍᴇ •",  callback_data="home"),
                      InlineKeyboardButton("• ᴄʟᴏsᴇ •", callback_data="close")]]))
        if data in ("home", "start"):
            return await q.message.edit_text(
                START_TXT.format(name=q.from_user.mention), reply_markup=_home_kb())
        if data == "premium_info":
            return await q.message.edit_text(
                "💎 <b>Premium Benefits</b>\n\n"
                "• No file limit\n• Direct links (no shortener)\n"
                "• No verification\n• Ad-free\n• Priority support\n\n"
                f"Contact @{OWNER_USERNAME}",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("• ʜᴏᴍᴇ •", callback_data="home")]]))
        if data == "refer":
            uid = q.from_user.id
            pts = await db.get_refer_points(uid)
            ref = f"https://t.me/{temp.U_NAME}?start=reff_{uid}"
            return await q.message.edit_text(
                f"🎁 <b>Refer & Earn</b>\n\n"
                f"Points: <code>{pts}</code>\n"
                f"+10 pts per join · 100 pts = 1 Month Premium\n\n"
                f"Your link:\n<code>{ref}</code>",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("• sʜᴀʀᴇ •",
                        url=f"https://telegram.me/share/url?url={ref}")],
                     [InlineKeyboardButton("• ʜᴏᴍᴇ •", callback_data="home")]]))
        if data == "bcast_cancel":
            temp.USERS_CANCEL = True
            return await q.answer("Broadcast will stop.", show_alert=True)
        if data.startswith("delfile_"):
            fid = int(data.split("_", 1)[1])
            doc = await db.files.find_one({"file_id": fid})
            if not doc:
                return await q.answer("Already deleted.", show_alert=True)
            if doc["user_id"] != q.from_user.id and q.from_user.id != ADMIN_ID:
                return await q.answer("Not your file.", show_alert=True)
            await db.files.delete_one({"file_id": fid})
            try: await client.delete_messages(BIN_CHANNEL, fid)
            except: pass
            await q.answer("Deleted.", show_alert=True)
            try: await q.message.edit_text("🗑 File deleted.")
            except: pass
    except Exception as e:
        log.warning(f"cb err: {e}")


# =========================================================================
# 22.  STARTUP  /  SHUTDOWN
# =========================================================================
async def _startup_banner():
    me = await app.get_me()
    temp.ME     = me.id
    temp.U_NAME = me.username
    temp.B_NAME = me.first_name
    temp.B_LINK = me.mention

    banner = (
        f"\n{'='*60}\n"
        f"  AV FILE-TO-LINK  ·  {BOT_VERSION}  ·  Pyrogram v{pyro_ver} (Layer {layer})\n"
        f"  Bot     : @{me.username}  ({me.id})\n"
        f"  Admin   : {ADMIN_ID}\n"
        f"  DB      : {DATABASE_NAME}\n"
        f"  Port    : {PORT}\n"
        f"  URL     : {URL}\n"
        f"{'='*60}\n"
    )
    print(banner)


async def _notify_restart():
    tz = pytz.timezone(TIMEZONE)
    now = datetime.now(tz)
    txt = (f"<b>♻️ Bot restarted</b>\n"
           f"📅 {now.strftime('%d-%m-%Y')}\n"
           f"⏰ {now.strftime('%I:%M:%S %p')}\n"
           f"🌐 URL: <code>{URL}</code>")
    for cid in (LOG_CHANNEL, SUPPORT_GROUP):
        if not cid:
            continue
        try:    await app.send_message(cid, txt)
        except: pass
    try:
        await app.send_message(ADMIN_ID, "✅ Bot restarted.")
    except Exception:
        pass


async def _run():
    print("\n" + "="*60)
    print(f"[START] {datetime.utcnow()}")
    print("="*60)

    # 1. bring up pyrogram
    log.info("🚀 starting pyrogram client…")
    await app.start()
    multi_clients[0] = app
    work_loads[0]    = 0
    await _startup_banner()

    # 2. start aiohttp
    runner = web.AppRunner(web.Application(client_max_size=30_000_000))
    runner.app.add_routes(routes)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", PORT).start()
    log.info(f"🌐 aiohttp listening on 0.0.0.0:{PORT}")

    # 3. HTTPS wrapper (Cloudflare Quick Tunnel) if needed
    await maybe_upgrade_url_to_https()

    # 4. notify
    await _notify_restart()

    # 5. idle forever
    await idle()

    # 6. shutdown
    log.info("Shutting down…")
    await app.stop()


def _install_signals(loop: asyncio.AbstractEventLoop):
    def _stop(*_):
        log.warning("Signal received, stopping…")
        for t in asyncio.all_tasks(loop):
            t.cancel()
    for s in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(s, _stop)
        except NotImplementedError:
            pass


def _global_excepthook(exc_type, exc_value, exc_tb):
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_tb)
        return
    log.critical("UNHANDLED EXCEPTION",
                 exc_info=(exc_type, exc_value, exc_tb))


sys.excepthook = _global_excepthook


if __name__ == "__main__":
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        _install_signals(loop)
        loop.run_until_complete(_run())
    except (KeyboardInterrupt, asyncio.CancelledError):
        log.info("Service stopped 👋")
    except Exception:
        log.critical("FATAL ERROR", exc_info=True)
        sys.exit(1)
