import type { RawJob, UserJobPreferences } from './types.ts';

const DEFAULT_TARGET_TITLES = [
  'Technical Support Engineer',
  'IT Support Specialist',
  'Application Support Analyst',
  'Cloud Support Engineer',
  'Junior Software Engineer',
];

const DEFAULT_LOCATIONS = ['Warsaw, Poland', 'Poland', 'Remote Poland'];

function safeString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalise(value: unknown): string {
  return safeString(value).toLowerCase();
}

function getFirstUrl(job: Record<string, unknown>): string {
  const direct = safeString(job.share_link || job.link || job.apply_link);
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
  return `https://www.google.com/search?q=${title}`;
}

function detectWorkModel(text: string): 'remote' | 'hybrid' | 'onsite' | 'any' {
  const value = normalise(text);

  if (value.includes('remote')) return 'remote';
  if (value.includes('hybrid')) return 'hybrid';
  if (
    value.includes('on-site') ||
    value.includes('onsite') ||
    value.includes('office based') ||
    value.includes('office-based')
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

  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }

  return null;
}

function extractGooglePostedAt(job: Record<string, unknown>): string | null {
  const detected = job.detected_extensions as Record<string, unknown> | undefined;
  return parsePostedAt(detected?.posted_at || detected?.posted || job.date);
}

function extractSalary(job: Record<string, unknown>): string | null {
  const detected = job.detected_extensions as Record<string, unknown> | undefined;
  const salary = safeString(
    detected?.salary ||
      job.salary ||
      job.salary_range ||
      job.compensation,
  );

  return salary || null;
}

function buildGoogleJob(job: Record<string, unknown>, fallbackLocation: string): RawJob | null {
  const title = safeString(job.title);
  const company = safeString(job.company_name || job.company);
  const jobId = safeString(job.job_id || job.job_highlights?.job_id || getFirstUrl(job));

  if (!title || !company || !jobId) return null;

  const description = safeString(job.description || job.snippet);
  const location = safeString(job.location) || fallbackLocation;
  const employmentType = safeString(
    (job.detected_extensions as Record<string, unknown> | undefined)?.schedule_type ||
      job.job_type,
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
    work_model: detectWorkModel(`${title} ${location} ${description}`),
    source_posted_at: extractGooglePostedAt(job),
    raw_data: job,
  };
}

function buildIndeedJob(job: Record<string, unknown>, fallbackLocation: string): RawJob | null {
  const title = safeString(job.title);
  const company = safeString(job.company || job.company_name);
  const jobId = safeString(job.job_id || job.id || job.link || job.url);

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

async function fetchGoogleJobs(
  query: string,
  location: string,
  serpApiKey: string,
  limit: number,
): Promise<RawJob[]> {
  const params = new URLSearchParams({
    engine: 'google_jobs',
    q: `${query} ${location}`,
    location,
    hl: 'en',
    api_key: serpApiKey,
  });

  const response = await fetchWithTimeout(`https://serpapi.com/search.json?${params}`);

  if (!response.ok) {
    console.error('[fetcher] Google Jobs failed:', response.status, await response.text());
    return [];
  }

  const data = await response.json();
  const results = Array.isArray(data.jobs_results) ? data.jobs_results : [];

  return results
    .slice(0, limit)
    .map((job: Record<string, unknown>) => buildGoogleJob(job, location))
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

  const response = await fetchWithTimeout(`https://serpapi.com/search.json?${params}`);

  if (!response.ok) {
    console.error('[fetcher] Indeed failed:', response.status, await response.text());
    return [];
  }

  const data = await response.json();
  const results = Array.isArray(data.jobs_results) ? data.jobs_results : [];

  return results
    .slice(0, limit)
    .map((job: Record<string, unknown>) => buildIndeedJob(job, location))
    .filter(Boolean) as RawJob[];
}

function getSearchSources(preferences: UserJobPreferences): Array<'google_jobs' | 'indeed'> {
  const enabled = preferences.enabled_sources || [];

  const hasGoogle =
    enabled.includes('google_jobs') ||
    enabled.includes('serpapi_google') ||
    enabled.length === 0;

  const hasIndeed =
    enabled.includes('indeed') ||
    enabled.includes('serpapi_indeed') ||
    enabled.length === 0;

  const sources: Array<'google_jobs' | 'indeed'> = [];

  if (hasGoogle) sources.push('google_jobs');
  if (hasIndeed) sources.push('indeed');

  if (sources.length === 0) {
    return ['google_jobs', 'indeed'];
  }

  return sources;
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
  perQueryLimit = 10,
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

  const queries = titles.slice(0, 5).flatMap((title) =>
    locations.slice(0, 3).map((location) => ({
      title,
      location,
    })),
  );

  const jobs: RawJob[] = [];
  const queriesRun: Array<{ source: string; query: string; location: string }> = [];

  for (const query of queries) {
    for (const source of sources) {
      queriesRun.push({
        source,
        query: query.title,
        location: query.location,
      });

      if (source === 'google_jobs') {
        const found = await fetchGoogleJobs(
          query.title,
          query.location,
          serpApiKey,
          perQueryLimit,
        );
        jobs.push(...found);
      }

      if (source === 'indeed') {
        const found = await fetchIndeedJobs(
          query.title,
          query.location,
          serpApiKey,
          perQueryLimit,
        );
        jobs.push(...found);
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  return {
    jobs: removeDuplicates(jobs),
    queriesRun,
    sourcesUsed: sources,
  };
}