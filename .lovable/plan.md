# Overlay → Routes Migration + Video Player Fixes

## Scope (confirmed)

- **Keep**: Bottom-nav swipe strip (Home/Series/LiveTV/Movies). It's not an overlay — it's the core UX.
- **Convert to real routes**: AnimeDetails, VideoPlayer, Search, Notifications, all Admin tabs.
- **Fix**: Video player Quality button (not working) + landscape mode panel scrolling (CC, Subtitle, Settings).

## Why staged

This touches `Index.tsx` (the central orchestrator), `AnimeDetails`, `VideoPlayer`, `SearchPage`, `NotificationPanel`, `Admin.tsx`, AI chat link handler, suggestion clicks, sessionStorage persistence, back-button logic, and PWA deep-link handling. Doing it all in one shot = high break risk. I'll ship it in 3 stages, each independently testable.

---

## Stage 1 — Video Player fixes (small, ship first)

**Files**: `src/components/VideoPlayer.tsx`

1. **Quality button (Auto/quality tab) fix**
   - Debug why the quality panel button click handler isn't firing — likely event swallowed by the new `data-player-panel` touch guard or panel state collision with Settings panel.
   - Ensure quality panel opens, lists all available qualities (manual only, no ABR per memory), and switching applies cleanly without restarting playback.
   - Make sure the Settings → Speed panel and Quality panel use separate state (no collision).

2. **Landscape scroll fix for CC / Subtitle / Settings panels**
   - In landscape, panel `max-height` currently uses `vh` which collapses → no scroll room. Switch to `min(70vh, 80vw)` or container-relative sizing.
   - Verify `touch-action: pan-y`, `overscroll-contain`, and `WebkitOverflowScrolling: touch` are applied to the actual scrollable inner div (not the outer wrapper).
   - Confirm parent gesture handler still ignores `data-player-panel="true"`.

3. **Verify** by logging into `rahatsarker224@gmail.com` and playing Captain Tsubasa Ep 28; screenshot quality panel + landscape CC scroll.

---

## Stage 2 — User-facing overlays → routes

**New routes** in `App.tsx`:
- `/anime/:id` → `AnimeDetailsPage` (wraps existing `AnimeDetails` content)
- `/watch/:id` → `WatchPage` (wraps `VideoPlayer`, reads season/episode from query: `?s=1&e=5`)
- `/search` → `SearchPageRoute`
- `/notifications` → `NotificationsPage`

**Files touched**:
- `src/App.tsx` — register new routes (lazy-loaded)
- `src/pages/AnimeDetailsPage.tsx` *(new)* — fetches anime by id, renders existing `AnimeDetails` component, handles back via `navigate(-1)`
- `src/pages/WatchPage.tsx` *(new)* — same pattern for `VideoPlayer`
- `src/pages/SearchPageRoute.tsx` *(new)*
- `src/pages/NotificationsPage.tsx` *(new)*
- `src/pages/Index.tsx` — **remove** overlay state for these 4 (`selectedAnime`, `playingEpisode`, `showSearch`, `showNotifications`). Replace with `navigate('/anime/:id')` etc.
- `src/components/AnimeDetails.tsx` — replace `onPlay`/`onClose` overlay calls with `navigate()`; keep the component reusable
- `src/components/VideoPlayer.tsx` — `onClose` → `navigate(-1)`; suggestion clicks → `navigate('/anime/:id')`
- AI chat internal links — instead of `onAnimeSelect` state, use `navigate('/anime/:id')`
- `useSelectedAnimeSalt` / sessionStorage refresh-persistence — replaced by URL params (URL itself is the persistence)

**PWA / Telegram deep links** (per source-aware-redirect memory) — keep working by mapping legacy query params to new routes inside `Index.tsx` on mount.

---

## Stage 3 — Admin panel → routes

**Files**: `src/pages/Admin.tsx` + each tab component

- Current: single `Admin.tsx` with tab state showing different sections as overlays/panels.
- New: nested routes under `/admin`:
  - `/admin` (dashboard/landing)
  - `/admin/series`, `/admin/movies`, `/admin/livetv`, `/admin/users`, `/admin/notifications`, `/admin/apk`, `/admin/branding`, `/admin/analytics`, `/admin/config`, etc.
- Admin sidebar/tabs become `<Link>`s.
- Each section becomes a lazy-loaded route component.
- PIN gate (553300) stays at `/admin` root and guards `<Outlet />`.

---

## Technical notes

- All new pages lazy-loaded with `React.lazy` + `Suspense` (same pattern as current `Admin`).
- Back button on Android / browser will Just Work because real routes = real history entries.
- Memory updates after Stage 2 & 3: update `mem://features/navigation/refresh-persistence` (URL-based now) and add a new memory for the route map.
- No changes to: Firebase data shape, auth, subscription flow, ad-link unlock, swipe nav strip.

## What I will NOT touch this chat

Anything else you mentioned in past chats. Only the 2 things you asked: overlay → routes (per your scope choice) and VideoPlayer quality + landscape scroll.

---

## Order of work

1. Stage 1 (Video Player) — ~30 min, ship and verify.
2. Stage 2 (user overlays → routes) — biggest chunk.
3. Stage 3 (admin → routes) — last.

Approve this and I'll start with Stage 1 immediately.