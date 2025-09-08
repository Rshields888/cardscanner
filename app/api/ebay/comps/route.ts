import { NextResponse } from "next/server";
import { searchActive } from "@/lib/ebay";
import { buildQuery, altQueries } from "@/lib/query-builder";

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const identity = body?.identity ?? null;
    const limit = Number(body?.limit ?? 30);
    const categoryId = body?.categoryId || process.env.EBAY_CATEGORY_ID || "261328";

    let query: string = body?.query || (identity ? buildQuery(identity) : "");
    const alts: string[] = body?.alt_queries || (identity ? altQueries(identity) : []);

    // primary search
    let result = await searchActive({ q: query, limit, categoryId });

    // try alternates if sparse
    if ((result.history?.length || 0) < 5 && alts.length) {
      for (const q2 of alts) {
        if (!q2 || q2 === query) continue;
        const r2 = await searchActive({ q: q2, limit, categoryId });
        if ((r2.history?.length || 0) >= 5) { result = r2; break; }
        if ((r2.history?.length || 0) > (result.history?.length || 0)) result = r2;
      }
    }

    // same shape the extension expects
    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { history: [], stats: { median: null }, note: e?.message || "browse_failed" },
      { status: 200 }
    );
  }
}