import { ebayRateLimiter } from './rate-limiter';
import { cache } from './cache';

export type CompItem = { title: string; price: number; currency: string; url?: string; ended?: string };
export type CompsOut = { lastSold?: number; avg?: number; floor?: number; items: CompItem[] };

class EbayApiError extends Error {
  constructor(message: string, public status?: number, public retryAfter?: number) {
    super(message);
    this.name = 'EbayApiError';
  }
}

async function makeEbayRequest(url: string, maxRetries: number = 3): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Wait for rate limit slot
      await ebayRateLimiter.waitForSlot();
      
      const response = await fetch(url);
      
      if (response.status === 429) {
        // Rate limit exceeded
        const retryAfter = response.headers.get('Retry-After');
        const retryMs = retryAfter ? parseInt(retryAfter) * 1000 : 60000; // Default 1 minute
        
        if (attempt < maxRetries) {
          console.log(`Rate limited, retrying after ${retryMs}ms (attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryMs));
          continue;
        } else {
          throw new EbayApiError('Rate limit exceeded', 429, retryMs);
        }
      }
      
      if (!response.ok) {
        throw new EbayApiError(`eBay API error: ${response.status}`, response.status);
      }
      
      const data = await response.json();
      
      // Check for eBay API errors in response
      if (data.errorMessage) {
        const error = data.errorMessage[0]?.error?.[0];
        if (error?.errorId?.[0] === '10001') {
          // Rate limit error from eBay
          const retryMs = 60000; // 1 minute
          if (attempt < maxRetries) {
            console.log(`eBay rate limit error, retrying after ${retryMs}ms (attempt ${attempt}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, retryMs));
            continue;
          } else {
            throw new EbayApiError('eBay rate limit exceeded', 429, retryMs);
          }
        }
        throw new EbayApiError(`eBay API error: ${error?.message?.[0] || 'Unknown error'}`);
      }
      
      return data;
    } catch (error) {
      if (error instanceof EbayApiError) {
        throw error;
      }
      
      if (attempt === maxRetries) {
        throw new EbayApiError(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

export async function findCompletedComps(keywords: string, appId: string, isNewOcrText: boolean = false): Promise<CompsOut> {
  // Create cache key
  const cacheKey = `ebay_comps_${keywords.toLowerCase().replace(/\s+/g, '_')}`;
  
  // Check cache first - only return cached if it's not new OCR text
  if (!isNewOcrText) {
    const cached = cache.get<CompsOut>(cacheKey);
    if (cached) {
      console.log('Returning cached eBay data for:', keywords);
      return cached;
    }
  }
  
  // Only make API call if it's new OCR text
  if (!isNewOcrText) {
    throw new EbayApiError('eBay API calls are only allowed for new OCR text to preserve rate limits');
  }
  
  const params = new URLSearchParams({
    "OPERATION-NAME": "findCompletedItems",
    "SERVICE-VERSION": "1.13.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    "REST-PAYLOAD": "true",
    "keywords": keywords,
    "paginationInput.entriesPerPage": "50",
    "itemFilter(0).name": "SoldItemsOnly",
    "itemFilter(0).value": "true",
    "outputSelector(0)": "SellerInfo",
    "sortOrder": "EndTimeSoonest"
  });
  
  const url = `https://svcs.ebay.com/services/search/FindingService/v1?${params.toString()}`;
  
  try {
    const j = await makeEbayRequest(url);
    const sr = j?.findCompletedItemsResponse?.[0]?.searchResult?.[0];
    const items: CompItem[] = (sr?.item || []).map((it: any) => {
      const selling = it?.sellingStatus?.[0];
      const pObj = selling?.currentPrice?.[0];
      return {
        title: it?.title?.[0],
        price: Number(pObj?.__value__) || 0,
        currency: pObj?.["@currencyId"] || "USD",
        url: it?.viewItemURL?.[0],
        ended: it?.listingInfo?.[0]?.endTime?.[0],
      };
    }).filter((x: CompItem) => x.price > 0);
    
    const prices = items.map(x => x.price);
    const lastSold = prices[0];
    const avg = prices.length ? prices.reduce((a,b)=>a+b,0)/prices.length : undefined;
    const floor = prices.length ? Math.min(...prices) : undefined;
    
    const result = { lastSold, avg, floor, items };
    
    // Cache the result for 10 minutes
    cache.set(cacheKey, result, 10 * 60 * 1000);
    
    return result;
  } catch (error) {
    if (error instanceof EbayApiError) {
      throw error;
    }
    throw new EbayApiError(`Failed to fetch eBay data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}