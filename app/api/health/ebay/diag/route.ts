import { NextResponse } from "next/server";
export const runtime = "edge";
function trimSafe(s: string) { return s.replace(/^\uFEFF/, "").trim(); }
function hasNonAscii(s: string) { for (let i=0;i<s.length;i++){ if (s.charCodeAt(i)>0x7f) return true; } return false; }
export async function GET() {
  const idRaw = (process.env.EBAY_CLIENT_ID || process.env.EBAY_APP_ID || "") as string;
  const secretRaw = (process.env.EBAY_CLIENT_SECRET || "") as string;
  const id = trimSafe(idRaw); const secret = trimSafe(secretRaw);
  return NextResponse.json({
    ok: !!id && !!secret,
    idPreview: id ? id.slice(0,12)+"…" : null,
    secretLen: secret.length,
    idHasNonAscii: hasNonAscii(id),
    secretHasNonAscii: hasNonAscii(secret),
    idStartsWithPRD: id.includes("-PRD-"),
  });
}
