// Shared utilities for building search queries from card identity

export type CardIdentity = {
  player: string;
  year: string;
  set: string;
  card_number: string;
  variant: string;
  grade: string;
};

export function buildSearchQuery(identity: CardIdentity): string {
  const parts: string[] = [];
  
  // Add year
  if (identity.year) {
    parts.push(identity.year);
  }
  
  // Add set
  if (identity.set) {
    parts.push(identity.set);
  }
  
  // Add player
  if (identity.player) {
    parts.push(identity.player);
  }
  
  // Add card number
  if (identity.card_number) {
    parts.push(identity.card_number);
  }
  
  // Add variant if it's not "Base"
  if (identity.variant && identity.variant !== "Base") {
    parts.push(identity.variant);
  }
  
  // Add grade if it's a meaningful grade (PSA 10, PSA 9, etc.)
  if (identity.grade && identity.grade !== "Raw" && identity.grade.includes("PSA")) {
    parts.push(identity.grade);
  }
  
  return parts.join(" ").trim() || "trading card";
}

export function buildAlternativeQueries(identity: CardIdentity): string[] {
  const queries: string[] = [];
  const baseQuery = buildSearchQuery(identity);
  
  // Add normalized card number variants
  if (identity.card_number) {
    const normalizedNumber = identity.card_number.replace(/\s+/g, "-");
    const compactNumber = identity.card_number.replace(/\s+/g, "");
    
    if (normalizedNumber !== identity.card_number) {
      queries.push(baseQuery.replace(identity.card_number, normalizedNumber));
    }
    
    if (compactNumber !== identity.card_number) {
      queries.push(baseQuery.replace(identity.card_number, compactNumber));
    }
    
    // Add SS expansion for Spotless Spans
    if (identity.card_number.toLowerCase().startsWith('ss')) {
      const ssExpansion = baseQuery.replace(identity.card_number, `Spotless Spans ${identity.card_number.substring(2)}`);
      queries.push(ssExpansion);
    }
  }
  
  // Add variant-specific queries
  if (identity.variant === "RC") {
    queries.push(baseQuery.replace("RC", "Rookie"));
  }
  
  return [...new Set(queries)]; // Remove duplicates
}
