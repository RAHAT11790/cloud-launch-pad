# RS Anime — Telegram Video Downloader Bot

Send a direct MP4 / M3U8 / MPD (or any yt-dlp supported) URL → pick a quality → the bot downloads with ffmpeg + yt-dlp and uploads back to Telegram with live progress bars. Supports up to **2 GB per file** (auto-splits larger files), custom thumbnails, and per-job cancel.

## 1. VPS prerequisites (Ubuntu / Debian)

```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-venv ffmpeg
python3 -m venv venv && source venv/bin/activate
pip install -U pip
pip install -r requirements.txt
# yt-dlp comes from requirements.txt — verify:
yt-dlp --version && ffmpeg -version | head -1
```

## 2. Configure

```bash
cp .env.example .env
nano .env   # fill API_ID, API_HASH, BOT_TOKEN (from @BotFather)
```

Get `API_ID` / `API_HASH` at <https://my.telegram.org/apps>.

### Optional: 2 GB uploads via user session
Bots are capped at 2000 MB. To upload closer to the true 2 GB limit (or 4 GB with Telegram Premium) generate a `USER_SESSION` string and paste it into `.env`:

```bash
python -m pyrogram
```

## 3. Run

```bash
source venv/bin/activate
python bot.py
```

Keep it alive with systemd / pm2 / screen — example `systemd` unit:

```ini
# /etc/systemd/system/rs-dl-bot.service
[Unit]
Description=RS Anime Downloader Bot
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/telegram-bot
ExecStart=/home/ubuntu/telegram-bot/venv/bin/python bot.py
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now rs-dl-bot
```

## 4. Bot commands

| Command | Description |
| --- | --- |
| Send URL | Probes qualities and shows inline buttons |
| `/thumb` | Reply / send a photo with this caption to set your custom thumbnail |
| `/clearthumb` | Remove your saved thumbnail |
| `/cancel` | Abort your current download / upload |
| `/help` | Usage info |

## 5. Notes

* HLS / DASH streams are remuxed to MP4 without re-encoding — fast and lossless.
* Downloads use 8 parallel fragments + 10 MB HTTP chunks for maximum throughput.
* Progress bars are rate-limited every 3 s to avoid Telegram FloodWait.
* Files > ~1.97 GB are automatically split with ffmpeg into `partNNN.mp4` pieces.
