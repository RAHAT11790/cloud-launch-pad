## কাজের তালিকা (এই চ্যাটেই A-Z শেষ)

### 1. Unlock + Telegram bot সম্পূর্ণ ঠিক
- নতুন bot token (`RS_ACCESS_BOT_TOKEN` ইতিমধ্যে আপডেট) দিয়ে webhook reset করব Supabase edge function `link-share-bot` থেকে।
- `link-share-bot` edge function-এ `/start <token>` handler ঠিক করব যাতে user বট-এ ঢুকলেই verify message + unlock confirm button পায়।
- Verify ক্লিকের পর Firebase-এ `users/${uid}/freeAccess` activate হবে → mini-app close → website-এ ফিরে আসলে `UnlockRequired` page auto-detect করে player-এ resume করবে (ইতিমধ্যে `onValue` listener আছে)।
- দ্বিতীয় ক্লিকে অন্য বটে নিয়ে যাওয়ার bug ঠিক করব → unlock service config-এ এক single Telegram provider lock করব।

### 2. "Mini Router" পুরো hide
- Admin panel-এ "Mini Router" নামের কোন section/tab/label থাকবে না।
- `Admin.tsx`-এ এটার navigation entry মুছব এবং সংশ্লিষ্ট component শুধু internal hook হিসেবে কাজ করবে — UI-এ দেখা যাবে না।

### 3. AnimeSalt — নিজের VideoPlayer copy
- `SaltPlayer.tsx`-এর iframe বাদ দিয়ে নিজস্ব `VideoPlayer.tsx`-এর copy বানাব (`AnimeSaltPlayer.tsx`)।
- AnimeSalt scraper থেকে যে multiple server URLs আসে সেগুলো server-list হিসেবে player-এ বসবে — server switch button থাকবে আমার player UI থেকে।
- Quality (480/720/1080) selector + fullscreen 100% কাজ করবে (mobile native fullscreen API)।
- Solid black UI, RGB buffering ring, swipe gesture — main player-এর সাথে সম্পূর্ণ identical।

### 4. NEW episode badge (36h lifecycle)
- Episode add/update timestamp চেক করে — শেষ 36 ঘণ্টায় add হলে episode card-এ animated "NEW" tag।
- 36h পার হলে auto disappear (client-side check, কোন cron লাগবে না)।

### 5. Admin cleanup + flash hide
- Unlock access global toggle OFF থাকলে user-side-এ কোন flash/toast/banner দেখাবে না — full silent।
- ON হলে সব unlock buttons + Telegram post inline buttons আগের মতই কাজ করবে।
- Admin panel-এর unlock/edge-router section-এ duplicate/dead controls সরাব।

## Technical files to touch
- `supabase/functions/link-share-bot/index.ts` — `/start` verify message, deep-link callback, single-bot lock।
- `src/lib/unlockAccess.ts` — provider resolution single-source করব।
- `src/pages/UnlockRequired.tsx` — flash hide when global off।
- `src/pages/Admin.tsx` — Mini Router tab/label remove, unlock section cleanup।
- `src/components/SaltPlayer.tsx` → replace with new `AnimeSaltPlayer.tsx` (copy of `VideoPlayer.tsx` adapted for salt server list)।
- `src/components/AnimeDetails.tsx` / episode list components — NEW badge logic (36h check)।
- `src/hooks/useAnimeSaltData.ts` — multi-server list expose for player switch।

## Result
- Telegram unlock end-to-end কাজ করবে: button → bot → verify → ফিরে এসে auto play।
- AnimeSalt content নিজের player-এ চলবে, fullscreen + server switch সহ।
- নতুন episode 36 ঘণ্টা NEW দেখাবে।
- Mini Router UI-তে আর দেখা যাবে না।
- Unlock OFF হলে কোন flash আসবে না।
