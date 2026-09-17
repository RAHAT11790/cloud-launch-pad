# Telegram, RS playback, and Search indexing fixes

## What will change

1. **Telegram download handoff**
   - Replace the oversized deep-link payload with a compact request token that stays within Telegram's limit.
   - Store the selected title, season, episodes, and qualities behind that token, then let the bot retrieve and process it from `/start`.
   - Add the matching `/start` payload handler to the active bot implementation and preserve the normal welcome response.
   - Remove the visible link preview and keep one **Go to Telegram** button.
   - Account for Telegram's mandatory first-contact consent: Telegram itself requires a user to press **Start** the first time; after that the bot will receive the request and reply correctly.

2. **RS server repair only**
   - Trace RS URL domain replacement, per-server proxy selection, failure switching, and Range requests.
   - Fix RS-specific broken paths and stalls without changing HLS/AN behavior or introducing cross-server URL mirroring.
   - Validate representative direct HTTPS and proxied HTTP RS URLs where available.

3. **Google indexing fixes**
   - Apply the remaining concrete items from the uploaded audit: accurate metadata, route-aware canonical/indexing rules, valid robots directives, and a clean sitemap containing only public canonical pages.
   - Keep private/admin/account-like pages out of indexing.

## Technical details

- Telegram deep-link payloads are restricted to 64 characters and a limited character set. A short opaque token avoids title-length failures and keeps request details out of the visible URL.
- The request record will expire and be readable only for the bot handoff flow.
- Existing HLS detection, HLS buffering, and AN paths remain untouched.
- Verification includes URL/token unit tests, bot payload tests, production build status, and mobile browser flow checks.
