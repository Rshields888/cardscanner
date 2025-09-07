// Simplified query builder for GPT-first card analysis

export type CardIdentity = {
  year?: number | null;
  player?: string | null;
  team?: string | null;
  card_number?: string | null;
  set?: string | null;
  subset?: string | null;
  company?: string | null;
  is_rookie?: boolean | null;
  parallel?: string | null;
  card_type?: string | null;
  grade?: string | null;
  canonical_name?: string | null;
  alt_queries?: string[];
};

/**
 * Builds a primary search query from card identity
 */
export function buildPrimaryQuery(identity: CardIdentity): string {
  const parts: string[] = [];
  
  // Add year
  if (identity.year) {
    parts.push(identity.year.toString());
  }
  
  // Add player name
  if (identity.player) {
    parts.push(identity.player);
  }
  
  // Add set name
  if (identity.set) {
    parts.push(identity.set);
  }
  
  // Add team (optional, helps with disambiguation)
  if (identity.team && identity.team !== identity.player) {
    parts.push(identity.team);
  }
  
  // Add card number with # prefix
  if (identity.card_number) {
    parts.push(`#${identity.card_number}`);
  }
  
  // Add parallel/variant
  if (identity.parallel) {
    parts.push(identity.parallel);
  }
  
  // Add card type if it's meaningful
  if (identity.card_type && identity.card_type !== 'Base') {
    parts.push(identity.card_type);
  }
  
  // Add rookie indicator
  if (identity.is_rookie) {
    parts.push('RC');
  }
  
  return parts.join(' ').replace(/\s+/g, ' ').trim() || 'trading card';
}

/**
 * Generates alternative search queries for better eBay results
 */
export function buildAlternativeQueries(identity: CardIdentity): string[] {
  const queries: string[] = [];
  const primary = buildPrimaryQuery(identity);
  
  // If GPT already provided alt_queries, use those as base
  const gptQueries = identity.alt_queries || [];
  
  // Generate additional variations
  const variations: string[] = [];
  
  // Variation 1: Drop team for broader search
  if (identity.team) {
    const withoutTeam = buildPrimaryQuery({ ...identity, team: null });
    if (withoutTeam !== primary) {
      variations.push(withoutTeam);
    }
  }
  
  // Variation 2: Drop parallel for base card search
  if (identity.parallel) {
    const withoutParallel = buildPrimaryQuery({ ...identity, parallel: null });
    if (withoutParallel !== primary) {
      variations.push(withoutParallel);
    }
  }
  
  // Variation 3: Shorter version (year + player + set only)
  if (identity.year && identity.player && identity.set) {
    const shortQuery = `${identity.year} ${identity.player} ${identity.set}`;
    if (shortQuery !== primary) {
      variations.push(shortQuery);
    }
  }
  
  // Variation 4: Player + set + number (no year)
  if (identity.player && identity.set && identity.card_number) {
    const noYearQuery = `${identity.player} ${identity.set} #${identity.card_number}`;
    if (noYearQuery !== primary) {
      variations.push(noYearQuery);
    }
  }
  
  // Variation 5: Company + player + year
  if (identity.company && identity.player && identity.year) {
    const companyQuery = `${identity.company} ${identity.player} ${identity.year}`;
    if (companyQuery !== primary) {
      variations.push(companyQuery);
    }
  }
  
  // Combine GPT queries with generated variations
  const allQueries = [...gptQueries, ...variations];
  
  // Remove duplicates and empty strings
  return [...new Set(allQueries.filter(q => q && q.trim()))];
}

/**
 * Main function to build query and alternatives from identity
 */
export function buildSearchQueries(identity: CardIdentity): {
  primary: string;
  alternatives: string[];
} {
  const primary = buildPrimaryQuery(identity);
  const alternatives = buildAlternativeQueries(identity);
  
  return {
    primary,
    alternatives
  };
}