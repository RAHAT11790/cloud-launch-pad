# Full Fix Plan — Log Channel Backup + Dedicated Video Player Route + HLS Tracks

## 1. Python Bot (`main_rahat.py`) — Log Channel Backup System

The streaming link must be built from the **log channel's** `chat_id` + `message_id` + a security hash, exactly like your old links. Right now the bot never forwards the finished video to the log channel, so there is no backup and the link format is wrong.

**Changes (delivered as full code in chat):**

- New env / config:
  - `LOG_CHANNEL_ID` (e.g. `-1001234567890`) — the bin/log channel.
  - `STREAM_SECRET` — HMAC secret for the hash segment.
- After a task finishes converting:
  1. Upload the final MP4 (or master HLS folder zipped reference) to the log channel via `bot.send_video(LOG_CHANNEL_ID, ...)`.
  2. Capture `msg.message_id` and `msg.video.file_id`.
  3. Build the link in the **old format**:
     ```
     https://<host>/stream/<log_channel_id>/<message_id>/<hash>/master.m3u8
     ```
     where `hash = hmac_sha256(secret, f"{channel_id}:{message_id}").hexdigest()[:16]`.
  4. Persist `(task_id → channel_id, message_id, hash, file_id)` in `tasks.json` so streams can be re-resolved from Telegram if local cache is wiped (true backup).
- Flask stream server:
  - New route `/stream/<channel_id>/<message_id>/<hash>/master.m3u8` validates hash, then resolves to the cached HLS or, if missing, re-downloads the original from the log channel using `file_id` and re-segments.
  - Keep the legacy `/stream/<task_id>/master.m3u8` working as an alias.
- Hardening: retries on Telegram 429/5xx, per-task lock to prevent double upload, graceful failure if `LOG_CHANNEL_ID` unset (logs warning, still serves stream but no backup).
- Keep all previous features (RAHAT MEDIA STUDIO branding, compact progress bars, VTT subs, multi-audio HLS, native player at `/play/<task_id>`).

Full file will be pasted in chat after approval.

## 2. Dedicated Video Player Route (no more overlay on Home)

**Problem today:** `VideoPlayer` is rendered conditionally inside `Index.tsx` on top of the home screen, so the hero slider, sections, and state all stay mounted → memory leaks and lag.

**Fix:**

- Add `/watch/:animeId/:episodeId?` route in `src/App.tsx`, lazy-loaded.
- New page `src/pages/Watch.tsx`:
  - Loads anime + episode from Firebase using URL params (no dependency on Home state).
  - Renders only `<VideoPlayer />` full-screen — nothing else mounted.
  - On close → `navigate(-1)` returns to previous page (Home stays in its last scroll state via the existing sessionStorage persistence).
- `Index.tsx`:
  - Remove the `<VideoPlayer ... />` overlay block and its `selectedEpisode` open-state.
  - Replace "play" handlers (in `AnimeDetails`, `NewEpisodeReleases`, `WeeklyEpisodeManager` previews, continue-watching, etc.) with `navigate('/watch/'+animeId+'/'+episodeId)`.
- `VideoPlayer.tsx`:
  - Accept `onClose` prop that defaults to `navigate(-1)` when used from `/watch`.
  - Add aggressive cleanup on unmount: detach `hls.js`, `video.removeAttribute('src')`, `video.load()`, clear all timers, revoke any blob URLs — confirms no leaks when leaving the route.
- Home page no longer re-renders while video plays → hero slider, sections, etc. fully unmount perception-wise (they stay in memory but are idle and not animating because the route changed).

## 3. HLS Audio + Subtitle Buttons (no overlay, clean UI)

Already wired `hls.js` last turn. Polish:

- **Audio button (`Languages` icon)** and **CC button (`Subtitles` icon)** placed inline in the bottom control bar, right side, between Quality and Settings — same pill style as Quality button.
- Click → opens a bottom-sheet panel (same pattern as existing Quality panel) listing tracks with a checkmark on the active one. Panels are **siblings of the video**, not absolutely positioned over the controls — no overlay z-index conflicts.
- Buttons auto-hide when the HLS manifest exposes 0 or 1 track of that type (so non-HLS sources don't show empty buttons).
- Labels use the manifest's `name`/`lang` (e.g. "Hindi", "Japanese", "English CC") with a fallback to `Track 1/2/3`.
- Subtitle "Off" option always present.
- All styles use semantic tokens (`bg-card`, `text-foreground`, `border-border`) — matches your existing player.

## 4. Verification

- Build passes.
- Manually test: open anime → click episode → URL changes to `/watch/...`, Home unmounts visually, player loads HLS, audio + sub buttons appear and switch tracks, close returns to Home with scroll preserved.
- Python bot: dry-run path that mocks Telegram upload and asserts link format matches old regex `^/stream/-?\d+/\d+/[a-f0-9]{16}/master\.m3u8$`.

## Order of execution

1. Add `/watch` route, `Watch.tsx`, navigation rewires (web side).
2. VideoPlayer cleanup + audio/sub buttons polish.
3. Remove overlay from `Index.tsx`.
4. Paste full revised `main_rahat.py` in chat with log channel backup.

Approve and I'll ship all four in one pass.
