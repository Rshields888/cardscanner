import { NextResponse } from "next/server";
export const runtime = "edge";
export async function GET() {
  const id = (process.env.EBAY_CLIENT_ID || process.env.EBAY_APP_ID || "").trim();
  const secret = (process.env.EBAY_CLIENT_SECRET || "").trim();
  return NextResponse.json({
    ok: !!id && !!secret,
    idPreview: id ? id.slice(0, 12) + "…" : null,
    secretLen: secret ? secret.length : 0,
    marketplace: process.env.EBAY_MARKETPLACE || null,
    categoryId: process.env.EBAY_CATEGORY_ID || null
  });
}
