import type { RawJob, UserJobPreferences } from './types.ts';

type SearchSource =
  | 'google_jobs'
  | 'indeed'
  | 'linkedin'
  | 'justjoinit'
  | 'nofluffjobs'
  | 'pracuj'
  | 'pracuj_it'
  | 'theprotocol'
  | 'bulldogjob'
  | 'crossweb';

const DEFAULT_TARGET_TITLES = [
  'Software Engineer',
  'IT Support',
  'Technical Support',
  'Data Analyst',
  'QA Tester',
];

const DEFAULT_LOCATIONS = ['Poland', 'Warsaw', 'Remote'];

const BOARD_SOURCES: Record<
  Exclude<SearchSource, 'google_jobs' | 'indeed'>,
  {
    label: string;
    siteQueries: string[];
  }
> = {
  linkedin: {
    label: 'LinkedIn',
    siteQueries: ['site:linkedin.com/jobs', 'site:pl.linkedin.com/jobs'],
  },
  justjoinit: {
    label: 'JustJoinIT',
    siteQueries: ['site:justjoin.it/job-offer', 'site:justjoin.it/jobs'],
  },
  nofluffjobs: {
    label: 'NoFluffJobs',
    siteQueries: ['site:nofluffjobs.com/job'],
  },
  pracuj: {
    label: 'Pracuj.pl',
    siteQueries: ['site:pracuj.pl/praca'],
  },
  pracuj_it: {
    label: 'Pracuj.pl IT',
    siteQueries: ['site:it.pracuj.pl/praca'],
  },
  theprotocol: {
    label: 'TheProtocol.it',
    siteQueries: ['site:theprotocol.it/szczegoly/praca'],
  },
  bulldogjob: {
    label: 'Bulldogjob',
    siteQueries: ['site:bulldogjob.pl/companies/jobs'],
  },
  crossweb: {
    label: 'Crossweb',
    siteQueries: ['site:crossweb.pl/job'],
  },
};

function safeString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalise(value: unknown): string {
  return safeString(value).toLowerCase();
}

function isNoResultsMessage(message: string) {
  const lower = message.toLowerCase();

  return (
    lower.includes("hasn't returned any results") ||
    lower.includes('has not returned any results') ||
    lower.includes('no results') ||
    lower.includes('empty') ||
    lower.includes('nothing found')
  );
}

function detectWorkModel(text: string): 'remote' | 'hybrid' | 'onsite' | 'any' {
  const value = normalise(text);

  if (value.includes('remote') || value.includes('zdalna')) return 'remote';
  if (value.includes('hybrid') || value.includes('hybrydowa')) return 'hybrid';

  if (
    value.includes('on-site') ||
    value.includes('onsite') ||
    value.includes('office based') ||
    value.includes('office-based') ||
    value.includes('stacjonarna')
  ) {
    return 'onsite';
  }

  return 'any';
}

function parsePostedAt(raw: unknown): string | null {
  const value = safeString(raw);
  if (!value) return null;

  const lower = value.toLowerCase();
  const now = new Date();

  if (lower.includes('hour')) {
    const hours = Number(lower.match(/\d+/)?.[0] || 1);
    now.setHours(now.getHours() - hours);
    return now.toISOString();
  }

  if (lower.includes('day')) {
    const days = Number(lower.match(/\d+/)?.[0] || 1);
    now.setDate(now.getDate() - days);
    return now.toISOString();
  }

  if (lower.includes('week')) {
    const weeks = Number(lower.match(/\d+/)?.[0] || 1);
    now.setDate(now.getDate() - weeks * 7);
    return now.toISOString();
  }

  if (lower.includes('month')) {
    const months = Number(lower.match(/\d+/)?.[0] || 1);
    now.setMonth(now.getMonth() - months);
    return now.toISOString();
  }

  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }

  return null;
}

function extractSalary(job: Record<string, unknown>): string | null {
  const detected = job.detected_extensions as Record<string, unknown> | undefined;

  const salary = safeString(
    detected?.salary ||
      job.salary ||
      job.salary_range ||
      job.compensation ||
      job.extracted_salary,
  );

  return salary || null;
}

function getFirstUrl(job: Record<string, unknown>): string {
  const direct = safeString(job.share_link || job.link || job.apply_link || job.url);
  if (direct) return direct;

  const applyOptions = job.apply_options;
  if (Array.isArray(applyOptions) && applyOptions.length > 0) {
    const first = applyOptions[0] as Record<string, unknown>;
    const link = safeString(first.link);
    if (link) return link;
  }

  const relatedLinks = job.related_links;
  if (Array.isArray(relatedLinks) && relatedLinks.length > 0) {
    const first = relatedLinks[0] as Record<string, unknown>;
    const link = safeString(first.link);
    if (link) return link;
  }

  const title = encodeURIComponent(safeString(job.title || 'job'));
  const company = encodeURIComponent(safeString(job.company_name || job.company || ''));
  return `https://www.google.com/search?q=${title}+${company}+job`;
}

function getResultsArray(data: Record<string, unknown>): Record<string, unknown>[] {
  const possibleKeys = ['jobs_results', 'organic_results', 'results', 'job_results'];

  for (const key of possibleKeys) {
    const value = data[key];

    if (Array.isArray(value)) {
      return value as Record<string, unknown>[];
    }
  }

  return [];
}

async function fetchWithTimeout(url: string, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function buildGoogleJob(
  job: Record<string, unknown>,
  fallbackLocation: string,
): RawJob | null {
  const title = safeString(job.title);
  const company = safeString(job.company_name || job.company);
  const jobId = safeString(job.job_id || job.id || job.link || getFirstUrl(job));

  if (!title || !company || !jobId) return null;

  const description = safeString(job.description || job.snippet);
  const location = safeString(job.location) || fallbackLocation;

  const detected = job.detected_extensions as Record<string, unknown> | undefined;

  const employmentType = safeString(
    detected?.schedule_type ||
      detected?.employment_type ||
      job.job_type ||
      job.type,
  );

  const url = getFirstUrl(job);

  return {
    source: 'google_jobs',
    external_id: jobId,
    title,
    company,
    location,
    job_url: url,
    description: description || null,
    salary_range: extractSalary(job),
    employment_type: employmentType || null,
    work_model: detectWorkModel(`${title} ${location} ${description} ${employmentType}`),
    source_posted_at: parsePostedAt(
      detected?.posted_at ||
        detected?.posted ||
        detected?.date ||
        job.date ||
        job.posted_at,
    ),
    raw_data: job,
  };
}

function buildIndeedJob(
  job: Record<string, unknown>,
  fallbackLocation: string,
): RawJob | null {
  const title = safeString(job.title);
  const company = safeString(job.company || job.company_name);
  const jobId = safeString(job.job_id || job.id || job.link || job.url || getFirstUrl(job));

  if (!title || !company || !jobId) return null;

  const description = safeString(job.description || job.snippet);
  const location = safeString(job.location) || fallbackLocation;
  const url = safeString(job.link || job.url) || getFirstUrl(job);

  return {
    source: 'indeed',
    external_id: jobId,
    title,
    company,
    location,
    job_url: url,
    description: description || null,
    salary_range: extractSalary(job),
    employment_type: safeString(job.job_type || job.type) || null,
    work_model: detectWorkModel(`${title} ${location} ${description}`),
    source_posted_at: parsePostedAt(job.date || job.posted_at),
    raw_data: job,
  };
}

function cleanOrganicTitle(title: string) {
  return title
    .replace(/\s+\|\s+.*$/g, '')
    .replace(/\s+-\s+LinkedIn.*$/gi, '')
    .replace(/\s+-\s+Pracuj\.pl.*$/gi, '')
    .replace(/\s+-\s+JustJoinIT.*$/gi, '')
    .replace(/\s+-\s+NoFluffJobs.*$/gi, '')
    .trim();
}

function inferCompanyFromOrganic(job: Record<string, unknown>, source: SearchSource) {
  const displayedLink = safeString(job.displayed_link);
  const sourceName = source;

  if (displayedLink) {
    const parts = displayedLink.split('›').map((part) => part.trim());
    if (parts.length >= 2) {
      return parts[1];
    }
  }

  return BOARD_SOURCES[source as keyof typeof BOARD_SOURCES]?.label || sourceName;
}

function buildOrganicBoardJob(
  job: Record<string, unknown>,
  source: Exclude<SearchSource, 'google_jobs' | 'indeed'>,
  fallbackLocation: string,
): RawJob | null {
  const title = cleanOrganicTitle(safeString(job.title));
  const url = safeString(job.link);

  if (!title || !url) return null;

  const snippet = safeString(job.snippet);
  const company = inferCompanyFromOrganic(job, source);
  const sourceLabel = BOARD_SOURCES[source].label;

  return {
    source,
    external_id: url,
    title,
    company,
    location: fallbackLocation,
    job_url: url,
    description: snippet || null,
    salary_range: extractSalary(job),
    employment_type: null,
    work_model: detectWorkModel(`${title} ${snippet} ${fallbackLocation}`),
    source_posted_at: parsePostedAt(
      (job.date as string | undefined) ||
        (job.rich_snippet as Record<string, unknown> | undefined)?.top?.detected_extensions,
    ),
    raw_data: {
      ...job,
      source_label: sourceLabel,
    },
  } as RawJob;
}

async function fetchGoogleJobs(
  query: string,
  location: string,
  serpApiKey: string,
  limit: number,
): Promise<RawJob[]> {
  const params = new URLSearchParams({
    engine: 'google_jobs',
    q: `${query} jobs`,
    location,
    hl: 'en',
    gl: 'pl',
    api_key: serpApiKey,
  });

  const url = `https://serpapi.com/search.json?${params}`;

  console.log('[fetcher] Google Jobs query:', {
    query,
    location,
  });

  const response = await fetchWithTimeout(url);
  const text = await response.text();

  if (!response.ok) {
    console.error('[fetcher] Google Jobs HTTP failed:', response.status, text);
    return [];
  }

  let data: Record<string, unknown>;

  try {
    data = JSON.parse(text);
  } catch {
    console.error('[fetcher] Google Jobs invalid JSON:', text);
    return [];
  }

  if (data.error) {
    const message = String(data.error);
    console.warn('[fetcher] Google Jobs SerpAPI message:', message);

    if (isNoResultsMessage(message)) {
      return [];
    }

    throw new Error(`Google Jobs SerpAPI error: ${message}`);
  }

  const results = getResultsArray(data);

  console.log('[fetcher] Google Jobs results count:', results.length);

  return results
    .slice(0, limit)
    .map((job) => buildGoogleJob(job, location))
    .filter(Boolean) as RawJob[];
}

async function fetchIndeedJobs(
  query: string,
  location: string,
  serpApiKey: string,
  limit: number,
): Promise<RawJob[]> {
  const params = new URLSearchParams({
    engine: 'indeed',
    q: query,
    l: location,
    country: 'PL',
    api_key: serpApiKey,
  });

  const url = `https://serpapi.com/search.json?${params}`;

  console.log('[fetcher] Indeed query:', {
    query,
    location,
  });

  const response = await fetchWithTimeout(url);
  const text = await response.text();

  if (!response.ok) {
    console.error('[fetcher] Indeed HTTP failed:', response.status, text);
    return [];
  }

  let data: Record<string, unknown>;

  try {
    data = JSON.parse(text);
  } catch {
    console.error('[fetcher] Indeed invalid JSON:', text);
    return [];
  }

  if (data.error) {
    const message = String(data.error);
    console.warn('[fetcher] Indeed SerpAPI message:', message);

    if (isNoResultsMessage(message)) {
      return [];
    }

    throw new Error(`Indeed SerpAPI error: ${message}`);
  }

  const results = getResultsArray(data);

  console.log('[fetcher] Indeed results count:', results.length);

  return results
    .slice(0, limit)
    .map((job) => buildIndeedJob(job, location))
    .filter(Boolean) as RawJob[];
}

async function fetchOrganicBoardJobs(
  source: Exclude<SearchSource, 'google_jobs' | 'indeed'>,
  query: string,
  location: string,
  serpApiKey: string,
  limit: number,
): Promise<RawJob[]> {
  const board = BOARD_SOURCES[source];

  if (!board) return [];

  const jobs: RawJob[] = [];

  for (const siteQuery of board.siteQueries) {
    const searchQuery = `${siteQuery} ${query} ${location} job`;

    const params = new URLSearchParams({
      engine: 'google',
      q: searchQuery,
      hl: 'en',
      gl: 'pl',
      num: String(limit),
      api_key: serpApiKey,
    });

    const url = `https://serpapi.com/search.json?${params}`;

    console.log('[fetcher] Board search query:', {
      source,
      searchQuery,
    });

    const response = await fetchWithTimeout(url);
    const text = await response.text();

    if (!response.ok) {
      console.error(`[fetcher] ${source} HTTP failed:`, response.status, text);
      continue;
    }

    let data: Record<string, unknown>;

    try {
      data = JSON.parse(text);
    } catch {
      console.error(`[fetcher] ${source} invalid JSON:`, text);
      continue;
    }

    if (data.error) {
      const message = String(data.error);
      console.warn(`[fetcher] ${source} SerpAPI message:`, message);

      if (isNoResultsMessage(message)) {
        continue;
      }

      continue;
    }

    const results = getResultsArray(data);

    console.log(`[fetcher] ${source} organic results count:`, results.length);

    const mapped = results
      .slice(0, limit)
      .map((job) => buildOrganicBoardJob(job, source, location))
      .filter(Boolean) as RawJob[];

    jobs.push(...mapped);

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return jobs;
}

function getSearchSources(preferences: UserJobPreferences): SearchSource[] {
  const enabled = preferences.enabled_sources || [];

  const defaultSources: SearchSource[] = [
    'google_jobs',
    'linkedin',
    'justjoinit',
    'nofluffjobs',
    'pracuj',
    'pracuj_it',
    'theprotocol',
    'bulldogjob',
    'crossweb',
    'indeed',
  ];

  if (enabled.length === 0) {
    return defaultSources;
  }

  const allowed = new Set<SearchSource>(defaultSources);

  const selected = enabled.filter((source): source is SearchSource =>
    allowed.has(source as SearchSource),
  );

  if (selected.length === 0) {
    return defaultSources;
  }

  return selected;
}

function removeDuplicates(jobs: RawJob[]) {
  const seen = new Set<string>();

  return jobs.filter((job) => {
    const key = `${job.source}:${job.external_id || job.job_url}`.toLowerCase();

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

export async function fetchJobsForPreferences(
  preferences: UserJobPreferences,
  serpApiKey: string,
  perQueryLimit = 5,
): Promise<{
  jobs: RawJob[];
  queriesRun: Array<{ source: string; query: string; location: string }>;
  sourcesUsed: string[];
}> {
  const titles =
    preferences.target_titles?.length > 0
      ? preferences.target_titles
      : DEFAULT_TARGET_TITLES;

  const locations =
    preferences.preferred_locations?.length > 0
      ? preferences.preferred_locations
      : DEFAULT_LOCATIONS;

  const sources = getSearchSources(preferences);

  const queries = titles.slice(0, 3).flatMap((title) =>
  locations.slice(0, 2).map((location) => ({
    title,
    location,
  })),
);

  console.log('[fetcher] selected sources:', sources);
  console.log('[fetcher] selected titles:', titles);
  console.log('[fetcher] selected locations:', locations);
  console.log('[fetcher] total query combinations:', queries.length);

  const jobs: RawJob[] = [];
  const queriesRun: Array<{ source: string; query: string; location: string }> = [];

  for (const query of queries) {
    for (const source of sources) {
      queriesRun.push({
        source,
        query: query.title,
        location: query.location,
      });

      try {
        if (source === 'google_jobs') {
          const found = await fetchGoogleJobs(
            query.title,
            query.location,
            serpApiKey,
            perQueryLimit,
          );

          jobs.push(...found);
        } else if (source === 'indeed') {
          const found = await fetchIndeedJobs(
            query.title,
            query.location,
            serpApiKey,
            perQueryLimit,
          );

          jobs.push(...found);
        } else {
          const found = await fetchOrganicBoardJobs(
            source,
            query.title,
            query.location,
            serpApiKey,
            perQueryLimit,
          );

          jobs.push(...found);
        }
      } catch (error) {
        console.error(`[fetcher] ${source} failed:`, error);

        queriesRun.push({
          source: `${source}_error`,
          query: error instanceof Error ? error.message : String(error),
          location: query.location,
        });

        continue;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  const uniqueJobs = removeDuplicates(jobs);

  console.log('[fetcher] total raw jobs:', jobs.length);
  console.log('[fetcher] total unique jobs:', uniqueJobs.length);

  return {
    jobs: uniqueJobs,
    queriesRun,
    sourcesUsed: sources,
  };
}