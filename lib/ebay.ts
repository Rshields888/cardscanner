export type CompItem = { title: string; price: number; currency: string; url?: string; ended?: string };
export type CompsOut = { lastSold?: number; avg?: number; floor?: number; items: CompItem[] };
export async function findCompletedComps(keywords: string, appId: string): Promise<CompsOut> {
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
  const r = await fetch(url);
  if (!r.ok) throw new Error(`eBay ${r.status}`);
  const j = await r.json();
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
  return { lastSold, avg, floor, items };
}