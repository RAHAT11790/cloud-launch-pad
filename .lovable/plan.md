# Implementation Plan

আপনার ৪টি বড় কাজ আছে। Step-by-step এভাবে করব:

## Step 1 — Episode timer reset fix (সবার আগে, ছোট bug)
**Problem:** Episode switch করলে আগের episode-এর currentTime carry over হয় (২২ মিনিট থেকে শুরু হয়)।
**Fix:** `src/components/VideoPlayer.tsx` — episode/source change detect হলে `videoEl.currentTime = 0` force, এবং saved-progress restore logic শুধুমাত্র same episode reload-এর সময় চলবে (episode id change হলে skip)।

## Step 2 — Monetag সম্পূর্ণ অপসারণ
- Delete: `src/lib/monetagAds.ts`, `src/components/MonetagAdManager.tsx`, `src/components/admin/MonetagConfig.tsx`, `public/sw.js` (Monetag service worker)
- Remove all imports/usages from `VideoPlayer.tsx`, `Admin.tsx`, anywhere else
- Firebase `settings/monetag` node — keep data but stop reading
- Result: zero Monetag script, zero network call

## Step 3 — Adsterra integration (Popunder + Social Bar)
- New file `src/lib/adsterraAds.ts` — player-scoped loader (same lifecycle pattern as Monetag had: enter player → inject scripts, exit → cleanup)
- Two slots only:
  1. **Popunder** (`<head>` snippet) — fires on first user click inside player
  2. **Social Bar** (`<body>` snippet) — ambient banner, loads on player mount
- New `src/components/AdsterraAdManager.tsx` — mounted only inside VideoPlayer, premium users → early return (no scripts)
- New admin section `src/components/admin/AdsterraConfig.tsx`:
  - Two `<textarea>` for the two `<script>` snippets
  - Master ON/OFF toggle
  - Stored at Firebase `settings/adsterra` ({ enabled, popunder, socialBar })

## Step 4 — Anti-bypass / Adblock guard
- New `src/lib/adGuard.ts` — runs only inside player, only for non-premium:
  - Bait-element detection (create hidden `.adsbox` div, check `offsetHeight===0` after 100ms)
  - Probe fetch to Adsterra script URL — if `failed/blocked` and bait hidden → user is blocking
  - Action: pause video + full-screen overlay "Please disable ad-blocker / VPN / custom DNS to continue" — no dismiss button, only "Retry" (re-checks)
  - DNS-level blockers (NextDNS / AdGuard DNS) are caught by the probe-fetch failing while network is otherwise fine
- Premium users completely skip this check

## Step 5 — Backdrop AI Generator (Admin tool)
**API:** আপনার দেওয়া innocent-ai.top endpoint (`gpt-image2.php` বা `nano2.php` — image gen) — key Supabase secret-এ store হবে।

**Edge function:** `supabase/functions/generate-backdrop/index.ts`
- Input: `{ animeId, title, year, genre }`
- Builds prompt: cinematic 16:9 anime backdrop, title text overlay, RS ANIME logo top-right, Telegram tag bottom-left (style matches your two reference images)
- Calls innocent-ai endpoint → gets image (URL or base64)
- Re-uploads to ImgBB (existing `imgbbUpload` helper logic, server-side fetch)
- Updates Firebase `webseries/{id}/backdrop` (or `movies/{id}/backdrop`)
- Returns `{ ok, url }`

**Admin UI:** new section `src/components/admin/BackdropAiReplacer.tsx`
- Lists all series + movies with current backdrop preview
- Per-row "Generate" button (single)
- "Generate ALL" button — sequential queue with live progress: `[12/247] Naruto ✓`, errors logged inline
- Cancel button mid-batch
- Shows realtime A-to-Z log feed

**Secret needed:** `INNOCENT_AI_API_KEY` (the `ak_ce4a84...` token)

---

## Order of execution
1. Fix episode timer (10 min)
2. Rip out Monetag (15 min)
3. Add Adsterra + admin config (20 min)
4. Add ad-guard with overlay (15 min)
5. Add INNOCENT_AI_API_KEY secret → build edge function → admin UI (40 min)

## Question before I start
Step 5-এর জন্য `INNOCENT_AI_API_KEY` secret add করতে হবে। Plan approve করলে আমি secret request পাঠাব, আপনি `ak_ce4a84ffd50eac6c9f829fd648290451fbd11808854574481e36d851cf4e1b3b` paste করবেন। Approve?
