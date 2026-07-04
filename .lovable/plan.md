## কী কী ঠিক করা হবে

### ১) Video Player — State reset (series change এ সব default এ ফেরা)
`src/components/VideoPlayer.tsx` এ series/anime ID track করার একটা `prevSeriesIdRef` যোগ করা হবে।
- Series ID change হলে: quality, language, server, resume-time — সব default এ reset।
- একই series-এর ভিতরে episode change হলে: quality/language/server preserve, কিন্তু time reset।

### ২) Control-panel Next button fix
Player-এর "Next" button-এর handler এখন internal state (currentTime, quality) carry করে ফেলছে। নিচের episode-bar এর মতো একই `handleEpisodeChange(nextIndex, { reset: true })` route দিয়ে চালানো হবে যাতে time/quality reset হয়।

### ৩) "Link expired" false-positive (AN)
`VideoPlayer.tsx` এর expire-detection এখন সব ধরনের HLS error কে expire ধরে নিচ্ছে। শুধু নিচের ক্ষেত্রে expire দেখানো হবে:
- HTTP 403/410 response, বা
- Manifest এ `EXT-X-ENDLIST` না থাকা + `fatal networkError` + URL এ expiry-token query param থাকা।
বাকিসব error এ silent retry + fallback server।

### ৪) EasyRouter path গুলো ঠিক করা
`src/components/admin/CloudflareManager.tsx` এ EasyRouter save করার সময় path key mismatch হচ্ছে:
- AN Fetch → `an-fetch` এর বদলে কোথাও `anFetch` লেখা।
- AN Playback → একই সমস্যা।
সব path কে একটা `ROUTE_KEYS` constant এ centralize করা হবে (`an-fetch`, `an-playback`, `video-proxy`, `rs-server-1`, `rs-server-2`)। User-saved URL থাকলে ওইটা, না হলে default fallback — এই priority strict রাখা হবে। Runtime resolver-ও একই key ব্যবহার করবে।

### ৫) RS Free Server 2 বন্ধ
মূল কারণ #৪ এর path mismatch। Fix হলেই চলা শুরু হবে। সাথে health-check ping যোগ করে dead server auto-mark হবে।

### ৬) Server Ultra-Optimization (download-like playback)
`SaltPlayer.tsx` / `VideoPlayer.tsx` এর hls.js config aggressive tune:
```
maxBufferLength: 60
maxMaxBufferLength: 600
maxBufferSize: 200 * 1000 * 1000   // 200MB
backBufferLength: 90
lowLatencyMode: false
enableWorker: true
startLevel: -1                      // auto based on bandwidth
abrEwmaDefaultEstimate: 5_000_000
fragLoadingMaxRetry: 6
manifestLoadingMaxRetry: 4
liveSyncDurationCount: 3
```
Edge functions (`video-proxy`, `rs-server-*`) এ:
- `Cache-Control: public, max-age=3600, immutable` fragment এর জন্য।
- `Accept-Ranges: bytes` + proper 206 partial response।
- Upstream fetch এ `keepalive: true` + connection pooling।
- Response body direct pipe (no full buffering) — memory pressure কমাবে multi-user এ।

### Technical details
Files to edit:
- `src/components/VideoPlayer.tsx` — series-change reset, next-button fix, expire logic, hls config
- `src/components/SaltPlayer.tsx` — hls config
- `src/components/admin/CloudflareManager.tsx` — ROUTE_KEYS centralization
- Router resolver hook (find via grep) — key alignment
- `supabase/functions/video-proxy/index.ts` + RS server functions — streaming/range/cache headers

### কোন কিছু নষ্ট হবে না — safety
- Legacy saved URL গুলো backward-compatible key map দিয়ে read হবে।
- Existing episode bar behavior অপরিবর্তিত।
- Premium/free server default logic টাচ হবে না, শুধু cross-series reset যোগ।
