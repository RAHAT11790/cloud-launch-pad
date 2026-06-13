এই message-এ ৪টা আলাদা সমস্যা আছে। সবগুলা একই pass-এ fix করব, কিন্তু প্রতিটার scope আলাদা রাখব যেন একটার change অন্যটাকে না ভাঙে।

---

## ১. AN video play হয় না (login user → "File not found")

**Root cause (screenshot থেকে):** AnimeSalt player Cloudflare scraper worker call করে। Guest user-এর জন্য কোনো `Authorization` header যায় না, তাই worker সরাসরি কাজ করে। কিন্তু Firebase login user-এর জন্য `SaltPlayer` / `animeSaltApi.ts` Supabase session token attach করে দিচ্ছে — যেটা ওই non-Supabase worker reject করে এবং empty/404 response পাঠায় → UI-তে "File not found" দেখায়।

**Fix:**

- `src/lib/animeSaltApi.ts` এবং AN-related fetch গুলোতে **কোনো auth header attach করব না** (third-party worker — anonymous fetch হওয়া উচিত)।
- `src/components/SaltPlayer.tsx`-এ login user detect হলে guest-এর মতই একই code path follow করবে — login-specific gating সরাব।
- ব্যর্থ হলে retry (২x exponential backoff) + clear English error যাতে raw "File not found" না দেখায়।

## ২. Download manager — single fail + bulk only first + battery prompt

**Root cause:**

- **Single fail (502 Bad Gateway):** কিছু source-এ Render origin slow/dead — current `video-download` edge function ২x retry করে hard-fail করে, browser-এ JSON error দেখায়।
- **Bulk only first:** `select all` → download click → loop চললেও browser একটার পরের আরেকটা `<a download>.click()` block করে দেয় (popup blocker behavior)। প্রতিটার মাঝে delay নেই।
- **Battery permission:** `navigator.getBattery()` কোথাও call হচ্ছে যা Android Chrome-এ prompt তোলে।

**Fix:**

- `supabase/functions/video-download/index.ts`: retry ২→৪, delay 600→400ms, এবং upstream 5xx হলে **অন্য fallback proxy chain চেষ্টা করব** (multi-CDN style)। শেষে `Range: bytes=0-` দিয়ে retry।
- Bulk download: প্রতিটা `<a>.click()`-এর মাঝে 350ms gap + iframe-based trigger (browser popup-block bypass)। `src/lib/videoDownload.ts`-এ নতুন `triggerBulkDownloads(items[])` helper যোগ করব।
- Admin/User Downloads UI-তে select-all → download button সেই bulk helper call করবে।
- Codebase scan করে `getBattery` reference সরাব।

## ৩. Weekly Episode — "All Day" tab যোগ

`src/components/admin/WeeklyEpisodeManager.tsx` + `src/lib/weeklyEpManager.ts`-এ:

- প্রতিটা card-এ নতুন checkbox: **"Show every day (All Day)"** → Firebase-এ `allDay: true` flag।
- Weekly section UI-তে ৭ দিনের button-এর পাশে নতুন **"All Day"** button। ওই tab `allDay === true` সব card দেখাবে এবং অন্য দিনের tab-এও ওই card visible থাকবে (যেহেতু "প্রতিদিন আসে")।

## ৪. Telegram deep-link → instant player open (10-15s latency সরাও)

**Root cause:** invite link-এ `?anime=ID&ep=N` থাকে। বর্তমানে App-এ Index.tsx পুরো splash + Firebase initial sync শেষ হওয়ার পরই URL param read করে → AnimeDetails open → তারপর Watch open → তারপর video load (৩ ধাপ)।

**Fix (`src/pages/Index.tsx` + URL handler):**

- App boot-এর প্রথম tick-এই URL param পড়ব। `?anime=` থাকলে **splash skip** করে সরাসরি `<SaltPlayer />` mount করব (anime metadata পরে hydrate হবে)।
- `?ep=` / `?s=` থাকলে initial episode/season set হয়ে যাবে।
- Player-এর video source URL Firebase থেকে আসে — তাই metadata fetch আর player mount **parallel** করব (আগে sequential ছিল)।
- Target: link click → ১.৫-২s-এর মধ্যে player visible এবং buffering শুরু।

---

### Files to edit

- `src/lib/animeSaltApi.ts`, `src/components/SaltPlayer.tsx` (issue 1)
- `supabase/functions/video-download/index.ts`, `src/lib/videoDownload.ts`, `src/lib/downloadManager.ts` + Downloads UI (issue 2)
- `src/lib/weeklyEpManager.ts`, `src/components/admin/WeeklyEpisodeManager.tsx`, `src/components/NewEpisodeReleases.tsx` (issue 3)
- `src/pages/Index.tsx`, possibly `src/App.tsx` (issue 4)

### Verification

- Admin PIN 258800 দিয়ে preview-এ ঢুকব।
- Login করে user id দিয়ে id pass :- [rahatsarker224@gmail.com](mailto:rahatsarker224@gmail.com) RAHAT1@a AN anime-এ যাব → play হবে কিনা check।
- Anime select-all → bulk download trigger check।
- Weekly Manager-এ একটা anime "All Day" mark → home-এ All Day tab দেখা যাবে।
- Telegram-style deep link `?anime=xxx&ep=1` open করে player mount time মাপব।

Approve করলে শুরু করছি।