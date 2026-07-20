# RS Anime — Telegram Downloader Bot (Admin-only)

Private bot. Only the Telegram user whose ID matches `OWNER_ID` can talk to it.

## 1. VPS setup (Debian / Ubuntu)

```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-venv ffmpeg
cd telegram-bot
python3 -m venv venv && source venv/bin/activate
pip install -U pip
pip install -r requirements.txt
```

All packages install at their latest versions — no pinned numbers.

## 2. Configure

```bash
cp .env.example .env
nano .env
```

Fill only these four values:

| Var | Where |
| --- | --- |
| `API_ID`, `API_HASH` | <https://my.telegram.org/apps> |
| `BOT_TOKEN` | @BotFather |
| `OWNER_ID` | @userinfobot (your numeric Telegram id) |

No `USER_SESSION`, no `BOT_API_SERVER` — not needed.

## 3. Run

```bash
python3 bot.py
```

You should see:

```
HH:MM:SS | INFO    | rs-bot | Starting RS Downloader Bot — owner=… workdir=…
```

Send the bot any video URL from your admin Telegram account.

## 4. systemd (optional)

```ini
# /etc/systemd/system/rs-dl-bot.service
[Unit]
Description=RS Anime Downloader Bot
After=network.target

[Service]
User=root
WorkingDirectory=/root/bots/rs-dl
ExecStart=/root/bots/rs-dl/venv/bin/python bot.py
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now rs-dl-bot
journalctl -u rs-dl-bot -f     # live log
```

## Commands

| Command | Description |
| --- | --- |
| Send URL | Probes qualities and shows inline buttons |
| `/thumb` | Reply to a photo with this command to save it as your custom thumbnail |
| `/clearthumb` | Remove saved thumbnail |
| `/cancel` | Cancel any running job |
| `/help` | Usage info |

## Notes

* Bot upload cap ≈ 1.95 GB per file. Larger files are refused with a message.
* HLS / DASH remuxed to MP4 (no re-encode).
* Every error is logged in full to stdout / journalctl.
