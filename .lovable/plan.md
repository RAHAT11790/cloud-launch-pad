# RS ANIME03 — Android User-Panel App (Capacitor)

Play Store-ready native Android app of the existing site, user panel only, no admin files, no guest access.

## 1. App shell
- Capacitor native wrapper (Android), appName `RS ANIME03`, existing site logo as launcher icon + splash.
- Bundled offline-capable build: app assets ship inside the APK, so the app keeps opening even if the domain breaks. Data/API calls go to the backend when online; cached data shows when offline.
- No live-reload/preview URL dependency in the release build.
- Strong image + data cache (same behaviour as the website) so posters load instantly after first view.

## 2. Login gate (no guest)
- First screen on every cold start = Login page.
- "Continue as guest" removed entirely in the Android build; all guest-only paths disabled.
- Email/password + Google sign-in working natively (native OAuth redirect back into the app).
- Nothing else in the app is reachable before sign-in.

## 3. Video player (no proxy)
- RS videos: direct HTTP/HTTPS playback natively — cleartext allowed, no proxy hop.
- AN/HLS keeps only the playback proxy it genuinely needs for HLS.
- Same UI, gestures and controls as the website player.

## 4. Download system
- Download button/entry inside Profile page → Download Manager screen.
- Direct download from source (HTTP or HTTPS), native auto-rename, no proxy.
- Queue: multiple selections download one-by-one in order.
- Top system notification while downloading: anime poster thumbnail, title, episode progress ("Ep 3 of 12") and a progress bar.
- HLS/AN download support: segments merged into a playable offline file, keeping multiple audio tracks.

## 5. Download Manager UI
- One card/holder per anime with its poster and episode count.
- Tap a holder → full episode list of that anime (downloaded + in-progress with live progress).
- Offline player identical to the online player, with the remaining episode list below the video — except no server switcher (not needed offline).
- Offline HLS player exposes an audio-track selector for multi-audio files.

## 6. Quality bar
- Professional dark UI polish on every new screen, matching the site's visual language.
- Clean build (no errors), typecheck, tests, and live preview checks with screenshots: HTTP direct play, AN play, queued downloads, notification progress, Download Manager progress, offline playback.
- Final signed-style APK delivered directly in chat (not inside a folder).

## Technical notes
- Capacitor + plugins for filesystem, local notifications, background download queue, native Google auth.
- `usesCleartextTraffic` enabled for direct HTTP media.
- Download queue state persisted locally so progress survives app restart.
- Admin panel code excluded from the Android bundle (routes/components stripped from this build).
