ভাই, কাজ ৩টা বড় area-তে — প্রত্যেকটার scope আলাদা। নিচে A→Z কী করব সেটা আছে। Approve করলে সরাসরি implement শুরু করব।

---

## ১) Comment Section (Video Player)

File: `src/components/VideoEngagement.tsx`

- প্রত্যেক comment ও reply-এর নিচে **Edit / Delete** button add করব — শুধু নিজের comment/reply-এ visible (userId match)।
- Edit → inline textarea + Save/Cancel; Firebase-এ update হবে + `editedAt` mark।
- Delete → confirm popup → Firebase থেকে remove (reply থাকলে "[deleted]" placeholder রেখে thread ভাঙবে না)।
- **Reply push notification restore**:
  - reply save করার সময় parent comment-এর `userId` নেব
  - `users/{parentUserId}/fcmTokens` থেকে token পড়ব
  - existing `send-fcm` edge function call → title: "New reply on your comment", body: reply text (৮০ char), deepLink: বর্তমান video page।
  - নিজের comment-এ নিজে reply দিলে notification skip।

---

## ২) Telegram Search Bot

File: `cloudflare-workers/anime-search-bot.js` (+ `src/lib/cloudflareWorkerLibrary.ts`-এ copy sync)

**Bug fixes:**

- Duplicate/random auto-reply বন্ধ: `update_id` dedup Map (in-memory + short TTL) + প্রত্যেক update একবারই process।
- Group-এ শুধু direct mention (`@botname`) বা `/anime <name>` বা reply-to-bot হলে reply — random text-এ auto-trigger বন্ধ।
- Debounce per chat (২ sec) যাতে same query দুইবার fire না হয়।

**Season/Episode breakdown:**

- Firebase থেকে series data fetch করে seasons array parse করব।
- Reply format:
  ```
  🎬 Dr. Stone
  📺 Season 1 — 24 Episodes
  📺 Season 2 — 11 Episodes
  📺 Season 3 — 22 Episodes
  Total: 57 Episodes across 3 Seasons
  ```
- Movie হলে: `🎬 Full Movie` / `Part 1, Part 2` (type-based)।

**Design polish:** header emoji, section separator, watch button inline keyboard, poster থাকলে `sendPhoto` with caption।

---

## ৩) Telegram Post System (Admin Panel)

Files: `src/pages/Admin.tsx` (inline `telegram-post` section + `sendTelegramPost`), `supabase/functions/telegram-post/index.ts`, `cloudflare-workers/telegram-post.js`

**Redesign UI (Admin):**

- বর্তমান mixed Bengali/English text সব clean English-এ rewrite (আপনি চাইলে Bengali labels-ও দিতে পারি — জানাবেন)।
- আলাদা **Template Editor** section: প্রত্যেক লাইন (title, subtitle, episode line, footer, support line, watch button label) আলাদা input-এ edit।
- Template save হবে Firebase `settings/telegramPostTemplates/{series|movie}`-এ।
- **Two templates** — Series template + Movie template — dropdown-এ switch।
- Placeholder token: `{title}`, `{episodeRange}`, `{season}`, `{quality}`, `{watchUrl}`, `{username}`, `{ownerUsername}` — live preview-এ resolve।
- "Owner support" line-এ hardcoded `admin` remove করে editable `ownerUsername` field (default আপনার username) — save হবে `settings/telegramPost/ownerUsername`।

**Auto-detection fixes:**

- **Episode range bug**: New Releases → Telegram Post transition-এ `episodeFrom/episodeTo` দুই field carry করব (currently শুধু single number যাচ্ছে)। `sendTelegramPost`-এ range থাকলে `Episode {from}-{to}` render।
- **Movie detection**: content type check (`type === 'movie' || !seasons`) → automatically Movie template load + type label "Full Movie" বা user-selected "Part 1/Part 2/Complete"।
- Series-এর জন্য existing episode logic রাখব।

**Preview panel:** left side edit, right side rendered Telegram-style card preview (poster + formatted caption + button)।

---

## Technical Notes

- Firebase paths: `comments/{contentId}/{commentId}`, `settings/telegramPostTemplates/*`, `settings/telegramPost/ownerUsername`, `users/{uid}/fcmTokens`।
- Edge function `send-fcm` already exists — reuse।
- Cloudflare worker changes সাথে সাথে `src/lib/cloudflareWorkerLibrary.ts`-এর copy update (dual-deploy rule)।
- Message length short রাখব (আপনি চেয়েছেন)।

---

## Delivery Order

1. Comment edit/delete + reply push (smallest, isolated)
2. Search bot dedup + season breakdown
3. Telegram Post redesign + template editor + movie/series split + range fix

Approve দিলে এক বারে সব শুরু করব।

&nbsp;