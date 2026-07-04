---
name: Edge Function ↔ EGD Manager sync
description: Whenever a Supabase edge function is created/edited, ensure its source flows into the EGD Manager library so admin can redeploy.
type: preference
---
**Rule:** Every time I touch `supabase/functions/<slug>/index.ts` (create or edit), the EGD Manager library MUST reflect the latest code.

**How it works (no manual copy needed for most functions):**
- `src/lib/edgeFunctionCodeLibrary.ts` imports each function's source via Vite `?raw` imports from `../../supabase/functions/<slug>/index.ts`. Edits propagate automatically on next build.
- **Exception:** `generate-backdrop` is NOT auto-deployed by Lovable. Its source lives at `src/lib/edgeSources/generate-backdrop.source.ts.txt` (raw imported). When editing this function, edit THAT file (not under `supabase/functions/`).

**Checklist when adding a new edge function:**
1. Create `supabase/functions/<slug>/index.ts`.
2. Add a `?raw` import + `entry()` row in `src/lib/edgeFunctionCodeLibrary.ts`.
3. Secrets auto-detected from `Deno.env.get("X")`. Vars with a `?? "fallback"` or `|| "fallback"` are treated as OPTIONAL and not requested at deploy time. Only truly required secrets surface in the deploy form.

**Why:** User redeploys every function via their own EGD Manager (own Supabase project). Library must always be current or admin sees stale code.
