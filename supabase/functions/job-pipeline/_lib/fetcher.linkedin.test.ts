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

const stubSerpApi = (handlers: { google_jobs: () => unknown }) => {
  const requests: URLSearchParams[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const params = new URL(String(input)).searchParams;
    requests.push(params);
    return respond(params.get('engine') === 'google_jobs' ? handlers.google_jobs() : {});
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

    // One Google Jobs call (no further page), location in the query, no fixed country.
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

  it('reads a second Google Jobs page when there is one, and never searches LinkedIn pages directly', async () => {
    let page = 0;
    const requests = stubSerpApi({
      google_jobs: () => {
        page++;
        return page === 1
          ? { jobs_results: [googleJob(1, 'https://www.linkedin.com/jobs/view/3800000001')], serpapi_pagination: { next_page_token: 'token-2' } }
          : { jobs_results: [googleJob(2, 'https://www.linkedin.com/jobs/view/3800000002')] };
      },
    });

    const { jobs } = await fetchJobsForPreferences(preferences(), 'test-key', 10);

    expect(requests.map((r) => r.get('engine'))).toEqual(['google_jobs', 'google_jobs']);
    expect(requests[1].get('next_page_token')).toBe('token-2');
    expect(jobs.map((j) => j.external_id)).toEqual(['3800000001', '3800000002']);
  }, 20_000);

  it('stops, without a fallback search, when Google Jobs has nothing', async () => {
    const requests = stubSerpApi({
      google_jobs: () => ({ error: "Google hasn't returned any results for this query." }),
    });

    const { jobs } = await fetchJobsForPreferences(preferences(), 'test-key', 10);
    expect(requests.map((r) => r.get('engine'))).toEqual(['google_jobs']);
    expect(jobs).toEqual([]);
  }, 20_000);

  it('adds a remote or hybrid preference to the search', async () => {
    const requests = stubSerpApi({ google_jobs: () => ({ jobs_results: [] }) });

    await fetchJobsForPreferences(preferences({ work_model: 'remote' }), 'test-key', 10);
    expect(requests[0].get('q')).toBe('Data Analyst London remote');
  }, 20_000);

  it('reads "Just posted" and Google\'s work-from-home flag', async () => {
    stubSerpApi({
      google_jobs: () => ({
        jobs_results: [
          googleJob(1, 'https://www.linkedin.com/jobs/view/3800000001', {
            detected_extensions: { posted_at: 'Just posted', work_from_home: true },
          }),
        ],
      }),
    });

    const { jobs } = await fetchJobsForPreferences(preferences(), 'test-key', 10);
    expect(jobs[0].source_posted_at).toBeTruthy();
    expect(jobs[0].work_model).toBe('remote');
  }, 20_000);

  it('reports a search service error instead of a silent empty run', async () => {
    stubSerpApi({ google_jobs: () => ({ error: 'Your account has run out of searches.' }) });

    const { jobs, searchReports } = await fetchJobsForPreferences(preferences(), 'test-key', 10);
    expect(jobs).toEqual([]);
    expect(searchReports).toEqual([
      { source: 'linkedin', title: 'Data Analyst', location: 'London', listings: 0, viaLinkedIn: 0, matched: 0, error: 'Your account has run out of searches.' },
    ]);
  }, 20_000);

  it('reports listings that were not posted on LinkedIn', async () => {
    stubSerpApi({
      google_jobs: () => ({ jobs_results: [googleJob(1, 'https://careers.example/jobs/1', { via: 'Company careers' }), googleJob(2, 'https://www.indeed.com/viewjob?jk=2', { via: 'Indeed' })] }),
    });

    const { searchReports } = await fetchJobsForPreferences(preferences(), 'test-key', 10);
    expect(searchReports[0]).toMatchObject({ listings: 2, viaLinkedIn: 0, matched: 0, error: null });
  }, 20_000);

  it('counts both possible LinkedIn calls against the per-run cap', async () => {
    stubSerpApi({ google_jobs: () => ({ jobs_results: [] }) });

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

describe('LinkedIn and Adzuna together', () => {
  it('runs both, each with its own report, and counts both against the cap', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.startsWith('https://api.adzuna.com/')) {
        return respond({
          results: [{
            id: '77', title: 'Data Analyst', company: { display_name: 'Beta' }, location: { display_name: 'London' },
            created: new Date().toISOString(), redirect_url: 'https://www.adzuna.co.uk/land/ad/77', description: 'SQL.',
          }],
        });
      }
      return respond({ jobs_results: [googleJob(1, 'https://www.linkedin.com/jobs/view/3800000001')] });
    }));

    const { jobs, searchReports, combinationsSearched } = await fetchJobsForPreferences(
      preferences({ enabled_sources: ['linkedin', 'adzuna'] }),
      'test-key',
      10,
      18,
      { adzuna: { appId: 'id', appKey: 'key', country: 'gb' } },
    );

    expect(jobs.map((j) => j.source).sort()).toEqual(['adzuna', 'linkedin']);
    expect(searchReports.map((r) => r.source)).toEqual(['linkedin', 'adzuna']);
    expect(urls.some((u) => u.startsWith('https://api.adzuna.com/v1/api/jobs/gb/search/1?'))).toBe(true);
    expect(combinationsSearched).toHaveLength(1);
  }, 20_000);

  it('says Adzuna is not set up when its keys are missing', async () => {
    stubSerpApi({ google_jobs: () => ({ jobs_results: [] }) });
    const { searchReports } = await fetchJobsForPreferences(preferences({ enabled_sources: ['adzuna'] }), '', 10);
    expect(searchReports[0].error).toContain('ADZUNA_APP_ID');
  }, 20_000);
});
