# Firebase Add — Multi-Firebase Manager (replaces FB Cleanup)

## Scope (this turn only)
1. Replace admin sidebar item **FB Cleanup** with **FB Add**.
2. New component `src/components/admin/FirebaseMultiManager.tsx` with full multi-Firebase UI.
3. Persist all extra Firebase configs in primary Firebase at `admin/extraFirebases/{id}`.
4. Per-Firebase: section-wise transfer (push real data from primary), JSON export per section, JSON import per section, copy RTDB rules, status pings, progress bars.
5. NOT in scope this turn: changing how the live app reads/writes (app still reads from primary). The extras are warm replicas — `useFirebaseData.ts` stays untouched. We can wire automatic read-fallback in a later turn if you want.

## UI Layout

```
┌─ Firebase Add (sidebar item) ─────────────────────┐
│ [+ Add Firebase Account]   [📋 Copy RTDB Rules]   │
│                                                    │
│ ┌── FB #1 · "Backup-A" · ● online ──────────────┐ │
│ │ Project ID:  rs-backup-a                       │ │
│ │ DB URL:      https://rs-backup-a.firebase…    │ │
│ │ Mirror URL:  https://rs-backup-a.asia-se1…    │ │
│ │ [Edit] [Delete] [Ping]                         │ │
│ │                                                 │ │
│ │ Sections this FB handles:                      │ │
│ │  ☑ images    ☑ webseries   ☑ movies            │ │
│ │  ☑ users     ☑ adminLinks  ☐ analytics          │ │
│ │  ☑ liveTv    ☐ subscriptions ☐ notifications    │ │
│ │                                                 │ │
│ │ Per-section actions:                            │ │
│ │  images   [⬇ Pull JSON] [⬆ Push from Main] [📤] │ │
│ │  webseries[⬇ Pull JSON] [⬆ Push from Main] [📤] │ │
│ │  …                                              │ │
│ │                                                 │ │
│ │ [▶ Sync ALL selected sections]                  │ │
│ │ ▓▓▓▓▓▓▓▓░░░░░░  42%  · webseries · 18/52 nodes │ │
│ └────────────────────────────────────────────────┘ │
│                                                    │
│ ┌── FB #2 · "Backup-B" · ● online ──────────────┐ │
│ │ …                                              │ │
│ └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

## Section list (checkboxes per FB)
All top-level RTDB roots used by the app:
- `webseries`, `movies`, `liveTv`, `users`, `userProfiles`, `watchHistory`, `library`, `comments`, `notifications`, `pushTokens`, `subscriptions`, `adminLinks`, `admin`, `seasonsByLanguage`, `images`, `analytics`, `miniApp`, `telegramPerAnimeButtons`, `fcmTokens`, `weeklyEpisodes`

(rendered as a grid of checkboxes, persisted per-FB in `admin/extraFirebases/{id}.sections`)

## Transfer engine (`src/lib/firebaseMultiSync.ts`)
- Initialize each extra Firebase via `initializeApp(config, uniqueName)` + `getDatabase(app, dbUrl)` lazily on demand (cached map).
- **Push from main → extra**: for each selected section, `get(ref(mainDb, section))` → walk top-level children → batched `update(ref(extraDb, section), { [childKey]: value })` in groups of 25 → report progress via callback `(done, total, currentSection, currentNode) => void`.
- **Pull JSON from extra**: `get(ref(extraDb, section))` → JSON.stringify → trigger download `section-{fbId}-{date}.json`.
- **Upload JSON to extra**: file input → JSON.parse → validate shape (object) → `set(ref(extraDb, section), parsed)` with confirm modal.
- **Copy RTDB rules**: clipboard with the standard rules block:
  ```json
  { "rules": { ".read": "auth != null", ".write": "auth != null" } }
  ```
  (Adjustable inline before copy.)
- **Ping**: `get(ref(extraDb, ".info/connected"))` with 5s timeout → green/red dot.

## Add/Edit dialog fields
- Display name (e.g. "Backup-A")
- API key, Auth domain, Project ID, **Database URL**, **Mirror URL** (optional alt region), Storage bucket, Messaging sender ID, App ID
- "Test connection" button before save
- Persists to `admin/extraFirebases/{id}` (id = uuid)

## Sidebar change
`Admin.tsx`:
- Replace label `fb-cleanup` → `fb-add`, icon `Database`, title "Firebase Add"
- Replace `<FirebaseCleanupSection />` with `<FirebaseMultiManager />`
- Keep old `FirebaseCleanup.tsx` file for now (not deleted) so existing code paths don't break; we just stop rendering it.

## Files touched
- **New**: `src/components/admin/FirebaseMultiManager.tsx` (~500 LOC: UI, dialog, per-FB card, progress bar)
- **New**: `src/lib/firebaseMultiSync.ts` (~200 LOC: app cache, push/pull/upload helpers, progress callback)
- **Edit**: `src/pages/Admin.tsx` (sidebar item + render swap, ~6 line change)

## Out of scope (will need a follow-up turn)
- Auto read-fallback in `useFirebaseData.ts` (app still reads main only)
- Auto realtime mirror on every write (huge architectural change; needs every `set/update` call wrapped)
- Edge function for server-side scheduled sync

## After approval — implementation steps
1. Write `firebaseMultiSync.ts` (engine).
2. Write `FirebaseMultiManager.tsx` (UI).
3. Patch `Admin.tsx` (3 spots: import, sidebar item, render).
4. Test: add a dummy FB, push `webseries` section, watch progress bar.

Confirm and I'll build.
