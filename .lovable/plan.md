## Plan

1. Fix the Adsterra rendering pipeline
- Replace the current bottom-fixed iframe strategy with a player-scoped ad slot system so ads stay inside the player and never float over the episode list.
- Make the ad loader parse and mount the saved Adsterra snippets more safely, refresh them on the exact admin-set interval, and fully tear them down/recreate them on each refresh cycle.
- Ensure config changes are read live while the player is open so updated script snippets and refresh timing apply immediately.
- Keep popunder/social ad behavior isolated to the player, but avoid blank transparent layers intercepting clicks when an ad fails to render.

2. Fix the blocked episode buttons
- Remove the click-blocking layer affecting episodes 10–12 by eliminating any invisible fixed overlay sitting above the lower part of the screen.
- Audit player z-index and pointer-events so only visible interactive UI can capture taps.
- Re-test the exact lower episode rows from your screenshot to confirm switching works consistently.

3. Redesign the download flow into one button
- Remove the separate “Download All Episodes” button completely.
- Keep one fixed-size download button that opens a compact picker panel/modal.
- In that panel, show:
  - season tabs (Season 1 / Season 2 / etc.)
  - a scrollable episode list/grid
  - manual multi-select for any episodes the user wants
  - an “All” toggle to select all episodes in the current season
  - quality selection after episode selection
- For single-episode items, keep the same button but simplify the picker automatically.

4. Wire the new download logic cleanly
- Rework the current bulk-download logic so it uses the selected episodes from the picker instead of forcing full-season download.
- Preserve the existing download quality handling and serial queueing, but only for the episodes the user selected.
- Keep filenames and quality mapping stable so downloads remain organized.

5. Validate end-to-end
- Verify Adsterra slots actually mount and refresh at the admin-set interval.
- Verify no ad container overlaps the episode grid anymore.
- Verify episode switching works on the lower rows.
- Verify the new single-button download flow works for season-based series and for specific episode selection.

## Technical details
- Main files likely involved:
  - `src/lib/adsterraAds.ts`
  - `src/components/AdsterraAdManager.tsx`
  - `src/components/admin/AdsterraConfig.tsx`
  - `src/components/VideoPlayer.tsx`
- Most likely current blocker: the existing Adsterra social iframe is viewport-fixed with a very high z-index, so even when it looks invisible/empty it can sit on top of the lower episode area and swallow taps.
- The download UI will be refactored from “single episode + separate all episodes button” into “single launcher button + internal selector panel”, without changing unrelated player behavior.