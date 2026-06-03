---
name: unlock-gate-toggle
description: Global Unlock Gate ON/OFF toggle at settings/unlockGateEnabled controls all flash/redirect; OFF = silent free play.
type: feature
---
- Firebase path: `settings/unlockGateEnabled` (boolean, default true).
- When false: `isShortenerEnabled()` in Index.tsx + VideoPlayer.tsx returns false → no redirect to /unlock-required, no toast, no ad-gate. Direct play.
- Admin toggle lives at top of AdServicesSection in Admin.tsx.
- Telegram bot webhook MUST be set to current Supabase project URL (`/functions/v1/telegram-post`) and `settings/telegramProvider/url` MUST also point to the same project — old/stale URLs break verify message delivery.
