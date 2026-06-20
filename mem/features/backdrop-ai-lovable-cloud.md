---
name: Backdrop AI on Lovable Cloud
description: Backdrop/Logo AI runs via auto-deployed `lovable-backdrop` edge function (uses LOVABLE_API_KEY). NOT in EGD Manager / Edge Router. Called directly via supabase.functions.invoke.
type: feature
---
- Edge function: `supabase/functions/lovable-backdrop/index.ts` — deployed on Lovable Cloud.
- BackdropAiReplacer calls it directly with `supabase.functions.invoke("lovable-backdrop", ...)`.
- NOT listed in EGD Manager library, NOT in Edge Router NEW paste list.
- Uses Lovable AI Gateway image generation (`google/gemini-3.1-flash-image-preview`).
- Uploads result to ImgBB for permanent URL.
- This is the ONE exception to the "no Lovable edge deploys" rule because LOVABLE_API_KEY can only live on Lovable Cloud.
