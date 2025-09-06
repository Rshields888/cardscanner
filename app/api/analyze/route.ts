import vision from "@google-cloud/vision";
import { okJSON, okEmpty, corsHeaders } from "../_cors";
import { buildSearchQuery, buildAlternativeQueries } from "@/lib/query-builder";

export const runtime = "nodejs";
export const maxDuration = 15;

// Type definitions
type Identity = {
  player: string;
  year: string;
  set: string;
  card_number: string;
  variant: string;
  grade: string;
  confidence: number;
  query: string;
  alt_queries: string[];
};

type HistoryEntry = {
  date: string;
  price: number;
  title: string;
  url: string;
};

type AnalyzeResponse = {
  identity: Identity;
  history: HistoryEntry[];
};

type AnalyzeError = {
  error: string;
};

// Utility functions
function ensureEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set`);
  return v;
}

function normalizePrivateKey(pk: string|undefined): string {
  return pk ? pk.replace(/\n/g, "\n").replace(/\\n/g, "\n") : "";
}

function validateImageSize(base64: string): void {
  // Rough estimate: base64 is ~4/3 the size of binary data
  // 4MB binary ≈ 5.3MB base64
  const maxBase64Size = 5.3 * 1024 * 1024; // 5.3MB
  if (base64.length > maxBase64Size) {
    throw new Error("Image too large (max 4MB)");
  }
}

async function processImageDataUrl(imageDataUrl: string): Promise<string> {
  if (!imageDataUrl.startsWith('data:')) {
    throw new Error("Invalid imageDataUrl format");
  }
  
  const base64Match = imageDataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!base64Match) {
    throw new Error("Invalid base64 data format");
  }
  
  const base64 = base64Match[1];
  validateImageSize(base64);
  return base64;
}

async function processImageUrl(imageUrl: string): Promise<string> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    validateImageSize(base64);
    return base64;
  } catch (error) {
    throw new Error(`Failed to process image URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Reuse OCR logic from /api/scan
function parseCardIdentity(text: string): Identity {
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
  const grade = "Raw";
  
  // Calculate confidence
  let confidence = 0.55; // Base confidence
  if (player && (set || card_number)) {
    confidence = 0.75;
  }
  
  // Build identity object
  const identity = {
    player,
    year,
    set,
    card_number,
    variant,
    grade
  };
  
  // Use shared utilities for query building
  const query = buildSearchQuery(identity);
  const alt_queries = buildAlternativeQueries(identity);
  
  return {
    ...identity,
    confidence,
    query,
    alt_queries
  };
}

// CORS preflight handler
export async function OPTIONS() {
  return okEmpty();
}

// Main analyze endpoint
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { imageDataUrl, imageUrl } = body;
    
    if (!imageDataUrl && !imageUrl) {
      return new Response(
        JSON.stringify({ error: "Either imageDataUrl or imageUrl must be provided" } as AnalyzeError),
        { 
          status: 400, 
          headers: { 
            "content-type": "application/json", 
            ...corsHeaders() 
          } 
        }
      );
    }
    
    // Process image
    let imageBase64: string;
    if (imageDataUrl) {
      imageBase64 = await processImageDataUrl(imageDataUrl);
    } else {
      imageBase64 = await processImageUrl(imageUrl!);
    }
    
    // Call Google Vision API
    const client = new vision.ImageAnnotatorClient({
      projectId: ensureEnv("GOOGLE_PROJECT_ID"),
      credentials: { 
        client_email: ensureEnv("GOOGLE_CLIENT_EMAIL"), 
        private_key: normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY) 
      }
    });

    const image = { content: imageBase64 };
    const [result] = await client.textDetection({ image });
    const text = result?.fullTextAnnotation?.text || "";
    
    const identity = parseCardIdentity(text);
    
    // For now, return empty history (will be populated by /api/ebay/comps)
    const history: HistoryEntry[] = [];
    
    const result: AnalyzeResponse = {
      identity,
      history
    };
    
    return okJSON(result);
    
  } catch (error: any) {
    console.error("Analyze error:", error);
    
    const errorResponse: AnalyzeError = {
      error: error.message || "Analysis failed"
    };
    
    const status = error.message?.includes("too large") ? 413 : 500;
    
    return new Response(
      JSON.stringify(errorResponse),
      { 
        status, 
        headers: { 
          "content-type": "application/json", 
          ...corsHeaders() 
        } 
      }
    );
  }
}

/*
CURL Examples for testing:

# Test with imageDataUrl (base64 data URL):
curl -X POST https://your-app.vercel.app/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"imageDataUrl": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD..."}'

# Test with imageUrl (public image URL):
curl -X POST https://your-app.vercel.app/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/card-image.jpg"}'

# Test CORS preflight:
curl -X OPTIONS https://your-app.vercel.app/api/analyze \
  -H "Origin: chrome-extension://your-extension-id" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type"
*/
