import { describe, expect, it } from 'vitest';

import {
  cleanSearchError,
  describeSearchReports,
  describeSourceSummaries,
  summariseSources,
  type SearchReport,
} from './searchReport.ts';

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

describe('source summaries', () => {
  it('counts what each source found and why its jobs were dropped', () => {
    const jobs = [
      { source: 'linkedin', source_posted_at: '2026-10-17T10:00:00Z', reason: null },
      { source: 'linkedin', source_posted_at: '2026-08-01T10:00:00Z', reason: 'date' },
      { source: 'linkedin', source_posted_at: '2026-10-17T10:00:00Z', reason: 'work_model' },
      { source: 'justjoinit', source_posted_at: null, reason: 'date' },
      { source: 'justjoinit', source_posted_at: null, reason: 'date' },
    ];

    const summaries = summariseSources(['linkedin', 'justjoinit', 'indeed'], jobs, (job) => job.reason);

    expect(summaries).toEqual([
      { source: 'linkedin', found: 3, kept: 1, undated: 0, tooOld: 1, otherFilters: 1 },
      { source: 'justjoinit', found: 2, kept: 0, undated: 2, tooOld: 0, otherFilters: 0 },
      { source: 'indeed', found: 0, kept: 0, undated: 0, tooOld: 0, otherFilters: 0 },
    ]);
    expect(describeSourceSummaries(summaries, 'Past week')).toBe(
      'By source: LinkedIn 3 found, 1 kept (1 older than past week, 1 removed by other filters); JustJoinIT 2 found, 0 kept (2 undated); Indeed 0 found.',
    );
    expect(describeSourceSummaries([], 'Past week')).toBe('');
  });

  it('names a failed source', () => {
    expect(describeSearchReports([report({ source: 'indeed', error: 'Unsupported `indeed` search engine.' })])).toEqual([
      'Indeed search for "Software engineer" in Warsaw failed: Unsupported `indeed` search engine.',
    ]);
  });
});
