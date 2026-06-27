# AN Firebase Prefetch + Player Fixes

## 1. AN Link Prefetch → Firebase (Admin Panel)
**New file:** `src/components/admin/AnFirebasePrefetcher.tsx` (mounted inside the existing AnimeSalt/AN section of `Admin.tsx`).

UI:
- **"All Series"** button — iterates every AN series currently surfaced in the user panel, calls `/anime?slug=` then `/episode?slug=` per episode, stores results.
- **"Single Series"** — slug input, prefetches just that one.
- **"Repair Broken"** — re-fetches only episodes flagged `broken: true`.
- Live progress log (current series / episode / success / fail counters).
- Concurrency: 4 episodes in parallel, 250ms throttle between series to avoid rate-limit.

**Firebase path (confirmed):**
```
anSeries/{slug}/
  meta: { title, poster, type, updatedAt }
  episodes/{epSlug}/
    number, title, directUrl, links: [{quality,url}],
    audio, defaultAudioIdx, preferredAudio,
    updatedAt, broken: false
```

## 2. Reader Side — Read From Firebase First
Edit `src/hooks/useAnimeSaltData.ts` (or wherever AN episode resolves in `AnNativeView.tsx` / `Index.tsx`):
- Before calling `an-api /episode`, read `anSeries/{slug}/episodes/{epSlug}` from Firebase.
- If found and not `broken` → return instantly (no toast).
- If missing/broken → fall back to API, then write result back to Firebase.
- On playback error in `VideoPlayer.tsx`, mark `broken: true` so the repair button can pick it up; auto-trigger one silent API refetch and update Firebase.

## 3. Remove "Loading details…" Toast
- Delete `showDetailsLoadingToast()` calls in `src/pages/Index.tsx` and AN card handlers.
- Remove the global event/toast-id wiring added for it.

## 4. Player — Check Size 1 MB
`src/components/VideoPlayer.tsx` HLS config:
- `maxBufferSize: 1 * 1024 * 1024` (was much larger)
- Keep `maxBufferLength` reasonable (30s) so low-power phones cope.

## 5. Brightness Gesture Zone (Left 30% / Middle 40% dead / Right 30% volume)
`VideoPlayer.tsx` vertical-swipe handler:
```
const w = rect.width;
const x = touch.clientX - rect.left;
if (x < w * 0.30) → brightness
else if (x > w * 0.70) → volume
else → ignore (no-op, allow tap/seek)
```
Removes the current middle-zone brightness bug.

## 6. Hanging Face Server ("video লোড হয় না, কিছুই দেখায় না")
- Inspect the server entry in admin server list (likely `huggingface.co/spaces/...` proxy).
- Symptom = silent fail → almost certainly mixed-content / CORS on the HF Space.
- Fix: route Hanging Face URLs through `video-proxy` like other HTTP sources, and add HF host to proxy allowlist. Add a 5s probe; if no `loadedmetadata`, mark server failed and show clear toast instead of blank.

## 7. Testing
After build, Playwright on preview:
- Open one AN series, run "Single Series" prefetch, verify Firebase write.
- Re-open episode → confirm instant load (no toast, no API call in network panel).
- Switch episode → < 1s.
- Verify brightness only triggers on left 30%.
- Verify Hanging Face server now plays or fails loudly.

## Files Touched
- `src/components/admin/AnFirebasePrefetcher.tsx` (new)
- `src/components/admin/Admin.tsx` or wherever AN admin section lives (mount component)
- `src/hooks/useAnimeSaltData.ts`
- `src/components/AnNativeView.tsx`
- `src/components/VideoPlayer.tsx`
- `src/pages/Index.tsx` (remove toast)
- `supabase/functions/video-proxy/index.ts` (HF host allowlist if restricted)

## Out of Scope
- No changes to RS pipeline.
- No schema changes beyond the new `anSeries/*` Firebase node.
