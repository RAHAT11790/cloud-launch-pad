---
name: RS server first playback policy
description: Fix RS server URLs and routing first; never change HLS or general player logic unless the user explicitly requests HLS/player changes.
type: preference
---

**Rule:** When the user asks to fix video servers, playback URLs, buffering, or RS playback, investigate and fix the RS server URL/domain/proxy path first.

Do not modify HLS/AN playback behavior or broad VideoPlayer playback logic unless the user explicitly asks to change HLS or the player itself. Preserve existing HLS paths and settings while repairing RS sources.

**Why:** Unrequested HLS/player tuning previously caused regressions and heavier buffering while the actual RS server URL problem remained.
