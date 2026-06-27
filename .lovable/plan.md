## লক্ষ্য

দুটো আলাদা সমস্যা একসাথে সমাধান:

1. **AN playback এখনো slow** — Firebase-এ data থাকা সত্ত্বেও card click / episode switch-এ ~১০s delay হচ্ছে। মানে `Index.tsx`-এর AN resolver Firebase-first পথে যাচ্ছে না, বা cache lookup async API call-এর পরে চলছে।
2. **AN Series management নেই** — RS series-এর মতো editable interface দরকার, যাতে Fetch button দিয়ে AN API থেকে data টানা যায়, প্রতিটা episode/quality/audio আলাদা ঘরে দেখা যায়, edit/refresh করা যায়, count দেখা যায়।

---

## পরিবর্তন (২ ভাগে)

### Part A — AN playback instant করা (root-cause fix)

`src/pages/Index.tsx` এর `getAnimeSaltDirectState` (AN card click handler) audit করব:

- নিশ্চিত করব `anSeries/{slug}/episodes/{epSlug}` Firebase node থেকে synchronously read হচ্ছে first
- Firebase hit হলে কোনো API call, কোনো toast, কোনো `await fetch()` chain ছাড়াই direct play
- Episode switcher (VideoPlayer পাশে) এর data source-ও Firebase-direct করব
- শুধু Firebase miss হলে API fallback — সেক্ষেত্রে background-এ result Firebase-এ লিখে রাখবে

### Part B — Admin → Series → "AN Series" tab (RS-style)

**Location:** Admin → Series → Add New → Manual এর পাশে নতুন tab `"as-list" / "as-manual"`। Settings থেকে existing `AnFirebasePrefetcher` সরিয়ে নেব।

**নতুন component:** `src/components/admin/AnSeriesManager.tsx`

UI layout (RS series-এর design tokens মেনে):

```text
┌─ AN Series ──────────────────────────────────┐
│ Stats: Added 42 / Total 87 · Pending 45      │
│ [Bulk Fetch All]  [Repair Broken]            │
├──────────────────────────────────────────────┤
│ [Search...]                                  │
│ ┌──────────────┬──────────────┐              │
│ │ poster  ✓    │ poster        │  ← grid     │
│ │ Naruto       │ Bleach        │             │
│ │ 220 eps      │ not fetched   │             │
│ │ [Edit]       │ [Fetch]       │             │
│ └──────────────┴──────────────┘              │
└──────────────────────────────────────────────┘
```

**Edit modal** (per series):

- Header: title, poster, [Refresh from AN] button
- Episode list: শুধু AN API যতগুলো episode return করে ততগুলো ঘর (২৪ episode থাকলেও AN-এ ২০ থাকলে ২০টাই)
- প্রতিটা episode card-এ:
  - Episode number + slug
  - Quality rows: 360p / 480p / 720p / 1080p — প্রত্যেকটার আলাদা URL field
  - Audio rows: প্রতিটা audio track-এর আলাদা URL field
  - Per-episode [Refetch] button
- [Save All] → `anSeries/{slug}/episodes/*` Firebase-এ লেখে

**Data source:** existing `useSelectedAnimeSalt` (user panel-এ যা দেখায় ঠিক সেইগুলোই)। AN API call হবে `getEdgeFunctionUrl("an-api")` দিয়ে — existing prefetcher-এর fetch logic reuse করব।

**Counts:** stored series count Firebase `anSeries` থেকে live, total = saltItems.length, pending = diff।

### Part C — Settings cleanup

`Admin.tsx` settings section থেকে `<AnFirebasePrefetcher />` mount remove, নতুন section route `"animesalt-manager"` (বা new `"an-series"`) এর Series tab-এ wire করব।

---

## টেস্টিং

1. Build/typecheck pass
2. Playwright-এ preview-তে login → Admin → Series → AN Series tab খুলবে, একটা series fetch করব, edit modal-এ episodes ও quality ঘর দেখব, save করব
3. User panel-এ ওই AN series card click করে measure করব — Firebase hit হলে <1s switch হচ্ছে কিনা
4. Screenshot পাঠাব

---

## টেকনিক্যাল ডিটেইলস

- নতুন file: `src/components/admin/AnSeriesManager.tsx` (~400 lines, RS series card grid pattern থেকে token reuse)
- পরিবর্তিত file: `src/pages/Admin.tsx` (series tab type union-এ `"as-list" | "as-manual"` যোগ, settings থেকে prefetcher unmount, series section-এ mount), `src/pages/Index.tsx` (AN resolver-এ Firebase-first guard)
- Firebase schema unchanged — same `anSeries/{slug}/{meta,episodes/{epSlug}}` যা prefetcher আগেই লিখছে
- `AnFirebasePrefetcher.tsx` rename/refactor হবে না — internal-এ reuse হবে, কিন্তু UI shell নতুন

---

## কী touch করব না

- Video player, gestures, proxy, edge functions — অপরিবর্তিত
- AN API edge function — অপরিবর্তিত
- RS series flow — অপরিবর্তিত
- এইখানে আরেকটা গুরুত্বপূর্ণ জিনিস করতে হবে এটা হল বর্তমানে যতগুলা An কার্ডগুলো আছে যেগুলা এপিআই থেকে লোড হয়েছে এই সবকিছুকে স্টপ করে দিতে হবে রিমুভ করে দিতে হবে ইউজার প্যানেল থেকে বুঝেছ সবগুলাকে ইউজার প্যানেল মানে এ পি আই এন এম সিলেট থেকে মানে এনিমি ফাংশন থেকে যতগুলা কার্ড এখন আমার ইউজার প্যানেলে দেখাইতেছে ওই সবগুলোকে বন্ধ করে দিতে হবে কারণ এইগুলা যদি বন্ধ না করি তখন ওইখান থেকে যে পেচ করব ওই গুলার সাথে এগুলো ডাটা লাগিয়ে যাবে কারণ এইগুলা এখন আর এস এর মতন এড হবে তাই এগুলোর সাথে ওইগুলো এপিআই এর গুলার প্যাচ লেগে যাবে তাই এপিয়ারের সমস্ত এখন যতগুলা পোস্ট আছে এন এর যতগুলা পোস্ট আছে প্রত্যেকটা বাদ যাবে প্রত্যেকটা রিমুভ আমি ওইখান থেকে সার্চ করে যখন পেচ বাটনে ক্লিক করবো যতগুলা সিরিজ ছায়াছবি শুধু ওইগুলাই আবার ইউজার প্যানেলে যাবি পেয়ারের সবগুলা বাদ যাবে এটা গুরুত্বপূর্ণ জিনিস। 