---
name: Player Adsterra two-ad cycle
description: Video player only alternates Stream Link and Popunder ads every 45–60 seconds; no post notification/social bar ads.
type: feature
---

Only two Adsterra player ad types are allowed: `streamLink` and `popunder`.

Rules:
- Do not re-add post notification/social-bar ads inside the video player.
- Alternate calls one-by-one between Stream Link and Popunder when both are configured.
- Schedule calls with jitter between 45 and 60 seconds to avoid player lag/ad spam.
- Premium users still bypass player ads.