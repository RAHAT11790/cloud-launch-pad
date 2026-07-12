# User Panel Ultra-Optimization Plan

## লক্ষ্য
১. Home ↔ Series ↔ Movies ↔ Live TV navigation lag/latency দূর করা।
২. Profile, Search, Cards, Video Player, Episode/Quality switching — সব জায়গায় UI jank কমানো।
৩. Video player-এ **smooth sequential fallback** — quality → quality → server → server, তারপরই "Link expired"।

---

## Part 1 — Navigation & Route-level optimization

- Home/Series/Movies/Live TV tab switch এ full re-mount বন্ধ করা।
  - Tab state কে top-level এ preserve করা, mounted tabs `display:none` দিয়ে hide (unmount না)।
  - প্রথমবার visit করলে lazy-mount, তারপর alive রাখা।
- Heavy list (NewEpisodeReleases, WebSeries grid, Movies grid) কে `React.memo` + stable keys + `useMemo` দিয়ে wrap।
- Route change এ scroll restore + transition duration 220ms → 160ms (tween, no spring)।
- Bottom nav button-এ tap → immediate route swap, data fetch background-এ।

## Part 2 — List / Card optimization

- AnimeCard, NewEpisodeReleases card, Movies card, Live TV card:
  - `React.memo` with shallow prop check।
  - Image: `loading="lazy"` + `decoding="async"` + fixed width/height (CLS 0)।
  - Backdrop blur/heavy shadow শুধু visible card-এ, off-screen এ simplified।
  - Framer-motion `layout` animation যেখানে দরকার নেই — remove।
- Long lists এ `content-visibility: auto` + `contain-intrinsic-size` — off-screen paint skip।
- Search bar: debounce 250ms, results virtualized-lite (slice top 40)।

## Part 3 — Profile & Static pages

- Profile page: heavy gradients কে static CSS token-এ move, per-render inline style কমানো।
- About/Privacy/Premium page-এ animation reduce।

## Part 4 — Video Player smooth fallback (মূল fix)

বর্তমান আচরণ: link fail → দ্রুত সব quality একসাথে switch, কোনটাই properly test হয় না, user-এর কাছে "Link expired" ভুলভাবে দেখায়।

### নতুন sequential probe logic (SaltPlayer)

```text
Play requested
   │
   ▼
[Current quality] ──play attempt (probe 4s)──▶ works? ── YES → play
   │ NO
   ▼
[Next quality]  ──probe 4s──▶ works? ── YES → switch + play
   │ NO
   ▼ (সব quality শেষ)
[Next server]   ──take server's default quality → probe 4s──▶ works?
   │ NO
   ▼ (সব server × সব quality শেষ)
Show "Link Expired — try later"
```

মূল নিয়ম:
- একসাথে অনেকগুলো probe **না** — একটার পর একটা, 4s timeout করে।
- প্রতি probe এ actual playable check: `loadeddata` + `canplay` + first frame render OR HLS manifest 200 + first segment 200।
- Manual quality/server switch → immediate, fallback skip।
- User pause/back করলে probe chain cancel।
- একই session-এ একবার fail হওয়া (quality, server) pair কে temp-blacklist (5 min) — বারবার probe না।

### Quality/Server switching latency fix
- Preload next quality manifest cache in background (idle time)।
- HLS.js instance destroy না করে `loadSource` reuse যেখানে সম্ভব।
- Switch এ black flash কমাতে previous frame hold (poster=currentFrame snapshot)।

## Part 5 — Global perf hardening

- `will-change` overuse audit — শুধু active animation-এ রাখা।
- Framer-motion heavy variants → CSS transition যেখানে সম্ভব।
- Global CSS: reduce backdrop-filter stacking (mobile GPU cost)।
- Fonts: `font-display: swap` + subset preload only used weights।

---

## Technical Details (dev-only)

**Files to touch:**
- `src/pages/Index.tsx` — tab preservation, memoization।
- `src/components/BottomNav.tsx` — instant route swap।
- `src/components/AnimeCard.tsx`, `NewEpisodeReleases.tsx`, `HeroSlider.tsx` — memo + content-visibility।
- `src/components/SearchPage.tsx` — debounce + slicing।
- `src/components/SaltPlayer.tsx` — new `sequentialProbe()` helper + blacklist map।
- `src/index.css` — animation/blur cost reduction।
- `src/components/ProfilePage.tsx`, `AboutPage.tsx` — static-ize gradients।

**No backend / data model change.** পুরাটাই frontend presentation + player logic।

---

## যা করব না
- Business logic, coin/premium, admin panel — untouched।
- Firebase/Supabase schema — untouched।
- Existing design/theme colors — untouched, শুধু performance layer।

Approve করলে পুরাটা এক পাসে ship করে দেব।