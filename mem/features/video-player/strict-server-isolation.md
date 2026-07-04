---
name: Strict per-server URL isolation
description: VideoPlayer must NEVER auto-mirror a server's URL to other origins. Each admin-defined server uses ONLY its own configured domain.
type: feature
---

**Rule:** `buildPlaybackCandidates()` in `src/components/VideoPlayer.tsx` does NOT call any mirror/origin-swap helper across servers. Each candidate list contains only:
- the original (per-server) URL
- the admin proxy variant (if HTTP/proxy preferred)
- the built-in stream proxy variant

The constant `VIDEO_MIRROR_ORIGINS` and helper `buildManagedMirrorSources()` still exist for `buildFallbackServers()` (used only when admin hasn't configured any servers at all), but they MUST NOT be invoked inside `buildPlaybackCandidates`.

**Why:** Previously, when the "Premium" server (e.g. Render) was down, the player silently swapped to a free origin like `hf.space` or `bot-hosting.net` inside the same candidate list. The UI still showed "Premium" while playing from a free server, making it impossible to diagnose a dead premium URL. Now per-server failover is explicit (handled by `switchServer()` walking the admin server list) and the user sees which server is actually playing.

**When editing the player:** If you ever feel tempted to re-add cross-origin mirroring inside `buildPlaybackCandidates`, DON'T. Add another server in admin instead.
