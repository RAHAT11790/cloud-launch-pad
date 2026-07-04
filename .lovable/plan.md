## Premium System সম্পূর্ণ Remove Plan

Premium Center কাজ করতেছে না তাই পুরা Premium logic A-to-Z remove করবো। সব content auto-unlock হয়ে যাবে, কেউ আর premium দেখাবে না।

### 1. Pages & Routes Remove (App.tsx থেকে)
- `PremiumRequired.tsx` — delete
- `PremiumBuyPage.tsx` — delete
- `FreePremium.tsx` (coin ad-flow page) — delete
- `Unlock.tsx` / `UnlockRequired.tsx` — delete
- App.tsx থেকে সব premium/unlock/free-premium routes সরানো

### 2. Admin Panel থেকে Remove
- `src/components/admin/PremiumCenter.tsx` — delete
- Admin.tsx এর `premium-center` section, sidebar entry, lazy import — সরানো
- Episode Lock Tab (RS lock UI) — সরানো
- Premium Device Limits section — সরানো
- bKash payment auto-activate premium logic — সরানো (payment request থাকলে থাকবে, কিন্তু premium activate করবে না)
- Server URL locked/premium toggle button — সরানো

### 3. Profile Page থেকে Remove
- `usePremium` hook usage
- Premium tab / panel পুরাটা
- Premium expiry, coin wallet, device count UI
- "Pause/Restore premium" button
- Premium status listener (`users/{uid}/premium` subscribe)

### 4. Library Files Delete
- `src/lib/premiumAccess.ts`
- `src/lib/premiumDevice.ts`
- `src/lib/unlockAccess.ts`
- `src/lib/freeAccessDevice.ts`
- `src/hooks/usePremium.ts`

### 5. Content Playback (Auto-Unlock)
- `useSelectedAnimeSalt.ts` — `premium` / `premiumEpisodes` fields ignore
- `Index.tsx` — premium/unlock gate check বাদ, সরাসরি play
- `VideoPlayer.tsx` — premium download restriction বাদ, সবাই download করতে পারবে
- `AnimeCard.tsx` / poster cards — Premium badge/lock icon সরানো

### 6. Mapper & Data Layer
- `firebaseAnimeMapper.ts` / `adminContentIndex.ts` — premium metadata preserve logic সরানো (harmless কিন্তু cleanup)
- `animeData.ts` — premium flags সরানো

### 7. Ads & Support
- `AdsterraAdManager.tsx` / `adsterraAds.ts` — coin-collection related ad flow সরানো (Adsterra config admin এ থাকলে থাকতে পারে, শুধু premium tie-in বাদ)
- LiveSupportChat, About, Privacy pages এ premium mention সরানো

### 8. Verify
- Build check করে ensure হবে কোন import error নাই
- `/`, `/admin`, `/profile` routes load হয় কিনা test

### Result
সব anime/movie/episode সবার জন্য free, download button সবার জন্য visible, কোনো coin/ad-gate নাই, Admin panel থেকে Premium tab পুরাটা গায়েব।
