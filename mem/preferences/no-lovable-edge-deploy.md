---
name: No Lovable Edge Function Deploys
description: User never wants Lovable to deploy Supabase edge functions; all edge work must go through EGD Manager with NEW tags.
type: preference
---

**Rule: NEVER deploy any edge function to Lovable Cloud.**

The user's credit budget cannot sustain Lovable-managed edge function runtime (Lovable functions expire when credits run out). They run everything on their own Supabase project via the EGD Manager → Edge Function URL Router flow. **Unlimited usage on their own Supabase is free.**

## How to apply

1. **Never call `supabase--deploy_edge_functions` and never create `supabase/functions/<name>/index.ts` expecting Lovable to deploy it.** If old Lovable-deployed functions exist, delete them with `supabase--delete_edge_functions`.
2. When edge function source code is created or modified:
   - Add (or update) its entry in `src/lib/edgeFunctionCodeLibrary.ts` using `?raw` import.
   - In `src/components/admin/EgdManager.tsx`, mark the slug in the `NEW_EDGE_DEPLOYS` set so a green **NEW** badge appears on the function card. The user reads that as "deploy this in my own Supabase now."
3. In `src/pages/Admin.tsx` → `FunctionUrlOverrides`, mark the same slug in `NEW_ROUTER_PASTE` so a **NEW** badge appears next to the URL input field. That's the user's cue to paste the freshly-deployed URL there.
4. Once the user confirms they've pasted the URL, remove the slug from both NEW sets (or leave it — they'll tell us).
5. Source files under `supabase/functions/` may stay (they feed `?raw` imports for EGD) — but they must NOT trigger Lovable deploys. If Lovable's auto-deploy can't be selectively disabled, prefer storing source under `src/lib/edgeSources/<name>.source.ts.txt` like `generate-backdrop`.

## Never do

- Don't run `supabase--deploy_edge_functions`.
- Don't tell the user "I've deployed it" — only "added to EGD Manager with NEW tag, please deploy from your Supabase."
- Don't put API keys in `add_secret` expecting Lovable runtime to use them for these functions. Their secrets live in their Supabase project.
