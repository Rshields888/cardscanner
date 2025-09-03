# Card Scan API (Google Vision + eBay Finding)

## Env Vars (Vercel → Settings → Environment Variables)
- `EBAY_APP_ID` — eBay Production App ID (Client ID)
- `GOOGLE_PROJECT_ID`
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY` — paste exactly; Vercel will treat newlines as literal so keep `\n` sequences—code replaces them

## Endpoints
- `POST /api/scan` — form-data `image`: uses Google Vision OCR to build a search query, then calls eBay Finding `findCompletedItems` for SOLD comps. Returns `{ title, comps, ocrText }`.
- `POST /api/ebay/comps` — JSON `{ query }`: direct sold comps via Finding API.
- `GET /api/health` — sanity check.

## Notes
- The OCR heuristic is intentionally simple; we can tune player/brand parsing or add a fallback keyword list per sport.
- For grading (PSA/BGS/SGC) we currently just add a `graded` flag; you can refine this to exact grade when clearly detected.
