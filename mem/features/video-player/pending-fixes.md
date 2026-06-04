---
name: VideoPlayer pending fixes (next message scope)
description: Open VideoPlayer bugs to fix in the next dedicated VideoPlayer-only pass — continue-watching resume from 0, episode-change carrying over time, ad force-off
type: feature
---

NEXT VideoPlayer-only message must fix:

1. **Continue Watching resume from 0**: ProfilePage and Home show saved position (e.g. 10 min watched) but when user taps the card, player starts from 0:00. Resume `currentTime` is not being applied on initial play. Check that `playerState.startAt` / `initialPosition` is read from `users/{uid}/watchHistory/{animeId}.currentTime` and applied via `video.currentTime = X` on `loadedmetadata` (not `canplay`).

2. **Episode change does NOT reset to 0**: When switching episodes inside the same series, player keeps the previous episode's `currentTime` (e.g. 22:00) instead of starting at 0. Must clear `currentTime` and any stored `startAt` whenever `epIdx` or `seasonIdx` changes.

3. **Ads must not be forced**: Currently ad gating sometimes blocks playback when ad network fails. Make ads best-effort: if ad SDK errors or times out (>2s), silently continue to video. Never force a failing ad to gate playback.

4. **Per-user continue-watching writes**: Confirm progress saves to `users/{uid}/watchHistory/{animeId}` with `currentTime`, `duration`, `watchedAt`, and `episodeInfo` on every 5s tick. Also mirror to localStorage `rs_continueCache` so offline/guest scenarios still show.
