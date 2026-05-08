## Edge Function Router রিফ্যাক্টর + Telegram /unlock flow

### A. Edge Function Router UI Cleanup (`src/components/admin/EgdManager.tsx` বা সংশ্লিষ্ট admin section)

**বাদ যাবে (সম্পূর্ণ remove):**
- 🔗 Built-in URL Shorteners section (Shorten AroLinks / ShrinkMe / VP Link blocks)
- ⚡ Core Functions section এর ভেতর — Weekly Auto-Detect, RS Bot (Telegram), Send OTP Email
- 🤖 Telegram Bot /start Webhook section (Set/Check/Remove webhook UI)
- ☁️ Cloudflare Worker Config section
- 🤖➕ "Telegram Bot আনলক বাটন (One-click)" auto-add button (Ad Link Services এর নিচের)

**যা থাকবে:**
- 📢 Telegram Post — URL + enable toggle + SB autofill + save (এটাই শুধু Core থেকে থাকবে)
- 🔗 Ad Link Services section (নিচে নতুন কাঠামো)

### B. Ad Link Services — নতুন কাঠামো

প্রতিটি service-এ এখন **শুধু দুইটা Supabase Edge Function URL** input থাকবে (Site URL + API key অপশন বাদ):

```
[Service Name] [Enable toggle] [Delete]

Mode:  ( ) Shortener  ( ) Telegram Bot     ← একই switch, রাউটিং ঠিক করে

🔗 Shortener Function URL:
   https://xxx.supabase.co/functions/v1/shorten-arolinks
   → website থেকে direct unlock-এর জন্য

🤖 Telegram Bot Function URL:
   https://xxx.supabase.co/functions/v1/link-share-bot
   → Telegram দিয়ে access নেওয়ার জন্য
```

- Mode = **Shortener** → website থেকে shortener link দিয়ে verify
- Mode = **Telegram Bot** → Telegram bot deep-link দিয়ে verify
- Duration field সম্পূর্ণ remove (global duration ব্যবহার হবে)
- "+ নতুন সার্ভিস যোগ করো" form-এও শুধু এই দুইটা URL input থাকবে

Firebase schema (`settings/adServices/{id}`):
```ts
{ id, name, enabled, mode: "shortener" | "miniapp",
  shortenerFunctionUrl: string,   // নতুন
  telegramBotFunctionUrl: string, // নতুন
  // siteBase, apiKey, durationHours, functionUrl → remove/ignore
}
```

### C. Telegram `/unlock` command (link-share-bot edge function)

**সমস্যা:** এখন bot-এ deep-link click করলে verify message আসে না।

**ফিক্স:**
1. `link-share-bot/index.ts`-এ `/unlock` text command handler যোগ করব (deep-link `/start <token>` এর পাশাপাশি)।
2. User যখন `/unlock` পাঠাবে বা website থেকে button-এ চাপলে যে deep-link বানাবো সেটা হবে:
   `https://t.me/RS_ANIME_FIND_BOT?start=unlock_<userId>`
3. Bot `/start unlock_<userId>` পেলে:
   - Telegram-এ user-এর profile photo (`getUserProfilePhotos`) fetch করবে
   - নিচের মত verify message পাঠাবে (English):
     ```
     [user profile photo]
     👋 Welcome, <first_name>!
     🆔 Telegram ID: <tg_id>
     🌐 Site UID: <userId>
     
     Tap the button below to verify and unlock 24h access.
     [✅ Verify & Unlock]   ← inline button, callback_data=verify_<token>
     ```
4. User `Verify & Unlock` callback চাপলে → token consume → Firebase `users/${userId}/freeAccess` activate → bot reply: `✅ Access granted! Return to the website — player will resume automatically.`

### D. Telegram Post-এর Free Access button flow

(Admin-এ "Telegram Post unlock button" চালু থাকলে প্রতি post-এ `🔓 Free Access` inline button যাবে)

1. User post-এ `Free Access` চাপলে → bot deep-link `?start=postunlock_<animeId>` খুলবে
2. Bot welcome message পাঠাবে user-এর profile photo সহ + একটা `🔗 Get Access Link` button
3. সেই button shortener (configured AroLinks function) দিয়ে link বানাবে — শেষ gateway page-এ user যখন finish করবে, redirect আসবে bot-এই (`?start=token_<token>`)
4. Bot সেই token-সহ welcome message পাঠাবে:
   ```
   [user profile photo]
   🎉 Verification complete!
   
   Your access token:
   `AB23CDEF`
   
   📋 Copy this token, return to the website's Unlock page,
   paste it in the "Access Token" box and tap "Unlock with Token".
   ```
5. Website-এর `UnlockRequired.tsx`-এ ইতিমধ্যেই token paste box আছে (`claimAccessCode`) — সেটাই কাজ করবে।

### E. Profile photo logic

- Telegram bot deep-link দিয়ে এলে → Telegram profile photo (getUserProfilePhotos)
- Website থেকে এলে (UnlockRequired page) → Firebase `users/${uid}/photoURL` থেকে
- দুই জায়গায় photo না থাকলে → fallback admin/branding logo
- `/start` (plain, কোনো param ছাড়া) → শুধুমাত্র আপনার সাইটের logo + welcome message

### F. ফাইল cleanup target

- `src/components/admin/EgdManager.tsx` — large UI cleanup (built-in shorteners, core functions extra rows, webhook section, cloudflare config, one-click telegram add — সব remove)
- `src/lib/edgeFunctionRouter.ts` — শুধু Telegram Post relevant code রাখব
- `src/lib/unlockAccess.ts` — `AdService` interface update (shortenerFunctionUrl + telegramBotFunctionUrl), `shortenWithService` update
- `src/pages/Index.tsx` / `VideoPlayer.tsx` — service.mode অনুযায়ী shortener vs telegram URL select
- `supabase/functions/link-share-bot/index.ts` — `/unlock` command handler, profile photo fetch, post-unlock token flow, English welcome messages
- `supabase/functions/telegram-post/index.ts` — `🔓 Free Access` button payload `start=postunlock_<animeId>`-এ পাঠানো

### G. একটা কনফার্মেশন দরকার

Mode = **Telegram Bot** select করলে website-এর unlock button-এ চাপলে user-কে কোথায় পাঠাবো?
- (1) সরাসরি Telegram bot deep-link খুলবে (current behaviour, recommended)
- (2) আগে shortener-এ পাঠাবো, তারপর শেষে bot-এ — extra ad layer

Plan-এ আমি (1) ধরেছি। ভিন্ন চাইলে জানান।

### Result
- Admin panel cleaner — শুধু Telegram Post + Ad Link Services দেখাবে
- প্রতিটা service-এ shortener URL + telegram bot URL দুটোই থাকবে, mode switch দিয়ে control
- `/unlock` ও deep-link দুটোই bot-এ verify message + profile photo সহ আসবে
- Telegram post-এর Free Access button → shortener → token → website paste flow পুরোপুরি কাজ করবে