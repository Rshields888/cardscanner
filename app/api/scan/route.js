import { NextResponse } from "next/server";

const EBAY_APP_ID = process.env.EBAY_APP_ID;
const COOLDOWN_MINUTES = parseInt(process.env.COOLDOWN_MINUTES || "10", 10);

const memCache = new Map();
let ebayCooldownUntil = 0;

export async function POST(req) {
  if (!EBAY_APP_ID) {
    return NextResponse.json({ error: "Server missing EBAY_APP_ID" }, { status: 500 });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const keywords = (body?.keywords || "").trim();
  const perPage = Math.min(Math.max(Number(body?.perPage ?? 20), 1), 50);
  if (!keywords) {
    return NextResponse.json({ error: "Missing keywords" }, { status: 400 });
  }

  const now = Date.now();
  if (now < ebayCooldownUntil) {
    const eta = Math.ceil((ebayCooldownUntil - now) / 1000);
    return NextResponse.json({ error: "ebay_rate_limited", retryAfterSec: eta }, { status: 429 });
  }

  const key = `${keywords.toLowerCase()}|${perPage}`;
  const hit = memCache.get(key);
  if (hit && now - hit.at < 5 * 60 * 1000) {
    return NextResponse.json({ cached: true, ...hit.data }, { status: 200 });
  }

// PATCHED: disabled direct eBay call
//   const url = new URL("https://svcs.ebay.com/services/search/FindingService/v1");
// PATCHED: disabled direct eBay call
//   url.searchParams.set("OPERATION-NAME", "findCompletedItems");
  url.searchParams.set("SERVICE-VERSION", "1.13.0");
  url.searchParams.set("SECURITY-APPNAME", EBAY_APP_ID);
  url.searchParams.set("RESPONSE-DATA-FORMAT", "JSON");
  url.searchParams.set("REST-PAYLOAD", "true");
  url.searchParams.set("GLOBAL-ID", "EBAY-US");
  url.searchParams.set("keywords", keywords);
  url.searchParams.set("paginationInput.entriesPerPage", String(perPage));
  url.searchParams.set("itemFilter(0).name", "SoldItemsOnly");
  url.searchParams.set("itemFilter(0).value", "true");
  url.searchParams.set("sortOrder", "EndTimeSoonest");

  const res = await fetch(url.toString(), { method: "GET", headers: { Accept: "application/json" } });
  let data;
  try {
    data = await res.json();
  } catch (e) {
    return NextResponse.json({ error: "Bad eBay response" }, { status: 502 });
  }

  const err = data?.errorMessage?.[0]?.error?.[0];
  if (err?.errorId?.[0] === "10001") {
    ebayCooldownUntil = Date.now() + COOLDOWN_MINUTES * 60 * 1000;
    return NextResponse.json(
      { error: "ebay_rate_limited", message: "Exceeded allowed calls", retryAfterSec: COOLDOWN_MINUTES * 60 },
      { status: 429 }
    );
  }

// PATCHED: disabled direct eBay call
//   const items = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item?.map((it) => ({
    itemId: it?.itemId?.[0],
    title: it?.title?.[0],
    viewItemURL: it?.viewItemURL?.[0],
    sellingStatus: {
      currentPrice: it?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__,
      currency: it?.sellingStatus?.[0]?.currentPrice?.[0]?.["@currencyId"],
    },
    endTime: it?.listingInfo?.[0]?.endTime?.[0],
    condition: it?.condition?.[0]?.conditionDisplayName?.[0],
    galleryURL: it?.galleryURL?.[0],
  })) ?? [];

  const shaped = { ok: true, count: items.length, items };
  memCache.set(key, { at: now, data: shaped });
  return NextResponse.json(shaped, { status: 200 });
}

export function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}