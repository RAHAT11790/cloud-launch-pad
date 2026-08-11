# Plan: Professional Series Editor Upgrade

Upgrade the "Series Editor" in the Admin panel with drag-and-drop sorting and a powerful season combination (merging) system.

## User Review Required

> [!IMPORTANT]
> - **Drag and Drop**: Seasons can be reordered by dragging. This order will be saved to the database.
> - **Combination Logic**: Merging seasons will sequentially re-number episodes (e.g., if S1 ends at Ep 12, S2 Ep 1 becomes Ep 13).
> - **Data Persistence**: Changes will be synced to Firebase and will reflect in the user-side video player.

## Proposed Changes

### 1. Dependencies
- Install `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` for high-performance drag-and-drop.

### 2. Admin Panel Upgrade (`src/pages/Admin.tsx`)
- **Drag and Drop Implementation**:
  - Wrap the Season list in `DndContext` and `SortableContext`.
  - Create a `SortableSeasonItem` component with a dedicated drag handle icon (GripVertical).
  - Implement `handleDragEnd` to update the `seasonsData` state and persist to Firebase.
- **Season Combination (Merge) Feature**:
  - Add a **"Combination"** button next to the "JSON Import" button.
  - Implement a Modal/Panel to select multiple seasons for merging.
  - **Logic**:
    - Iterate through selected seasons in their current order.
    - Flat map all episodes into a single list.
    - Re-assign `episodeNumber` sequentially from 1 to N.
    - Create a new combined season and remove the individual merged seasons.
- **UI Enhancements**:
  - Use smooth animations for dragging.
  - Add "Merge" indicator tags.
  - Improve the layout of the season cards for a more "Ultra Professional" look, matching the provided screenshot.

### 3. Core Logic & Persistence
- Update `saveSeries` function to handle the new season order and combined structures.
- Ensure `useSelectedAnimeSalt` and `SaltPlayer` correctly handle the reordered season list.

## Technical Details
- **State Management**: Update `seasonsData` React state and sync with `seriesSeasonsByLanguage` to ensure all language variants stay consistent if applicable.
- **Episode Re-indexing**:
  ```typescript
  let currentEpCount = 0;
  const mergedEpisodes = selectedSeasons.flatMap(s => {
    return s.episodes.map(ep => {
      currentEpCount++;
      return { ...ep, episodeNumber: currentEpCount };
    });
  });
  ```

## Verification Plan
- **Manual Test**: Drag Season 2 above Season 1 in Admin and verify the order changes in the Video Player.
- **Combination Test**: Merge two seasons with 10 episodes each and verify the resulting season has 20 episodes numbered 1-20.
- **Persistence Test**: Refresh the Admin page after changes and verify state is restored from Firebase.
