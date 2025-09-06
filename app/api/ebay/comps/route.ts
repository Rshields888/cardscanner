import { okJSON, okEmpty, corsHeaders } from "../../_cors";

export const runtime = "nodejs";
export const maxDuration = 15;

// Type definitions
type CompsRequest = {
  query: string;
  alt_queries?: string[];
  grade?: string;
};

type HistoryEntry = {
  date: string;
  price: number;
  title: string;
  url: string;
};

type Stats = {
  count: number;
  median: number;
  p10: number;
  p90: number;
};

type CompsResponse = {
  history: HistoryEntry[];
  stats: Stats;
};

type CompsError = {
  error: string;
};

// Utility functions
function ensureEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set`);
  return v;
}

function normalizeCurrency(price: number, currency: string): number {
  // Simple currency conversion - in production, use a real exchange rate API
  const rates: { [key: string]: number } = {
    'USD': 1.0,
    'CAD': 0.74,
    'EUR': 1.08,
    'GBP': 1.27,
    'AUD': 0.66
  };
  
  return price * (rates[currency] || 1.0);
}

function isJunkListing(title: string): boolean {
  const junkKeywords = [
    'lot', 'bundle', 'repack', 'custom', 'mystery', 'stickers', 
    'box', 'hobby', 'case', 'blaster', 'auction photo'
  ];
  
  const lowerTitle = title.toLowerCase();
  return junkKeywords.some(keyword => lowerTitle.includes(keyword));
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function deduplicateListings(listings: HistoryEntry[]): HistoryEntry[] {
  const seen = new Map<string, HistoryEntry>();
  
  for (const listing of listings) {
    const normalizedTitle = normalizeTitle(listing.title);
    const key = `${normalizedTitle}_${Math.round(listing.price * 2) / 2}`;
    
    if (!seen.has(key) || seen.get(key)!.price > listing.price) {
      seen.set(key, listing);
    }
  }
  
  return Array.from(seen.values());
}

function calculateStats(prices: number[]): Stats {
  if (prices.length === 0) {
    return { count: 0, median: 0, p10: 0, p90: 0 };
  }
  
  const sorted = prices.sort((a, b) => a - b);
  const count = sorted.length;
  
  const median = count % 2 === 0 
    ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
    : sorted[Math.floor(count / 2)];
  
  const p10 = sorted[Math.floor(count * 0.1)];
  const p90 = sorted[Math.floor(count * 0.9)];
  
  return { count, median, p10, p90 };
}

async function searchEbay(query: string, appId: string): Promise<HistoryEntry[]> {
  // Mock eBay API response - replace with real eBay API call
  const mockResults: HistoryEntry[] = [
    {
      date: "2024-01-15",
      price: 25.99,
      title: "2023 Bowman Draft Chrome Jacob Wilson BDC-121 RC",
      url: "https://ebay.com/itm/123456789"
    },
    {
      date: "2024-01-14", 
      price: 22.50,
      title: "2023 Bowman Draft Chrome Jacob Wilson BDC-121 RC",
      url: "https://ebay.com/itm/123456790"
    },
    {
      date: "2024-01-13",
      price: 28.75,
      title: "2023 Bowman Draft Chrome Jacob Wilson BDC-121 RC",
      url: "https://ebay.com/itm/123456791"
    }
  ];
  
  // Filter out junk listings
  const filtered = mockResults.filter(listing => !isJunkListing(listing.title));
  
  // Deduplicate
  return deduplicateListings(filtered);
}

// CORS preflight handler
export async function OPTIONS() {
  return okEmpty();
}

// Main comps endpoint
export async function POST(req: Request) {
  try {
    const body: CompsRequest = await req.json();
    const { query, alt_queries = [], grade } = body;
    
    if (!query) {
      return new Response(
        JSON.stringify({ error: "Query is required" } as CompsError),
        { 
          status: 400, 
          headers: { 
            "content-type": "application/json", 
            ...corsHeaders() 
          } 
        }
      );
    }
    
    // Get eBay app ID
    const appId = ensureEnv("EBAY_APP_ID");
    
    // Search eBay for the main query
    let allListings = await searchEbay(query, appId);
    
    // Search alternative queries if provided
    for (const altQuery of alt_queries) {
      const altListings = await searchEbay(altQuery, appId);
      allListings = [...allListings, ...altListings];
    }
    
    // Remove duplicates again after combining results
    allListings = deduplicateListings(allListings);
    
    // Sort by date ascending
    allListings.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    // Calculate statistics
    const prices = allListings.map(listing => listing.price);
    const stats = calculateStats(prices);
    
    const result: CompsResponse = {
      history: allListings,
      stats
    };
    
    return okJSON(result);
    
  } catch (error: any) {
    console.error("eBay comps error:", error);
    
    const errorResponse: CompsError = {
      error: error.message || "Failed to fetch eBay comps"
    };
    
    const status = error.message?.includes("not set") ? 400 : 500;
    
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

# Test with query:
curl -X POST https://your-app.vercel.app/api/ebay/comps \
  -H "Content-Type: application/json" \
  -d '{"query": "2023 Topps Elly De La Cruz SS-38 RC"}'

# Test with alt_queries:
curl -X POST https://your-app.vercel.app/api/ebay/comps \
  -H "Content-Type: application/json" \
  -d '{"query": "2023 Bowman Jacob Wilson BDC-121", "alt_queries": ["2023 Bowman Jacob Wilson BDC121", "2023 Bowman Jacob Wilson Spotless Spans 121"]}'

# Test CORS preflight:
curl -X OPTIONS https://your-app.vercel.app/api/ebay/comps \
  -H "Origin: chrome-extension://your-extension-id" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type"
*/