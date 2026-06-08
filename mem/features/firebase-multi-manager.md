---
name: Firebase Multi-Manager
description: Admin panel multi-Firebase system — main is protected source of truth, helpers are passive replicas with sync/JSON/storage tools
type: feature
---
Admin → "FB Add" section renders `FirebaseMultiManager`. Architecture:

- **Main Firebase** stays hardcoded in `src/lib/firebase.ts` (untouched, source of truth). UI shows it as a protected card — full JSON download, full JSON upload (merge at root), storage analytics. Cannot be deleted.
- **Helper Firebases** stored in main RTDB at `admin/extraFirebases/{id}`. Each holds: connection config, selected sections, `autoMirrorMinutes`.
- **No live read/write routing** to helpers — they are passive replicas. App always reads/writes main. Helpers receive data via:
  - Manual per-section push from main → helper
  - Manual "Sync ALL" of selected sections
  - Optional auto-mirror interval (5m / 15m / 30m / 1h / 3h / 12h / 24h) scheduled client-side from admin page
- **JSON ops**: per-section download/upload (overwrite) + full-DB download/upload (merge at root via `update`) for both main and helpers.
- **Storage analytics**: estimates RTDB usage via `JSON.stringify().length`. Shows total bytes, % of 1 GB free tier, top sections by size.
- **Adding a new helper never touches existing data** — replicas only fill when sync is triggered.

Files: `src/lib/firebaseMultiSync.ts`, `src/components/admin/FirebaseMultiManager.tsx`.
