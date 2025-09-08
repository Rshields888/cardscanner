import { NextResponse } from "next/server";
import { searchActive } from "@/lib/ebay";
export const runtime = "edge";
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "2024 Panini Prizm Caitlin Clark #22";
    const limit = Number(searchParams.get("limit") || 5);
    const categoryId = searchParams.get("categoryId") || process.env.EBAY_CATEGORY_ID || "261328";
    const result = await searchActive({ q, limit, categoryId });
    return NextResponse.json({ ok: true, q, count: result.history?.length || 0, median: result.stats?.median ?? null, sample: result.history?.slice(0,2) || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "browse_failed" }, { status: 200 });
  }
}