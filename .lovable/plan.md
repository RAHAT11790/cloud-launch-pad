# Plan: AN-কে আগের API system এ ফিরিয়ে আনা + Admin Ultra Optimization

## লক্ষ্য
1. AN series-এর সব Firebase storage / cached link / synthetic HLS / prefetch — সবকিছু **সম্পূর্ণ delete**।
2. AN আগের মতন **pure API-driven** হবে — click করলেই API call → fresh link → play। কোন stored link নাই, কোন expired link এর ঝামেলা নাই।
3. Admin panel থেকে AN-related সব tab/loader/data-fetcher বাদ। RS-এর মতই super-fast করা।
4. Whole site latency কমানো — Firebase load কমানো।

---

## কী কী Remove হবে

### Firebase Paths (data delete হবে না, কোডে আর touch করবে না)
- `animesalt/` / `an/` / synthetic HLS cache paths আর read/write হবে না।
- (আপনি চাইলে পরে manual delete করতে পারবেন admin থেকে আলাদা cleanup দিয়ে।)

### Files — সম্পূর্ণ Delete
- `src/components/admin/AnSeriesManager.tsx`
- `src/components/admin/AnFirebasePrefetcher.tsx`
- `src/hooks/useAnimeSaltData.ts` (Firebase-version)
- `src/hooks/useSelectedAnimeSalt.ts` (যদি Firebase-cache logic থাকে)
- `src/pages/AnExplorer.tsx` যদি Firebase data পড়ে — শুধু API-version রাখা হবে
- `src/components/AnNativeView.tsx` (Firebase-tied হলে)
- `mem/test-an-*.mjs`, `an_verify.cjs` — stale test files

### Files — Refactor (Firebase reference সম্পূর্ণ বাদ)
- `src/components/SaltPlayer.tsx` → শুধু `animeSaltApi` দিয়ে fresh fetch
- `src/lib/animeSaltApi.ts` → API call optimize (parallel, abort, no cache write)
- `src/pages/Index.tsx` → AN section API দিয়ে load (RS এর মতন hook pattern)
- `src/pages/Admin.tsx` → AN tab/section সম্পূর্ণ remove
- `supabase/functions/an-api/index.ts` → fast path verify, unnecessary HLS probe বাদ

---

## আগের API Flow ফিরিয়ে আনা

```text
User clicks AN card
   ↓
navigate to /watch/an/<id>  (instant)
   ↓
SaltPlayer mount → animeSaltApi.fetchEpisode(id, ep)
   ↓
an-api edge fn → AnimeSalt player endpoint → fresh m3u8 URL
   ↓
HLS.js plays directly (proxy দিয়ে CORS/Referer handle)
```

কোন Firebase read/write নাই AN flow তে।

---

## Admin Panel Optimization
- AN-related সব tab বাদ → bundle ছোট, latency কম।
- `Admin.tsx` lazy-load প্রতিটা section আলাদা ভাবে (RS, Users, Free-access only on demand)।
- Total counters শুধু shallow REST scan — already implemented, AN counter বাদ।
- AnFirebasePrefetcher-এর `onMount` heavy listener সম্পূর্ণ গায়েব → Firebase quota অনেক কমবে।

---

## Latency Targets
| জায়গা | আগে | পরে |
|---|---|---|
| AN card click → play start | 3–8s (Firebase + cache miss) | < 1s (single API call) |
| Admin panel boot | 4–10s | < 1.5s |
| Naruto-type big series fetch | Firebase disconnect | API stream, no disconnect |

---

## Technical Steps (যেই order এ করবো)

1. **Delete files**: AnSeriesManager, AnFirebasePrefetcher, related hooks/tests।
2. **Refactor `Admin.tsx`**: AN tab + import গুলা বাদ।
3. **Refactor `Index.tsx`**: AN section কে `useAnimeSaltApi` hook দিয়ে replace (in-memory cache, no Firebase)।
4. **Rewrite `useAnimeSaltData.ts`** → API-only, sessionStorage cache (15 min TTL) — কোন Firebase touch নাই।
5. **`SaltPlayer.tsx` simplify**: synthetic HLS / Firebase link / stored quality — সব বাদ। শুধু API থেকে আসা fresh link play করবে।
6. **`an-api` edge function**: একবারে fast path — token fetch → m3u8 rewrite → return। অতিরিক্ত probe/size check বাদ।
7. **Build verify** + console/network check করে latency confirm।

---

## ঝুঁকি / নোট
- যেসব user এর AN partial progress save আছে localStorage এ, ওইটা ঠিক রাখবো (resume কাজ করবে)।
- AnimeSalt site যদি down থাকে তখন user friendly error — fallback message।
- Firebase এ পুরাতন `animesalt/` data থাকবে, কিন্তু code আর read করবে না। চাইলে পরে manual cleanup দিবো।

**Approve করলে এক-শট এ পুরা refactor করে delivery দিবো — পুরাপুরি real testing সহ।**