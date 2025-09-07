export const runtime = 'edge';

import { corsHeaders, okJSON } from "../../_cors";
import { findCompletedComps } from "@/lib/ebay";
import { buildSearchQueries } from "@/lib/query-builder";

// Type definitions
type CompsRequest = {
  query: string;
  alt_queries?: string[];
  grade?: string;
  // Legacy support for extension
  history?: any;
  stats?: any;
};

type HistoryEntry = {
  price: number;
  shipping: number;
  date: string;
  url: string;
};

type Stats = {
  median: number;
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
    'box', 'hobby', 'case', 'blaster', 'auction photo', 'proxy',
    'reprint', 'fake', 'replica'
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
    const normalizedTitle = normalizeTitle(listing.url); // Use URL for deduplication
    const key = `${normalizedTitle}_${Math.round(listing.price * 2) / 2}`;
    
    if (!seen.has(key) || seen.get(key)!.price > listing.price) {
      seen.set(key, listing);
    }
  }
  
  return Array.from(seen.values());
}

function calculateMedian(prices: number[]): number {
  if (prices.length === 0) return 0;
  
  const sorted = prices.sort((a, b) => a - b);
  const count = sorted.length;
  
  return count % 2 === 0 
    ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
    : sorted[Math.floor(count / 2)];
}

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

// CORS preflight handler
export async function OPTIONS() {
  return new Response(null, { 
    status: 204, 
    headers: corsHeaders() 
  });
}

// Main comps endpoint
export async function POST(req: Request) {
  try {
    const body: CompsRequest = await req.json();
    
    // Support both new format and legacy extension format
    let query: string;
    let alt_queries: string[] = [];
    let grade: string | undefined;
    
    if (body.query) {
      // New format from GPT analysis
      query = body.query;
      alt_queries = body.alt_queries || [];
      grade = body.grade;
    } else if (body.history && body.stats) {
      // Legacy format from extension - return as-is for compatibility
      return okJSON({
        history: body.history,
        stats: body.stats
      });
    } else {
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
    
    // Try primary query first
    let allListings: HistoryEntry[] = [];
    let searchQueries = [query, ...alt_queries];
    
    for (const searchQuery of searchQueries) {
      try {
        console.log(`Searching eBay for: ${searchQuery}`);
        const ebayResult = await findCompletedComps(searchQuery, appId, true);
        
        // Convert eBay results to our format
        const listings: HistoryEntry[] = ebayResult.items
          .filter(item => !isJunkListing(item.title))
          .map(item => ({
            price: normalizeCurrency(item.price, item.currency),
            shipping: 0, // eBay API doesn't always provide shipping separately
            date: formatDate(item.ended || new Date().toISOString()),
            url: item.url || ''
          }));
        
        allListings = [...allListings, ...listings];
        
        // If we have enough results, break early
        if (allListings.length >= 20) {
          break;
        }
      } catch (error) {
        console.warn(`Failed to search for "${searchQuery}":`, error);
        // Continue with next query
      }
    }
    
    // Remove duplicates
    allListings = deduplicateListings(allListings);
    
    // Sort by date ascending (oldest first)
    allListings.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    // Take most recent 50 results
    allListings = allListings.slice(-50);
    
    // Calculate median price
    const prices = allListings.map(listing => listing.price + listing.shipping);
    const median = calculateMedian(prices);
    
    const result: CompsResponse = {
      history: allListings,
      stats: { median }
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