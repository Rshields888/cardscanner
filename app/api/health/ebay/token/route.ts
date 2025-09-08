import { NextResponse } from "next/server";
import { getAppToken } from "@/lib/ebay";
export const runtime = "edge";
export async function GET() {
  try {
    const token = await getAppToken();
    return NextResponse.json({ ok: true, tokenPreview: token.slice(0,12) + "…" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "token_failed" }, { status: 200 });
  }
}
