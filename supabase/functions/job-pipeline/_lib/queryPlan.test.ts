import { describe, expect, it } from 'vitest';

import { cleanTerms, orderCombinations, parseMaxCalls, planSearchQueries } from './queryPlan.ts';

const pairs = (combinations: Array<{ title: string; location: string }>) =>
  combinations.map(({ title, location }) => `${title} @ ${location}`);

describe('cleanTerms', () => {
  it('trims, drops blanks and case-insensitive duplicates', () => {
    expect(cleanTerms(['  Data Analyst ', 'data analyst', '', '  ', 'BI  Analyst', null, 3])).toEqual(['Data Analyst', 'BI Analyst']);
    expect(cleanTerms(undefined)).toEqual([]);
  });
});

describe('orderCombinations', () => {
  it('covers every title and every location before repeating any', () => {
    const ordered = pairs(orderCombinations(['A', 'B', 'C'], ['X', 'Y']));

    expect(ordered.slice(0, 3)).toEqual(['A @ X', 'B @ Y', 'C @ X']);
    expect(ordered).toHaveLength(6);
    expect(new Set(ordered).size).toBe(6);
  });

  it('works when there are more locations than titles', () => {
    expect(pairs(orderCombinations(['A'], ['X', 'Y', 'Z']))).toEqual(['A @ X', 'A @ Y', 'A @ Z']);
  });

  it('returns nothing without titles or locations', () => {
    expect(orderCombinations([], ['X'])).toEqual([]);
    expect(orderCombinations(['A'], [])).toEqual([]);
  });
});

describe('planSearchQueries', () => {
  it('searches every combination when they fit within the cap', () => {
    const plan = planSearchQueries({ titles: ['A', 'B'], locations: ['X', 'Y'], callsPerCombination: 3, maxCalls: 18 });

    expect(plan.combinations).toHaveLength(4);
    expect(plan.skipped).toEqual([]);
  });

  it('caps paid calls per run and reports what was left out', () => {
    // 6 calls per combination x 3 combinations = 18 calls.
    const plan = planSearchQueries({ titles: ['A', 'B', 'C'], locations: ['X', 'Y', 'Z'], callsPerCombination: 6, maxCalls: 18 });

    expect(pairs(plan.combinations)).toEqual(['A @ X', 'B @ Y', 'C @ Z']);
    expect(plan.skipped).toHaveLength(6);
    expect(plan.combinations.length * 6).toBeLessThanOrEqual(18);
  });

  it('still searches one combination when the sources alone exceed the cap', () => {
    const plan = planSearchQueries({ titles: ['A', 'B'], locations: ['X'], callsPerCombination: 6, maxCalls: 4 });

    expect(pairs(plan.combinations)).toEqual(['A @ X']);
    expect(pairs(plan.skipped)).toEqual(['B @ X']);
  });
});

describe('parseMaxCalls', () => {
  it('accepts positive whole numbers and falls back to the default otherwise', () => {
    expect(parseMaxCalls('30')).toBe(30);
    expect(parseMaxCalls(undefined)).toBe(18);
    expect(parseMaxCalls('')).toBe(18);
    expect(parseMaxCalls('0')).toBe(18);
    expect(parseMaxCalls('-5')).toBe(18);
    expect(parseMaxCalls('2.5')).toBe(18);
    expect(parseMaxCalls('lots')).toBe(18);
  });
});
