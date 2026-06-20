---
name: No Lovable Edge Function Deploys (with 3 exceptions)
description: User does not deploy edge functions on Lovable EXCEPT three: rs-bot, send-otp-email, process-email-queue. Everything else goes through EGD Manager.
type: preference
---

**Rule:** Lovable Cloud edge function deploys are allowed ONLY for these 3 slugs:
- `rs-bot` (AI chat)
- `send-otp-email` (custom OTP email sender)
- `process-email-queue` (background OTP queue worker)

Everything else must be EGD-only (added to `edgeFunctionCodeLibrary.ts` via `?raw`, marked with a NEW badge in `EgdManager.tsx` (`NEW_EDGE_DEPLOYS`) and in `Admin.tsx` `FunctionUrlOverrides` (`NEW_ROUTER_PASTE`)). User pastes the resulting URL in the Edge Function URL Router.

## How to apply

1. For the 3 allowed slugs: editing `supabase/functions/<slug>/index.ts` is fine. Lovable auto-deploys them. Mark them in the `LOVABLE_MANAGED` set inside `EgdManager.tsx` so the Code Library card shows a blue **LOVABLE** badge (not the green NEW badge). The user should NOT need to redeploy them anywhere else.
2. For every other edge function:
   - Never call `supabase--deploy_edge_functions`.
   - Add/update entry in `src/lib/edgeFunctionCodeLibrary.ts` using `?raw` import.
   - Add slug to `NEW_EDGE_DEPLOYS` (EgdManager.tsx) and `NEW_ROUTER_PASTE` (Admin.tsx).
   - Source files may stay under `supabase/functions/` for the `?raw` import to work, but they are NOT meant to be Lovable-deployed.
3. Once the user confirms they've pasted the URL, NEW tags can be removed.

## Why

User's credit budget cannot sustain a large Lovable-managed edge runtime. They host video-proxy, video-download, an-api, apk-download, generate-backdrop, telegram-post, link-share-bot, shorten-arolinks on their own Supabase free tier. Only the 3 functions above are small/critical enough to stay on Lovable Cloud.

## Never do

- Don't deploy any edge function other than the 3 allowed slugs to Lovable Cloud.
- Don't put API keys in `add_secret` for non-Lovable-managed functions — those secrets belong in the user's own Supabase project.
