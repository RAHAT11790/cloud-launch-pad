# Roadmap

- [ ] Align profile photo, name, email, and Premium badge into one polished mobile identity row.
- [ ] Place Edit Profile and Profile Studio side by side with equal sizing.
- [ ] Render uploaded profile backdrops in a stable 16:9 area without gaps or vertical drift.
- [ ] Correct Settings and Logout spacing and alignment.
- [ ] Live-test the updated profile on mobile and desktop and capture screenshots.
- [ ] Replace oversized Telegram start payloads with a compact, bot-resolvable request handoff.
- [ ] Handle Telegram `/start` download payloads in the active bot and verify reply flow.
- [ ] Remove the visible Telegram URL preview; keep only the Telegram action button.
- [ ] Diagnose and repair RS server URL/proxy playback without changing HLS behavior.
- [ ] Implement the actionable Google Search Console fixes from the uploaded audit.
- [ ] Run focused tests, build verification, and end-to-end browser checks.
- [x] Redesign Profile with premium fonts/themes and 20 coin-purchasable animated frames.
- [x] Connect Admin Profile Shop frames/backgrounds to the Profile Studio purchase and equip flow.
- [x] Add gallery uploads through ImgBB with editable previews and reliable save states.
- [x] Replace generated frame shapes with uploaded transparent frame artwork and correct avatar placement.
- [x] Fix profile back-button/banner placement and verify admin/profile views on mobile and desktop.
- [x] Align uploaded profile frames precisely with avatar portraits at every size.
- [x] Verify backdrop coverage, remove the top gap, and make profile themes visibly affect all surfaces.
- [x] Fix name-style premium badge overflow and mobile watchlist/history page overflow.
- [x] Validate the complete Profile page on mobile and desktop with the premium test account.

## Admin UI + performance (2026-09-21)
- [x] Premium Users manager UI rebuilt (aligned stat cards, segmented tabs, compact action rows).
- [x] Telegram Download config UI rebuilt (dark admin palette, consistent fields/labels/buttons).
- [x] Admin panel lag reduced: 16 heavy admin sections now code-split with lazy loading.
- [x] Live verified with Admin PIN, screenshots captured, build OK / typecheck clean / 15 tests pass.

- [x] Download Manager: admin page, Telegram/Website toggles, HTTP proxy vs HTTPS direct mode, daily/7d/30d stats, player gating (live verified)

## Android app v2 — real native app, NOT WebView (noted 2026-09-22, work in next chat)
- [x] Signed release APK with a proper keystore so Google/Play Protect stops flagging it as unauthorized/unknown.
- [x] Ship a real native Android app shell: app must keep working even if the domain is banned/deleted (bundled app assets + native APIs, no remote-URL WebView, remove any capacitor server.url).
- [ ] Google login must work inside the app (native/in-app auth), not open Chrome to a blank white page.
- [x] Hide the phone status/notification bar + navigation bar (true immersive fullscreen).
- [x] Video player: real fullscreen button, no black side borders, auto-rotate to landscape on fullscreen.
- [x] HTTP video servers must play reliably inside the app.
- [x] Swipe gestures must control the phone's real system volume and real screen brightness (not just in-app volume).
- [x] Request + handle runtime permissions: notifications, storage, and audio/volume control, with user allow flow.
- [x] Profile page must have a visible Download button opening the in-app Download Manager.
- [x] Downloads must run natively inside the app — never hand off to Chrome.
- [ ] Ongoing download notification with anime backdrop image + live progress (episode X of Y).
- [x] Add a Download button for AN / HLS videos too (currently missing).
- [ ] Offline: app opens offline, offline player + downloaded library fully usable, multi-audio track selection.
- [ ] Professional UI polish across player, download manager and offline library.
- [ ] Verify with signed APK install on device + screenshots.
