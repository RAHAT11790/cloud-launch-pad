
# Adsterra Master-Trap Access Gate

Replace today's in-player Adsterra ads with a single dedicated gate page (`/access-gate`) that the user passes through once to earn time-limited ad-free access. All other ad surfaces get removed permanently.

## Flow

```text
User taps anime card
        │
        ▼
   Has active access?  ── yes ──▶ open player directly (no ads)
        │ no
        ▼
   /access-gate  ── show 5 ad slots + direct-link button
        │
        ▼
   User clicks Direct Link N times (timer ≥ X sec each)
        │
        ▼
   Unlock → grant access for H hours → open player
```

## Admin Panel (new `AccessGateConfig` card under Adsterra)

Single Firebase node `settings/accessGate`:

| Field | Type | Meaning |
|---|---|---|
| `enabled` | bool | Master on/off for the gate |
| `directLink` | string | Adsterra Smartlink URL |
| `nativeBanner` | string | Native Banner `<script>` snippet |
| `banner160x300` | string | Banner 160×300 `<script>` snippet |
| `popunder` | string | Existing popunder snippet (reused) |
| `socialBar` | string | Existing social-bar snippet (reused) |
| `clicksRequired` | number | How many qualifying direct-link views (e.g. 5) |
| `dwellSeconds` | number | Seconds the user must stay on the direct-link tab before count increments (e.g. 10) |
| `accessHours` | number | Hours of ad-free access granted after unlock (e.g. 6) |

Old `settings/adsterra` keys (`popunder`, `socialBar`) are migrated into the new node on save; the gate is the only consumer.

## Gate Page (`src/pages/AccessGate.tsx`, route `/access-gate`)

Layout — built as a master-trap:

```text
┌──────────────────────────────┐
│  Social Bar  (Adsterra fixed)│
├──────────────────────────────┤
│  Native Banner               │
│  Banner 160×300              │
├──────────────────────────────┤
│  Progress: 2 / 5 unlocked    │
│  ⏱  10s timer                │
│  ╔══════════════════════════╗│
│  ║   ▶  Continue (Ad)       ║│  ← direct-link button
│  ╚══════════════════════════╝│
│  (popunder fires on click)   │
└──────────────────────────────┘
```

Click behavior on the Continue button:
1. Open `directLink` in a new tab (`window.open` — popunder script triggers concurrently).
2. Start a `dwellSeconds` countdown in the foreground tab.
3. When user returns (page `visibilitychange` → visible) AND countdown elapsed → increment counter in `localStorage` (`gateProgress`).
4. After `clicksRequired` successful cycles → write `localStorage.gateAccessUntil = now + accessHours*3600*1000` and `navigate(returnTo)`.

The button is positioned so social-bar / native-banner / 160×300 ad units sit around/above it — clicks tend to register on multiple ad surfaces (trap effect) without breaking Adsterra ToS-visible UI.

## Access Check

Helper `src/lib/accessGate.ts`:

```ts
export function hasGateAccess(): boolean
export function clearGateAccess(): void
export function consumeGateRedirect(returnTo: string): void  // navigate('/access-gate?to=...')
```

Player open paths (`AnimeDetails` → Watch button, `SaltPlayer` mount) check `hasGateAccess()`. If false and `settings/accessGate.enabled`, redirect to `/access-gate?to=<encoded original path>`.

## Removal of legacy ad surfaces

- Delete `src/components/AdsterraAdManager.tsx` mounts inside `SaltPlayer`, `VideoPlayer`, `ProfilePage`.
- Remove `enterAdsterraPlayerScope`/`loadAdsterraSlots`/`exitAdsterraPlayerScope` calls.
- Keep `src/lib/adsterraAds.ts` only as a thin script-injection utility reused by the gate page (no MutationObserver popunder throttling on gate — we *want* the ads to fire).

## Files

New:
- `src/pages/AccessGate.tsx`
- `src/lib/accessGate.ts`
- `src/components/admin/AccessGateConfig.tsx`

Edited:
- `src/App.tsx` — register `/access-gate` route
- `src/pages/Admin.tsx` — swap `AdsterraConfig` card for `AccessGateConfig`
- `src/components/SaltPlayer.tsx` — remove `AdsterraAdManager`, add gate check
- `src/components/AnimeDetails.tsx` — gate the "Watch" button
- `src/pages/Index.tsx` — gate the `setSaltPlayerState` call
- `src/components/VideoPlayer.tsx`, `ProfilePage.tsx` — remove ad mounts

Removed:
- `src/components/AdsterraAdManager.tsx`
- `src/components/admin/AdsterraConfig.tsx`

## Notes / Out of scope

- Honest verification: the `visibilitychange + dwell` check is the strongest browser-side signal possible without a server callback. No Adsterra postback API exists for Smartlink, so this matches the original "Telegram-code" pattern's trust model.
- Existing premium / device-bypass logic continues to short-circuit the gate.
- Localised UI text stays English per project rule.
