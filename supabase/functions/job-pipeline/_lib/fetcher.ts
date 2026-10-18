import { fetchAdzunaJobs, type AdzunaConfig } from './adzuna.ts';
import { classifyWorkModel } from './jobFilters.ts';
import { cleanSearchError, type SearchReport } from './searchReport.ts';
import {
  canonicalLinkedInJobUrl,
  findLinkedInJobLink,
  LINKEDIN_MAX_CALLS,
  linkedInJobId,
  linkedInSearchQuery,
} from './linkedin.ts';
import { cleanTerms, DEFAULT_MAX_SEARCH_CALLS, planSearchQueries, type SearchCombination } from './queryPlan.ts';
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
  | 'crossweb'
  // Official API with exact posting times (see adzuna.ts); not a SerpAPI search.
  | 'adzuna';

const BOARD_SOURCES: Record<
  Exclude<SearchSource, 'google_jobs' | 'indeed' | 'adzuna'>,
  {
    label: string;
    siteQueries: string[];
  }
> = {
  // Not searched: LinkedIn postings come from Google Jobs (fetchLinkedInJobs).
  linkedin: {
    label: 'LinkedIn',
    siteQueries: [],
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

// ─────────────────────────────────────────────────────────────────────────
// Basic string helpers
// ─────────────────────────────────────────────────────────────────────────

function safeString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalise(value: unknown): string {
  return safeString(value).toLowerCase();
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanUrl(url: string): string {
  const value = safeString(url);

  if (!value) return '';

  try {
    const parsed = new URL(value);

    [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'gclid',
      'fbclid',
      'trk',
      'ref',
      'refId',
      'trackingId',
      'position',
      'pageNum',
      'from',
      'src',
    ].forEach((param) => parsed.searchParams.delete(param));

    parsed.hash = '';

    return parsed.toString();
  } catch {
    return value;
  }
}

function cleanUrlForKey(url: string): string {
  try {
    const parsed = new URL(cleanUrl(url));
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().toLowerCase();
  } catch {
    return safeString(url).toLowerCase().split('?')[0].split('#')[0];
  }
}

// A failed SerpAPI answer as one line: its error message, or the HTTP status.
function serpApiFailure(label: string, status: number, text: string) {
  try {
    const message = safeString((JSON.parse(text) as Record<string, unknown>).error);
    if (message) return message;
  } catch {
    // Not JSON.
  }
  return `${label} answered with HTTP ${status}.`;
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

  if (/just (now|posted)|today|minute|moments? ago|\bnow\b/.test(lower)) {
    return now.toISOString();
  }

  if (lower.includes('yesterday')) {
    now.setDate(now.getDate() - 1);
    return now.toISOString();
  }

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

function extractOrganicPostedAt(job: Record<string, unknown>): string | null {
  const richSnippet = job.rich_snippet as Record<string, unknown> | undefined;
  const richSnippetTop = richSnippet?.top as Record<string, unknown> | undefined;
  const detectedExtensions = richSnippetTop?.detected_extensions as
    | Record<string, unknown>
    | undefined;

  const postedAt =
    job.date ||
    job.posted_at ||
    job.posted ||
    detectedExtensions?.posted_at ||
    detectedExtensions?.posted ||
    detectedExtensions?.date ||
    detectedExtensions?.detected_extensions;

  return parsePostedAt(postedAt);
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
  if (direct) return cleanUrl(direct);

  const applyOptions = job.apply_options;
  if (Array.isArray(applyOptions) && applyOptions.length > 0) {
    const first = applyOptions[0] as Record<string, unknown>;
    const link = safeString(first.link);
    if (link) return cleanUrl(link);
  }

  const relatedLinks = job.related_links;
  if (Array.isArray(relatedLinks) && relatedLinks.length > 0) {
    const first = relatedLinks[0] as Record<string, unknown>;
    const link = safeString(first.link);
    if (link) return cleanUrl(link);
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

// ─────────────────────────────────────────────────────────────────────────
// Rejection filter
// ─────────────────────────────────────────────────────────────────────────

const LISTING_URL_PATTERNS: RegExp[] = [
  /\/jobs\/?(\?|$)/i,
  /\/jobs\/search/i,
  /\/job-offers\/?(\?|$)/i,
  /\/praca\/?(\?|$)/i,
  /\/praca\/lista/i,
  /\/oferty-pracy\/?(\?|$)/i,
  /\/companies\/jobs\/?(\?|$)/i,
  /\/category\//i,
  /\/categories\//i,
  /\/szukaj/i,
  /\/search\//i,
  /\/career(s)?\/?(\?|$)/i,
];

const LISTING_TITLE_PATTERNS: RegExp[] = [
  /^\d+\s*(oferty?|offers?|jobs?|wyniki)/i,
  /\boferty pracy\b/i,
  /\bjob(s)? in\b/i,
  /\bsearch results\b/i,
  /\bwyniki wyszukiwania\b/i,
  /\bcareer page\b/i,
  /\bview all jobs\b/i,
  /\ball jobs\b/i,
  /\bbrowse jobs\b/i,
  /^\s*praca\s*$/i,
];

const LISTING_SNIPPET_PATTERNS: RegExp[] = [
  /\bsearch results\b/i,
  /\bview all jobs\b/i,
  /\d+\s*(oferty?|offers?)\s*(pracy)?/i,
];

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

interface RejectionCheckInput {
  title: string;
  company: string;
  url: string;
  description: string;
  // The URL is known to be one job (Google Jobs' own page), so its shape
  // isn't checked.
  singleJobUrl?: boolean;
}

function getRejectionReason(input: RejectionCheckInput): string | null {
  const { title, company, url, description, singleJobUrl } = input;

  if (!title || title.length < 3) return 'missing_or_too_short_title';
  if (!url) return 'missing_url';

  const cleanedUrl = cleanUrl(url);

  if (!singleJobUrl && matchesAny(cleanedUrl, LISTING_URL_PATTERNS)) return 'listing_url_pattern';
  if (matchesAny(title, LISTING_TITLE_PATTERNS)) return 'listing_title_pattern';
  if (matchesAny(description, LISTING_SNIPPET_PATTERNS)) return 'listing_snippet_pattern';

  if (/^\d+\+?$/.test(title.trim())) return 'numeric_only_title';

  if (!company || company.length < 2) return 'missing_company';
  if (singleJobUrl) return null;

  const urlPath = (() => {
    try {
      return new URL(cleanedUrl).pathname;
    } catch {
      return cleanedUrl;
    }
  })();

  const pathSegments = urlPath.split('/').filter(Boolean);
  const lastSegment = pathSegments[pathSegments.length - 1] || '';

  if (pathSegments.length <= 1) return 'url_too_shallow_for_single_job';

  if (lastSegment.length < 4 && !/^\d+$/.test(lastSegment)) {
    return 'url_last_segment_too_short';
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Title / company cleaning
// ─────────────────────────────────────────────────────────────────────────

const TITLE_SUFFIX_PATTERNS: RegExp[] = [
  /\s+\|\s+.*$/,
  /\s+-\s+LinkedIn.*$/i,
  /\s+-\s+Pracuj\.pl.*$/i,
  /\s+-\s+JustJoinIT.*$/i,
  /\s+-\s+NoFluffJobs.*$/i,
  /\s+-\s+TheProtocol\.it.*$/i,
  /\s+-\s+Bulldogjob.*$/i,
  /\s+-\s+Crossweb.*$/i,
  /\s+\(\d+\)\s*$/,
];

const COMPANY_LEGAL_SUFFIX =
  /(sp\.?\s*z\s*o\.?\s*o\.?|s\.?a\.?|sp\.?\s*k\.?|gmbh|inc\.?|ltd\.?|llc|s\.?r\.?o\.?|plc)\.?$/i;

const BAD_COMPANY_VALUES = [
  'job',
  'jobs',
  'praca',
  'szczegoly',
  'szczegóły',
  'details',
  'career',
  'careers',
  'unknown',
  'company',
  'search',
  'results',
  'linkedin',
  'indeed',
];

function stripTitleSuffixes(title: string): string {
  let cleaned = title;

  for (const pattern of TITLE_SUFFIX_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  return collapseWhitespace(cleaned);
}

function splitTrailingCompanyFromCommaList(title: string): { title: string; company: string | null } {
  const segments = title
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length < 2) {
    return { title, company: null };
  }

  const last = segments[segments.length - 1];

  if (COMPANY_LEGAL_SUFFIX.test(last) || /\b(poland|polska)\b/i.test(last)) {
    return {
      title: collapseWhitespace(segments.slice(0, -1).join(', ')),
      company: last,
    };
  }

  return { title, company: null };
}

function splitTitleAtCompany(title: string): { title: string; company: string | null } {
  const match = title.match(/^(.*?)\s+(?:at|@)\s+(.+)$/i);

  if (!match) return { title, company: null };

  const [, rawTitle, rawCompany] = match;

  if (!rawTitle.trim() || !rawCompany.trim()) {
    return { title, company: null };
  }

  return {
    title: collapseWhitespace(rawTitle),
    company: collapseWhitespace(rawCompany),
  };
}

function splitTitleDashCompany(title: string): { title: string; company: string | null } {
  const match = title.match(/^(.+?)\s+[-–]\s+(.+)$/);

  if (!match) return { title, company: null };

  const [, rawTitle, rawCompany] = match;

  if (!rawTitle.trim() || !rawCompany.trim()) {
    return { title, company: null };
  }

  if (rawCompany.split(' ').length > 6) {
    return { title, company: null };
  }

  return {
    title: collapseWhitespace(rawTitle),
    company: collapseWhitespace(rawCompany),
  };
}

function cleanCompanyName(company: string): string {
  let cleaned = collapseWhitespace(company);

  cleaned = cleaned.replace(/^(at|@)\s+/i, '');
  cleaned = cleaned.replace(/^["'(]+|["')]+$/g, '');
  cleaned = cleaned.replace(
    /\s*[-|]\s*(LinkedIn|Pracuj\.pl|JustJoinIT|NoFluffJobs|TheProtocol\.it|Indeed|Bulldogjob|Crossweb)\s*$/i,
    '',
  );

  return collapseWhitespace(cleaned);
}

function isPlausibleCompanyName(company: string): boolean {
  const cleaned = normalise(company);

  if (!cleaned || cleaned.length < 2) return false;
  if (/^\d+$/.test(cleaned)) return false;
  if (BAD_COMPANY_VALUES.includes(cleaned)) return false;
  if (matchesAny(company, LISTING_TITLE_PATTERNS)) return false;

  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// Source-specific title/company parsers
// ─────────────────────────────────────────────────────────────────────────

function parseTheProtocol(rawTitle: string): { title: string; company: string | null } {
  const commaSplit = splitTrailingCompanyFromCommaList(rawTitle);
  if (commaSplit.company) return commaSplit;

  return splitTitleDashCompany(rawTitle);
}

function parseLinkedIn(rawTitle: string): { title: string; company: string | null } {
  const atSplit = splitTitleAtCompany(rawTitle);
  if (atSplit.company) return atSplit;

  const hiringMatch = rawTitle.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+.+$/i);

  if (hiringMatch) {
    const [, company, title] = hiringMatch;

    return {
      title: collapseWhitespace(title),
      company: collapseWhitespace(company),
    };
  }

  return { title: rawTitle, company: null };
}

function parsePracuj(rawTitle: string): { title: string; company: string | null } {
  const dashSplit = splitTitleDashCompany(rawTitle);
  if (dashSplit.company) return dashSplit;

  return splitTrailingCompanyFromCommaList(rawTitle);
}

function parseJustJoinIt(rawTitle: string): { title: string; company: string | null } {
  const inMatch = rawTitle.match(/^(.+?)\s+in\s+(.+)$/i);

  if (inMatch) {
    const [, title, company] = inMatch;

    if (company.trim().length >= 2) {
      return {
        title: collapseWhitespace(title),
        company: collapseWhitespace(company),
      };
    }
  }

  return splitTitleDashCompany(rawTitle);
}

function parseGenericBoard(rawTitle: string): { title: string; company: string | null } {
  const atSplit = splitTitleAtCompany(rawTitle);
  if (atSplit.company) return atSplit;

  const commaSplit = splitTrailingCompanyFromCommaList(rawTitle);
  if (commaSplit.company) return commaSplit;

  return splitTitleDashCompany(rawTitle);
}

const SOURCE_TITLE_PARSERS: Record<
  Exclude<SearchSource, 'google_jobs' | 'indeed' | 'adzuna'>,
  (rawTitle: string) => { title: string; company: string | null }
> = {
  theprotocol: parseTheProtocol,
  linkedin: parseLinkedIn,
  pracuj: parsePracuj,
  pracuj_it: parsePracuj,
  justjoinit: parseJustJoinIt,
  nofluffjobs: parseGenericBoard,
  bulldogjob: parseGenericBoard,
  crossweb: parseGenericBoard,
};

function inferCompanyFromDisplayedLink(job: Record<string, unknown>): string | null {
  const displayedLink = safeString(job.displayed_link);

  if (!displayedLink) return null;

  const parts = displayedLink
    .split('›')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const candidate = cleanCompanyName(parts[1]);

    if (isPlausibleCompanyName(candidate)) {
      return candidate;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Builders
// ─────────────────────────────────────────────────────────────────────────

function buildGoogleJob(job: Record<string, unknown>, fallbackLocation: string): RawJob | null {
  const title = safeString(job.title);
  const company = cleanCompanyName(safeString(job.company_name || job.company));
  const jobId = safeString(job.job_id || job.id || job.link || getFirstUrl(job));

  if (!title || !company || !jobId) return null;

  const description = safeString(job.description || job.snippet);
  const location = safeString(job.location) || fallbackLocation;

  // Link to the posting itself: a link the caller chose, else the first
  // "Apply on" option that looks like a single job, else Google's own page
  // for the job (a google.com/search link, which is still one job).
  const applyOptions = Array.isArray(job.apply_options) ? (job.apply_options as Record<string, unknown>[]) : [];
  const chosenLink = safeString(job.link);
  const postingLink = (chosenLink ? [chosenLink] : applyOptions.map((option) => safeString(option.link)))
    .map(cleanUrl)
    .find((link) => link && !getRejectionReason({ title, company, url: link, description }));
  const url = postingLink || cleanUrl(getFirstUrl(job));

  const rejection = getRejectionReason({
    title,
    company,
    url,
    description,
    singleJobUrl: !postingLink,
  });

  if (rejection) {
    console.log('[fetcher] rejected google_jobs result:', rejection, {
      title,
      company,
      url,
    });

    return null;
  }

  const detected = job.detected_extensions as Record<string, unknown> | undefined;

  const employmentType = safeString(
    detected?.schedule_type || detected?.employment_type || job.job_type || job.type,
  );

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
    work_model:
      classifyWorkModel({ title, location, description }, detected?.work_from_home === true) ?? 'any',
    source_posted_at: parsePostedAt(
      detected?.posted_at || detected?.posted || detected?.date || job.date || job.posted_at,
    ),
    raw_data: job,
  };
}

function buildIndeedJob(job: Record<string, unknown>, fallbackLocation: string): RawJob | null {
  const title = safeString(job.title);
  const company = cleanCompanyName(safeString(job.company || job.company_name));
  const jobId = safeString(job.job_id || job.id || job.link || job.url || getFirstUrl(job));

  if (!title || !company || !jobId) return null;

  const description = safeString(job.description || job.snippet);
  const location = safeString(job.location) || fallbackLocation;
  const url = cleanUrl(safeString(job.link || job.url) || getFirstUrl(job));

  const rejection = getRejectionReason({
    title,
    company,
    url,
    description,
  });

  if (rejection) {
    console.log('[fetcher] rejected indeed result:', rejection, {
      title,
      company,
      url,
    });

    return null;
  }

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

function buildOrganicBoardJob(
  job: Record<string, unknown>,
  source: Exclude<SearchSource, 'google_jobs' | 'indeed' | 'adzuna'>,
  fallbackLocation: string,
): RawJob | null {
  const rawTitle = collapseWhitespace(safeString(job.title));
  const url = cleanUrl(safeString(job.link));
  const snippet = safeString(job.snippet);
  const sourceLabel = BOARD_SOURCES[source].label;

  if (!rawTitle || !url) return null;

  const earlyRejection = getRejectionReason({
    title: rawTitle,
    company: '',
    url,
    description: snippet,
  });

  if (
    earlyRejection &&
    earlyRejection !== 'missing_company' &&
    earlyRejection !== 'url_too_shallow_for_single_job' &&
    earlyRejection !== 'url_last_segment_too_short'
  ) {
    console.log('[fetcher] rejected organic result (pre-parse):', earlyRejection, {
      source,
      rawTitle,
      url,
    });

    return null;
  }

  if (
    earlyRejection === 'url_too_shallow_for_single_job' ||
    earlyRejection === 'url_last_segment_too_short'
  ) {
    console.log('[fetcher] rejected organic result (shallow url):', earlyRejection, {
      source,
      rawTitle,
      url,
    });

    return null;
  }

  const strippedTitle = stripTitleSuffixes(rawTitle);
  const parser = SOURCE_TITLE_PARSERS[source] ?? parseGenericBoard;
  const parsed = parser(strippedTitle);

  let title = collapseWhitespace(parsed.title);
  let company = parsed.company ? cleanCompanyName(parsed.company) : null;

  if (!company || !isPlausibleCompanyName(company)) {
    const fromDisplayedLink = inferCompanyFromDisplayedLink(job);

    if (fromDisplayedLink) {
      company = fromDisplayedLink;
    }
  }

  let companyIsFallback = false;

  if (!company || !isPlausibleCompanyName(company)) {
    company = sourceLabel;
    companyIsFallback = true;
  }

  const finalRejection = getRejectionReason({
    title,
    company,
    url,
    description: snippet,
  });

  if (finalRejection) {
    console.log('[fetcher] rejected organic result (post-parse):', finalRejection, {
      source,
      title,
      company,
      url,
    });

    return null;
  }

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
    source_posted_at: extractOrganicPostedAt(job),
    raw_data: {
      ...job,
      source_label: sourceLabel,
      company_is_fallback: companyIsFallback,
      source_confidence: companyIsFallback ? 'medium' : 'high',
      raw_title: rawTitle,
      cleaned_url: url,
    },
  } as RawJob;
}

// ─────────────────────────────────────────────────────────────────────────
// SerpAPI fetchers
// ─────────────────────────────────────────────────────────────────────────

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
    throw new Error(serpApiFailure('Google Jobs', response.status, text));
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

    throw new Error(message);
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
    throw new Error(serpApiFailure('Indeed', response.status, text));
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

    throw new Error(message);
  }

  const results = getResultsArray(data);

  console.log('[fetcher] Indeed results count:', results.length);

  return results
    .slice(0, limit)
    .map((job) => buildIndeedJob(job, location))
    .filter(Boolean) as RawJob[];
}

async function fetchOrganicBoardJobs(
  source: Exclude<SearchSource, 'google_jobs' | 'indeed' | 'adzuna'>,
  query: string,
  location: string,
  serpApiKey: string,
  limit: number,
): Promise<RawJob[]> {
  const board = BOARD_SOURCES[source];

  if (!board) return [];

  const jobs: RawJob[] = [];
  let rejectedCount = 0;

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
      continue;
    }

    const results = getResultsArray(data);

    console.log(`[fetcher] ${source} organic results count:`, results.length);

    for (const rawResult of results.slice(0, limit)) {
      const built = buildOrganicBoardJob(rawResult, source, location);

      if (built) {
        jobs.push(built);
      } else {
        rejectedCount += 1;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (rejectedCount > 0) {
    console.log(`[fetcher] ${source} rejected ${rejectedCount} non-job results`);
  }

  return jobs;
}

// A Google Jobs result posted on LinkedIn, as a LinkedIn job with the
// LinkedIn posting as its link (Google Jobs' own link is a google.com page).
function buildLinkedInJob(job: Record<string, unknown>, fallbackLocation: string): RawJob | null {
  const link = findLinkedInJobLink(job);
  if (!link) return null;

  const built = buildGoogleJob({ ...job, share_link: undefined, link }, fallbackLocation);
  if (!built) return null;

  return {
    ...built,
    source: 'linkedin',
    external_id: linkedInJobId(link) || built.external_id,
    job_url: canonicalLinkedInJobUrl(link),
  };
}

// LinkedIn postings: Google Jobs results posted on LinkedIn, with their
// title, company, location, description and posting date. Reads up to
// LINKEDIN_MAX_CALLS pages. A plain Google search of LinkedIn pages is not used:
// it mostly returned old, closed postings without dates.
async function fetchLinkedInJobs(
  query: string,
  location: string,
  workModel: string | null | undefined,
  serpApiKey: string,
  limit: number,
): Promise<{ jobs: RawJob[]; report: SearchReport }> {
  const jobs: RawJob[] = [];
  const report: SearchReport = { source: 'linkedin', title: query, location, listings: 0, viaLinkedIn: 0, matched: 0, error: null };
  let pageToken: string | null = null;

  console.log('[fetcher] LinkedIn (Google Jobs) query:', { query, location, workModel });

  for (let page = 0; page < LINKEDIN_MAX_CALLS && jobs.length < limit; page++) {
    const params = new URLSearchParams({
      engine: 'google_jobs',
      q: linkedInSearchQuery(query, location, workModel),
      hl: 'en',
      api_key: serpApiKey,
      ...(pageToken ? { next_page_token: pageToken } : {}),
    });

    let data: Record<string, unknown>;

    try {
      const response = await fetchWithTimeout(`https://serpapi.com/search.json?${params}`);
      const text = await response.text();

      if (!response.ok) {
        let detail = '';
        try {
          detail = String((JSON.parse(text) as Record<string, unknown>).error || '');
        } catch {
          // Not JSON.
        }
        console.error('[fetcher] LinkedIn (Google Jobs) HTTP failed:', response.status, cleanSearchError(detail));
        report.error = cleanSearchError(detail || `the search service answered with HTTP ${response.status}`);
        break;
      }

      data = JSON.parse(text) as Record<string, unknown>;
    } catch (error) {
      console.error('[fetcher] LinkedIn (Google Jobs) failed:', error instanceof Error ? error.message : error);
      report.error = cleanSearchError(error instanceof Error ? error.message : error);
      break;
    }

    if (data.error) {
      const message = String(data.error);
      console.warn('[fetcher] LinkedIn (Google Jobs) SerpAPI message:', cleanSearchError(message));
      // "No results" isn't a failure; anything else (quota, key, ...) is reported.
      if (!isNoResultsMessage(message)) report.error = cleanSearchError(message);
      break;
    }

    const results = getResultsArray(data);
    const linkedIn = results.map((job) => buildLinkedInJob(job, location)).filter(Boolean) as RawJob[];
    report.listings += results.length;
    report.viaLinkedIn += results.filter((job) => /linkedin/i.test(String(job.via ?? '')) || findLinkedInJobLink(job)).length;
    console.log(`[fetcher] LinkedIn postings in Google Jobs page ${page + 1}:`, linkedIn.length, 'of', results.length);
    jobs.push(...linkedIn);

    const pagination = data.serpapi_pagination as Record<string, unknown> | undefined;
    pageToken = typeof pagination?.next_page_token === 'string' ? pagination.next_page_token : null;
    if (!pageToken) break;
  }

  report.matched = Math.min(jobs.length, limit);
  return { jobs: jobs.slice(0, limit), report };
}

// The most paid SerpAPI calls one title/location pair can cost on a source.
function maxCallsForSource(source: SearchSource): number {
  if (source === 'google_jobs' || source === 'indeed' || source === 'adzuna') return 1;
  if (source === 'linkedin') return LINKEDIN_MAX_CALLS;
  return BOARD_SOURCES[source]?.siteQueries.length || 1;
}

// ─────────────────────────────────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────────────────────────────────

function getSearchSources(preferences: UserJobPreferences): SearchSource[] {
  const enabled = preferences.enabled_sources || [];

  const defaultSources: SearchSource[] = [
    'linkedin',
    'justjoinit',
    'nofluffjobs',
    'pracuj',
    'theprotocol',
    'indeed',
  ];

  if (enabled.length === 0) {
    return defaultSources;
  }

  // Every source this file can search. Google Jobs, Pracuj.pl IT,
  // Bulldogjob, Crossweb and Adzuna are only used when chosen.
  const allowed = new Set<SearchSource>([
    ...defaultSources,
    'google_jobs',
    'pracuj_it',
    'bulldogjob',
    'crossweb',
    'adzuna',
  ]);

  const selected = enabled.filter((source): source is SearchSource =>
    allowed.has(source as SearchSource),
  );

  if (selected.length === 0) {
    return defaultSources;
  }

  return selected;
}

function removeDuplicates(jobs: RawJob[]) {
  const seenUrls = new Set<string>();
  const seenTitleCompanyLocation = new Set<string>();

  return jobs.filter((job) => {
    const urlKey = cleanUrlForKey(job.job_url || job.external_id || '');

    const titleCompanyLocationKey = [
      normalise(job.title),
      normalise(job.company),
      normalise(job.location),
    ].join('|');

    if (urlKey && seenUrls.has(urlKey)) {
      return false;
    }

    if (titleCompanyLocationKey && seenTitleCompanyLocation.has(titleCompanyLocationKey)) {
      return false;
    }

    if (urlKey) {
      seenUrls.add(urlKey);
    }

    if (titleCompanyLocationKey) {
      seenTitleCompanyLocation.add(titleCompanyLocationKey);
    }

    return true;
  });
}

export async function fetchJobsForPreferences(
  preferences: UserJobPreferences,
  serpApiKey: string,
  perQueryLimit = 2,
  maxSearchCalls = DEFAULT_MAX_SEARCH_CALLS,
  options: { adzuna?: AdzunaConfig | null } = {},
): Promise<{
  jobs: RawJob[];
  queriesRun: Array<{ source: string; query: string; location: string }>;
  sourcesUsed: string[];
  // Title/location combinations searched on every source this run, and the
  // ones left for later (per-run call cap or time budget).
  combinationsSearched: SearchCombination[];
  combinationsSkipped: SearchCombination[];
  // What each search returned (LinkedIn), to explain empty runs.
  searchReports: SearchReport[];
}> {

  const startedAt = Date.now();
  const maxRuntimeMs = 120_000;

  const hasTimeBudget = () => Date.now() - startedAt < maxRuntimeMs;
  // Only what the user set; with no titles or locations nothing is searched.
  const titles = cleanTerms(preferences.target_titles);
  const locations = cleanTerms(preferences.preferred_locations);

  const sources = getSearchSources(preferences);

  // Every title and location the user set, within the per-run call cap.
  const plan = planSearchQueries({
    titles,
    locations,
    callsPerCombination: sources.reduce((total, source) => total + maxCallsForSource(source), 0),
    maxCalls: maxSearchCalls,
  });
  const queries = plan.combinations;
  const combinationsSearched: SearchCombination[] = [];
  const combinationsSkipped: SearchCombination[] = [...plan.skipped];

  console.log('[fetcher] selected sources:', sources);
  console.log('[fetcher] selected titles:', titles);
  console.log('[fetcher] selected locations:', locations);
  console.log('[fetcher] query combinations:', queries.length, 'of', queries.length + plan.skipped.length);

  const jobs: RawJob[] = [];
  const queriesRun: Array<{ source: string; query: string; location: string }> = [];
  const searchReports: SearchReport[] = [];

for (const [index, query] of queries.entries()) {
  if (!hasTimeBudget()) {
    console.warn('[fetcher] stopping before next query because time budget is nearly exhausted');
    combinationsSkipped.unshift(...queries.slice(index));
    break;
  }

  combinationsSearched.push(query);

  for (const source of sources) {
    if (!hasTimeBudget()) {
      console.warn('[fetcher] stopping before next source because time budget is nearly exhausted');
      break;
    }

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
      } else if (source === 'linkedin') {
        const { jobs: found, report } = await fetchLinkedInJobs(
          query.title,
          query.location,
          preferences.work_model,
          serpApiKey,
          perQueryLimit,
        );

        jobs.push(...found);
        searchReports.push(report);
      } else if (source === 'adzuna') {
        const { jobs: found, report } = await fetchAdzunaJobs(options.adzuna ?? null, {
          title: query.title,
          location: query.location,
          maxAgeDays: preferences.max_job_age_days,
          workModel: preferences.work_model,
          limit: perQueryLimit,
        });

        jobs.push(...found);
        searchReports.push(report);
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

      // Say which source failed and why, instead of it just finding nothing.
      searchReports.push({
        source,
        title: query.title,
        location: query.location,
        listings: 0,
        viaLinkedIn: 0,
        matched: 0,
        error: cleanSearchError(error instanceof Error ? error.message : error),
      });

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
    combinationsSearched,
    combinationsSkipped,
    searchReports,
  };
}