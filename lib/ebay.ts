export type ActiveItem = {
  price: number | null;
  shipping: number | null;
  date: string | null;
  url: string | null;
  title: string | null;
  image: string | null;
  legacyItemId?: string | null;
};

let tokenMemo: { accessToken: string; expAt: number } | null = null;

function getClientId() {
  return (process.env.EBAY_CLIENT_ID || process.env.EBAY_APP_ID || "").trim();
}
function getClientSecret() {
  return (process.env.EBAY_CLIENT_SECRET || "").trim();
}

// Edge/Node-safe base64
function base64(input: string) {
  try { if (typeof Buffer !== "undefined") return Buffer.from(input, "utf-8").toString("base64"); } catch {}
  const bytes = new TextEncoder().encode(input);
  let bin = ""; for (let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
  // @ts-ignore
  return btoa(bin);
}
function median(nums: number[]) {
  if (!nums.length) return null as number | null;
  const a = [...nums].sort((x,y)=>x-y); const m = Math.floor(a.length/2);
  return a.length % 2 ? a[m] : (a[m-1]+a[m])/2;
}

export async function getAppToken() {
  const now = Date.now();
  if (tokenMemo && now < tokenMemo.expAt - 60_000) return tokenMemo.accessToken;

  const id = getClientId(); const secret = getClientSecret();
  if (!id || !secret) throw new Error("Missing EBAY_CLIENT_ID/EBAY_APP_ID or EBAY_CLIENT_SECRET");

  // Use precise Browse scope; space-separated allows multiple if needed
  const scope = "https://api.ebay.com/oauth/api_scope/buy.browse.readonly";
  const body = new URLSearchParams({ grant_type: "client_credentials", scope });

  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${base64(`${id}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`token ${res.status} ${txt} [client:${id.slice(0,10)}…]`);
  }

  const json = await res.json() as { access_token: string; expires_in: number };
  tokenMemo = { accessToken: json.access_token, expAt: Date.now() + json.expires_in*1000 };
  return tokenMemo.accessToken;
}

export async function searchActive(opts: { q: string; limit?: number; categoryId?: string }) {
  const token = await getAppToken();
  const marketplace = process.env.EBAY_MARKETPLACE || "EBAY_US";
  const limit = String(opts.limit ?? 30);
  const categoryId = opts.categoryId || process.env.EBAY_CATEGORY_ID || "";

  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", opts.q);
  url.searchParams.set("limit", limit);
  url.searchParams.set("fieldgroups", "FULL");
  if (categoryId) url.searchParams.set("category_ids", categoryId);

  const ctx: string[] = [];
  const camp = process.env.EBAY_AFFILIATE_CAMPAIGN_ID;
  const ref  = process.env.EBAY_AFFILIATE_REFERENCE_ID;
  if (camp) ctx.push(`affiliateCampaignId=${camp}`);
  if (ref)  ctx.push(`affiliateReferenceId=${ref}`);
  ctx.push("contextualLocation=country=US,zip=10001");

  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplace,
      "X-EBAY-C-ENDUSERCTX": ctx.join(";"),
    },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`browse ${r.status} ${await r.text()}`);

  const data = await r.json() as any;
  const items: ActiveItem[] = (data.itemSummaries ?? []).map((it: any) => ({
    price: it?.price?.value ? Number(it.price.value) : null,
    shipping: it?.shippingOptions?.[0]?.shippingCost?.value ? Number(it.shippingOptions[0].shippingCost.value) : 0,
    date: null,
    url: it?.itemAffiliateWebUrl || it?.itemWebUrl || null,
    title: it?.title ?? null,
    image: it?.image?.imageUrl || it?.thumbnailImages?.[0]?.imageUrl || null,
    legacyItemId: it?.legacyItemId ?? null,
  }));

  const totals = items.map(i => (i.price ?? 0) + (i.shipping ?? 0)).filter(v=>v>0);
  return { history: items, stats: { median: median(totals) } };
}