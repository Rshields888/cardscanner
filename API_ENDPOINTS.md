# API Endpoints for Chrome Extension

This document describes the API endpoints that are compatible with the Chrome extension.

## Environment Variables Required

- `GOOGLE_PROJECT_ID` - Google Cloud project ID
- `GOOGLE_CLIENT_EMAIL` - Google service account email
- `GOOGLE_PRIVATE_KEY` - Google service account private key (with \n for newlines)
- `EBAY_APP_ID` - eBay application ID for API access

## Endpoints

### 1. `/api/analyze` - Card Image Analysis

**Purpose**: Analyzes card images using Google Vision API and returns structured card identity.

**Method**: `POST`

**Content-Type**: `application/json`

**Request Body**:
```json
{
  "imageDataUrl": "data:image/jpeg;base64,/9j/4AAQ...", // OR
  "imageUrl": "https://example.com/card-image.jpg"
}
```

**Response**:
```json
{
  "identity": {
    "player": "Jacob Wilson",
    "year": "2023",
    "set": "Bowman",
    "card_number": "BDC-121",
    "variant": "RC",
    "grade": "Raw",
    "confidence": 0.75,
    "query": "2023 Bowman Jacob Wilson BDC-121 RC",
    "alt_queries": ["2023 Bowman Jacob Wilson BDC121 RC", "2023 Bowman Jacob Wilson Spotless Spans 121 RC"]
  },
  "history": []
}
```

**Curl Example**:
```bash
curl -X POST https://your-app.vercel.app/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"imageDataUrl": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD..."}'
```

### 2. `/api/ebay/comps` - eBay Pricing Data

**Purpose**: Fetches completed eBay listings for pricing data.

**Method**: `POST`

**Content-Type**: `application/json`

**Request Body**:
```json
{
  "query": "2023 Topps Elly De La Cruz SS-38 RC",
  "alt_queries": ["2023 Topps Elly De La Cruz SS38 RC", "2023 Topps Elly De La Cruz Spotless Spans 38 RC"],
  "grade": "Raw"
}
```

**Response**:
```json
{
  "history": [
    {
      "date": "2024-01-15",
      "price": 25.99,
      "title": "2023 Topps Elly De La Cruz SS-38 RC",
      "url": "https://ebay.com/itm/123456789"
    }
  ],
  "stats": {
    "count": 3,
    "median": 25.99,
    "p10": 22.50,
    "p90": 28.75
  }
}
```

**Curl Example**:
```bash
curl -X POST https://your-app.vercel.app/api/ebay/comps \
  -H "Content-Type: application/json" \
  -d '{"query": "2023 Topps Elly De La Cruz SS-38 RC"}'
```

## CORS Support

Both endpoints support CORS for Chrome extensions:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization`

## Chrome Extension Integration

1. **Capture image** from the current tab
2. **POST to `/api/analyze`** with `imageDataUrl`
3. **Extract `identity.query` and `identity.alt_queries`** from response
4. **POST to `/api/ebay/comps`** with query data
5. **Display results** in overlay

## Error Handling

Both endpoints return appropriate HTTP status codes:
- `400` - Bad Request (missing required fields)
- `413` - Payload Too Large (image too big)
- `500` - Internal Server Error (API failures)

Error responses include:
```json
{
  "error": "Error message description"
}
```
