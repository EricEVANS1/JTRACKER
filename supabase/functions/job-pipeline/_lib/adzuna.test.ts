import { describe, expect, it, vi } from 'vitest';

import { adzunaSearchUrl, buildAdzunaJob, fetchAdzunaJobs, readAdzunaConfig, type AdzunaConfig } from './adzuna.ts';

const config: AdzunaConfig = { appId: 'id-123', appKey: 'key-abc', country: 'pl' };

// Shaped like Adzuna's documented search response.
const result = (overrides: Record<string, unknown> = {}) => ({
  id: '4876543210',
  title: 'IT <strong>Support</strong> Specialist',
  description: 'Help our users with hardware and software. Praca stacjonarna w Warszawie.',
  created: '2026-10-18T07:15:00Z',
  redirect_url: 'https://www.adzuna.pl/land/ad/4876543210?se=abc',
  company: { display_name: 'Acme Sp. z o.o.' },
  location: { display_name: 'Warszawa, Mazowieckie' },
  contract_time: 'full_time',
  contract_type: 'permanent',
  salary_min: 7000,
  salary_max: 9000,
  salary_is_predicted: '0',
  ...overrides,
});

describe('readAdzunaConfig', () => {
  it('needs both keys and a country Adzuna serves', () => {
    const env = (values: Record<string, string>) => (name: string) => values[name];
    expect(readAdzunaConfig(env({ ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b', ADZUNA_COUNTRY: 'PL' }))).toEqual({ appId: 'a', appKey: 'b', country: 'pl' });
    expect(readAdzunaConfig(env({ ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b' }))).toBeNull();
    expect(readAdzunaConfig(env({ ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b', ADZUNA_COUNTRY: 'xx' }))).toBeNull();
  });
});

describe('adzunaSearchUrl', () => {
  it('searches newest first within Date posted', () => {
    const url = new URL(adzunaSearchUrl(config, { title: 'Support Specialist', location: 'Warsaw', maxAgeDays: 1, workModel: 'onsite', limit: 10 }));
    expect(url.origin + url.pathname).toBe('https://api.adzuna.com/v1/api/jobs/pl/search/1');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      what: 'Support Specialist',
      where: 'Warsaw',
      max_days_old: '1',
      sort_by: 'date',
      results_per_page: '10',
    });
  });

  it('handles remote and "Any time"', () => {
    const url = new URL(adzunaSearchUrl(config, { title: 'Support Specialist', location: 'Remote', maxAgeDays: 0, limit: 10 }));
    expect(url.searchParams.get('what')).toBe('Support Specialist remote');
    expect(url.searchParams.has('where')).toBe(false);
    expect(url.searchParams.has('max_days_old')).toBe(false);
  });
});

describe('buildAdzunaJob', () => {
  it('keeps the exact posting time and stated salary', () => {
    expect(buildAdzunaJob(result(), 'Warsaw')).toMatchObject({
      source: 'adzuna',
      external_id: '4876543210',
      title: 'IT Support Specialist',
      company: 'Acme Sp. z o.o.',
      location: 'Warszawa, Mazowieckie',
      job_url: 'https://www.adzuna.pl/land/ad/4876543210?se=abc',
      source_posted_at: '2026-10-18T07:15:00.000Z',
      salary_range: '7,000 – 9,000',
      employment_type: 'Full-time, Permanent',
      work_model: 'onsite',
    });
  });

  it("doesn't show Adzuna's estimated salaries, and skips incomplete results", () => {
    expect(buildAdzunaJob(result({ salary_is_predicted: '1' }), 'Warsaw')?.salary_range).toBeNull();
    expect(buildAdzunaJob(result({ company: {} }), 'Warsaw')).toBeNull();
    expect(buildAdzunaJob(result({ redirect_url: '' }), 'Warsaw')).toBeNull();
  });
});

describe('fetchAdzunaJobs', () => {
  const search = { title: 'Support Specialist', location: 'Warsaw', maxAgeDays: 1, limit: 10 };

  it('returns jobs and a report', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ count: 2, results: [result(), result({ id: '2', company: {} })] })));
    const { jobs, report } = await fetchAdzunaJobs(config, search, fetchImpl as unknown as typeof fetch);

    expect(jobs).toHaveLength(1);
    expect(report).toMatchObject({ source: 'adzuna', listings: 2, matched: 1, error: null });
  });

  it('reports a missing setup or an API error without calling or leaking keys', async () => {
    const fetchImpl = vi.fn();
    expect((await fetchAdzunaJobs(null, search, fetchImpl as unknown as typeof fetch)).report.error).toContain('ADZUNA_APP_ID');
    expect(fetchImpl).not.toHaveBeenCalled();

    const failing = vi.fn(async () => new Response(JSON.stringify({ display: 'Authorisation failed', exception: 'AUTH_FAIL' }), { status: 401 }));
    const { report } = await fetchAdzunaJobs(config, search, failing as unknown as typeof fetch);
    expect(report.error).toBe('Authorisation failed');
    expect(report.error).not.toContain('key-abc');
  });
});
