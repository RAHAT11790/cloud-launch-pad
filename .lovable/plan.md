# Premium + Ads + RS Player/Download — 4 ধাপে সম্পূর্ণ overhaul

আপনার screenshot-গুলার Monetag ad code দেখেই সঠিক SDK placement করবো (One-Click Popunder, Direct Link/Social Bar, Banner)। নিচে ৪টা ধাপ:

---

## ধাপ ১ — Premium Center সম্পূর্ণ ঠিক করা

**Series Lock (Full)**
- Premium Center-এর search bar আসলে কাজ করবে (deferred filter + prefix/fuzzy match RS + AN dataset-এ)।
- প্রতিটা series card-এ একটা golden "Lock/Unlock" toggle button — click করলে সাথে সাথে `series.premium = true` Firebase-এ save হবে।
- Admin dashboard-এর series row-এ (Edit / Delete button-এর পাশে) নতুন **"Premium Lock"** button — এক click-এ series full lock/unlock।

**Episode Lock (Partial)**
- Premium Center-এ নতুন **"Episode Lock"** tab। Series select → সব season+episode accordion-এ show → tap করে individual episode toggle → `premiumEpisodes["s1e5"] = true`।
- User-side card grid-এ locked episode-এ ছোট gold crown icon overlay।
- Locked episode-এ click করলে সুন্দর professional message modal: "🔒 এই episode শুধু Premium members-এর জন্য" + "Get Premium" button।

**Card Premium Animation**
- Locked series card-এ ultra-professional gold shimmer border, corner "PRO" ribbon, subtle glow pulse — একদম দেখেই প্রিমিয়াম বোঝা যাবে (framer-motion + CSS gradient border animation)।

---

## ধাপ ২ — Ad SDK + Coin System + Free Premium Page

**Monetag SDK proper integration** (আপনার screenshot-গুলা reference করে)
- `src/lib/monetagAds.ts` নতুন module:
  - **One-Click Popunder** — `<script src="//groleegni.net/401/..."></script>` runtime inject with de-dup।
  - **Direct Link / Social Bar** — URL-based, new tab open।
  - **Banner Ad** — iframe/script slot rendering with proper container।
- Admin Premium Center-এর "Ad Sources" tab-এ ৩টা textarea (Popunder script, Direct Link URL, Banner script) — default-এ আপনার screenshot-এর সব code pre-filled থাকবে। Save + Test button।

**Coin Center in Profile**
- ProfilePage-এ নতুন section: current coin balance (Coins icon + count animation), today's remaining ad watches, "Get Free Premium" big button।
- Card animation: coin flip + counter tween।

**Free Premium Page (`/premium/free`)**
- Scrollable container (banner ads scroll কাজ করবে) with proper `overflow-y-auto`।
- Header: "Watch Ads → Earn Coins → Get Premium Free"।
- ৫টা ad slot card। প্রতিটা ad button-এ two-tap logic:
  - **1st tap** → Social bar/Direct link open + top toast: "⚠️ This ad is not counted. Come back and tap again." → **কোনো counter start হবে না**।
  - **2nd tap (same ad, after return)** → Direct link ad open + top toast: "✅ Ad counted! Watch for 15 seconds." → background 15s timer start → user back এলে +1 coin animation।
- Daily cap enforcement, per-ad de-dup।
- ২০ coin জমলে auto-notify "You can now redeem Premium!"।

**Card click → Premium Required Page redesign**
- Locked series card click করলে `/premium-required?series=xxx` route open — professional message, series poster blur backdrop, "If you want Premium free, tap here" bell button → `/premium/free`।

---

## ধাপ ৩ — RS Player Time Reset + Quality Persist + Download Manager Fix

**RS Player**
- **Time reset bug**: Episode switch করলে `video.currentTime = 0` reset হবে (episode change handler-এ resumeAt clear করা)। Continue-watching resume শুধু same episode reopen-এ কাজ করবে।
- **Quality persistence**: `localStorage["rs_preferred_quality"]` — user 4K/1080p/720p যা select করবে, next episode-ও ওই quality-তেই start হবে (available থাকলে)। না থাকলে nearest quality fallback।

**RS Download Manager**
- Size probe fix: HEAD → GET Range 0-0 fallback → filename-based estimate — zero size আর show করবে না।
- Browser download route: proper `<a download>` blob/direct link redirect যাতে browser default downloader-এ চলে যায়।
- Select-all bulk download queue ঠিকভাবে কাজ করবে।
- **Premium lock message**: download locked হলে সুন্দর card modal:
  > 🔒 **Premium Only Download**
  > "This RS video is available for download only to Premium members. Upgrade to unlock unlimited downloads across all quality tiers."
  > [ Get Premium → ] button — click করলে `/premium/buy` open হবে।
- Unlock mode-এ সব user download পাবে normally।

---

## ধাপ ৪ — Full Testing & Verification

- TypeScript check + vitest run।
- Playwright smoke: Admin Premium Center → search "Naruto" → lock toggle → verify Firebase write। User side card locked animation visible → click → premium-required page → Free Premium page → 2-tap ad flow → coin +1।
- RS episode switch time reset verify (screenshot proof)।
- Download unlock/lock message verify।
- UI polish pass — spacing, gradient border, message box padding, emoji alignment।

---

**Technical notes (for reference)**
- Files touched: `PremiumCenter.tsx`, `Admin.tsx` (series row lock button), `AnimeCard.tsx` (premium overlay), `ProfilePage.tsx` (coin center + Get Free Premium button), `FreePremium.tsx` (2-tap ad logic), `PremiumRequired.tsx` (message redesign), `VideoPlayer.tsx` (time reset + quality persist), `downloadManager.ts` + `DownloadProgressOverlay.tsx` (size probe + lock modal), new `src/lib/monetagAds.ts`.
- No breaking changes to Firebase schema — only adds `premiumEpisodes`, `qualityLocks`, `settings/monetag`।

Approve করলে ধাপ ১ থেকে একে একে শুরু করবো।
