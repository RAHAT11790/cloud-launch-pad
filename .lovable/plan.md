# Login page + Profile page full fix plan

## What will be fixed

### 1. Login / Sign Up page
- **Login & Sign Up button text** — clean, professional formatting (no garbled/mixed text).
- **Typing lag on mobile** — remove heavy re-renders on every keystroke (password strength checks, decorative animations, blur effects) so typing email/password feels instant.
- **Color fix** — typed email/password currently appears black-on-black and unreadable; input text will get proper readable colors in both fields, plus matching placeholder, label, and autofill colors.
- Overall visual polish: consistent spacing, readable labels, clear error messages.

### 2. Profile page text & layout
- Fix text formatting and alignment — labels, values and buttons will line up cleanly (no overlapping or misaligned text with buttons).
- Positions of sections, name, stats and action buttons tidied into a consistent grid.

### 3. Backdrop image
- Live-test backdrop images from the shop: full cover of the banner area, no black gap at the top, readable overlay over the image.

### 4. Name styles — more options
- Expand the name-style list with several new professional styles (gradient, gold, neon, outline, glow, fire, ice, rainbow etc.).
- Make sure the "Premium" badge on style previews stays inside the card (no overflow).

### 5. Final confirmation
- Full check: build passes, type-check passes, all 8 Telegram tests pass.
- Live testing on the real accounts (premium user + admin) on mobile and desktop sizes.
- Screenshots shared as proof before reporting done.

## Technical details (for reference)
- `src/pages/Auth.tsx` (or equivalent login component): memoize expensive per-keystroke work, remove backdrop-blur/shadow animations during input focus, set explicit `color` on inputs and `-webkit-autofill` overrides.
- `src/lib/profileCustomization.ts`: add new entries to `PROFILE_FONTS` / name-style list.
- `src/index.css`: new `profile-font-*` style classes; fix `.profile-premium-chip` overflow inside style picker buttons.
- `src/components/ProfilePage.tsx`: text/alignment fixes in identity panel and stats rows.
