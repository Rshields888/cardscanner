# Card Scanner API (Full Package)
- Vision OCR + eBay Finding (sold comps)
- CORS helpers + OPTIONS handlers
- Next 15 app router with root layout

## Endpoints
- `POST /api/scan` — `multipart/form-data` with `image` (jpeg). Returns `{ title, comps, ocrText }`.
- `POST /api/ebay/comps` — JSON `{ query }`. Returns sold comps directly.
- `GET /api/health` — `{ ok: true }`.

## Env (Vercel → Settings → Environment Variables)
- `EBAY_APP_ID`
- `GOOGLE_PROJECT_ID`
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY`  (keep literal \n in value; code normalizes)

## Notes
- The OCR->query heuristic is simple and tuned for common brands. We can refine per sport later.
