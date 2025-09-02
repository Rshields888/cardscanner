
# CardScanner Endpoint – Challenge Handshake Ready

Endpoints:
- `/api/health` — GET
- `/api/ebay/deletion` — GET (health), **GET with `challenge_code`** (responds with computed `challengeResponse`), POST (acknowledge notifications).

## Required Env Vars (Vercel → Project → Settings → Environment Variables)
- `EBAY_VERIFICATION_TOKEN` — 32–80 chars (letters, digits, `_`, `-`).
- (Optional) `EBAY_ENDPOINT_URL` — set to your exact URL `https://YOUR-PROJECT.vercel.app/api/ebay/deletion`.
  If not set, the code reconstructs the URL from `x-forwarded-proto` + `x-forwarded-host` + path.

## How the challenge works (from eBay docs)
When you click **Save** in the eBay dashboard, eBay calls:
```
GET https://<your-endpoint>?challenge_code=ABC...
```
You must reply:
```
200 OK
Content-Type: application/json

{ "challengeResponse": SHA256( challenge_code + verification_token + endpoint_url ) }
```
This project implements that exactly.

## Test locally (after deploy)
- Health: `https://YOUR-PROJECT.vercel.app/api/health`
- Challenge simulate:
  `https://YOUR-PROJECT.vercel.app/api/ebay/deletion?challenge_code=hello`
  (Response body will include the `challengeResponse` hash)
- POST simulate:
```bash
curl -X POST https://YOUR-PROJECT.vercel.app/api/ebay/deletion   -H "Content-Type: application/json"   -H "x-ebay-verification-token: YOUR_TOKEN"   -d '{"type":"ACCOUNT_DELETION","userId":"test"}'
```
