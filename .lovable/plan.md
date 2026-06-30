# AN Manager — Full Redesign

পুরোনো ১৬০০-লাইনের `AnimeSaltManagerSection` সম্পূর্ণ বাদ দিয়ে নতুন একটা lean, professional manager বানাবো যেটা শুধু API দিয়ে চলবে। ভিডিও URL Firebase-এ কখনো store হবে না — শুধু slug + TMDB metadata save হবে।

## ফাইল কাঠামো

নতুন ফাইল: `src/components/admin/AnManager.tsx` — সব logic এখানে আসবে (Admin.tsx থেকে inline বাদ)।

Admin.tsx-এ পুরোনো `AnimeSaltManagerSection` ফাংশন আর তার call পুরোপুরি delete করে নতুন `<AnManager />` mount করবো।

## ফিচার (top → bottom)

```text
┌─ AnimeSalt Manager ──────────────────────────────────────┐
│  [AN ON/OFF toggle]   [ Image Refresh ↻ ]   [ Reload ⟳ ] │
│                                                          │
│  Stats:  Total in API: 320   Selected: 47   Series/Movie │
│                                                          │
│  Bulk:  [ ✓ Select All ] [ ✗ Clear ]                     │
│         [ ➕ Add All Selected ] [ 🗑 Delete All Saved ]   │
│                                                          │
│  Category dropdown ▾   🔍 Search…   Filter: All|Saved    │
│                                                          │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐             │
│  │ poster │ │ poster │ │ poster │ │ poster │  ← grid     │
│  │ title  │ │ title  │ │ title  │ │ title  │             │
│  │[✓ Add] │ │[ Edit ]│ │[ Add  ]│ │[Delete]│             │
│  └────────┘ └────────┘ └────────┘ └────────┘             │
└──────────────────────────────────────────────────────────┘
```

### Behaviour
- **Load on mount**: `animeSaltApi.browseAll()` → all series + movies as cards (cached 30 min in localStorage).
- **Add All**: bulk-saves the currently filtered/selected slugs to `animesaltSelected/{slug}` with TMDB-enriched metadata (title, poster, backdrop, rating, year, genres, overview) — **no video URLs**.
- **Delete All**: clears entire `animesaltSelected` node.
- **Select All / Clear**: toggles checkbox state for visible cards.
- **Per-card Add**: TMDB lookup by title → save 1 slug.
- **Per-card Delete**: removes from `animesaltSelected/{slug}`.
- **Per-card Edit**: modal to override title / poster / backdrop / rating / overview / category.
- **AN ON/OFF**: writes `settings/animeSaltEnabled` (already read by user panel).
- **Image Refresh**: clears `rs_img_seen_v1` + `caches.delete('rs-img-v1')` and force-reloads `<img>`s.
- **Reload**: clears `rs_cache_animesalt_api_cards_v2` and re-calls `browseAll()`.

### TMDB enrichment
- Auto-search by title (clean Season N from query).
- If exactly 1 result → save automatically.
- If multiple → small picker (top 5 posters) before save.
- Stores only metadata: `tmdbId`, `rating`, `genres`, `posterTmdb`, `backdrop`, `overview`, `year`.

### User panel behaviour (no change needed)
- `useSelectedAnimeSalt` already merges API list + filters by `animesaltSelected` slugs.
- `Index.tsx` already reads `settings/animeSaltEnabled`.
- Playback already pulls URLs live via `animeSaltApi.getEpisode/getMovie`.

## Removed (old code)
- 1596-line inline `AnimeSaltManagerSection` from `Admin.tsx` (lines ~10789–12380).
- Episode preloader UI (URLs never stored anyway).
- URL import section (not needed — browseAll covers all).
- Inline TMDB modal duplication (moved to new component).

## Out of scope
- No changes to `an-api` edge function.
- No changes to `SaltPlayer.tsx` / `Index.tsx` playback path.
- No legacy migration — old `animesaltSelected` rows remain compatible.

বানিয়ে দেবো এই plan অনুযায়ী?
