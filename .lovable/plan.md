# Profile page and Profile Shop completion

## What will change

1. **Fix the current error and unfinished wiring**
   - Resolve the reported mobile-hook TypeScript error and any related build errors.
   - Complete the already-added Profile Shop connection without changing unrelated website behavior.

2. **Use only admin-added frame images**
   - Remove the twenty generated CSS frames and their animations from the profile experience.
   - Load enabled frames from the admin Profile Shop and place the selected transparent PNG above the avatar at a stable, centered size.
   - Keep premium items free; other users can unlock them with the configured coin price.

3. **Add admin-managed profile backgrounds**
   - Load enabled background images from the same shop, show them as a separate collection, and support buy/equip behavior.
   - Display the equipped background across the profile banner without awkward cropping or covering the controls.

4. **Rebuild the admin Profile Shop workflow**
   - Add gallery file selection with automatic image hosting and URL insertion, while preserving manual URL entry.
   - Use a clear add/edit form followed by a saved-item list; saved frames and backgrounds appear immediately in ordered rows/cards.
   - Add explicit Edit, Save, Cancel, visibility, free/paid, price, preview, and delete controls with mobile-safe text and buttons.

5. **Polish the profile layout**
   - Move the back control into a stable top bar.
   - Improve banner/avatar alignment, hierarchy, spacing, and restrained motion while keeping the selected Discord-inspired anime direction.
   - Ensure long names, prices, and button labels do not overflow.

6. **Finish and verify**
   - Complete the admin-reply visibility fix already identified.
   - Check TypeScript/build output and verify the profile and Profile Shop at desktop and mobile sizes in the running website.

## Technical details

- Existing stored customization remains compatible; missing or removed legacy frame IDs fall back to no frame.
- Frame artwork uses `object-fit: contain` and an oversized square overlay around the circular avatar, suitable for transparent ornamental PNGs.
- Background artwork uses responsive cover/position rules with a readable content overlay.
- Coin deduction and ownership remain atomic through the existing profile-shop purchase helper.
