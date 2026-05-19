---
name: Route-based pages
description: /search and /notifications are real routes — Index navigates to them, no overlay rendering
type: feature
---
**Routes that replaced overlays** (use `navigate()`, never setState):
- `/search` → `src/pages/SearchPageRoute.tsx` wraps `SearchPage` component. Loads anime via `useFirebaseData` + `useSelectedAnimeSalt`. Result click → `navigate('/?anime=ID')`.
- `/notifications` → `src/pages/NotificationsPage.tsx`. Item with `contentId` → `navigate('/?anime=ID')`.

`NotificationPanel` is now bell-only (badge + click → `navigate('/notifications')`). No full-page mode inside the panel.

`Header.onSearchClick` in `Index.tsx` → `navigate('/search')`. The `showSearch` state still exists in Index but is never set to true (dead branch retained for sessionStorage layer-restore back-compat; will overwrite on next nav).

AnimeDetails (`/anime/:id`) and Watch (`/watch/:id`) routes are NOT yet built — still rendered as overlays inside Index. Pending future work.
