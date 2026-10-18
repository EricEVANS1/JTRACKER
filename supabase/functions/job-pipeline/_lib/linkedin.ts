// LinkedIn postings, found through SerpAPI's Google Jobs results (which list
// where each job is posted and link to the posting). LinkedIn itself isn't
// scraped: its terms forbid it and its jobs API is partner-only.
// Kept free of Deno imports so it can be unit tested.

// Below this many LinkedIn postings from Google Jobs, also run a plain Google
// search of linkedin.com/jobs/view pages.
export const MIN_LINKEDIN_RESULTS_BEFORE_FALLBACK = 3;

// Paid calls a LinkedIn search can make: Google Jobs, plus the fallback search.
export const LINKEDIN_MAX_CALLS = 2;

const asString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const isLinkedInJobPage = (value: string) => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (host === 'linkedin.com' || host.endsWith('.linkedin.com')) && /\/jobs\/view\//.test(url.pathname);
  } catch {
    return false;
  }
};

const linksFrom = (value: unknown) =>
  Array.isArray(value) ? value.map((item) => asString((item as Record<string, unknown>)?.link)) : [];

// The LinkedIn posting link of a Google Jobs result, if it has one.
export const findLinkedInJobLink = (job: Record<string, unknown>): string | null => {
  const candidates = [
    ...linksFrom(job.apply_options),
    ...linksFrom(job.related_links),
    asString(job.link),
    asString(job.apply_link),
  ];

  return candidates.find(isLinkedInJobPage) ?? null;
};

// LinkedIn's numeric job id from /jobs/view/<id> or /jobs/view/<slug>-<id>.
export const linkedInJobId = (url: string): string | null =>
  url.match(/\/jobs\/view\/(?:[^/?#]*?-)?(\d{6,})(?:[/?#]|$)/)?.[1] ?? null;

// One form per posting (no tracking parameters or country subdomains), so the
// same job found twice is recognised as one.
export const canonicalLinkedInJobUrl = (url: string): string => {
  const id = linkedInJobId(url);
  if (id) return `https://www.linkedin.com/jobs/view/${id}/`;

  try {
    const parsed = new URL(url);
    return `https://www.linkedin.com${parsed.pathname}`;
  } catch {
    return url;
  }
};

// Google Jobs query for a LinkedIn search. The location goes in the query
// (Google Jobs understands "… in London" and "… remote"), so no fixed country
// or SerpAPI location name is needed.
export const linkedInSearchQuery = (title: string, location: string) =>
  /^\s*remote\s*$/i.test(location) ? `${title} remote` : `${title} ${location}`.trim();
