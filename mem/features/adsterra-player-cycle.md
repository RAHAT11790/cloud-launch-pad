---
name: Player Adsterra two-ad cycle
description: Video player injects Popunder plus Social/Push ads on every player click with no cooldown.
type: feature
---

Adsterra player ads are click-triggered with no app-side cooldown.

Rules:
- Add both configured player placements: `streamLink` / social-push and `popunder`.
- Do not throttle player ad calls; every video/player click may call configured ads.
- Admin panel must not show or save a player cooldown timer.
- Premium users still bypass player ads.
- Do not show a blocking adblock/VPN/DNS guard overlay in the player; ad calls are best-effort and must not pause playback repeatedly.