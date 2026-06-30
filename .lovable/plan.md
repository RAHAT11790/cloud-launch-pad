## যা সমস্যা সেইটা ধরছি

1. **User panel এ সব 500 item auto আসে** — `useSelectedAnimeSalt` Firebase না, API থেকে full browse list টানে। তাই Admin save না করলেও সব দেখায়।
2. **Card click এ কিচ্ছু খুলে না / crash** — `handleCardClick`-এর AN branch এখনো Firebase-stored URL খোঁজে; না পেলে "Admin থেকে fetch করো" বলে toast দিয়ে রিটার্ন। আর `saltPlayerState` কোথাও render-ই হচ্ছে না (পূর্ববর্তী cleanup-এ JSX চলে গেছে)।
3. **TMDB metadata incomplete** — `AnManager.buildEnriched` rating/overview/backdrop/genres pull করে, কিন্তু save করার সময় `id`, `source`, `sourceName`, `anSlug`, `animeSaltSlug`, `description`, proper `type` (webseries/movie) save করে না — তাই user-panel mapping ভেঙে যায়।
4. **Admin "শুধু 25 দেখায়"** — Admin grid filter/render-এ অদৃশ্য cap নেই, কিন্তু `browseAll` যদি একটাই page fetch করে fall short করে তাহলে অল্প আসে। `maxPage` detection আছে কিন্তু পেজ ১-এর HTML যদি ফেরত না দেয় তাহলে ১ page-এই থেমে যায়। Reload button-এ `force=true` সঠিক ভাবে যেতে হবে।

## যা করব

### A. User panel: admin-curated AN only
`src/hooks/useSelectedAnimeSalt.ts` রিরাইট:
- API call বাদ। `onValue(ref(db, "animesaltSelected"))` সাবস্ক্রাইব করব।
- প্রতিটি saved row → `AnimeItem` map: `id` (`an_<slug>` বা `an_mv_<slug>`), `anSlug`, `animeSaltSlug`, `slug`, `source: "animesalt"`, `sourceName: "AnimeSalt"`, `type` (`webseries`/`movie`), `description = overview`, `rating`, `backdrop`, `poster`, `year`, `category`, `genres`.
- localStorage write-through cache রাখব (instant repeat load)।

### B. Admin: full TMDB record save
`src/components/admin/AnManager.tsx` → `buildEnriched`/`saveOne`:
- saved row-এ যোগ করব: `id`, `source: "animesalt"`, `sourceName: "AnimeSalt"`, `anSlug = slug`, `animeSaltSlug = slug`, `slug`, proper `type` (`series` → `webseries`, `movies` → `movie`), `description = overview`, `category` (default "Anime"), `genres`, `backdrop`, `rating`, `year`, `tmdbId`, `createdAt`, `updatedAt`.
- Reload button-এ `browseAll(true)` সঠিক ভাবে force-refresh চালাবে আর `MAX_CARDS` clamp এ যেন full list render হয় তা নিশ্চিত করব।

### C. Card click → live API → in-app player
`src/pages/Index.tsx`:
1. `handleCardClick` AN branch থেকে `hasStoredFirebasePlayback` gate সরাব। তার বদলে:
   - **Series**: `animeSaltApi.getSeries(slug)` → seasons/episodes; first episode-এর slug ধরে `animeSaltApi.getEpisode(epSlug)` → `embedUrl`, `streams`, `audio`.
   - **Movie**: `animeSaltApi.getMovie(slug)` → একই shape।
2. `setSaltPlayerState({ embedUrl, anime, anNativeData: { streams, audio, preferredQualityIdx, defaultAudioIdx }, loading: false, ... })` করব।
3. JSX-এ saltPlayerState render path পুনঃস্থাপন করব: `saltPlayerState && <AnNativeView embedUrl={...} initialData={...} onFail={fallback to iframe} />` overlay দিয়ে। Player back/close handler `setSaltPlayerState(null)` করবে।
4. Loading toast/state দেখাব যাতে fetch latency feel না হয়।

### D. Verify
- Playwright দিয়ে localhost user-panel-এ Series page open করব → শুধুমাত্র admin-saved item দেখা যাবে।
- Admin panel-এ "Add" → user panel reload → card click → player open → video play হচ্ছে confirm করব। Screenshot evidence সহ report দেব।

## Technical notes
- `useSelectedAnimeSalt` এর export shape একই থাকবে (`{ items, loading }`) — Index.tsx/SearchPageRoute.tsx-এ extra change লাগবে না।
- AN edge function `an-api` যেই HLS extraction দেয় সেটাই `AnNativeView` consume করে; নতুন backend কাজ নেই।
- Firebase write shape Admin → User end-to-end consistent থাকবে (`firebaseAnimeMapper`-এর সাথে compatible)।
- Legacy `buildAnimeSaltEpisodePlaybackFromFirebase` path-গুলি অপরিবর্তিত রাখব — শুধু AN cards এর জন্য নতুন route যোগ করব, তাই RS playback ভাঙবে না।

Approve করলে A→D ক্রমে implement করে testing screenshot দিয়ে confirm করব।
