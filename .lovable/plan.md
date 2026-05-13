## Goal

1. ব্রাউজার back button smooth করতে প্রত্যেক page/section/function এর জন্য আলাদা React Router route বানানো (user + admin উভয়ের জন্য)।
2. Monetag ads (popunder + direct link) শুধু video player route এর মাঝে যোগ করা।
3. Monetag verification service worker (`3nbf4.com` zone `10888250`) site root এ serve করা।

---

## Part 1 — Router Restructure

### User-facing routes (Index.tsx এর state গুলোকে real route বানানো)

```text
/                       → Home tab
/series                 → Series tab
/movies                 → Movies tab
/livetv                 → Live TV tab
/profile                → Profile tab
/search                 → Search overlay
/anime/:id              → Anime details page
/anime/:id/season/:s    → Season selected (deep link)
/watch/:id              → Video player (movie)
/watch/:id/:season/:ep  → Video player (episode)
/livetv/:channelId      → Live TV player
/login                  → Login page
/about                  → About
/privacy                → Privacy
/unlock, /unlock-required → already exist
```

`Index.tsx` এর internal state (`activePage`, `selectedAnime`, `playerOpen`, `searchOpen`, `profileOpen` ইত্যাদি) কে `useNavigate` + `useParams` + `useLocation` দিয়ে replace করা হবে — যাতে browser back button প্রতি step এ একটা করে UI layer pop করে।

### Admin routes (Admin.tsx এর tab/section গুলোকে nested route বানানো)

```text
/admin                          → dashboard
/admin/series                   → series manager
/admin/series/:id               → edit series
/admin/series/:id/seasons       → seasons
/admin/series/:id/episodes      → episodes
/admin/movies, /admin/movies/:id
/admin/livetv, /admin/livetv/:id
/admin/users, /admin/users/:uid
/admin/notifications
/admin/new-release
/admin/telegram
/admin/telegram/posts
/admin/telegram/buttons
/admin/branding
/admin/edge-router
/admin/ad-services
/admin/apk
/admin/email
/admin/analytics
/admin/devices
/admin/subscriptions
/admin/import
/admin/export
/admin/link-validator
/admin/url-tools
/admin/firebase-cleanup
/admin/egd
```

প্রত্যেক admin section আলাদা lazy-loaded route component হবে। Tabs UI পাল্টে `<NavLink>` based sidebar/tab bar হবে যেগুলো URL update করে।

### Implementation approach

- নতুন folder `src/routes/` এ split route components তৈরি করা হবে যা existing components wrap করবে।
- `App.tsx` এ central `<Routes>` config এ সব route register করা হবে (lazy load সবগুলো)।
- Existing inline-state navigation calls (যেমন `setActivePage("series")`, `setSelectedAnime(x)`) replace করে `navigate("/...")` দিয়ে।
- Page transitions আগের মতো swipe/translate3d behavior রাখা হবে (memory rule), শুধু source-of-truth URL এ যাবে।
- sessionStorage based refresh persistence (existing memory) URL based হয়ে যাবে — automatic improvement।

---

## Part 2 — Monetag Ads (video player route only)

### Files

- `src/lib/monetagAds.ts` — singleton helper:
  - `loadPopunder()` — page load এ একবার শুধু (sessionStorage flag `mt_pop_loaded`)। Script: `https://3nbf4.com/...` Monetag tag।
  - `triggerDirectLink()` — player surface এ click করলে নতুন tab এ direct link URL open করে, তারপর cooldown (e.g. 60s) এ block।
- `src/components/MonetagAdManager.tsx` — শুধু `/watch/*` route এ mount হবে। Mount হলে popunder একবার call, unmount এ cleanup।
- `VideoPlayer.tsx` এ player surface এ overlay click handler যোগ — play/pause toggle এর পাশাপাশি `triggerDirectLink()` call (rate-limited, প্রথম click পর video resume normally)।

### Guards (popunder একবার হওয়া নিশ্চিত)

- `sessionStorage` + in-memory flag check।
- `window.__mtPopShown` global once-flag।
- Script tag duplicate check (`document.querySelector('script[data-mt-pop]')`)।
- Direct link এর জন্য last-trigger timestamp, minimum 45–60s gap; back করে ফিরলে video resume হবে।

User Monetag dashboard থেকে actual popunder + direct-link tag দিলে ওই URL `monetagAds.ts` এ বসানো হবে। আপাতত placeholder constants `MONETAG_POPUNDER_SRC` এবং `MONETAG_DIRECT_LINK_URL` রাখা হবে যা admin → branding/edge-router section থেকেও override করা যাবে।

---

## Part 3 — Monetag Verification Service Worker

User এর দেওয়া snippet:

```js
self.options = { "domain": "3nbf4.com", "zoneId": 10888250 }
self.lary = ""
importScripts('https://3nbf4.com/act/files/service-worker.min.js?r=sw')
```

Monetag verification এর জন্য site root এ একটা service worker file দরকার যেটা ওরা fetch করতে পারে। দুটো জায়গায় serve করা হবে:

- `public/sw.js` — root path থেকে accessible (`https://rsanime03.lovable.app/sw.js`)।
- Verification meta-tag (যদি Monetag চায়) `index.html` `<head>` এ optional — শুধু Monetag docs এ specified কিছু থাকলে।

**Conflict guard**: existing PWA / kill-switch SW নেই project এ, তাই `sw.js` add safe। কিন্তু auto-register করা হবে না (Lovable preview iframe rule) — শুধু Monetag fetch করার জন্য static file হিসেবে থাকবে। Verification এর পর Monetag নিজেই handle করবে।

`index.html` এ minimal register snippet (production only, iframe guard সহ) যোগ করা হবে যাতে Monetag verification pass করে:

```html
<script>
  if (location.hostname.endsWith("lovable.app") &&
      !location.hostname.includes("id-preview") &&
      window.self === window.top &&
      "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(()=>{});
  }
</script>
```

---

## Files to add / change

**New**
- `src/routes/` (12+ user route components, 20+ admin route components)
- `src/lib/monetagAds.ts`
- `src/components/MonetagAdManager.tsx`
- `public/sw.js`

**Edit**
- `src/App.tsx` — central route config
- `src/pages/Index.tsx` — strip internal navigation state, use URL
- `src/pages/Admin.tsx` — nested routes, sidebar uses NavLink
- `src/components/VideoPlayer.tsx` — direct-link click handler
- `index.html` — guarded SW register
- `src/components/BottomNav.tsx` — NavLink based

---

## Risk / Notes

- Index.tsx 2311 lines — refactor বড়, কিন্তু behavior একই থাকবে (visual + swipe + cache সব preserve)।
- Admin.tsx এ অনেক section আছে; প্রথম pass এ সব major section route করা হবে, sub-modal গুলো দরকারমতো nested route এ পরিনত হবে।
- Popunder একবার load — sessionStorage + global flag + DOM duplicate check, তিন স্তরে block।
- SW register শুধু production domain এ — preview/iframe এ skip (Lovable rule)।

কাজ শুরু করতে approve করো।