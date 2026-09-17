# Profile frame shop completion

## What will change

1. **Fix the current error**
   - Re-check the reported `use-mobile.tsx` TypeScript failure against the current source and remove any stale or conflicting reference that triggers it.
   - Keep the existing mobile behavior unchanged.

2. **Professional Admin Profile Shop**
   - Add a gallery picker for frame PNG/WebP and backdrop images.
   - Upload selected files through the existing ImgBB uploader, show upload progress and a real preview, then fill the saved image URL automatically.
   - Keep URL entry as an alternative, and make existing items fully editable for name, image, price, free/paid, visibility, tier, and display order.
   - Use a compact responsive layout so labels and buttons do not overflow on phones.

3. **Connect admin items to Profile Studio**
   - Subscribe the profile page to the live frame/background shop instead of relying only on the old generated frame list.
   - Show only enabled items, preserve already-owned purchases, and make Premium users receive all items free.
   - Let free users buy/equip frames and backdrops atomically with coins at the admin-set price.

4. **Correct frame and backdrop placement**
   - Render uploaded transparent frame artwork as an overlay centered around the avatar, outside the circular photo crop so wings/crowns are not cut off.
   - Use the same artwork and proportions in the shop preview and equipped profile preview.
   - Render the selected backdrop across the complete profile banner area with a readable content overlay.
   - Reposition the Back control above the profile panel without covering the banner.

5. **Repair comment replies already in scope**
   - Write admin replies in the flat comment format read by the user panel while preserving legacy nested replies.

## Verification

- Run the TypeScript check and focused tests.
- Verify Admin gallery upload, edit/save, free/paid settings, and image previews.
- Verify frame purchase/equip and backdrop selection in Profile Studio.
- Inspect mobile and desktop screenshots to confirm the frame surrounds the avatar without clipping or overlap.
- Confirm the final preview build reports no errors.