# Ultra Security Hardening Plan

চারটা layer-এ security add করব। প্রতিটা layer আলাদা ভাবে কাজ করে যাতে কেউ একটা break করলেও বাকিগুলা ধরে রাখে।

---

## Layer 1 — Domain-Locked Video & API (সবচেয়ে important)

**Goal:** আমার video URL/API অন্য কারো website বা app-এ play হবে না। শুধু `rsanime03.lovable.app` + lovable preview domain-এ চলবে।

### Edge functions hardening (`video-proxy`, `video-download`, `an-api`, `rs-bot`, etc.)
- Origin/Referer **allowlist**: `rsanime03.lovable.app`, `*.lovable.app` (preview), `localhost` (dev only)
- Reject অন্য সব origin → `403 Forbidden` JSON: `{ error: "Access denied" }`
- `OPTIONS` (CORS preflight) থেকেও non-allowed origin block — অন্য site থেকে browser fetch বন্ধ হবে
- Bot/script direct hit (no Origin header) → require a rotating short-lived `x-rs-token` header (HMAC of timestamp with `RS_API_KEY`, ±90s window) → frontend automatically attaches it
- Server-to-server scrapers fail কারণ token-এর secret browser-এ exposed না

### Frontend helper
- নতুন `src/lib/secureFetch.ts` — wrapping `fetch` to auto-add `x-rs-token` + correct origin
- All edge-function calls এই helper দিয়ে যাবে

**Result:** কেউ DevTools দিয়ে URL copy করে অন্য site-এ embed করলে 403, server-to-server scrape করলেও token mismatch → 403.

---

## Layer 2 — Browser Anti-Theft UI

**Goal:** কেউ image save / text copy / right-click / drag করতে পারবে না।

Global CSS (`src/index.css`) এ add:
```css
html, body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
img, video { -webkit-user-drag: none; user-drag: none; pointer-events: none; }
input, textarea, [contenteditable] { -webkit-user-select: text; user-select: text; }
```

Global JS guard (`src/lib/uiGuard.ts`, mounted in `App.tsx`):
- `contextmenu` event → preventDefault (right-click + long-press image menu বন্ধ)
- `dragstart` on images → preventDefault
- `keydown`: F12, Ctrl+Shift+I/J/C, Ctrl+U, Ctrl+S → preventDefault
- `copy` event on non-input → preventDefault
- Mobile long-press on images → suppress save dialog via `touch-action` + callout disable

Card images-এ explicit `draggable={false}` + `onContextMenu={preventDefault}` wrapper.

**Note:** এগুলো friction add করে, determined attacker DevTools বন্ধ করতে পারবে না (browser-level limit) — কিন্তু সাধারণ user/casual scraper সম্পূর্ণ block।

---

## Layer 3 — Admin Login History & Block System

**Goal:** Admin panel-এ কে কে ঢুকছে list দেখা + intruder permanently block + owner immune।

### Owner protection (hard-coded)
`src/lib/adminGuard.ts` এ:
```ts
export const OWNER_EMAILS = ["rahatsarker224@gmail.com", "sarkeremon207@gmail.com"];
```
Block check skips these emails — কেউ owner-কে block করলে effect হবে না।

### New Firebase nodes
```
adminAccess/
  logs/{pushId}     → { email, uid, ip, userAgent, country, success, ts, reason }
  blocked/{key}     → { email|uid|ip, blockedAt, blockedBy, reason }
  sessions/{pushId} → { email, ip, startedAt, lastSeen, deviceFingerprint }
```

### Login flow change
- Admin PIN modal-এ entry-এর সময় → log every attempt (success/fail) to `adminAccess/logs`
- IP/country fetch থেকে `ipapi.co/json` (free tier)
- Device fingerprint = existing canvas hash
- Check `adminAccess/blocked` before granting access — owner email skip block check

### New Admin UI tab: "Security & Access"
- **Login History** table: time, email, IP, country, device, status (✓/✗)
- **Active Sessions**: real-time current admins
- **Blocked List**: with unblock button
- One-click "Block" beside each log entry (greyed out for owner emails)
- Filter by date/email/IP

**Result:** intruder login attempt → আপনি list-এ দেখবেন → এক click-এ block → তার IP/email/fingerprint পরের attempt-এ deny।

---

## Layer 4 — Firebase Data Protection

**Goal:** Database থেকে কেউ bulk read/dump করতে না পারে।

- Existing Firebase rules check — sensitive nodes (`adminAccess/*`, `users/*/private/*`) read-only for matching uid বা owner
- Bulk-read guard: client-side throttle in `useFirebaseData` — single `onValue` per node, no `get()` loop pattern
- `siteConfig` public read OK; auth/admin nodes locked
- Document which nodes are public vs locked in `mem://infrastructure/firebase-rules`

---

## Technical Implementation Order

1. **Edge function origin/token guard** (Layer 1) — most impactful, blocks API misuse instantly
2. **Frontend `secureFetch` helper** + replace existing fetch calls in critical paths
3. **CSS + `uiGuard.ts`** mounted in `App.tsx` (Layer 2)
4. **Admin login logging + block table** Firebase nodes + UI tab (Layer 3)
5. **Owner email immunity** hardcoded in `adminGuard.ts`
6. **Firebase rules audit** documented in memory

---

## What This Will NOT Do (honest limits)

- Direct HTTPS video URLs (যেগুলা proxy bypass করে play হয়) — upstream server-এর control আমাদের নাই, ওগুলা সম্পূর্ণ lock করা impossible without re-proxying everything (latency cost বাড়বে)
- DevTools open করে browsing — browser-level feature, কেউ চাইলে disable করতে পারবে না 100%
- Screenshot/screen-record — OS-level, browser block করতে পারে না

কিন্তু **API scraping, embed theft, casual copy/download — সব block হবে।**

---

## Decisions Needed From You

1. **Allowlist domains** — শুধু `rsanime03.lovable.app` + `*.lovable.app`? নাকি custom domain-ও যোগ হবে?
2. **Direct HTTPS videos**ও কি proxy-র মধ্যে force করব (slower but fully locked) নাকি current speed-priority রাখব?
3. **Owner emails** — উপরে যে দুইটা লিখেছি ঠিক আছে, নাকি আরও add করব?
4. **Existing admin PIN (553300)** — keep as fallback বা remove করে শুধু email+password authentic admin auth use করব?

Approve করলে এই sequence-এ build start করব।