export function buildQuery(identity: any) {
  const year   = identity?.year || "";
  const player = identity?.player || identity?.player_name || "";
  const set    = identity?.set || identity?.set_name || "";
  const par    = identity?.parallel || identity?.variant || "";
  const num    = identity?.card_number || identity?.number || "";
  return [year, player, set, par, num && `#${num}`]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function altQueries(identity: any) {
  const primary = buildQuery(identity);
  const dropPar = primary.replace(identity?.parallel || identity?.variant || "", "").replace(/\s+/g, " ").trim();
  const dropNum = primary.replace(/#\S+/, "").replace(/\s+/g, " ").trim();
  const year = identity?.year || "",
        set  = identity?.set || identity?.set_name || "",
        player = identity?.player || identity?.player_name || "";
  const reordered = [year, set, player].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return Array.from(new Set([dropPar, dropNum, reordered].filter(Boolean)));
}