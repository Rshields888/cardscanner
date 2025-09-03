# Card Scan API (Fixed)
- Adds required `app/layout.tsx` root layout for Next 15.
- Removes invalid `experimental.runtime` from `next.config.js`.
- Pins React 18.2.0 for compatibility.
- Endpoints: `/api/scan` (Vision + eBay Finding), `/api/ebay/comps` (direct), `/api/health`.

## Env
EBAY_APP_ID, GOOGLE_PROJECT_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY
