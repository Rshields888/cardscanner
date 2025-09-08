import { NextResponse } from "next/server";
import { searchActive } from "@/lib/ebay";
import { buildQuery, altQueries } from "@/lib/query-builder";
export const runtime = "edge";

export async function POST(req: Request) {
  const rid = Math.random().toString(36).slice(2, 8);
  try {
    const body = await req.json();
    const debug = !!body?.debug;

    const identity = body?.identity ?? null;
    const limit = Number(body?.limit ?? 30);
    const categoryId = body?.categoryId || process.env.EBAY_CATEGORY_ID || "261328";

    let query: string = body?.query || (identity ? buildQuery(identity) : "");
    const alts: string[] = body?.alt_queries || (identity ? altQueries(identity) : []);

    console.log(`[ebay:${rid}] primary q=`, query);

    let result = await searchActive({ q: query, limit, categoryId });
    let used = { which: "primary", q: query, count: result.history?.length || 0, median: result.stats?.median ?? null };

    // try alternates if sparse
    if (used.count < 5 && alts.length) {
      for (const q2 of alts) {
        if (!q2 || q2 === query) continue;
        console.log(`[ebay:${rid}] try alt q=`, q2);
        const r2 = await searchActive({ q: q2, limit, categoryId });
        if ((r2.history?.length || 0) > used.count) {
          result = r2;
          used = { which: "alt", q: q2, count: r2.history?.length || 0, median: r2.stats?.median ?? null };
          if (used.count >= 5) break;
        }
      }
    }

    // final fallback: drop category filter entirely
    if (used.count < 3) {
      const r3 = await searchActive({ q: used.q, limit, categoryId: "" });
      if ((r3.history?.length || 0) > used.count) {
        result = r3;
        used = { which: used.which + "+nocat", q: used.q, count: r3.history?.length || 0, median: r3.stats?.median ?? null };
      }
    }

    console.log(`[ebay:${rid}] used=${used.which} count=${used.count} median=${used.median}`);

    return NextResponse.json(debug ? { ...result, debug: { rid, used } } : result, { status: 200 });
  } catch (e: any) {
    console.log(`[ebay:${rid}] ERROR`, e?.message);
    return NextResponse.json(
      { history: [], stats: { median: null }, note: e?.message || "browse_failed", debug: { rid } },
      { status: 200 }
    );
  }
}