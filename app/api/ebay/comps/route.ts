import { findCompletedComps } from "@/lib/ebay";
import { okJSON, okEmpty, corsHeaders } from "../../_cors";
export const runtime = "nodejs";
function ensureEnv(name: string){ const v = process.env[name]; if(!v) throw new Error(`Missing env: ${name}`); return v; }
export async function OPTIONS(){ return okEmpty(); }
export async function POST(req: Request){
  try{
    const { query } = await req.json();
    if(!query){ return new Response(JSON.stringify({ error: "query required" }), { status: 400, headers: { "content-type":"application/json", ...corsHeaders() } }); }
    const appId = ensureEnv("EBAY_APP_ID");
    const data = await findCompletedComps(query, appId);
    return okJSON(data);
  }catch(e:any){
    return new Response(JSON.stringify({ error: e?.message || "failed" }), { status: 500, headers: { "content-type":"application/json", ...corsHeaders() } });
  }
}