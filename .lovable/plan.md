# Web Series Season Management Upgrade

## Goals
- Implement **Drag-and-Drop Reordering** for seasons in the Web Series editor.
- Add a **Season Combination (Merge)** feature to merge multiple seasons into a single sequential season with auto-reindexing of episode numbers.
- Ensure the reordering reflects correctly in the video player's season list.

## Implementation Plan

### 1. Drag-and-Drop Season Reordering
- Utilize `@dnd-kit` (already installed) to make the season list sortable.
- The `seasonsData` state will be updated when a drag-and-drop operation completes.
- Ensure `SortableSeasonItem` handles the drag handle correctly.

### 2. Season Combination (Merge) Feature
- Add a "Merge Seasons" UI to the Web Series editor.
- Allow users to select multiple seasons to merge.
- Logic:
  - The first selected season retains its episode numbering (e.g., 1-12).
  - The second selected season's episodes start after the first (e.g., 13-24).
  - The process continues for all selected seasons.
  - The original seasons are removed and replaced by the merged one.

### 3. Structural Integrity & UI Consistency
- Maintain the current 13,000+ line structure of `src/pages/Admin.tsx`.
- Ensure all other sections (Movies, Analytics, etc.) remain functional.
- Use the existing `glassCard`, `inputClass`, `btnPrimary`, and `btnSecondary` styles for the new UI components.

## Technical Details
- **Component**: `src/pages/Admin.tsx`
- **State**: `seasonsData` (array of `Season` objects).
- **Libraries**: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`.
- **Merge Logic**: Sequential `episodeNumber` incrementing across selected seasons.
