- A. Details Page — MovieBox-style redesign (UI only)

`src/components/AnimeDetails.tsx` — full visual rewrite. Player, controls, video logic, AnimeSalt fetcher — সব untouched থাকবে।

Layout (top → bottom):

1. **Backdrop hero** — 16:9 image, fully edge-to-edge, top-left close (X), top-right "Info ›" link (opens existing details modal/section)
2. **Title block** — Big bold title, then a single info row: `📺 ⭐ 9.0 | 2026 | Hindi | Webseries | 1 season`
3. **Action chips row** — Add to list, Share, Download, Library (rounded-full muted bg, icon + label, horizontal scroll on mobile)
4. **Resources section** — heading + two dropdowns (Language, Season), then horizontal episode pill scroller with "All / 1 / 2 / 3…" — selected pill in amber pill
5. **Tabs** — For you (active = amber pill) | Comments (count badge)
6. **Related grid** — 3-column poster grid below, scrolls with the page (no fixed-height inner scroll). This is the "scrolling like MovieBox" behavior.

Theme: **dark theme retained** (consistent with rest of app), but using MovieBox's spacing/typography/structure exactly. Action chips and tabs use the screenshot's pill style adapted to dark surface tokens.

Player/controls/AnimeSalt code: **zero changes**.

## B. Admin — per-language episode links

Currently `Episode.audioTracks: AudioTrack[]` already supports per-language links. Admin UI will be reworked to feel like the user described:

- In edit-anime page, replace the inline audio-track inputs with a **Languages** section showing language chips (Hindi, English, Japanese, …) + "+ Add Language" button.
- Clicking a language chip opens a **dedicated sub-page (drawer/modal)** showing that language's full episode list with input rows for each episode (link + 480/720/1080/4K).
- "+ Add Language" prompts for language name, then opens its own empty sub-page.
- Data persists into the existing `episode.audioTracks[]` structure (no schema change, no migration). The "main" `episode.link` becomes the default/Hindi fallback.
- Player picks language from the user's selected dropdown (already wired via existing audio-track system).

## C. Loader — restore previous stable version

- `src/components/SplashLoader.tsx`: revert to the **simple SVG ring + logo + brand text** version (the most recent pre-action-bg stable). Remove background-image rendering.
- `src/hooks/useBranding.ts` + `src/pages/Admin.tsx`: **remove `splashBgUrl` field and its upload button** from the Branding admin section. Keep logo upload only.

## D. Remove login wall — guest mode by default

- `src/pages/Index.tsx`: remove `if (!user) return <LoginPage />` gate. App renders straight from splash → homepage regardless of auth state.
- Header top-right corner: if `user` exists → existing profile avatar (unchanged); if no user → **"Login" pill button** that opens the existing LoginPage as a route/modal.
- ProfilePage: when no user, show a polished **"Sign in to sync your data"** card with email + Google login (reusing existing LoginPage logic, just embedded inside ProfilePage instead of full-screen).

## E. Guest data → localStorage only (no Firebase writes)

New file `src/lib/guestStore.ts` — thin wrapper around localStorage with keys:

- `guest:continueWatching` (array of {animeId, episode, position, updatedAt})
- `guest:watchlist`
- `guest:recentlyViewed`
- `guest:preferences` (theme, language, audio)

Wire-up rule across the codebase (Index.tsx, VideoPlayer.tsx, ProfilePage.tsx, AnimeDetails.tsx):

```
if (user)  → Firebase RTDB (existing path)
else       → guestStore.* (localStorage)
```

All existing Firebase writes guarded by `if (!user) return;` already — those stay. Replace them with `else guestStore.set(...)` so guest progress still works.

On login success: optional **one-time migration** — read guestStore, merge into user's Firebase node, clear localStorage.

**Result**: zero guest entries in Firebase `users/`. The Index.tsx user-sync block (writes Name/Email to `users/${uid}`) only runs when `user` is real.

## F. Cleanup

- Remove `src/components/admin/BackdropAiReplacer.tsx` background-bg upload section? **No** — that's separate (per-anime backdrop AI). Only the splash background admin field gets removed. আরে ভাই এখানে ব্যাগ ড্রপ ai না লোডারী স্কিনের যে ব্যাকগ্রাউন্ড ইমেজ দেওয়া যেত ওই ব্যাকগ্রাউন্ড ইমেজের ফাংশনটা বলেছে রিমুভ দিয়ে দিতে এডমিন প্যানেল থেকে ইউজার প্যানেল থেকে কারণ লোডার তুমি নিজে বানাইবা আগের ডিজাইনের লোডারের জন্য কোন ব্যাকগ্রাউন্ড ইমেজ দেওয়ার দরকার নাই ব্যাগ যেরকম আছে এরকমই থাকবে এটা যে সব কিছু হবে না 
- Update mem://auth/guest-access-restriction memory to reflect new "guest allowed, localStorage-only" rule.

---

### Files touched

- `src/components/AnimeDetails.tsx` — full UI rewrite (player code intact)
- `src/components/SplashLoader.tsx` — revert to simple ring
- `src/hooks/useBranding.ts` — drop `splashBgUrl`
- `src/pages/Admin.tsx` — remove splash bg upload; add Languages sub-page UI for episodes
- `src/pages/Index.tsx` — remove login gate; guest-mode data branching
- `src/components/Header.tsx` — Login button when no user
- `src/components/ProfilePage.tsx` — embedded login card when no user
- `src/components/VideoPlayer.tsx` — guard Firebase writes with guestStore fallback (continue-watching only)
- `src/lib/guestStore.ts` — **new**
- `mem://auth/guest-access-restriction` — update rule

### Not touched

- VideoPlayer rendering, controls, ABR/quality logic, AnimeSalt fetcher, Cloudflare worker, edge functions, ad-link system, Telegram bot.

### Out of scope (will ask later if you want)

- Migrating existing guest accounts already in Firebase (one-click cleanup tool already exists in admin).
- Schema migration for `episode.audioTracks` — keeping current structure.