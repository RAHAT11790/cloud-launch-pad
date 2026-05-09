## Goal

`src/components/VideoPlayer.tsx`-এ ৪টা জিনিস ঠিক করব। Premium/free আলাদা logic পুরোপুরি বাদ — শুধু URL protocol (HTTP vs HTTPS) দিয়ে route ঠিক হবে। User off button দিলে কোন proxy call হবেই না।

## 1. Settings → Proxy section: "Off" button

- Settings panel-এর মাঝে নতুন একটা **"Network"** বা **"Proxy"** tab যোগ করব (Speed/Quality/Audio-এর পাশে)। ভিতরে options:
  - **Auto** (default): HTTP হলে proxy, HTTPS হলে direct।
  - **Off**: কোনো proxy/CDN call নেই — HTTP হোক বা HTTPS, raw `src` direct play।
  - **Force Proxy**: সব URL proxy দিয়ে।
- Selection সংরক্ষিত হবে `localStorage` (`rsanime_proxy_mode`)। প্রতি player open-এ সাথে সাথে apply।
- Implementation: `buildPlaybackCandidates()` + `resolvePlaybackSrc()`-কে একটা `proxyMode` arg নিতে দেব। `Off` মানে শুধু `[directUrl]` return — HTTP-ও direct।

## 2. Free server "block" fix → unified protocol routing

- `getRoleDefaultServerIndex()` এবং `getTierDefaultSelection()` থেকে premium/free branching বাদ। Default server সবসময় **list-এর প্রথম server** (admin যেটা প্রথমে রেখেছে)। User চাইলে server panel থেকে অন্যটা select করবে।
- `switchServer`-এর `if (effectiveVideoServers[serverIndex].locked && !isPremium) return` lock-গুলো রেখে দেব শুধু explicit locked server-গুলোর জন্য — কিন্তু RS01/free server কখনো `locked: true` নয়, তাই block ছুটে যাবে।
- Auto failover (`getAccessibleServerIndexes`)-ও premium-aware থাকবে (premium 4K-server দেখবে), তবে free user কে আর free-only subset-এ আটকাবে না — সব unlocked server পাবে।
- Result: এখন HTTPS source হলে direct, HTTP হলে proxy — দুই server-ই।

## 3. Ultra-fast skipping (download-feel) + faster initial load

`<video>` element-এ:
- `preload="auto"` (already), যোগ করব `crossOrigin="anonymous"` শুধু proxied URL-এ (direct HTTPS-এ skip করব যেন CORS error না আসে)।

Skip behavior fix:
- `seek()`-এ এখন আমরা শুধু `v.currentTime = nextTime` সেট করি, কিন্তু loader debounce তখনও 180ms wait করে → user-এর কাছে "load হতেই থাকে" feel আসে। Fix:
  1. Manual seek চলাকালে `userSeekingRef = true` set করব (`seek()` আর progress-bar touch-এর শুরুতে)। `onWaiting`/`onStalled`-এ `userSeekingRef === true` থাকলে loader debounce **600ms → 1200ms** বাড়াব যেন instant `seeked` আসলে loader-ই দেখাবে না।
  2. `onSeeked` event-এ `userSeekingRef = false` + `setIsBuffering(false)` সাথে সাথে → skip-এর পরে কখনো stuck loader থাকবে না।
  3. Remove the redundant `v.load()` call from the error retry path for HTTPS sources — শুধু src reset, no full reload (browser native range request handle করবে)।
- Range request flow: `video-proxy/index.ts` already Range forward করছে; কিছু changing লাগবে না। Direct HTTPS-এ browser নিজেই Range request করে — এটা অপটিমাল।

Faster initial load:
- `useEffect` ([src] init) তে এখন `setShowFixedLoader(true)` immediate। এর বদলে `requestAnimationFrame`-এর পর only set করব যদি 200ms-এ `playing` event না আসে — fast HTTPS-এ loader flash-ই হবে না।
- Remove `setTimeout 450ms switchingEpisode` → 150ms করব। `instantSwitchRef`-ও 150ms।

## 4. Side-by-side Season selector inside player

বর্তমান player-এর season selector (lines ~2809–2828) wrapping pill row। ঠিক করব:
- "X Seasons" label সরিয়ে একটা horizontal scroll strip বানাব:
  ```
  [ Season 1 ] [ Season 2 ] [ Season 3 ] [ Season 4 ] →
  ```
- Container: `flex gap-2 overflow-x-auto scrollbar-hide pb-1` + `touch-action: pan-x`। Active season-এ gradient + glow, inactive-এ subtle border।
- প্রতিটা button `min-w-[110px]` যাতে একই size-এ সুন্দর line-up হয়।

## Files to edit

- `src/components/VideoPlayer.tsx` (only file)

## Out of scope

- Anime details page-এর season list (user বললো player only)।
- Proxy edge function code change নেই।
- Premium/free unrelated feature change নেই।
