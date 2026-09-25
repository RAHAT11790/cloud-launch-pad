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
- [~] Google login: native in-app Google sheet implemented (@capgo/capacitor-social-login + Firebase credential). BLOCKED: owner must add signing SHA-1 848E0CA9D5A050BAE82F028810358A757A23D035 to the Firebase Android app and drop google-services.json into android/app/.
- [x] Hide the phone status/notification bar + navigation bar (true immersive fullscreen).
- [x] Video player: real fullscreen button, no black side borders, auto-rotate to landscape on fullscreen.
- [x] HTTP video servers must play reliably inside the app.
- [x] Swipe gestures must control the phone's real system volume and real screen brightness (not just in-app volume).
- [x] Request + handle runtime permissions: notifications, storage, and audio/volume control, with user allow flow.
- [x] Profile page must have a visible Download button opening the in-app Download Manager.
- [x] Downloads must run natively inside the app — never hand off to Chrome.
- [x] Ongoing download notification with anime backdrop image + live progress (episode X of Y).
- [x] Add a Download button for AN / HLS videos too (currently missing).
- [x] Offline: app opens offline, offline player + downloaded library fully usable, multi-audio track selection.
- [ ] Professional UI polish across player, download manager and offline library.
- [ ] Verify with signed APK install on device + screenshots.

## Website — Premium Episode Lock + Telegram quality (verification in progress)
- [x] Fix root cause: episode/part `lockUntil` was stripped on save/load, so timed locks never reached the user panel.
- [x] Carry the lock map on lightweight home cards so New Release taps can't bypass it.
- [x] Block free users and guests on every playback path until the lock window expires; auto-unlock after.
- [x] Golden "Episode N • Premium Only" badge + glow on locked New Release cards, removed automatically on unlock.
- [x] Telegram post quality now lists only the newly added episode's qualities, ordered 480p → 720p → 1080p → 4K.
- [x] Resolve TS2686 by moving the JSX-free mobile hook from `.tsx` to `.ts`.
- [x] Re-verify the first locked New Episode Release card visually and test guest/free direct entry paths.
- [ ] Verify in-player Next, episode-list, and season-switch lock walls against a real playable title.
- [x] Correct New Release premium state so only the actually locked episode/title gets a Golden card.
- [x] Make current content lock state authoritative so stale release snapshots cannot show false Premium cards.
- [ ] Verify the Golden card on the hosted Lovable Preview (blocked here by Lovable editor sign-in; mobile local Preview verified).
- [x] Fix grouped New Release cards so any newly locked episode (not the oldest episode) activates the Golden card.
- [ ] Verify the grouped Golden card on both the hosted Preview and published domain after publishing the current build.

## Security Day (2026-09-25)
- [x] HTTPS Protection gateway (Lovable Cloud + Cloudflare), in both code managers, per-server field in Video Servers, player wiring. Live-tested: own site 206, foreign site 403, foreign signing 403, tampered 403, real domain not in link.
- [x] Firebase rules phase-1 draft (security/firebase-rules.phase1.draft.json).
- [ ] Move OTP / password reset / redeem / unlock / bKash / coin + premium writes to backend functions (needed before rules go live).
- [ ] Admin Gateway: admin writes via backend with login + PIN check.
- [ ] Move video links out of public catalog into a private node resolved server-side.
- [ ] Owner applies rules in Firebase Console, then live test all flows + Android app.
- [ ] Remove hardcoded PIN/owner data from client, security headers, security scan fixes.
