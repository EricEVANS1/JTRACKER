// What each search returned, so a run with no results says why ("Google Jobs
// had 10 listings, none posted on LinkedIn" or "the search service said …")
// instead of a bare "Scanned: 0". Shared by the job-pipeline function and the
// Job Automation page. No Deno or browser imports.

export interface SearchReport {
  source: string;
  title: string;
  location: string;
  // Listings Google Jobs returned (all pages read).
  listings: number;
  // Of those, how many said they were posted via LinkedIn.
  viaLinkedIn: number;
  // Of those, how many had a LinkedIn posting link and were kept.
  matched: number;
  error: string | null;
}

// Error text from the search service, without anything that looks like a key.
export const cleanSearchError = (message: unknown) =>
  String(message ?? '')
    .replace(/(api_key=)[^&\s"']+/gi, '$1***')
    .replace(/\b[a-f0-9]{40,}\b/gi, '***')
    .slice(0, 300);

const SOURCE_LABELS: Record<string, string> = { linkedin: 'LinkedIn' };

// One sentence per search that found nothing to keep.
export const describeSearchReports = (reports: SearchReport[] | null | undefined) =>
  (reports || [])
    .filter((report) => report.error || report.matched === 0)
    .map((report) => {
      const what = `${SOURCE_LABELS[report.source] || report.source} search for "${report.title}" in ${report.location}`;
      if (report.error) return `${what} failed: ${report.error}`;
      if (report.listings === 0) return `${what}: Google Jobs had no listings.`;
      if (report.viaLinkedIn === 0) return `${what}: Google Jobs had ${report.listings} listings, none posted on LinkedIn.`;
      return `${what}: ${report.viaLinkedIn} of ${report.listings} listings were posted on LinkedIn, but none had a LinkedIn link.`;
    });
