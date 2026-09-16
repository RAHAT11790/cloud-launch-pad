# Admin-managed profile collectibles

## What will change

1. **Fix the current TypeScript error**
   - Correct the mobile hook/module issue reported by the build.
   - Resolve any directly related profile integration errors.

2. **Connect Profile Shop to the user profile**
   - Subscribe to the frames and backgrounds saved from the admin panel.
   - Show only enabled admin items; remove the generated placeholder frame collection from the user-facing shop.
   - Gracefully show no equipped frame when an old or deleted frame ID is stored.

3. **Frame and background ownership**
   - Mark an item available when it is already owned, free, or the user has premium access.
   - Let other users purchase items with coins through the existing atomic purchase helper.
   - Equip the item after a successful purchase and update the visible coin balance immediately.
   - Display clear states for Equipped, Owned/Use, Free, Premium free, price, and insufficient coins.

4. **Correct visual placement**
   - Layer transparent frame PNGs above the avatar with centered `object-fit: contain` sizing.
   - Display the selected background image across the profile identity banner with readable profile details above it.
   - Add Frames and Backgrounds collections to Profile Studio with stable card dimensions and no text overflow.

5. **Verify**
   - Check the build output and TypeScript status.
   - Test the profile page at desktop and mobile sizes, including free/owned/paid display states and equip behavior.
