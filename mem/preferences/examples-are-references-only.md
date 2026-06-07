---
name: User examples are references only — never copy literally
description: When the user shares a screenshot/image as an example, extract the IDEA only — never replicate sizes, colors, layout, or styling verbatim. Always match the site's existing UI/theme.
type: preference
---

When the user attaches an image/screenshot and says things like "look at this", "এরকম", "এর মতন", "উদাহরণ" — this is a REFERENCE to communicate intent, NOT a design spec to clone.

**Rules:**
- Extract only the conceptual idea (e.g. "rounded buttons", "tunnel slide effect", "ultra-pro banner").
- Keep the existing site's color palette, sizing, spacing, typography, and component conventions intact.
- Never lift exact colors, sizes, fonts, or layout values from the example.
- Match the website's existing UI — that is the source of truth.

**Why:** The user has explicitly and repeatedly stated this is their #1 frustration. Copying examples literally breaks site cohesion and forces rework.

**Applies to:** UI components, AI image generation prompts (e.g. backdrop generator — use example only to understand branding/quality bar, don't hardcode "match Captain Tsubasa layout"), animations, and any visual reference the user shares.
