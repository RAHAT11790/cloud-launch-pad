# Roadmap

## Bell, popups, live visitors (2026-10-25)
- [x] Bottom bar is "Go back watch page"; per-episode Telegram buttons + one "All N episodes" button.
- [x] Notification bell beside profile: live New Release notices (deleted/expired releases vanish) + admin messages.
- [x] Admin (New Releases section): normal or one-time popup with title, details, small 3:1 image, expiry; expired rows auto-deleted. Popup verified once-per-device on phone size.
- [x] Admin Users + Dashboard: separate Real/Guest total, online, offline from live `presence` rows (no personal data).
- [ ] Admin panel screens not visually checked in this run (PIN login).

## Approved download and navigation corrections (2026-10-24)
- [x] Add an initial timed wait to every ad step, auto-advance after a completed sponsor visit, and restart on early return; real Naruto flow verified (headless early-return check explicitly dispatched the blur signal).
- [x] Center the ad container between the timer and Continue; real countdown and no-scroll layout verified.
- [x] Limit the unsupported-browser screen to Chrome and Close, with browser/version/IP details; Firefox gate screenshot verified.
- [x] Make Telegram endpoint selections inclusive ranges and add independent episode buttons; 1–12 payload and one-episode payload tests pass, real final-page buttons verified.
- [x] Restore the exact previous page without a Home flash; Naruto player → /series and /download → original watch URL verified without page errors.
- [ ] Verify actual paid ad image centering — provider delivered no creative during live checks.
- [ ] Verify Telegram bot sends all requested files — requires active bot delivery outside the browser; payload and UI verified only.

## Stability and guest privacy (approved 2026-10-23)
- [x] Fix download warning loading flash, unavailable-service guidance, exact ad step count and no-ad fallback.
- [x] Fix repeat card clicks, stale resume episode links and stale application data.
- [x] Keep guest personal data local; retain only minimal guest registry/count in Firebase.
- [x] Add safe legacy guest cleanup in batches of 50 with fresh explicit-marker checks; production deletion intentionally not executed.
- [x] Run 106 regression tests and real Naruto mobile download checks: 2 configured steps, real sizes and named MKV download. Paid advertiser fill and premium-account checks remain externally unverified.

## Download corrections (2026-10-23)
- [x] Restore original selection with free episodes initially unselected; keep premium direct dispatch with filename relay.
- [x] Remove free quality locks and recover stored resolutions; final Telegram action respects its existing enabled setting (currently off).
- [x] Compact no-scroll ad steps and sponsor-return reset; final document contains zero ad frames. Provider scripts still return empty responses.
- [x] Verify real Naruto final sizes and named download; 96 tests pass. Premium live verification blocked by test-account access state; production Worker URL awaits owner.

## Download-only advertising flow (2026-10-22)
- [x] Add configurable episode limit, timed ad stages and download-only placement settings.
- [x] Build mobile download stages and an ad-free final quality/size list with independent blocker checks.
- [x] Register filename relay in both libraries and router; verify hosted default and save placement settings through admin.
- [x] Run rule tests and real mobile flow, download-start and screenshot checks (Naruto E1/E2: 212.3/212.9 MB, named MKV download started; intentionally cancelled rather than transfer entire file).
- [ ] Switch file-rename Router row to production Cloudflare — waits for owner's separate Worker deployment URL.
- [ ] Verify all paid ad creatives and full-file/resume download on production — advertiser delivery intermittent here; production Worker not deployed by owner yet. Range pass-through tested locally; final page has zero ad frames.

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

## Android app — removed (2026-10-01)
- [x] All Android/native app code, files and packages deleted; website only.

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

## Direct Link (replaces Abyss)
- [x] Remove Abyss fully (server code, router row, both managers, player, empty DB fields).
- [x] Direct Link field in Series/Movie editors; "Direct Server" in player when both links exist.
- [ ] Movie editor screenshot + real in-player playback proof on a real phone/Chrome (sandbox browser can't decode H.264).

## Master fix (2026-10-01)
- [x] Abyss episode switch never shows the previous episode; in-player "Episode loading…" loader; 2h link cache.
- [x] Episode strip stays on the selected episode.
- [x] Telegram downloader shows only real qualities/episodes.
- [x] Editor Telegram/Direct Link switch redesigned.
- [x] Home cards update episode count live.
- [x] Profile app download buttons removed; junk files removed.

## Player tracks + slider polish (2026-10-07)
- [x] Episode slider: edge episodes stay in place, middle ones glide to centre, selected chip no longer clipped.
- [x] Search cards: RS badge sized to its text.
- [x] CC panel opens under the CC button; separate Audio button before Next.
- [x] Track detection sniffs real file type (".mp4" MKVs, ".mkv" MP4s); MP4 track list.
- [x] Subtitles with original audio load without restarting playback (works with E-AC3 files too); dialogue tracks listed before signs.
- [x] Live-tested Naruto Shippuden, Tokyo Ghoul, Days with My Stepsister, Akame ga Kill, First Dragon; screenshots in test-shots/v4.

## Audio/lang + admin fixes (2026-10-08)
- [x] Faster language switch (header pre-read, shorter buffer wait).
- [x] Player language sheet lists both editor languages and in-file languages.
- [x] Series/Movie domain replacer no longer clears itself.
- [x] Telegram post: "Multi Audio" shortcut button.
- [ ] Tomb Raider King Ep 11: file server refuses to send the file (re-upload needed); routed video-proxy project unreachable — user to check.

## Profile video + frame instant load (2026-10-10)
- [x] Root cause: site-wide "stop playback" sweeps emptied the profile video; fixed + self-healing watchdog.
- [x] Stored videos download over HTTPS (not the realtime socket), decoded natively; frames no longer wait 5s.
- [x] First paint shows saved frame + video's own first frame (no default image); admin uploads auto-make a poster.
- [x] Service worker no longer wipes the video cache on updates.
- [x] Live-tested with the real account: reopen, in-app return, browser restart, 30s loop, slowed CPU.

## Subtitles, category animation, combo episodes (2026-10-11)
- [x] Real subtitle names (language + Signs) from a one-time shared scan; Indic-friendly caption fonts; CC panel fits on phones.
- [x] Moving emoji + letter animation on top pills, every lower rail title and New Episode Release.
- [x] Combo episodes: New Release taps, share links/cards (`?ep=42`), share title and both Telegram bots count every episode.

## Smooth pages + view + Hindi default (2026-10-13)
- [x] Bottom-menu page change slides smoothly (no jump/flash), far pages don't load the middle ones.
- [x] Profile opens with the same motion as the other four pages; other routes fade in smoothly.
- [x] View count: one view per device per series per 24h after ~20s of watching.
- [x] Hindi is the default language whenever a title has Hindi (editor or in-file).
- [x] Episode-list language button also lists the in-file Hindi track.
- [x] Phone-size live checks + screenshots, tests.

## Uploaded standalone HTML player (2026-10-18)
- [x] Match centered play/pause, ten-second side skips, fit/fill, lock, audio/CC/speed panels and official app logos; preserve template variables.
- [x] Verify panel opening/closing, speed, text size, lock, responsive containment and logo rendering in a browser.
- [ ] Verify actual playback, audio switching, skips and external-app launch — source video host refuses sandbox connections; Android app launch requires a real Android device.

## Season editor + ads (2026-10-21)
- [x] Seasons header: one 4-button tool row; compact collapsible full-series premium lock.
- [x] Merge renumbers as one list (no double counters); range split keeps order across per-season numbering.
- [x] Ads: popunder favoured 2:1 over smartlink; analytics no longer flags popunder/smartlink "0 clicks".
- [x] Supplied Social Bar + 160×300 banner stored only in Download controller; non-download ad settings unchanged. Native Banner not supplied.

## Download page polish (2026-10-23)
- [x] Free users: Download opens the episode selector directly; rows show "All Quality Free Download". Premium keeps Telegram/Website choice.
- [x] Ad steps: timer ring + clear 5-second instructions; Continue visible without scrolling.
- [x] Final page: green quality buttons (quality, size, type), no big episode title; first tap on each button opens a sponsor, next tap downloads.
- [x] Telegram button with official logo fixed in a bottom bar.

## Download flow glitch fix + Get Link screen (2026-10-23)
- [x] Removed the 1.5s no-focus auto-advance that flipped pages 4-5 times by itself; steps now advance only on a real sponsor return.
- [x] Last step no longer reloads straight to links: a "Your links are ready!" screen with a Get Link button appears first; Get Link redirects to the final download page.
- [x] Last-step button reads "Get Link"; early sponsor return still restarts the step timer without penalty.
- [x] Live mobile test on real Naruto: Step 1 Continue → sponsor → Step 2 Get Link → sponsor → ready screen → Get Link → final links (1080P FHD, real sizes, Telegram bar). 11 download tests + build pass.

## Chrome gate, per-count ad steps, popup, no-spinner back (2026-10-25)
- [x] Chrome-only now instant and catches Chrome-lookalike browsers (Booyah etc.); admin panel open in any browser (Telegram mini app).
- [x] Ad steps per selected-episode count + optional "All episodes" box; selector shows ad step count; no daily limit.
- [x] Download page ad codes moved to Ad Manager; Download Manager keeps only download rules.
- [x] After each countdown an instruction popup appears; only its cross closes it.
- [x] Back from download/player shows no loading spinner; download page Back returns to the previous page directly.

## Separate Continue timer, Notifications menu, player Back (2026-10-26)
- [x] Continue button timer is its own admin field (default 10s), separate from step timers; tested 7s vs 10s step, early return restarts, full wait advances.
- [x] Admin menu has its own "Notifications" page with Normal/Popup messages; test popup reached a visitor and was deleted.
- [x] Player Back no longer leaves a blank screen before Home (slowed-phone test: player → Home with no gap).

## Stuck Continue step, popup image shape, smoothness, DM redesign, real counter (2026-10-26)
- [x] Sponsor visit judged by real clock time and survives reloads; normal, early, reload, 30s-wait and tab-switch runs all reach "Your links are ready!".
- [x] Popup/bell image: upload first, then pick 3:1, 16:9, 1:1 or 9:16; box follows the chosen shape.
- [x] Tab switching / player close smoother: no whole-page restyle on navigation, hidden tabs paused, cards skip re-render (about 2x fewer dropped frames on a slowed phone).
- [x] Download Manager redesigned into clean grouped cards.
- [x] Dashboard real-user counter loads (no more permanent zero).
