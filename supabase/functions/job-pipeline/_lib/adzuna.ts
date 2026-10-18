// Adzuna job search (https://developer.adzuna.com), an official API with exact
// posting times, newest-first sorting and a "posted within N days" filter.
// Needs the owner's free API keys: ADZUNA_APP_ID, ADZUNA_APP_KEY and
// ADZUNA_COUNTRY (Adzuna's two-letter country, e.g. pl, gb, de, us).
// No Deno imports, so it can be unit tested.

import { classifyWorkModel } from './jobFilters.ts';
import { cleanSearchError, type SearchReport } from './searchReport.ts';
import type { RawJob } from './types.ts';

export interface AdzunaConfig {
  appId: string;
  appKey: string;
  country: string;
}

// Countries Adzuna's API serves.
export const ADZUNA_COUNTRIES = [
  'at', 'au', 'be', 'br', 'ca', 'ch', 'de', 'es', 'fr', 'gb', 'in', 'it', 'mx', 'nl', 'nz', 'pl', 'sg', 'us', 'za',
];

export const ADZUNA_SETUP_MESSAGE =
  'Adzuna is not set up: add ADZUNA_APP_ID, ADZUNA_APP_KEY and ADZUNA_COUNTRY to the job-pipeline function secrets.';

export const readAdzunaConfig = (env: (name: string) => string | undefined): AdzunaConfig | null => {
  const appId = (env('ADZUNA_APP_ID') || '').trim();
  const appKey = (env('ADZUNA_APP_KEY') || '').trim();
  const country = (env('ADZUNA_COUNTRY') || '').trim().toLowerCase();
  return appId && appKey && ADZUNA_COUNTRIES.includes(country) ? { appId, appKey, country } : null;
};

export const adzunaSearchUrl = (
  config: AdzunaConfig,
  { title, location, maxAgeDays, workModel, limit }: {
    title: string;
    location: string;
    maxAgeDays?: number | null;
    workModel?: string | null;
    limit: number;
  },
) => {
  const remoteLocation = /^\s*remote\s*$/i.test(location);
  const words = [title.trim()];
  if (remoteLocation || workModel === 'remote') words.push('remote');
  if (workModel === 'hybrid') words.push('hybrid');

  const params = new URLSearchParams({
    app_id: config.appId,
    app_key: config.appKey,
    what: words.join(' '),
    results_per_page: String(Math.min(Math.max(limit, 1), 50)),
    sort_by: 'date',
    'content-type': 'application/json',
  });

  if (!remoteLocation && location.trim()) params.set('where', location.trim());
  if (maxAgeDays && maxAgeDays > 0) params.set('max_days_old', String(maxAgeDays));

  return `https://api.adzuna.com/v1/api/jobs/${config.country}/search/1?${params.toString()}`;
};

const asText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const nested = (value: unknown, key: string) =>
  value && typeof value === 'object' ? asText((value as Record<string, unknown>)[key]) : '';

const salaryRange = (result: Record<string, unknown>) => {
  // Adzuna estimates salaries for ads that don't state one; only show stated ones.
  if (String(result.salary_is_predicted) === '1') return null;
  const min = Number(result.salary_min);
  const max = Number(result.salary_max);
  const format = (n: number) => Math.round(n).toLocaleString('en-GB');
  if (min > 0 && max > 0) return min === max ? format(min) : `${format(min)} – ${format(max)}`;
  if (min > 0) return `from ${format(min)}`;
  if (max > 0) return `up to ${format(max)}`;
  return null;
};

const EMPLOYMENT: Record<string, string> = { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', permanent: 'Permanent' };

export const buildAdzunaJob = (result: Record<string, unknown>, fallbackLocation: string): RawJob | null => {
  const id = asText(result.id) || String(result.id ?? '');
  const title = asText(result.title).replace(/<[^>]+>/g, '');
  const company = nested(result.company, 'display_name');
  const url = asText(result.redirect_url);
  if (!id || !title || !company || !url.startsWith('http')) return null;

  const created = asText(result.created);
  const posted = created && !Number.isNaN(Date.parse(created)) ? new Date(created).toISOString() : null;
  const location = nested(result.location, 'display_name') || fallbackLocation;
  const description = asText(result.description).replace(/<[^>]+>/g, '') || null;
  const employment = [EMPLOYMENT[asText(result.contract_time)], EMPLOYMENT[asText(result.contract_type)]].filter(Boolean).join(', ');

  return {
    source: 'adzuna',
    external_id: id,
    title,
    company,
    location,
    job_url: url,
    description,
    salary_range: salaryRange(result),
    employment_type: employment || null,
    work_model: classifyWorkModel({ title, location, description }) ?? 'any',
    source_posted_at: posted,
    raw_data: result,
  };
};

// One Adzuna search for a title and location.
export const fetchAdzunaJobs = async (
  config: AdzunaConfig | null,
  search: { title: string; location: string; maxAgeDays?: number | null; workModel?: string | null; limit: number },
  fetchImpl: typeof fetch = fetch,
): Promise<{ jobs: RawJob[]; report: SearchReport }> => {
  const report: SearchReport = {
    source: 'adzuna',
    title: search.title,
    location: search.location,
    listings: 0,
    viaLinkedIn: 0,
    matched: 0,
    error: null,
  };

  if (!config) return { jobs: [], report: { ...report, error: ADZUNA_SETUP_MESSAGE } };

  try {
    const response = await fetchImpl(adzunaSearchUrl(config, search), { signal: AbortSignal.timeout(20_000) });
    const text = await response.text();

    if (!response.ok) {
      let detail = '';
      try {
        const body = JSON.parse(text) as Record<string, unknown>;
        detail = asText(body.display) || asText(body.exception) || asText(body.error);
      } catch {
        // Not JSON.
      }
      return { jobs: [], report: { ...report, error: cleanSearchError(detail || `Adzuna answered with HTTP ${response.status}`) } };
    }

    const results = ((JSON.parse(text) as Record<string, unknown>).results || []) as Record<string, unknown>[];
    const jobs = results.map((result) => buildAdzunaJob(result, search.location)).filter(Boolean) as RawJob[];

    return { jobs: jobs.slice(0, search.limit), report: { ...report, listings: results.length, matched: Math.min(jobs.length, search.limit) } };
  } catch (error) {
    return { jobs: [], report: { ...report, error: cleanSearchError(error instanceof Error ? error.message : error) } };
  }
};
