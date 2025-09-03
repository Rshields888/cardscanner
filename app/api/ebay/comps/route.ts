import { findCompletedComps } from "../../../../lib/ebay";
export const runtime = 'nodejs';

function ensureEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const { query } = await req.json();
    if (!query) {
      return new Response(JSON.stringify({ error: "query required" }), { status: 400 });
    }

    const appId = ensureEnv("EBAY_APP_ID");
    const data = await findCompletedComps(query, appId);

    return new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message || "failed" }),
      { status: 500 }
    );
  }
}
