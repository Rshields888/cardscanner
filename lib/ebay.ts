// lib/ebay.ts
export type CompItem = { title: string; price: number; currency: string; url?: string; ended?: string };
export type CompsOut = { lastSold?: number; avg?: number; floor?: number; items: CompItem[] };

function mapResult(j: any): CompsOut {
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

  if (!items.length) return { items: [] };

  const prices = items.map(x => x.price);
  const lastSold = prices[0];
  const avg = prices.reduce((a,b)=>a+b,0) / prices.length;
  const floor = Math.min(...prices);
  return { lastSold, avg, floor, items };
}

export async function findCompletedComps(rawKeywords: string, appId: string): Promise<CompsOut> {
  const keywords = (rawKeywords || "").trim().replace(/\s+/g, " ").slice(0, 120); // keep it reasonable
  if (!keywords) return { items: [] };

  const params = new URLSearchParams({
    "OPERATION-NAME": "findCompletedItems",
    "SERVICE-VERSION": "1.13.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    "REST-PAYLOAD": "true",
    "GLOBAL-ID": "EBAY-US",
    "keywords": keywords,
    "paginationInput.entriesPerPage": "20",     // smaller page reduces 5xx odds
    "itemFilter(0).name": "SoldItemsOnly",
    "itemFilter(0).value": "true",
    "sortOrder": "EndTimeSoonest"
  });

  const url = `https://svcs.ebay.com/services/search/FindingService/v1?${params.toString()}`;

  let lastErr: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, {
      // Some infra setups like a UA present; harmless to add
      headers: { "User-Agent": "card-scanner/1.0" },
    });
    if (r.ok) {
      const j = await r.json();
      // If eBay returned an application-level error, surface it instead of throwing 500
      const ack = j?.findCompletedItemsResponse?.[0]?.ack?.[0];
      if (ack === "Failure" || ack === "Warning") {
        const msg = j?.findCompletedItemsResponse?.[0]?.errorMessage?.[0]?.error?.[0]?.message?.[0];
        return { items: [] }; // treat as “no comps” rather than crashing
      }
      return mapResult(j);
    }

    // 4xx: don’t retry; 5xx: retry once
    lastErr = new Error(`eBay ${r.status}`);
    if (r.status < 500) break;
    await new Promise(res => setTimeout(res, 250));
  }
  throw lastErr;
}
