## Plan

1. Rework the APK DW section so it is button-first, not URL-form-first.
   - Remove the current large URL input-focused layout from `ApkDownloadCenter`.
   - Keep one simple toggle for the user panel: ON/OFF to show or hide the user-side install/download button.
   - Show a clear admin-side button inside APK DW for downloading/opening the Admin Panel install target.
   - Keep the text minimal and mobile-friendly so it matches the screenshot-style admin UI.

2. Align the user panel with the requested behavior.
   - Keep the user profile download/install button controlled only by the admin ON/OFF switch.
   - Make sure the button label reads like an app install/download action, not a raw APK URL action.
   - Remove extra helper text or technical wording that makes the mobile UI feel cluttered.

3. Replace the current “paste APK URL everywhere” behavior with the intended install flow.
   - Use the existing route-based install setup so Admin Panel and User Panel remain separate install targets.
   - Ensure the admin button opens the Admin Panel install target and the user button opens the User Panel install target.
   - Avoid exposing raw URL management as the primary experience in the APK DW screen.

4. Keep Telegram unlock return behavior intact.
   - Preserve the source-aware return logic already in place so users still return to admin app, user app, or Chrome correctly after unlock.
   - Verify the return path still respects panel context (`/admin` vs `/`).

## Technical details

- Files to update:
  - `src/components/admin/ApkDownloadCenter.tsx`
  - `src/components/ProfilePage.tsx`
  - potentially small supporting tweaks in `src/components/ManifestManager.tsx` if button targets need tightening
- Existing logic already available and will be reused:
  - route-based separate install metadata for `/admin` and `/`
  - user visibility flag at `settings/apk/userEnabled`
  - source-aware Telegram return using panel context
- Main cleanup:
  - de-emphasize or remove raw `userApkUrl` / `adminApkUrl` inputs from the visible APK DW UI
  - present direct buttons and one user ON/OFF switch instead of a URL-management form

## Result

After this update:
- APK DW will show the admin download/install button clearly
- APK DW will show the user panel ON/OFF control clearly
- the user profile will only show the user download/install button when ON
- the UI will stop feeling like a URL settings form and instead match the requested mobile install flow