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

function getClientIdRaw() {
  return (process.env.EBAY_CLIENT_ID || process.env.EBAY_APP_ID || "") as string;
}
function getClientSecretRaw() {
  return (process.env.EBAY_CLIENT_SECRET || "") as string;
}

function trimSafe(s: string) {
  // strip BOM and trim whitespace/newlines
  return s.replace(/^\uFEFF/, "").trim();
}
function hasNonAscii(s: string) {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) return true;
  }
  return false;
}

// Edge/Node-safe base64 for Edge runtime
function b64(input: string) {
  try {
    if (typeof Buffer !== "undefined") return Buffer.from(input, "utf-8").toString("base64");
  } catch {}
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // @ts-ignore
  return btoa(bin);
}

function median(nums: number[]) {
  if (!nums.length) return null as number | null;
  const a = [...nums].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Internal helper to actually request a token using a given strategy
async function requestToken(scope: string, strategy: "basic" | "body", id: string, secret: string) {
  const url = "https://api.ebay.com/identity/v1/oauth2/token";
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  const body = new URLSearchParams({ grant_type: "client_credentials", scope });

  if (strategy === "basic") {
    headers["Authorization"] = `Basic ${b64(`${id}:${secret}`)}`;
  } else {
    // Fallback: send client_id/client_secret in the body (some OAuth servers accept this)
    body.set("client_id", id);
    body.set("client_secret", secret);
  }

  const res = await fetch(url, { method: "POST", headers, body });
  const text = await res.text();
  if (!res.ok) {
    let err: any;
    try { err = JSON.parse(text); } catch { err = text; }
    return { ok: false as const, status: res.status, err, text };
  }
  let json: any = {};
  try { json = JSON.parse(text); } catch {}
  return { ok: true as const, status: res.status, json, text };
}

/** Fetch & cache an Application token (Client Credentials) with robust fallbacks. */
export async function getAppToken(): Promise<string> {
  const now = Date.now();
  if (tokenMemo && now < tokenMemo.expAt - 60_000) return tokenMemo.accessToken;

  const idRaw = getClientIdRaw();
  const secretRaw = getClientSecretRaw();
  const id = trimSafe(idRaw);
  const secret = trimSafe(secretRaw);
  if (!id || !secret) throw new Error("Missing EBAY_CLIENT_ID/EBAY_APP_ID or EBAY_CLIENT_SECRET");

  // sanity checks (helpful when debugging)
  if (hasNonAscii(id) || hasNonAscii(secret)) {
    throw new Error(`non_ascii_credential [idNonAscii=${hasNonAscii(id)} secretNonAscii=${hasNonAscii(secret)}]`);
  }

  // 1) Preferred scope (Browse readonly), 2) base scope fallback
  const scopes = [
    "https://api.ebay.com/oauth/api_scope/buy.browse.readonly",
    "https://api.ebay.com/oauth/api_scope",
  ];

  // Try: (scope A, basic) -> (scope A, body) -> (scope B, basic) -> (scope B, body)
  let lastErr = "";
  for (const scope of scopes) {
    for (const strategy of ["basic", "body"] as const) {
      const r = await requestToken(scope, strategy, id, secret);
      if (r.ok) {
        const { access_token, expires_in } = r.json as { access_token: string; expires_in: number };
        tokenMemo = { accessToken: access_token, expAt: Date.now() + expires_in * 1000 };
        return tokenMemo.accessToken;
      }
      lastErr = `(${strategy} ${scope.split("/").pop()}) ${r.status} ${typeof r.err === "string" ? r.err : JSON.stringify(r.err)}`;
      // if it's invalid_scope, move on to next scope; if it's invalid_client, try next strategy then scope
    }
  }
  throw new Error(`token_failed ${lastErr} [client:${id.slice(0, 12)}… len:${secret.length}]`);
}

/** Browse: active listings (price + shipping + affiliate URL if headers provided). */
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

  // Affiliate context (enables itemAffiliateWebUrl)
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

  const totals = items.map(i => (i.price ?? 0) + (i.shipping ?? 0)).filter(v => v > 0);
  return { history: items, stats: { median: median(totals) } };
}