## Core understanding (confirm before I touch code)

**AN (AnimeSalt) is NOT RS.** API returns per episode:

- 4 video URLs (480p / 720p / 1080p, and default URL 1080p ) — **video only, no audio, language-agnostic**
- N audio URLs — **one per language** (Hindi / Tamil / Telugu / English / …)

Player must play **video stream + audio stream simultaneously**, perfectly synced (audio element slaved to video's `currentTime`). Default audio = Hindi. Switching audio swaps only the audio element — video keeps playing. Switching quality swaps only the video element — audio keeps playing.

RS keeps its current per-language `seasonsByLanguage` shape. **Zero RS changes.**

## Changes

### 1. AN admin editor (`AnSeriesManager.tsx`) — AN branch only

Per episode, render:

```
Episode 1
  Video qualities (single set, no language selector)
    [480p]  [720p]  [1080p]  [4K optional]
  Audio tracks (one row per language returned by API)
    Hindi  [audio URL]   (default ●)
    Tamil  [audio URL]   ( ○ )
    Telugu [audio URL]   ( ○ )
```

- Remove the "Language: Hindi / This is the base language" selector for AN entries.
- Save shape: `episode = { link480, link720, link1080, link4k?, audioTracks: [{language,label,link,isDefault}] }`. No `seasonsByLanguage` duplication for AN.
- Fetch button populates this exact shape from `an-api` (single call, fills all qualities + all audio rows). RS fetch path untouched.

### 2. AN card click fix (`AnNativeView.tsx` / `Index.tsx`)

AN cards currently don't open the detail/player view. Restore the click handler so tapping an AN card opens AnimeDetails like any other card.

### 3. Dual-stream player for AN (`VideoPlayer.tsx`, AN branch only)

- Detect AN entry → mount hidden `<audio>` alongside `<video>`.
- Video src = selected quality URL.
- Audio src = selected language URL (default Hindi, fallback first available).
- Sync rules (millisecond-tight):
  - On `play/pause/seeking/seeked/ratechange` → mirror to audio element.
  - On every `timeupdate` and every 250 ms, if `|audio.currentTime − video.currentTime| > 0.05s` → set `audio.currentTime = video.currentTime`.
  - Wait for both `canplay` before starting playback; if audio buffers, pause video; resume both together (prevents video-ahead-of-audio drift).
- Quality menu lists 480/720/1080/4K from stored URLs (no API calls).
- New audio menu lists languages from `audioTracks` (no API calls).
- RS path in VideoPlayer untouched.

### 4. Migration / compatibility

Reader tolerates old AN rows that stored `seasonsByLanguage`: flatten to the new shape on load (pick base-language video URLs, collect all language audio URLs). No data wipe needed.

### 5. Verification (mandatory before reporting done)

Run Playwright against `localhost:8080`:

1. Open home → click an AN card → screenshot detail page open.
2. Click Play → screenshot player with video playing.
3. Assert `<video>` has `currentTime > 0`, `<audio>` has `currentTime > 0`, `|Δ| < 0.1s`.
4. Switch audio language → screenshot, assert video keeps playing without reload, audio source changed.
5. Save all screenshots to `/mnt/documents/an-redesign-*.png` and surface them.

Will not stop until those screenshots show: AN card opens, video + audio play together in sync, language switch works.

## Files touched

- `src/components/admin/AnSeriesManager.tsx` (AN branch UI + save shape)
- `src/components/AnNativeView.tsx` and/or `src/pages/Index.tsx` (card click)
- `src/components/VideoPlayer.tsx` (dual-stream AN branch, guarded `if (isAn)`)
- Possibly `src/data/animeData.ts` types (add explicit video-only quality fields already exist)

## Files NOT touched

- Any RS playback code path
- `an-api` edge function (already returns correct data)
- Firebase rules, auth, notifications, anything else

Approve and I'll execute end-to-end and return with the screenshots.

সিরিজের ক্ষেত্রেও এটাই আর মুভিস এর ক্ষেত্রেও এটাই মুভি ফাংশটা আবার ভুলে যেও না দোনোটা কিন্তু এক্স একই রকমের একইভাবে কাজ করবে আর P review তে যতক্ষণ পর্যন্ত না টেস্টিং করে ছবি পাঠাইবা কাজ কোনভাবেই শেষ হবে না এখানে দুই নাম্বার চ্যাট লাগানো যাবে না এক চ্যাটের মাঝে সবগুলো করতে হবে এবং টেস্টিংও এক চ্যাটের মাঝে করতে হবে এখানে অজুহাত দিলে চলবে না যে পরের যেটের মাঝে টেস্টিং করব ছবি পাঠাবো এই চ্যাটের মাঝে সব ঠিক করে ছবি পাঠাতে হবে এটা বাধ্যতামূলক এখানে দুই নাম্বার চ্যাটের আশ্বাস নেওয়া একবারেই যাবে না এটা আমি বলে রাখি এটা আমার সম্পূর্ণ আদেশ এটা অমান্য করলে কোন কাজই হবে না। 