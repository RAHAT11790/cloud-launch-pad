# Download Manager (Admin + User) — Plan

## 1. Admin panel: new "Download Manager" section
New sidebar button + page with four blocks:

**a) Download sources toggle**
- `Telegram download` on/off
- `Website download` on/off
- Both off -> user sees only "Download not available".

**b) Download mode (per video server)**
- Server list is NOT managed here; it is read live from the existing Video Servers data.
- Each server row gets a mode switch: `HTTP (proxy)` or `HTTPS (direct)`.
- HTTP: current behaviour — proxy path + file renaming + progress overlay.
- HTTPS: no proxy, direct download URL built by stripping the `/watch` segment from the play URL. No renaming (accepted).

**c) Statistics**
- Counters written on every download event: source (telegram / website), day bucket.
- Status bars: today, last 7 days, last 30 days.
- Only totals: number of files / URLs requested and number of Telegram hand-offs. No anime titles, no series breakdown.

**d) UI**
- Same dark admin palette as the rebuilt Premium Users / Telegram Download cards: consistent card, label, field and button atoms, aligned stat tiles, no text/box mismatch.

## 2. User panel: download button behaviour
- Click Download -> chooser sheet:
  - Both enabled: two buttons, `Telegram` and `Website`.
  - One enabled: that single button.
  - None enabled: "Download not available" message only.
- Website path respects the server's HTTP/HTTPS mode (proxy+rename vs direct link).
- Telegram path keeps the existing deep-link builder.
- Each completed action logs one statistics event.

## 3. Technical notes
- Settings stored in Firebase under `settings/downloadManager`: `{ telegram: bool, website: bool, serverModes: { [serverId]: "http" | "https" } }`.
- Stats stored under `stats/downloads/{YYYY-MM-DD}`: `{ telegram, website, total }`, incremented client-side on trigger.
- Direct URL derivation: remove `/watch` (and `/watch/`) from the source URL; validate it is `https://` before offering direct mode.
- Reuse `src/lib/videoDownload.ts` / `downloadManager.ts` for the proxy+rename path; add a direct branch instead of duplicating logic.

## 4. Verification before reporting done
- Build, typecheck, existing tests.
- Live admin check with PIN: toggle each source off/on, switch a server to HTTPS, confirm the user-side chooser reacts (two buttons / one button / "Download not available").
- Live user check: one HTTP download (proxy + rename) and one HTTPS download (direct link).
- Admin panel screenshots attached in the report.
