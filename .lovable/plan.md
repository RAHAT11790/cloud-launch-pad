## সমস্যা ও সমাধান প্ল্যান

আপনার সব requirement বুঝলাম। নিচে A→Z কাজের list, প্রায়োরিটি অনুযায়ী।

### 1. Ultra-Fast API Layer (`src/lib/animeSaltApi.ts` + `supabase/functions/an-api`)
- **Concurrency বাড়াব**: pagination concurrency 6→12, episode/season parallel fetch।
- **Retry + Timeout + Abort**: প্রতিটা request-এ exponential backoff (3 try, 400ms→1.6s), 8s timeout, AbortController।
- **In-flight dedup**: একই slug-এর parallel call একটাই network hit।
- **Memory cache layer**: 5 min in-memory (Map), instant repeat hit।
- **Multi-endpoint fallback**: edge function fail হলে direct origin + mirror domain try (already partial — পূর্ণ করব)।
- **Edge function**: parallel page scrape, HTML stream parse (regex pre-compiled), gzip response।

### 2. Pre-Player Loading Flow (`src/pages/Index.tsx` + নতুন `LoadingDetailsOverlay.tsx`)
- বর্তমান: card click → player open → "Video source is still loading"। **এটা সম্পূর্ণ সরাব।**
- নতুন flow:
  ```
  Card click → Full-screen "Loading Details" overlay
    ├─ Fetching episodes…
    ├─ Loading audio tracks…
    ├─ Preparing stream…
    └─ Almost ready…
  → সব ready হলে → Player open → instant play
  ```
- নতুন component `LoadingDetailsOverlay.tsx`: progressive step text, animated progress bar, anime poster background blur।
- `handleCardClick` AN branch refactor: series হলে seasons + first episode streams + audio সব pre-resolve, তারপর `openPlayerFromAnime`।
- `VideoPlayer.tsx` থেকে "Video source is still loading. Please tap again" toast/banner সম্পূর্ণ delete।

### 3. Local Cache (LocalStorage + IndexedDB)
- নতুন `src/lib/anPlaybackCache.ts`:
  - Key: `an_pb_<slug>`, TTL: 4 ঘন্টা।
  - Series: full seasons + episode streams + audio।
  - Movie: streams + audio।
  - Episode-level cache: `an_ep_<slug>` TTL 4h।
- Cache hit → 0ms playback open। Miss/expired → live fetch + background refresh।
- IndexedDB fallback বড় payload-এর জন্য (idb-keyval pattern, lightweight)।
- Firebase-এ video URL save **করব না** (আপনি বলেছেন)।

### 4. Episode Timer Reset Bug (`VideoPlayer.tsx`)
- Episode switch হলে `video.currentTime = 0` force, saved progress restore শুধু same episode resume-এ।
- `lastPlayedKey` tracking যোগ করব episode change detect করতে।

### 5. TMDB Full Enrichment (`src/components/admin/AnManager.tsx`)
- নতুন fields fetch + Firebase save: `rating`, `releaseYear`, `overview`, `genres`, `studios`, `runtime`, `seasonCount`, `episodeCount`, `originalTitle`, `nativeTitle`, `cast` (top 10 with character + photo), `directors`, `writers`, `producers`, `popularity`, `voteCount`, `logos`, `keywords`, `backdrop`।
- নতুন button **"Load All Details"**: queue-based bulk updater, concurrency 4, progress bar (X/Y done), failed retry, resumable।
- Per-row "Refresh" icon-button for single anime।

### 6. Card UI Fix (`src/components/AnimeCard.tsx` + `Index.tsx` map)
- **AN badge** সব AN card-এ visible (currently missing) — `source==="animesalt"` check করে absolute corner badge।
- **Rating** star + value সব card-এ; missing হলে "—" placeholder নয়, TMDB fallback।
- **Year** badge সব card-এ।
- Movie cards same treatment with "MOVIE" badge।
- mapper `mapSaved`-এ TMDB fields properly pass through।

### 7. Multi-API Fallback Router
- `animeSaltApi` এ ordered endpoint list: edge `an-api` → direct origin → mirror। প্রতিটাতে retry, fail হলে next।

### 8. Error UX
- সব path-এ try/catch + toast (Bengali friendly message)।
- Player crash impossible — loading overlay-এ fail হলে retry button।

### Technical details (developer notes)
- Files to edit: `src/lib/animeSaltApi.ts`, `src/pages/Index.tsx`, `src/components/VideoPlayer.tsx`, `src/components/AnimeCard.tsx`, `src/components/admin/AnManager.tsx`, `src/hooks/useSelectedAnimeSalt.ts`, `supabase/functions/an-api/index.ts`।
- Files to create: `src/lib/anPlaybackCache.ts`, `src/components/LoadingDetailsOverlay.tsx`।
- Existing `src/lib/anLivePlayback.ts` extend করব cache integration-এর জন্য।
- Card badge change pure presentational — backend untouched।
- Timer fix scoped to AN branch, RS playback অপরিবর্তিত।

### Verification
- Build clean।
- Playwright দিয়ে: card click → loading overlay visible → player opens instantly → no "still loading" toast → episode switch → timer 00:00।
- Admin "Load All Details" run করে 10+ anime enrichment confirm, card-এ rating/year/AN badge দেখাব।

### বাদ দিচ্ছি (intentional)
- Firebase-এ video URL cache (আপনি না বলেছেন)।
- Production-grade IndexedDB lib (lightweight wrapper যথেষ্ট)।

Approve করলে A→8 ক্রমে implement করে screenshot proof সহ report দেব।