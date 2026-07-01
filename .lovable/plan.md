# Premium System — Full Build Plan

অনেক বড় feature request। একবারে সব ঠিকঠাক বানানোর জন্য নিচের কাঠামো follow করব।

## 1. Data Model (Firebase RTDB)

**Anime/Series flags** (`animeSaltSelected/<slug>` & `series/<id>`):
- `dubType`: `"official" | "fan"` (Admin toggle)
- `premium`: `true/false` (whole series lock)
- `premiumEpisodes`: `{ "s1e5": true, ... }` (per-episode lock)
- `qualityLocks`: `{ "1080p": true, "4k": true }` (per-series quality lock)

**Global settings** (`settings/premium`):
- `globalQualityLocks`: `{ "4k": true, "1080p": false }` — site-wide
- `globalDownloadLock`: `true` (premium-only downloads)
- `coinPlan`: `{ coins: 20, days: 5 }` (editable, default only plan)
- `extraPlans`: `[ { name, coins, days } ]` (admin can add)

**User** (`users/<uid>/premium`):
- `active: bool`, `expiresAt: ms`, `source: "coin"|"bkash"|"redeem"`
- `coins: number`
- `adWatchLog`: `{ [YYYY-MM-DD]: { count, adIds: [] } }` (max 5/day)

## 2. Admin Panel Changes

### A. Series Editor (existing `AnManager` + RS `Admin.tsx` series list)
- Dub selector: **Official Dub / Fan Dub** radio → splits list into two columns/tabs.
- New row button beside Edit/Delete: **⭐ Premium** (toggles full-series lock).
- Inside editor modal: 
  - Quality lock checkboxes (480/720/1080/4K)
  - Episode lock grid (click episodes to toggle premium)

### B. New Top-Level Admin Tab: **"Premium Center"**
Central hub for all premium controls:
- **Series Lock Manager** — searchable list of all AN + RS with Premium toggle
- **Episode Lock Manager** — pick series → toggle episodes
- **Quality Lock Manager** — global + per-series quality locks (4K default on, 1080p off)
- **Download Lock Toggle** — global switch
- **Plans Manager** — default `20 coins / 5 days`, add/edit/remove extra plans
- **Coin Ad Manager** — paste up to 5 Adsterra direct-link scripts
- **User Premium Overview** — search user, grant/revoke premium, view coin balance

### C. Fan Dub Section
New sidebar button **"Fan Dub Anime"** → dedicated page listing only `dubType === "fan"` series with quick premium/lock controls.

## 3. User Panel Changes

### A. Premium Gate
When free user clicks a premium series/episode/quality → route to `/premium-required` page:
- Big website logo, gradient hero
- "This content is Premium Only"
- Two CTAs: **Buy Premium** → `/premium` , **Get Free Premium** → `/free-premium`
- Smooth motion (framer-motion), glass-morphism cards

### B. `/premium` Page (Buy)
Three buttons (existing bKash, Redeem Code + **new "Buy with Coins"**):
- Coin button shows current balance, plan (`20 coins → 5 days`), disabled if <20
- On click → deduct 20 coins, activate `premium.active=true, expiresAt=now+5d`
- Extra admin-added plans render as extra cards

### C. `/free-premium` Page (Earn Coins)
Master ad grid — up to 5 Adsterra direct-link cards (only 1/day per ad):
- Click card → opens ad URL in new tab, starts 15s background timer
- If user returns before 15s → no coin
- After 15s + return → **coin animation** (floating +1 coin dropping into balance) + Firebase write
- Daily cap: 5 coins/day (one per ad)
- Progress bar: `X/20 coins → Buy 5-day Premium`

### D. Profile Page
New **Coin Balance Card** with animated counter + "Redeem for Premium" button.

### E. Video Player
- Before load: check `premium` flags → if locked & user not premium, redirect to gate page
- Quality selector: locked qualities show 🔒 → click routes to gate
- Download button: if `globalDownloadLock` && !premium → 🔒 → gate
- Keep existing 4K lock, remove auto-1080p lock behavior

## 4. Technical Details

**New files:**
- `src/pages/PremiumRequired.tsx` — gate page
- `src/pages/PremiumPage.tsx` — buy page (refactor if exists)
- `src/pages/FreePremium.tsx` — coin earning page
- `src/components/CoinAnimation.tsx` — floating +1 animation
- `src/components/admin/PremiumCenter.tsx` — admin hub
- `src/components/admin/FanDubManager.tsx` — fan dub list
- `src/lib/premiumAccess.ts` — `isPremium(user)`, `canPlay(anime, ep, quality, user)`, `spendCoins()`, `awardCoin()`
- `src/hooks/usePremium.ts` — reactive user premium state

**Routes:** `/premium-required`, `/premium`, `/free-premium` added to `App.tsx`.

**Guard integration:** hook into `Index.tsx handlePlay` — before opening player, run `canPlay()` gate.

**Design system:** use existing semantic tokens; gold/amber gradient for premium (`--premium: 45 100% 55%`), coin icon = Lucide `Coins`. Glass cards, framer-motion enter animations, professional spacing.

## 5. Delivery Order (single build)

1. Data helpers (`premiumAccess.ts`, `usePremium.ts`) + Firebase paths
2. Admin Premium Center + series editor buttons + Fan Dub tab
3. Premium gate page + route guards in player
4. `/premium` Buy-with-Coins button
5. `/free-premium` ad grid + 15s timer + coin animation
6. Profile balance card
7. Preview test: lock a series, verify gate → earn coins → buy → unlock

সব একসাথে বানাব, প্রতিটা step টেস্ট করে দেখাব। শুরু করি?
