
# CardScanner Endpoint v2 (Vercel)

Includes:
- `/` static index
- `/api/health` (GET)
- `/api/ebay/deletion` (GET|POST with token validation)

Make sure to set env var in Vercel:
`EBAY_VERIFICATION_TOKEN` = 32–80 chars (same value you enter in eBay).

Then deploy via Vercel "New Project → Import → Upload".
