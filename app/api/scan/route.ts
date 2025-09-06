import vision from "@google-cloud/vision";
import { findCompletedComps } from "@/lib/ebay";
import { cache } from "@/lib/cache";
import { okJSON, okEmpty, corsHeaders } from "../_cors";
export const runtime = "nodejs";
export const maxDuration = 15;
function ensureEnv(name: string){ const v = process.env[name]; if(!v) throw new Error(`Missing env: ${name}`); return v; }
function normalizePrivateKey(pk: string|undefined){ return pk ? pk.replace(/\n/g, "\n").replace(/\\n/g, "\n") : ""; }
// Card identity type
type CardIdentity = {
  player: string;
  year: string;
  set: string;
  card_number: string;
  variant: string;
  grade: "Raw" | "PSA 10" | "PSA 9" | "SGC 10" | "SGC 9.5" | "SGC 9" | "BGS 10" | "BGS 9.5" | "BGS 9";
  confidence: number;
  query: string;
  alt_queries: string[];
};

function buildQueryFromText(text: string){
  const lower = text.toLowerCase();
  const yearMatch = lower.match(/\b(19|20)\d{2}\b/);
  const brands = ["topps","panini","prizm","mosaic","optic","select","donruss","bowman","chrome","fleer","upper deck","score","prizim"];
  const brand = brands.find(b => lower.includes(b)) || "";
  const numMatch = lower.match(/#\s?([0-9]{1,4}[a-z]?)/) || lower.match(/no\.\s?([0-9]{1,4}[a-z]?)/);
  const nameMatch = (text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}/g) || []).sort((a,b)=>b.length-a.length)[0] || "";
  const flags = []; if(/\b(rc|rookie)\b/i.test(text)) flags.push("RC"); if(/\b(psa\s*10|psa\s*9|bgs|sgc)\b/i.test(text)) flags.push("graded"); if(/\b(silver|holo|refractor)\b/i.test(text)) flags.push("silver");
  const parts = [yearMatch?.[0], brand, nameMatch, (numMatch ? ("#"+numMatch[1]) : ""), ...flags].filter(Boolean);
  const q = parts.join(" ").replace(/\s+/g," ").trim();
  return q || text.split("\n")[0] || "trading card";
}

function parseCardIdentity(text: string): CardIdentity {
  // Extract year
  const yearMatch = text.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : "";
  
  // Detect set names
  const setPatterns = [
    "Topps", "Bowman", "Panini", "Prizm", "Select", "Mosaic", "Donruss", 
    "Chrome", "Allen & Ginter", "Optic", "Fleer", "Upper Deck", "Score"
  ];
  const set = setPatterns.find(setName => 
    text.toLowerCase().includes(setName.toLowerCase())
  ) || "";
  
  // Extract card number with normalization
  const numberPatterns = [
    /#\s*([A-Z]*\s*\d+[A-Z]?)/i,
    /no\.\s*([A-Z]*\s*\d+[A-Z]?)/i,
    /card\s*#?\s*([A-Z]*\s*\d+[A-Z]?)/i,
    /([A-Z]{1,3}\s*\d+[A-Z]?)/i
  ];
  
  let card_number = "";
  for (const pattern of numberPatterns) {
    const match = text.match(pattern);
    if (match) {
      card_number = match[1].trim();
      break;
    }
  }
  
  // Normalize card number variants
  const normalizedNumber = card_number.replace(/\s+/g, "-");
  const compactNumber = card_number.replace(/\s+/g, "");
  
  // Extract player name (look for proper names in text)
  const namePatterns = [
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g,
    /([A-Z][a-z]+\s+[A-Z][a-z]+)/g
  ];
  
  let player = "";
  for (const pattern of namePatterns) {
    const matches = text.match(pattern) || [];
    // Find the longest name that looks like a person
    const candidate = matches
      .filter(name => name.split(' ').length >= 2)
      .sort((a, b) => b.length - a.length)[0];
    if (candidate) {
      player = candidate;
      break;
    }
  }
  
  // Detect variant
  const variantPatterns = [
    { pattern: /\b(rc|rookie)\b/i, variant: "RC" },
    { pattern: /\b(refractor)\b/i, variant: "Refractor" },
    { pattern: /\b(silver)\b/i, variant: "Silver" },
    { pattern: /\b(holo|holofoil)\b/i, variant: "Holo" },
    { pattern: /\b(base)\b/i, variant: "Base" }
  ];
  
  const variant = variantPatterns.find(({ pattern }) => pattern.test(text))?.variant || "";
  
  // Default grade to Raw
  const grade: CardIdentity["grade"] = "Raw";
  
  // Build query
  const queryParts = [year, set, player, card_number].filter(Boolean);
  const query = queryParts.join(" ");
  
  // Generate alternative queries
  const alt_queries: string[] = [];
  
  // Add normalized number variants
  if (card_number && normalizedNumber !== card_number) {
    alt_queries.push(query.replace(card_number, normalizedNumber));
  }
  if (card_number && compactNumber !== card_number) {
    alt_queries.push(query.replace(card_number, compactNumber));
  }
  
  // Add SS expansion for Spotless Spans
  if (card_number.toLowerCase().startsWith('ss')) {
    const ssExpansion = query.replace(card_number, `Spotless Spans ${card_number.substring(2)}`);
    alt_queries.push(ssExpansion);
  }
  
  // Calculate confidence
  let confidence = 0.55; // Base confidence
  if (player && (set || card_number)) {
    confidence = 0.75;
  }
  
  return {
    player,
    year,
    set,
    card_number,
    variant,
    grade,
    confidence,
    query: query || "trading card",
    alt_queries
  };
}
export async function OPTIONS(){ return okEmpty(); }
export async function POST(req: Request){
  try{
    // Validate Chrome extension origin for eBay API calls
    const origin = req.headers.get('origin');
    const isChromeExtension = origin?.startsWith('chrome-extension://') || origin?.startsWith('moz-extension://');
    
    const form = await req.formData();
    const image = form.get("image");
    if(!image || !(image instanceof Blob)){
      return new Response(JSON.stringify({ error: "No image provided" }), { status: 400, headers: { "content-type":"application/json", ...corsHeaders() } });
    }
    const buf = Buffer.from(await (image as Blob).arrayBuffer());
    const client = new vision.ImageAnnotatorClient({
      projectId: ensureEnv("GOOGLE_PROJECT_ID"),
      credentials: { client_email: ensureEnv("GOOGLE_CLIENT_EMAIL"), private_key: normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY) }
    });
    const [result] = await client.textDetection({ image: { content: buf } });
    const text = result?.fullTextAnnotation?.text || "";
    const query = buildQueryFromText(text);
    const cardIdentity = parseCardIdentity(text);
    const manual = String(form.get('manual')||'0') === '1';
    let comps = null;
    let compsError = null;
    
    if (manual && isChromeExtension) {
      // Only call eBay API for Chrome extension requests with manual flag
      // Check if we've already processed this exact OCR text recently
      const isNewOcrText = !cache.hasOcrText(text);
      
      if (isNewOcrText) {
        try {
          // Only call eBay API for truly new OCR text from Chrome extensions
          comps = await findCompletedComps(query, ensureEnv("EBAY_APP_ID"), true);
          // Mark this OCR text as processed
          cache.setOcrText(text);
        } catch (error: any) {
          console.error('eBay API error in scan:', error);
          compsError = {
            message: error?.message || "Failed to fetch eBay data",
            isRateLimited: error.name === 'EbayApiError' && error.status === 429,
            retryAfter: error.retryAfter
          };
        }
      } else {
        // Return cached data for previously processed OCR text
        const cacheKey = `ebay_comps_${query.toLowerCase().replace(/\s+/g, '_')}`;
        comps = cache.get(cacheKey);
        if (!comps) {
          compsError = {
            message: "No cached data available for this previously processed text",
            isRateLimited: false
          };
        }
      }
    } else if (manual && !isChromeExtension) {
      // Reject manual requests from non-extension origins
      return new Response(
        JSON.stringify({ error: "eBay API access restricted to Chrome extensions" }), 
        { status: 403, headers: { "content-type":"application/json", ...corsHeaders() } }
      );
    }
    
    return okJSON({ 
      title: query, 
      comps, 
      compsError,
      ocrText: text?.slice(0,1000) || null,
      identity: cardIdentity
    });
  }catch(e:any){
    return new Response(JSON.stringify({ error: e?.message || "scan failed" }), { status: 500, headers: { "content-type":"application/json", ...corsHeaders() } });
  }
}