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

export const SOURCE_LABELS: Record<string, string> = {
  google_jobs: 'Google Jobs',
  indeed: 'Indeed',
  linkedin: 'LinkedIn',
  justjoinit: 'JustJoinIT',
  nofluffjobs: 'NoFluffJobs',
  pracuj: 'Pracuj.pl',
  pracuj_it: 'Pracuj.pl IT',
  bulldogjob: 'Bulldogjob',
  theprotocol: 'TheProtocol.it',
  crossweb: 'Crossweb.pl',
  adzuna: 'Adzuna',
};

// One sentence per search that found nothing to keep.
export const describeSearchReports = (reports: SearchReport[] | null | undefined) =>
  (reports || [])
    .filter((report) => report.error || report.matched === 0)
    .map((report) => {
      const what = `${SOURCE_LABELS[report.source] || report.source} search for "${report.title}" in ${report.location}`;
      if (report.error) return `${what} failed: ${report.error}`;
      if (report.source !== 'linkedin') return `${what}: no listings.`;
      if (report.listings === 0) return `${what}: Google Jobs had no listings.`;
      if (report.viaLinkedIn === 0) return `${what}: Google Jobs had ${report.listings} listings, none posted on LinkedIn.`;
      return `${what}: ${report.viaLinkedIn} of ${report.listings} listings were posted on LinkedIn, but none had a LinkedIn link.`;
    });

// ── Per-source results ───────────────────────────────────────────────────

// What one source contributed to a run, so it's clear which sources find
// fresh jobs and which only return undated or old pages.
export interface SourceSummary {
  source: string;
  found: number;
  kept: number;
  undated: number;
  tooOld: number;
  // Closed, other work model or other experience level.
  otherFilters: number;
}

export const summariseSources = <T extends { source: string; source_posted_at?: string | null }>(
  sources: readonly string[],
  jobs: readonly T[],
  // The job's filter reason ('date', 'closed', ...), or null when it is kept.
  reasonOf: (job: T) => string | null,
): SourceSummary[] => {
  const summaries = new Map<string, SourceSummary>(
    sources.map((source) => [source, { source, found: 0, kept: 0, undated: 0, tooOld: 0, otherFilters: 0 }]),
  );

  for (const job of jobs) {
    let summary = summaries.get(job.source);
    if (!summary) {
      summary = { source: job.source, found: 0, kept: 0, undated: 0, tooOld: 0, otherFilters: 0 };
      summaries.set(job.source, summary);
    }

    summary.found++;
    const reason = reasonOf(job);
    if (!reason) summary.kept++;
    else if (reason !== 'date') summary.otherFilters++;
    else if (!job.source_posted_at || Number.isNaN(Date.parse(job.source_posted_at))) summary.undated++;
    else summary.tooOld++;
  }

  return [...summaries.values()];
};

// "By source: LinkedIn 8 found, 2 kept (6 older than past week); Indeed 0 found."
export const describeSourceSummaries = (summaries: SourceSummary[] | null | undefined, dateLabel: string) => {
  if (!summaries?.length) return '';

  const parts = summaries.map((summary) => {
    const label = SOURCE_LABELS[summary.source] || summary.source;
    if (summary.found === 0) return `${label} 0 found`;

    const removed = [
      summary.undated ? `${summary.undated} undated` : '',
      summary.tooOld ? `${summary.tooOld} older than ${dateLabel.toLowerCase()}` : '',
      summary.otherFilters ? `${summary.otherFilters} removed by other filters` : '',
    ].filter(Boolean);

    return `${label} ${summary.found} found, ${summary.kept} kept${removed.length ? ` (${removed.join(', ')})` : ''}`;
  });

  return `By source: ${parts.join('; ')}.`;
};
