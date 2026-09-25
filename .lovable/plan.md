# পুরো ওয়েবসাইটের নিরাপত্তা পরিকল্পনা (Security Day)

## আগে একটা সৎ কথা
- ডাটাবেসের ঠিকানা ব্রাউজারের network log থেকে কখনোই ১০০% লুকানো যায় না। আসল সুরক্ষা হলো ঠিকানা কেউ জানলেও **কিছু পড়তে বা লিখতে না পারা**। আমরা এটাই করব।
- ভিডিও একবারে পুরোটা আসে না, ছোট ছোট টুকরো হয়ে আসে। তাই একেবারে "একবার চলেই শেষ" লিংক দিলে ভিডিও মাঝপথে থেমে যাবে। এর বদলে প্রতিবার Play চাপলে একটা **আলাদা লিংক** তৈরি হবে, যেটা শুধু ওই ইউজার, ওই ডিভাইস আর আপনার ডোমেইনে চলবে এবং অল্প সময় পরে বাতিল হবে। অন্য কেউ কপি করলে লিংকটা চলবে না।

## ধাপ ১ — ডাটাবেস লক করা (সবচেয়ে জরুরি)
- ডাটাবেসকে তিন ভাগে ভাগ করা হবে:
  - **সবার জন্য খোলা (শুধু পড়া যাবে):** anime-এর নাম, ছবি, এপিসোডের তালিকা, New Release। এখানে ভিডিও লিংক থাকবে না।
  - **ইউজারের নিজের অংশ:** প্রোফাইল, coin, watch history। প্রত্যেকে শুধু নিজেরটা পড়তে ও লিখতে পারবে।
  - **সম্পূর্ণ গোপন:** ভিডিও লিংক, সার্ভারের তালিকা, admin settings, security log, payment, premium তালিকা। ব্রাউজার থেকে এগুলো কেউ পড়তে বা লিখতে পারবে না।
- কেউ নিজে থেকে coin বা premium বাড়াতে পারবে না। এগুলো শুধু সার্ভার বদলাবে।
- Admin panel-এর সব লেখার কাজ হবে একটা নিরাপদ "Admin Gateway"-এর মাধ্যমে। সেটা প্রতিবার login আর PIN যাচাই করবে।
- শেষে ডাটাবেসের নিয়মগুলো (rules) আমি লিখে দেব। আপনি সেগুলো Firebase Console-এ বসাবেন (নিচে ধাপে ধাপে দেওয়া আছে)।

## ধাপ ২ — HTTPS Protection (নতুন কোড)
- নতুন কোড **"HTTPS Protection"** যোগ হবে দুই জায়গায়: আপনার Edge Function Manager আর Cloudflare Manager।
- কাজটা এভাবে হবে:
  1. ইউজার Play চাপলে অ্যাপ সার্ভারের কাছে একটা লিংক চাইবে।
  2. সার্ভার যাচাই করবে: login ঠিক আছে কি না, premium বা lock-এর অনুমতি আছে কি না, আর অনুরোধটা আপনার ডোমেইন থেকে এসেছে কি না।
  3. যাচাই পাস হলে সার্ভার একটা এলোমেলো দেখতে সাময়িক লিংক বানাবে। লিংকটা ওই ইউজার আর ডিভাইসের সঙ্গে বাঁধা থাকবে, তাতে সময়সীমা থাকবে, আর গোপন কী দিয়ে সিল করা থাকবে।
  4. প্লেয়ার শুধু এই সাময়িক লিংকটাই দেখবে। আসল সার্ভার বা ডোমেইনের নাম কোথাও দেখা যাবে না।
  5. অন্য ওয়েবসাইট, অন্য ইউজার বা সময় পেরিয়ে গেলে লিংক চালাতে চাইলে সেটা বাতিল হবে।
- Video Servers-এ প্রতিটি HTTPS সার্ভারের জন্য "HTTPS Protection" চালু বা বন্ধ করার অপশন থাকবে (HTTP proxy-র মতোই)।
- ডাউনলোডেও একই ধরনের সাময়িক লিংক ব্যবহার হবে।

## ধাপ ৩ — ওয়েবসাইটের বাকি ফাঁকগুলো বন্ধ করা
- **Admin PIN** শুধু সার্ভারে যাচাই হবে। কোডের ভেতরে কোনো PIN বা owner-এর গোপন তথ্য থাকবে না।
- **Premium ও Lock** সার্ভারে যাচাই হবে। ব্রাউজারে কিছু বদলে কেউ lock এড়াতে পারবে না।
- **বাইরের সব function** শুধু আপনার ডোমেইন থেকে চলবে। প্রতিটি function ইনপুট যাচাই করবে, আর বারবার চেষ্টা করলে (rate-limit) আটকে দেবে।
- **Telegram ও বাকি bot-এর চাবি** শুধু সার্ভারে থাকবে। আগে ফাঁস হয়ে থাকলে সেগুলো বদলানোর তালিকা দেব।
- ওয়েবসাইটে নিরাপত্তা headers বসানো হবে, যাতে অন্য সাইট আপনার সাইট ফ্রেমে বসাতে না পারে বা কোড ঢোকাতে না পারে।
- পুরো security scan চালিয়ে সব সমস্যা ঠিক করা হবে।

## ধাপ ৪ — পরীক্ষা
- লগইন না করে বা অন্য ইউজার হয়ে গোপন ডাটা পড়ার চেষ্টা করা হবে। ফলাফল হতে হবে: আটকে যাবে।
- অন্য ডোমেইন থেকে ভিডিও লিংক চালানোর চেষ্টা করা হবে। ফলাফল হতে হবে: চলবে না।
- আপনার সাইটে ভিডিও প্লে, ডাউনলোড, Admin panel আর Android app ঠিকমতো চলছে কি না দেখা হবে। স্ক্রিনশটসহ রিপোর্ট দেব।

## সময়সূচি
```text
অংশ ১: পুরো অ্যাপ স্ক্যান করে কোন অংশ কোন ডাটা পড়ে/লেখে তার তালিকা
অংশ ২: Admin Gateway ও ইউজারের নিজের ডাটার নিয়ম
অংশ ৩: ভিডিও লিংক গোপন অংশে সরানো + HTTPS Protection কোড
অংশ ৪: বাকি ফাঁক বন্ধ + security scan
অংশ ৫: আপনি নতুন rules বসাবেন -> আমি live test করব
```
সব কাজ কয়েক দফায় হবে। প্রতিটি দফা পরীক্ষা করে তবেই পরেরটা শুরু হবে, যাতে সাইট কখনো বন্ধ না হয়।

## আপনাকে যা করতে হবে
1. পুরোনো ডাটার একটা backup নিন: Firebase Console → Realtime Database → ⋮ → Export JSON।
2. আমি বললে নতুন rules Firebase Console → Realtime Database → Rules-এ বসিয়ে Publish করবেন।
3. HTTPS Protection কোডটি Cloudflare Manager থেকে Deploy করবেন। তারপর তার ঠিকানা Router-এ বসাবেন (আমি দেখিয়ে দেব)।
4. কাজ শেষে ওয়েবসাইট Publish করবেন আর নতুন APK install করবেন।

## Technical details
- Firebase RTDB rules: public `/catalog` read-only; `/users/$uid` with `auth.uid === $uid`; private nodes `.read/.write: false`. Server writes go through the Admin SDK (`FIREBASE_SERVICE_ACCOUNT_KEY`).
- Client Firebase auth: an edge function mints a Firebase custom token from a verified backend session (guests get anonymous Firebase auth with limited scope).
- Link tokens: HMAC-SHA256 (`SIGNING_SECRET`) over {uid, device fp, content id, exp ≈ 2–4h, nonce}. The origin is checked against an allowlist. Playlist and segment URLs are rewritten so each carries a child token. Nonce revocation lives in CF KV (Cloudflare) or a Postgres table (Supabase) with RLS and service_role-only access.
- Source URLs are resolved server-side only and never sent to the client.
- A Cloudflare Worker and a Supabase edge function stay in sync (dual-deploy rule).
