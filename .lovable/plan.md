# Profile mobile layout correction plan

## What will be fixed

### 1. Profile identity layout
- Keep the profile picture, name, email, and Premium badge visually aligned as one compact identity row.
- Move the identity content slightly upward without covering the backdrop or frame artwork.
- Place **Edit profile** and **Profile Studio** side by side with equal height, balanced width, and consistent spacing.

### 2. Exact 16:9 backdrop presentation
- Give the uploaded backdrop a stable 16:9 display area instead of the current shallow/cropped strip.
- Fit every uploaded backdrop consistently inside that area, preventing vertical drifting, black gaps, or unintended top-only cropping.
- Keep the back button readable without making it distort or cover the main profile composition.

### 3. Settings and Logout spacing
- Separate the Settings and Logout rows with an even, intentional gap.
- Keep both rows equal in width, height, icon alignment, and corner treatment.

### 4. Responsive checks
- Preserve the corrected composition on the supplied mobile size and on desktop.
- Check long names/emails, Premium badge containment, frame-to-avatar alignment, and page scrolling.

### 5. Final confirmation
- Run type-check, focused tests, and build verification.
- Live-test the complete profile page at mobile and desktop sizes using the real account.
- Capture screenshots of the corrected identity area, 16:9 backdrop, and Settings/Logout rows before reporting completion.

## Technical details (for reference)
- Update the profile identity grid so the avatar and identity text share a predictable row and action buttons use a two-column layout.
- Replace the variable-height cover strip with an aspect-ratio-driven 16:9 media region and consistent image fitting.
- Add explicit profile menu spacing rather than relying on adjacent card margins.
- Do not modify profile purchasing, premium rules, uploads, or unrelated pages.
