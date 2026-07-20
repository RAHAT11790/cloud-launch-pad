# RS Anime — Telegram Downloader Bot (Admin-only, no .env)

সব config সরাসরি `bot.py`-এর উপরে। কোনো `.env` লাগবে না।

## 1. VPS setup

```bash
sudo apt update
sudo apt install -y python3 python3-pip ffmpeg
pip3 install -r requirements.txt
```

সব package latest version-এ install হবে।

## 2. Edit `bot.py`

উপরের CONFIG block-এ ৪টা মান বসাও:

```python
API_ID    = 1234567
API_HASH  = "your_api_hash_here"
BOT_TOKEN = "123456:ABC-DEF..."
OWNER_ID  = 123456789
```

- `API_ID` / `API_HASH` — <https://my.telegram.org/apps>
- `BOT_TOKEN` — @BotFather
- `OWNER_ID` — @userinfobot (তোমার numeric Telegram id)

## 3. Run

```bash
python3 bot.py
```

Log-এ দেখাবে:

```
HH:MM:SS | INFO | rs-bot | 🚀 Starting RS Downloader Bot — owner=… workdir=…
```

Telegram-এ bot-কে `/start` পাঠাও — instant reply আসবে।

## Commands

| Command | কাজ |
| --- | --- |
| URL পাঠাও | Quality button আসে |
| `/thumb` | photo-এ reply করে custom thumbnail |
| `/clearthumb` | thumbnail remove |
| `/cancel` | চলমান job cancel |
| `/help` | help |
