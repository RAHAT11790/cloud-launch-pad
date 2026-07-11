
# Movies-এ Parts System (Web Series-এর copy version)

আপনি চান Movies section-টা যেন Web Series-এর মতো একই feel পায় — কিন্তু "Season/Episode"-এর জায়গায় "Movie/Part"। নিচে সম্পূর্ণ কাজের plan দিলাম। Approve করলে A-to-Z implement করব।

---

## 1) Data model (Firebase-এ movie row)

Movie item-এ একটা নতুন field:
```
parts?: Array<{
  partNumber: number;
  title?: string;         // optional, default "Part N"
  link: string;           // default streaming link (required)
  link480?, link720?, link1080?, link4k?: string;
}>
```
- `parts` না থাকলে বা empty হলে — পুরানো single-link movie (backwards compatible)।
- `parts` থাকলে player ওটা দেখাবে; top-level `movieLink` fallback হিসেবে থাকবে।

`src/data/animeData.ts` এবং `firebaseAnimeMapper.ts` (movie mapper)-এ `parts` add হবে।

---

## 2) Admin → Movies form redesign

`src/pages/Admin.tsx` movie form (mv-add / mv-manual)-এ Web Series-এর episode UI-এর একটা **simplified copy**:

- Section header: **"Movie Parts"** (Season list-এর জায়গায় শুধু একটাই "Movie" container)
- বাটন: **"➕ Add New Part"** (Add New Episode-এর মতো)
- প্রতি Part card-এ ইনপুট:
  - Part title (optional)
  - Default link (required)
  - 480p / 720p / 1080p / 4K (optional)
  - Delete part, reorder up/down
- Parts না দিলে — উপরের পুরানো "Movie Link (Default) + Quality Links" section-ই কাজ করবে (একদম untouched)।
- **JSON paste + JSON file upload** — Web Series-এর মতো একটা textarea + file upload বাটন, কিন্তু শুধু parts array parse করবে। Format:
  ```json
  { "parts": [
      { "partNumber": 1, "link": "...", "link1080": "..." },
      { "partNumber": 2, "link": "..." }
  ]}
  ```
  বা flat array-ও accept করবে। **smartMergeEpisodesInto-এর মতো smart merge** — শুধু non-empty quality field overwrite করবে, বাকিগুলো preserve করবে (আপনার আগের feedback অনুযায়ী)।
- Save Movie → parts কে clean করে persist করবে (empty parts drop)।

---

## 3) Save + Notify (Movies) — auto-tracking with parts

বর্তমান crash-এর কারণ: server auto-tracker season/episode expect করে, movie payload-এ ওগুলা নেই।

নতুন behavior:
- **Parts আছে** (এবং edit-এ নতুন part add হয়েছে): last-added part range track করে release-এ পাঠাবে:
  - `episodeInfo: { type: "movie-parts", partsAdded: "Part 2-3" }`
  - Push body: `"Movie Name • Part 2-3 Added"`
- **Parts নেই** (single movie): `episodeInfo: { type: "movie", label: "Full Movie Added" }`
  - Push body: `"Movie Name • Full Movie Released"`
- এরপর existing flow: **New Release entry → FCM push → Telegram Post redirect** (Web Series-এর copy)।
- Old-vs-new part diff detect করার জন্য save-এর আগে বর্তমান Firebase snapshot থেকে previous `parts` fetch করে compare করব।

---

## 4) Video player UI (AnimeDetails / SaltPlayer)

`src/components/AnimeDetails.tsx`-এ movie type-এর জন্য:
- `parts` empty/missing হলে — এখনকার মতো একটাই play button।
- `parts` থাকলে — Web Series episode list-এর মতো নিচে horizontal list:
  - Label: **"Parts"** (Episodes-এর জায়গায়)
  - Cards: **"Part 1", "Part 2"…** selectable, tap করলে সেই part-এর quality-aware link play হবে।
- Quality selector আগের মতোই কাজ করবে — active part-এর quality URLs use করবে।

---

## 5) Files touched

- `src/data/animeData.ts` — MoviePart type + `parts` on AnimeItem
- `src/lib/firebaseAnimeMapper.ts` — map parts in `mapFirebaseMovieItem`
- `src/pages/Admin.tsx` — movie form UI + save logic + Save+Notify diff/push/telegram + JSON paste/upload/smart-merge
- `src/components/AnimeDetails.tsx` — movie parts list UI + selection
- (Player component if needed for quality-per-part switching)

---

## 6) Testing (আপনি করবেন)

Implement শেষে আমি dev server-এ typecheck run করে confirm করব। এরপর আপনি:
1. একটা movie edit করে 2-3টা part add → Normal Save → refresh → parts persist কিনা
2. Video player-এ Parts tab দেখা যাচ্ছে কিনা, switch করে play হচ্ছে কিনা
3. Save + Notify → New Release, Push, Telegram Post redirect সব হচ্ছে কিনা
4. Parts ছাড়া পুরানো movie backwards-compatible কিনা

---

**Approve করলে সাথে সাথে A-to-Z implement শুরু করে দিব।**
