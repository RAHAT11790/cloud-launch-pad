# Plan: Download Proxy + Edge Manager Library + Router URL Fields

## 1. নতুন dedicated Download Proxy edge function (`video-download`)

**সমস্যা:** screenshot এ `ERR_INVALID_RESPONSE` — Render origin মাঝে মাঝে malformed header / chunked-encoding ভাঙা response পাঠায়। বর্তমান `video-proxy` streaming এর জন্য optimized, কিন্তু download path এ upstream error গুলো user এর browser এ raw চলে যায়।

**সমাধান:** আলাদা `supabase/functions/video-download/index.ts` — শুধু download এর জন্য, যা:
- Upstream এ HEAD probe → fail হলে retry (২ বার, exponential backoff)
- Range request করে না (full file fetch) → invalid range response এড়ায়
- Upstream chunked/identity encoding ঠিকঠাক normalize করে — invalid hop-by-hop header strip
- 5xx পেলে retry, তাও fail হলে clear JSON error (browser এ blank page না)
- `Content-Disposition: attachment` filename UTF-8 সহ
- Larger socket timeout (90s), keep-alive, parallel-safe
- কোনো cache না (`no-store`) — corrupt partial cache এড়ায়

`src/lib/videoDownload.ts` → এখন `video-download` কে call করবে, `video-proxy` না।

## 2. Edge Manager — Button-based Code Library (`src/components/admin/EgdManager.tsx` update)

বর্তমান EgdManager এ যোগ হবে একটা **"Code Library"** section, যেখানে এই function গুলোর full source code button হিসেবে থাকবে (Firebase `settings/edgeCodeLibrary` তে save):

| Button | Edge Function |
|---|---|
| Video Proxy | `video-proxy` |
| Video Download (new) | `video-download` |
| Telegram Post | `telegram-post` |
| RS Bot | `rs-bot` |
| Send OTP Email | `send-otp-email` |
| Process Email Queue | `process-email-queue` |
| APK Download | `apk-download` |
| Link Share Bot | `link-share-bot` |
| Shorten Arolinks | `shorten-arolinks` |
| Generate Backdrop | `generate-backdrop` |

**Flow:**
- Button click → নিচের bigass code textarea তে full source paste হয়ে যায়
- নিচে auto-detected ENV vars listed (e.g. `LOVABLE_API_KEY`, `TELEGRAM_BOT_TOKEN`, `RESEND_API_KEY`) — empty input fields সহ
- "Copy Code" button → clipboard
- User Supabase Dashboard → Edge Functions → paste → deploy → URL copy

**Lovable-only functions** (যেগুলোর secret/value user নিজে আনতে পারবে না, e.g. internal Lovable AI Gateway proxy) — list করা হবে না, কারণ তুমি বলেছো।

## 3. Edge Router — URL Override Fields সবার জন্য

`src/components/admin/EdgeRouterConfig.tsx` (বা যেখানে router config UI আছে) এ প্রতি function এর জন্য একটা URL input field থাকবে, যা Firebase `settings/functionOverrides/{fnName}.customUrl` তে save হয়। বর্তমান `getEdgeFunctionUrl()` already এই pattern support করে — শুধু UI add করতে হবে।

**Default values:** আমি current Lovable Supabase URL গুলো (`https://kqxpzqegtvaiwgdusrin.supabase.co/functions/v1/{fnName}`) প্রতিটার জন্য prefill করে দিবো, যাতে fallback হিসাবে কাজ করে।

## 4. Latency Optimization

- Edge Router config cache TTL 30s → 120s
- Firebase initial fetch parallelize (Promise.all already আছে কিনা check করবো)
- Index.tsx এর splash safety timeout 4s → 2.5s
- Console এ heavy debug log গুলো production এ strip

## Files to Touch

```text
NEW: supabase/functions/video-download/index.ts
EDIT: src/lib/videoDownload.ts              (call new function)
EDIT: src/components/admin/EgdManager.tsx   (add Code Library section)
EDIT: src/components/admin/EgdManager.tsx   (or related Router config) — URL inputs
EDIT: src/lib/edgeFunctionRouter.ts         (cache TTL, prefill defaults)
EDIT: src/pages/Index.tsx                   (splash timeout)
```

## Out of Scope (পরে handle করবো)
- Ad spam (already adjusted)
- Continue Watching (already fixed in previous turn)
- Profile sync (already done)

## Verification
- Admin panel এ login (PIN `258800`) → EgdManager খুলে button গুলো test
- নতুন `video-download` deploy করার জন্য code library থেকে copy → user Supabase এ deploy → URL Router এ paste
- Preview এ একটা problematic episode download try

**Approve দিলে আমি এক shot এ build করবো।**
