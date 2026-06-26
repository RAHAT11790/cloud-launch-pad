---
name: Dual-deploy edge functions (Lovable + EGD)
description: Lovable agent MUST deploy every library edge function on Lovable Cloud AND keep it in EGD library so admin can self-deploy as backup. Default button uses Lovable URL.
type: preference
---

**Rule:** Every edge function in `src/lib/edgeFunctionCodeLibrary.ts` MUST be deployed on Lovable Cloud by the agent, AND remain available for the admin to self-deploy via EGD Manager.

## Why
User wants dual redundancy: agent-hosted copy by default (so testing & playback work the moment code lands), and admin-hosted copy as backup (when Lovable credits run out, admin pastes their own URL and switches over). When Lovable credits restore, admin clicks "Default" to switch back to the agent's URL.

## How to apply

1. **Always deploy** every function in `EDGE_FUNCTION_LIBRARY` via `supabase--deploy_edge_functions` when its code changes.
2. Keep `?raw` import + `entry()` row in `src/lib/edgeFunctionCodeLibrary.ts` so admin can still self-deploy via EGD Manager.
3. EGD Router (`FunctionUrlOverrides` in `src/pages/Admin.tsx`) shows a **Default** button per row that pastes `https://kqxpzqegtvaiwgdusrin.supabase.co/functions/v1/<slug>` (the Lovable copy). Admin saves to activate.
4. Required secrets for any function the agent deploys (e.g. `ALLOWED_HOSTS`, `TELEGRAM_BOT_TOKEN`, `AROLINKS_API_KEY`, `LINK_SHARE_BOT_TOKEN`, `SHRINKME_API_KEY`) must exist in this Lovable project's secrets. Check before deploying; request via `add_secret` if missing.
5. Test edge functions via `supabase--curl_edge_functions` after any change — the agent has no other way to verify behavior since it cannot see the admin's self-hosted Supabase project.

## Currently dual-deployed (all 8)
`video-proxy`, `video-download`, `live-tv-proxy`, `telegram-post`, `apk-download`, `link-share-bot`, `shorten-arolinks`, `an-api`.

The previous rule "no Lovable edge deploys except 3" is REVOKED. Old file `mem/preferences/no-lovable-edge-deploy.md` was deleted.
