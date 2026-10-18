// Decides which title/location combinations a job search run covers. Kept free
// of Deno and Supabase imports so it can be unit tested.
//
// Every combination is searched on every selected source, and each search is a
// paid SerpAPI call (some sources make more than one), so a run is capped. Within the cap, combinations are
// ordered so each title and each location is searched once before any pairing
// repeats; the rest follow in title order.

export const DEFAULT_MAX_SEARCH_CALLS = 18;

export interface SearchCombination {
  title: string;
  location: string;
}

export interface SearchPlan {
  combinations: SearchCombination[];
  // Combinations left out by the per-run cap.
  skipped: SearchCombination[];
  maxCalls: number;
}

// Trimmed, non-empty, without case-insensitive duplicates (first spelling kept).
export const cleanTerms = (values: readonly unknown[] | null | undefined) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values ?? []) {
    if (typeof value !== 'string') continue;
    const term = value.trim().replace(/\s+/g, ' ');
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    result.push(term);
  }

  return result;
};

export const orderCombinations = (titles: string[], locations: string[]): SearchCombination[] => {
  if (!titles.length || !locations.length) return [];

  const ordered: SearchCombination[] = [];
  const used = new Set<string>();
  const add = (title: string, location: string) => {
    const key = `${title}\u0000${location}`;
    if (used.has(key)) return;
    used.add(key);
    ordered.push({ title, location });
  };

  // Pair them up diagonally first, so every title and every location appears.
  const coverage = Math.max(titles.length, locations.length);
  for (let i = 0; i < coverage; i++) {
    add(titles[i % titles.length], locations[i % locations.length]);
  }

  for (const title of titles) {
    for (const location of locations) add(title, location);
  }

  return ordered;
};

// Reads the per-run cap from an environment value; falls back to the default
// for anything that isn't a positive whole number.
export const parseMaxCalls = (value: string | undefined | null) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_SEARCH_CALLS;
};

export const planSearchQueries = ({
  titles,
  locations,
  callsPerCombination,
  maxCalls = DEFAULT_MAX_SEARCH_CALLS,
}: {
  titles: string[];
  locations: string[];
  // Most paid calls one combination can cost across the selected sources.
  callsPerCombination: number;
  maxCalls?: number;
}): SearchPlan => {
  const all = orderCombinations(titles, locations);
  // Always search at least one combination, even if the sources alone exceed the cap.
  const allowed = Math.max(1, Math.floor(maxCalls / Math.max(1, callsPerCombination)));

  return {
    combinations: all.slice(0, allowed),
    skipped: all.slice(allowed),
    maxCalls,
  };
};
