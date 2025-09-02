import crypto from "crypto";

function fullEndpointUrl(req) {
  // Build the absolute URL that eBay called (without querystring),
  // using forwarded headers so hashing matches what eBay expects.
  const proto = (req.headers["x-forwarded-proto"] || "https").toString();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
  // req.url contains path + query; strip query
  const path = (req.url || "").split("?")[0];
  return `${proto}://${host}${path}`;
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export default async function handler(req, res) {
  const method = req.method || "GET";

  // --- Handle the initial verification challenge (GET with challenge_code) ---
  const url = new URL((req.headers["x-forwarded-proto"] || "https") + "://" + (req.headers["x-forwarded-host"] || req.headers.host) + req.url);
  const challengeCode = url.searchParams.get("challenge_code") || (req.body && req.body.challenge_code) || (req.body && req.body.challengeCode) || "";

  if (challengeCode) {
    const verificationToken = process.env.EBAY_VERIFICATION_TOKEN || "";
    if (!verificationToken || verificationToken.length < 32) {
      return res.status(400).json({ ok: false, msg: "server missing EBAY_VERIFICATION_TOKEN (>=32 chars)" });
    }
    const endpoint = process.env.EBAY_ENDPOINT_URL || fullEndpointUrl(req);
    const concat = `${challengeCode}${verificationToken}${endpoint}`;
    const challengeResponse = sha256Hex(concat);
    console.log("[EBAY_CHALLENGE]", { endpoint, challengeCode, challengeResponse });
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({ challengeResponse });
  }

  // --- Normal POST notification flow (after validation) ---
  if (method === "GET") {
    return res.status(200).json({ ok: true, msg: "ebay deletion webhook healthy" });
  }
  if (method !== "POST") {
    return res.status(405).json({ ok: false, msg: "method not allowed" });
  }

  // Optional: verify token if provided (but not required for runtime notifications)
  const provided = (req.headers["x-ebay-verification-token"] || "").toString();
  const expected = (process.env.EBAY_VERIFICATION_TOKEN || "").toString();
  if (expected && provided && provided !== expected) {
    return res.status(400).json({ ok: false, msg: "verification token mismatch" });
  }

  console.log("[EBAY_DELETION_NOTICE]", {
    ts: new Date().toISOString(),
    headers: req.headers,
    body: req.body
  });
  return res.status(200).json({ ok: true, msg: "acknowledged" });
}
