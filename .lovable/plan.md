# Plan: Ultra-optimization + AN restore + Edge Manager completeness

You've asked for many things in one go. I'll group them into 4 focused work-blocks and ship them in this chat one after another. Here's the plan so you know exactly what I'll do.

## Block 1 — Persistent image cache (biggest perf win)

Goal: every poster/backdrop the user sees gets stored on their device once, then served instantly forever (until they clear browser data). Firebase load drops ~60%.

**Tech:** Service Worker with Cache Storage API (NOT localStorage — localStorage is 5MB and can't hold images; Cache Storage is hundreds of MB and is the correct tool for this).

- Extend existing `public/sw.js` with a `rs-image-cache-v1` cache.
- Strategy: **stale-while-revalidate** for all image hosts (ImgBB, TMDB, Firebase Storage, AnimeSalt CDN). First visit → fetch + cache. Every later visit (even after scrolling away and back) → served from cache in <5ms, no black flash, no network call.
- Cache survives reloads, tab close, and even cache deletion (SW re-fills automatically on next view).
- Add `<img loading="eager" decoding="async" fetchpriority="…">` on above-the-fold posters so they paint before scroll.
- Add a tiny low-res blurred placeholder (CSS gradient based on poster color) so cards are never pure black while the cached image decodes.

## Block 2 — Search bar instant open + branding text fix

- **Search bar lag:** the route currently lazy-mounts on click. I'll preload the SearchPage chunk on app idle (`requestIdleCallback`) so tapping the search bar opens it in <50ms.
- **"RS Anime" footer text:** find the home-screen footer/about block, replace any hardcoded `"Anime"` string with the live `branding.siteName` value from Firebase (`settings/branding`). Whatever you save in admin panel will show.

## Block 3 — Restore AN video playback (Lovable credits exhausted)

Since the AN proxy edge function is dead, I'll wire the **AnimeSalt direct-fetch + custom worker fallback** path that already exists in `src/lib/animeSaltApi.ts` into the player flow:

- In Edge Router admin, the existing "AnimeSalt Custom URL" field will be used as the primary source when Lovable edge fails.
- In Edge Manager, add a one-click deploy block for the AnimeSalt worker code so you can paste the deployed Worker URL into Edge Router → save → AN plays again with **your** RS video player (not the default loader).
- Cache resolved AN episode links in Firebase `animesaltCache/{id}` (already partly built) — second open = <1s.

## Block 4 — Edge Manager / Edge Router completeness

You're right that Edge Manager is missing several functions. I'll audit `supabase/functions/*` and make sure **every** one of these has a Manager deploy card + Router URL slot:

- `an-api` (AnimeSalt)
- `link-share-bot` ← currently missing, will add
- `telegram-post`
- `rs-bot`
- `send-otp-email`, `process-email-queue`
- `shorten-arolinks`
- `video-proxy`, `video-download`
- `apk-download`
- `generate-backdrop`

**Env var hygiene:** for each card I'll show ONLY the secrets that function actually reads from `Deno.env.get(...)` — no junk placeholders. Bot tokens (which only you have) will be empty fields for you to paste; API keys already in Supabase Secrets won't be re-asked.

**Link Share Bot vs Telegram Post bot:** I'll keep them as two separate cards with two separate token slots (`LINK_SHARE_BOT_TOKEN` and `TELEGRAM_BOT_TOKEN`), since they're different bots with different jobs.

---

## Order of execution in this chat

1. Block 1 (image cache) — ships first, immediate visible win
2. Block 2 (search + branding)
3. Block 4 (Edge Manager audit) — needed before Block 3 can be deployed
4. Block 3 (AN restore via your deployed worker)

After each block I'll verify (build clean + targeted check) before moving on. No stopping until all 4 are done, as you instructed.

**Approve this plan and I'll start with Block 1 immediately.**