## Plan: AN iframe fixes, RS download fixes, season list, auto‑detect notify

### 1. AN (AnimeStill) iframe video — keep iframe, redesign overlay controls
File: `src/components/VideoPlayer.tsx` (in `forceEmbedMode` / `isEmbedPlayback` branch)

- Keep the iframe loading AN URL exactly as-is (no direct src extraction). Allow iframe interaction (remove `pointerEvents: none`, remove blocking overlay) so AN's own play/pause/seek/quality controls work.
- Hide our full custom control panel for AN. Render only a minimal floating top-right overlay with TWO buttons:
  - **Server change** (existing `serverList` switcher).
  - **Fullscreen / crop** (the existing fit/crop toggle from our player).
- "Pseudo-fullscreen" for AN iframe (since AN's player has no fullscreen): clicking our fullscreen button calls `element.requestFullscreen()` on the iframe wrapper div + sets `screen.orientation.lock('landscape')` + scales the iframe to fill the viewport (CSS `position:fixed; inset:0; width:100vw; height:100vh`). Tapping it again exits.
- **Hide download button entirely when AN content is playing** (iframe / `forceEmbedMode`). Download UI only renders for RS direct media.
- Keep season selector + episode list + suggested rail visible below AN iframe (these are ours, not AN's).

### 2. RS download — fix broken/0KB downloads + sequential "Download All"
File: `src/lib/downloadManager.ts`, `src/components/VideoPlayer.tsx`

- Root cause of 0KB: HLS (`.m3u8`) blob fetch returns the playlist text (~few KB), not the video. Only direct `.mp4` (HTTPS web-series-style links) are downloadable.
- New logic in `VideoPlayer` download handler:
  - Pick the **direct HTTPS mp4 link** from the episode's quality list (`link480/link720/link1080/link4k`) corresponding to selected quality. Skip `.m3u8` / proxy / iframe URLs.
  - If no direct mp4 is found → toast "Direct download not available for this episode".
  - For "Download All": queue every episode of the current season into a serial queue (sorted by `episodeNumber` ASC). The queue runs ONE at a time — next starts only after the previous is `complete` or `error`.
- In `downloadManager.ts`:
  - Add a `queue: string[]` and `processing: boolean` flag. New `enqueueDownload(params)` pushes to queue and triggers `processQueue()` which awaits each `startDownload` sequentially.
  - Stop the duplicate browser-notification download: remove the `<a download>` click trigger when `saveVideo` succeeds (file is already saved to IndexedDB; user opens it from the in-app Downloads page). OR keep one and remove the other — we keep IndexedDB only; export/share happens from Downloads page.
  - On error, do NOT auto-`window.open(url)` (currently re-triggers a browser download). Just mark error and move on.

### 3. Season list — single line, horizontal scroll, both places
Files: `src/components/VideoPlayer.tsx` (player season strip), `src/components/AnimeDetails.tsx` (details page season header)

- Wrap the season chips row in a flex container with `overflow-x-auto whitespace-nowrap flex-nowrap` + `[&::-webkit-scrollbar]:hidden`. Each chip uses `shrink-0`.
- Use `getShortSeasonLabel` everywhere (`Season 1`, `Season 2`...) — apply same helper in `AnimeDetails.tsx` (currently shows raw `season.name`).
- Touch-action: `pan-x` for smooth horizontal swipe.

### 4. Save + Notify — auto-detect newly added episode range + multi-targeting
File: `src/pages/Admin.tsx` (around lines 2156–5170)

- Track the **baseline** of seasons/episodes when the edit modal opens: `wsBaselineRef.current = deepClone(seasonsData)` set on series load.
- When user clicks "Save + Notify", BEFORE opening the modal compute the diff:
  - For each season, find new episode numbers that exist now but didn't in the baseline (or didn't exist at all).
  - Auto-fill `wsNotifySeason` + `wsNotifyEpisode` (start) + `wsNotifyEpisodeEnd` (end) from the diff.
  - If multiple non-contiguous ranges or multiple seasons changed, store an array `wsNotifyRanges: Array<{seasonIdx, startEp, endEp}>` and loop through it on confirm — pushing one notification + one Telegram post per range (so episodes 5–10 and 15–20 fire as two targeted notifications).
- The existing manual selectors stay but pre-populated; user can override. Show a small "Auto-detected: S1 E5–E10" hint above the selectors.
- Notification body becomes "Episode 5 to 10 are now available!" when range > 1.

### Out of scope (untouched)
- VideoPlayer src loading / quality switching / server logic for RS.
- Login page.
- Free-user device limit (already removed).

### Files to edit
- `src/components/VideoPlayer.tsx`
- `src/components/AnimeDetails.tsx`
- `src/lib/downloadManager.ts`
- `src/pages/Admin.tsx`
