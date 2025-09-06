import { findCompletedComps } from "@/lib/ebay";
import { okJSON, okEmpty, corsHeaders } from "../../_cors";
export const runtime = "nodejs";
function ensureEnv(name: string){ const v = process.env[name]; if(!v) throw new Error(`Missing env: ${name}`); return v; }
export async function OPTIONS(){ return okEmpty(); }
export async function POST(req: Request){
  try{
    const { query, isNewOcrText = false } = await req.json();
    if(!query){ return new Response(JSON.stringify({ error: "query required" }), { status: 400, headers: { "content-type":"application/json", ...corsHeaders() } }); }
    const appId = ensureEnv("EBAY_APP_ID");
    const data = await findCompletedComps(query, appId, isNewOcrText);
    return okJSON(data);
  }catch(e:any){
    console.error('eBay API error:', e);
    
    // Handle rate limiting errors specifically
    if (e.name === 'EbayApiError' && e.status === 429) {
      const retryAfter = e.retryAfter || 60;
      return new Response(JSON.stringify({ 
        error: "Rate limit exceeded. Please try again later.",
        retryAfter: retryAfter,
        isRateLimited: true
      }), { 
        status: 429, 
        headers: { 
          "content-type":"application/json", 
          "Retry-After": retryAfter.toString(),
          ...corsHeaders() 
        } 
      });
    }
    
    return new Response(JSON.stringify({ 
      error: e?.message || "Failed to fetch eBay data",
      isRateLimited: e.name === 'EbayApiError' && e.status === 429
    }), { 
      status: e.status || 500, 
      headers: { "content-type":"application/json", ...corsHeaders() } 
    });
  }
}