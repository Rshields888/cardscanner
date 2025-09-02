
# CardScanner Vercel Endpoint

This project provides two serverless routes:
- `GET /api/health` — quick health check
- `GET|POST /api/ebay/deletion` — eBay Marketplace Account Deletion webhook (POST validates a verification token)

## Deploy
1. Create a new Vercel project and upload this folder/zip.
2. In Vercel → Project → Settings → Environment Variables, add:
   - `EBAY_VERIFICATION_TOKEN` = your 32–80 character token (must exactly match the one you enter in eBay).
3. Deploy.

## eBay Dashboard
- Endpoint: `https://YOUR-PROJECT.vercel.app/api/ebay/deletion`
- Verification token: (same as `EBAY_VERIFICATION_TOKEN`)

## Test
```bash
curl https://YOUR-PROJECT.vercel.app/api/health

curl -X POST https://YOUR-PROJECT.vercel.app/api/ebay/deletion   -H "Content-Type: application/json"   -H "x-ebay-verification-token: YOUR_TOKEN"   -d '{"type":"ACCOUNT_DELETION","userId":"test"}' -i
```
