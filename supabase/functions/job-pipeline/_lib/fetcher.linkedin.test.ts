import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchJobsForPreferences } from './fetcher.ts';
import type { UserJobPreferences } from './types.ts';

// Search runs with LinkedIn as the only source, against a fake SerpAPI that
// answers like its documented google_jobs / google responses.

const preferences = (overrides: Partial<UserJobPreferences> = {}): UserJobPreferences => ({
  user_id: 'u1',
  default_cv_version_id: null,
  target_titles: ['Data Analyst'],
  preferred_locations: ['London'],
  work_model: 'any',
  min_match_score: 60,
  enabled_sources: ['linkedin'],
  max_job_age_days: 7,
  automation_enabled: false,
  ...overrides,
});

const googleJob = (n: number, applyLink: string, extra: Record<string, unknown> = {}) => ({
  title: `Data Analyst ${n}`,
  company_name: `Company ${n}`,
  location: 'London, UK',
  via: 'LinkedIn',
  description: `Role ${n}: SQL, Python and dashboards.`,
  job_id: `gj-${n}`,
  share_link: `https://www.google.com/search?ibp=htl;jobs&htidocid=gj-${n}`,
  detected_extensions: { posted_at: '2 days ago', schedule_type: 'Full-time' },
  apply_options: [{ title: 'LinkedIn', link: applyLink }],
  ...extra,
});

const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const stubSerpApi = (handlers: { google_jobs: () => unknown; google?: () => unknown }) => {
  const requests: URLSearchParams[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const params = new URL(String(input)).searchParams;
    requests.push(params);
    const engine = params.get('engine') as 'google_jobs' | 'google';
    return respond(handlers[engine]?.() ?? {});
  }));
  return requests;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('LinkedIn search', () => {
  it('takes LinkedIn postings from Google Jobs with full details and the LinkedIn link', async () => {
    const requests = stubSerpApi({
      google_jobs: () => ({
        jobs_results: [
          googleJob(1, 'https://uk.linkedin.com/jobs/view/data-analyst-at-company-1-3800000001?utm_source=google_jobs_apply'),
          googleJob(2, 'https://www.linkedin.com/jobs/view/3800000002/?trk=abc'),
          googleJob(3, 'https://www.linkedin.com/jobs/view/3800000003'),
          googleJob(4, 'https://careers.example/jobs/4', { via: 'Company careers' }),
        ],
      }),
    });

    const { jobs } = await fetchJobsForPreferences(preferences(), 'test-key', 10);

    // One Google Jobs call, location in the query, no fixed country; enough
    // LinkedIn results, so no fallback search.
    expect(requests).toHaveLength(1);
    expect(requests[0].get('engine')).toBe('google_jobs');
    expect(requests[0].get('q')).toBe('Data Analyst London');
    expect(requests[0].has('gl')).toBe(false);

    expect(jobs.map((j) => j.job_url)).toEqual([
      'https://www.linkedin.com/jobs/view/3800000001/',
      'https://www.linkedin.com/jobs/view/3800000002/',
      'https://www.linkedin.com/jobs/view/3800000003/',
    ]);
    expect(jobs[0]).toMatchObject({
      source: 'linkedin',
      external_id: '3800000001',
      title: 'Data Analyst 1',
      company: 'Company 1',
      location: 'London, UK',
      description: 'Role 1: SQL, Python and dashboards.',
      employment_type: 'Full-time',
    });
    expect(jobs[0].source_posted_at).toBeTruthy();
  }, 20_000);

  it('tops up from a LinkedIn site search when Google Jobs has few LinkedIn postings', async () => {
    const requests = stubSerpApi({
      google_jobs: () => ({ jobs_results: [googleJob(1, 'https://www.linkedin.com/jobs/view/3800000001')] }),
      google: () => ({
        organic_results: [
          {
            title: 'Company 7 hiring Data Analyst in London, England, United Kingdom | LinkedIn',
            link: 'https://uk.linkedin.com/jobs/view/data-analyst-at-company-7-3800000007?refId=x',
            snippet: 'Posted 1 day ago. Company 7 is hiring a Data Analyst in London.',
          },
          // The same posting Google Jobs already found.
          {
            title: 'Company 1 hiring Data Analyst 1 in London | LinkedIn',
            link: 'https://www.linkedin.com/jobs/view/data-analyst-1-at-company-1-3800000001',
            snippet: 'Company 1 is hiring.',
          },
        ],
      }),
    });

    const { jobs } = await fetchJobsForPreferences(preferences(), 'test-key', 10);

    expect(requests.map((r) => r.get('engine'))).toEqual(['google_jobs', 'google']);
    expect(requests[1].get('q')).toBe('site:linkedin.com/jobs/view Data Analyst London job');
    expect(requests[1].has('gl')).toBe(false);

    // The repeat of 3800000001 collapses into one job.
    expect(jobs.map((j) => j.job_url).sort()).toEqual([
      'https://www.linkedin.com/jobs/view/3800000001/',
      'https://www.linkedin.com/jobs/view/3800000007/',
    ]);
    expect(jobs.every((j) => j.source === 'linkedin')).toBe(true);
  }, 20_000);

  it('still runs the fallback search when Google Jobs fails', async () => {
    const requests = stubSerpApi({
      google_jobs: () => ({ error: "Google hasn't returned any results for this query." }),
      google: () => ({ organic_results: [] }),
    });

    const { jobs } = await fetchJobsForPreferences(preferences(), 'test-key', 10);
    expect(requests.map((r) => r.get('engine'))).toEqual(['google_jobs', 'google']);
    expect(jobs).toEqual([]);
  }, 20_000);

  it('counts both possible LinkedIn calls against the per-run cap', async () => {
    stubSerpApi({ google_jobs: () => ({ jobs_results: [] }), google: () => ({ organic_results: [] }) });

    const { combinationsSearched, combinationsSkipped } = await fetchJobsForPreferences(
      preferences({ target_titles: ['A', 'B', 'C'], preferred_locations: ['London'] }),
      'test-key',
      10,
      4, // 4 calls allowed, 2 per pair -> 2 pairs
    );

    expect(combinationsSearched).toHaveLength(2);
    expect(combinationsSkipped).toHaveLength(1);
  }, 20_000);
});
