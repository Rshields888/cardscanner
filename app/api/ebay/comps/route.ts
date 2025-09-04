import { findCompletedComps } from "@/lib/ebay";
import { okJSON, okEmpty, corsHeaders } from "../../_cors";
export const runtime = "nodejs";
let __lastAt = 0;
function __rateGate(){
  const now = Date.now();
  if(now - __lastAt < 300){
    return new Response(JSON.stringify({ error: "Backoff: RATE_LIMIT" }), { status: 429, headers: { "content-type":"application/json", ...corsHeaders() } });
  }
  __lastAt = now;
  return null;
}
  __lastAt = now;
  return null;
}
function ensureEnv(name: string){ const v = process.env[name]; if(!v) throw new Error(`Missing env: ${name}`); return v; }
export async function OPTIONS(){ return okEmpty(); }
export async function POST(req: Request){
  
  const __g = __rateGate(); if(__g) return __g;
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