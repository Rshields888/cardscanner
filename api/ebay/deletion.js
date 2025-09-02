export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, msg: "ebay deletion webhook healthy" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, msg: "method not allowed" });
  }
  const expected = process.env.EBAY_VERIFICATION_TOKEN || "";
  if (!expected || expected.length < 32) {
    return res.status(400).json({ ok: false, msg: "server missing EBAY_VERIFICATION_TOKEN (>=32 chars)" });
  }
  const tokenFromHeader = req.headers["x-ebay-verification-token"];
  let tokenFromBody = "";
  try {
    if (req.headers["content-type"]?.includes("application/json") && typeof req.body === "object") {
      tokenFromBody = req.body?.verificationToken || req.body?.verification_token || req.body?.metadata?.verificationToken || "";
    }
  } catch {}
  const provided = (tokenFromHeader || tokenFromBody || "").toString();
  if (!provided) return res.status(400).json({ ok: false, msg: "verification token missing" });
  if (provided !== expected) return res.status(400).json({ ok: false, msg: "verification token mismatch" });
  console.log("[EBAY_DELETION_NOTICE]", { ts: new Date().toISOString(), headers: req.headers, body: req.body });
  return res.status(200).json({ ok: true, msg: "acknowledged" });
}