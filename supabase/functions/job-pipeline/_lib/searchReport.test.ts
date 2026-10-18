import { describe, expect, it } from 'vitest';

import { cleanSearchError, describeSearchReports, type SearchReport } from './searchReport.ts';

const report = (overrides: Partial<SearchReport>): SearchReport => ({
  source: 'linkedin', title: 'Software engineer', location: 'Warsaw', listings: 0, viaLinkedIn: 0, matched: 0, error: null, ...overrides,
});

describe('describeSearchReports', () => {
  it('explains each search that found nothing to keep', () => {
    expect(describeSearchReports([
      report({ error: 'Your account has run out of searches.' }),
      report({ listings: 0 }),
      report({ listings: 10, viaLinkedIn: 0 }),
      report({ listings: 10, viaLinkedIn: 3, matched: 0 }),
      report({ listings: 10, viaLinkedIn: 3, matched: 3 }), // fine: not mentioned
    ])).toEqual([
      'LinkedIn search for "Software engineer" in Warsaw failed: Your account has run out of searches.',
      'LinkedIn search for "Software engineer" in Warsaw: Google Jobs had no listings.',
      'LinkedIn search for "Software engineer" in Warsaw: Google Jobs had 10 listings, none posted on LinkedIn.',
      'LinkedIn search for "Software engineer" in Warsaw: 3 of 10 listings were posted on LinkedIn, but none had a LinkedIn link.',
    ]);
    expect(describeSearchReports(undefined)).toEqual([]);
  });
});

describe('cleanSearchError', () => {
  it('never repeats a key', () => {
    const key = 'a'.repeat(64);
    expect(cleanSearchError(`Invalid API key. Your API key should be here: https://serpapi.com/search?api_key=${key}&q=x`)).not.toContain(key);
    expect(cleanSearchError(`bad key ${key}`)).toBe('bad key ***');
  });
});

describe('describeSearchReports for Adzuna', () => {
  it('names the source and its problem', () => {
    expect(describeSearchReports([
      { source: 'adzuna', title: 'Support Specialist', location: 'Warsaw', listings: 0, viaLinkedIn: 0, matched: 0, error: null },
      { source: 'adzuna', title: 'Support Specialist', location: 'Warsaw', listings: 0, viaLinkedIn: 0, matched: 0, error: 'Authorisation failed' },
    ])).toEqual([
      'Adzuna search for "Support Specialist" in Warsaw: no listings.',
      'Adzuna search for "Support Specialist" in Warsaw failed: Authorisation failed',
    ]);
  });
});
