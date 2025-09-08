function normalizeCompany(set: string, company?: string) {
  const s = (set || "").toLowerCase();
  if (company) return company;
  if (/(prizm|select|mosaic|donruss|optic|chronicles)/i.test(s)) return "Panini";
  if (/(topps|chrome|finest|bowman)/i.test(s)) return "Topps";
  if (/upper\s*deck|young\s*guns/i.test(s)) return "Upper Deck";
  return "";
}
function cleanNumber(n?: string | null) {
  if (!n) return "";
  const v = String(n).trim().replace(/^#/, "");
  if (!/^[0-9]{1,4}[a-z]?$/i.test(v)) return "";
  if (Number(v) > 0 && Number(v) <= 2) return ""; // filter obvious jersey/noise
  return `#${v}`;
}
export function buildQuery(identity: any) {
  const year   = identity?.year || "";
  const player = identity?.player || identity?.player_name || "";
  const set    = identity?.set || identity?.set_name || "";
  const company= normalizeCompany(set, identity?.company || identity?.producing_company);
  const par    = identity?.parallel || identity?.variant || "";
  const num    = cleanNumber(identity?.card_number || identity?.number || "");
  const parts: string[] = [];
  if (year) parts.push(year);
  if (company) parts.push(company);
  if (set) parts.push(set);
  if (player) parts.push(player);
  if (par) parts.push(par);
  if (identity?.is_rookie) parts.push("rookie", "RC");
  if (num) parts.push(num);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
export function altQueries(identity: any) {
  const base = buildQuery(identity);
  const out = new Set<string>();
  const par  = identity?.parallel || identity?.variant || "";
  out.add(base.replace(/#\S+\b/g, "").replace(/\s+/g, " ").trim());                 // drop number
  out.add(base.replace(par, "").replace(/#\S+\b/g, "").replace(/\s+/g, " ").trim()); // drop par + num
  const year = identity?.year || "", set = identity?.set || identity?.set_name || "", player = identity?.player || identity?.player_name || "";
  out.add([year, set, player, identity?.is_rookie ? "RC" : ""].join(" ").replace(/\s+/g, " ").trim()); // reorder
  const company = normalizeCompany(set, identity?.company || identity?.producing_company);
  out.add([year, company, set, identity?.parallel || "", identity?.is_rookie ? "RC" : ""].join(" ").replace(/\s+/g, " ").trim()); // brand fallback
  return Array.from(out).filter(Boolean);
}