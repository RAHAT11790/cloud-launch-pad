## 1. Episode strip "All" — sticky pill + bottom sheet

**File:** `src/components/VideoPlayer.tsx` (episode horizontal selector)

- Remove "All" from the scrolling list. Render it as a separate sticky pill on the left (`position: sticky; left: 0; z-index: 2`) with a solid dark background + subtle border + small right-side shadow so scrolling episodes visually slide *underneath* it (matches the reference screenshot exactly).
- Active state for "All" uses the same green gradient/glow as numbered episodes.
- Tapping "All" opens a bottom sheet titled **"All episodes"** with:
  - Close (×) top-right
  - Grid of episode tiles (6 per row on mobile), same square style as the screenshot — current episode highlighted in green/teal.
  - Tap tile → selects that episode + closes sheet.
- Sheet uses existing `Sheet` from shadcn (side="bottom") so no extra animation cost; keep transitions ≤150ms to stay lag-free.

No "All" detail page in the main layout — the sheet **is** the detail view, opened only on tap.

## 2. Backdrop AI — true image-to-image from TMDB reference

**File:** `supabase/functions/generate-backdrop/index.ts` (+ small admin UI toggle in `src/components/admin/BackdropAiReplacer.tsx`)

Current behavior: text-to-image only → AI invents characters and misreads genre (romance → action, etc.).

New flow when `mode="backdrop"`:
1. Caller passes `tmdbBackdropUrl` + `tmdbOverview` + `tmdbGenres[]` + `title` + `year`.
2. Edge function downloads the TMDB backdrop bytes.
3. Builds a **grounded prompt** that explicitly states genre (`Romance / Slice-of-life — soft pastel lighting, NOT action`), overview summary (2 lines), and a "preserve original characters from reference image: same hair, eyes, outfit, body proportions, expressions" instruction.
4. Calls **image-edit** model (`google/gemini-3.1-flash-image-preview` via Lovable AI Gateway `/v1/images/generations` with the reference image attached as input) instead of pure text-to-image. Falls back to `google/gemini-3-pro-image-preview` if flash fails.
5. Lovable model output → ImgBB → returns URL.
6. Keep old text-to-image path as fallback when TMDB backdrop is missing.

Admin UI: small "Use TMDB reference (recommended)" toggle defaults to ON. Pass the TMDB backdrop URL already stored on the anime record.

## 3. Admin Settings → Anime Name Exporter (AN / RS / Both)

**Files:** new `src/components/admin/AnimeNameExporter.tsx`, mounted at the **bottom** of the Settings tab in `src/pages/Admin.tsx`.

UI: card titled "Export Anime Names" with 5 buttons, each downloads a `.json` and `.txt` (toggle):
- **RS only** — names that exist in Firebase RS catalog but not in AnimeSalt (AN).
- **AN only** — names from AnimeSalt that aren't in RS.
- **In both** — intersection.
- **All RS** — full RS list.
- **All AN** — full AN list.

Matching: normalized title (lowercase, strip punctuation, collapse spaces). Each export item: `{ id, title, year, source }`. Filename pattern: `rs-only-2026-06-07.json` etc. Pure client-side using already-loaded `useFirebaseData` + `useAnimeSaltData`.

## Technical notes
- No DB migrations.
- No new dependencies.
- Backdrop edge function will be redeployed after edit.
- "All" pill uses semantic tokens (`bg-card`, `border-border`, `text-primary`) — no hard-coded colors.

## Out of scope (explicitly not doing)
- No standalone "All" detail route/page.
- No changes to episode data model.
- No changes to RS/AN catalog sources — exporter is read-only.
