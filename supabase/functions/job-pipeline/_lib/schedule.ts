// Scheduled job searches: who runs, how a scheduled request is trusted, and
// the alert a run sends. No Deno imports, so it can be unit tested.

// A user isn't searched again within this gap (any run, manual or scheduled).
export const MIN_GAP_BETWEEN_RUNS_MS = 50 * 60 * 1000;

// Stop starting new users after this long, to stay inside the function's
// time limit; the rest are searched first on the next scheduled run.
export const SCHEDULED_RUN_BUDGET_MS = 60 * 1000;

export const DEFAULT_SCHEDULED_MAX_CALLS = 6;

// Constant-time comparison of the scheduler's secret header.
export const isScheduleSecretValid = (provided: string | null | undefined, expected: string | null | undefined) => {
  if (!provided || !expected || expected.length < 16) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
};

// Users with automation on, longest-waiting first, minus anyone searched
// within the gap.
export const usersDueForSearch = (
  userIds: string[],
  lastRunAt: Record<string, string | null | undefined>,
  now = Date.now(),
  minGapMs = MIN_GAP_BETWEEN_RUNS_MS,
) =>
  [...new Set(userIds)]
    .map((userId) => ({ userId, last: lastRunAt[userId] ? Date.parse(lastRunAt[userId] as string) : 0 }))
    .filter(({ last }) => Number.isNaN(last) || now - last >= minGapMs)
    .sort((a, b) => a.last - b.last)
    .map(({ userId }) => userId);

export interface MatchForAlert {
  title: string;
  company: string | null;
  score: number;
}

// One notification per scheduled run that found new matches, naming the best.
export const buildMatchAlert = (matches: MatchForAlert[]) => {
  if (!matches.length) return null;

  const best = [...matches].sort((a, b) => b.score - a.score);
  const name = (match: MatchForAlert) => `${match.title}${match.company ? ` at ${match.company}` : ''}`;
  const listed = best.slice(0, 3).map((match) => `${name(match)} (${Math.round(match.score)}/100)`);
  const more = best.length > 3 ? ` and ${best.length - 3} more` : '';

  return {
    type: 'job_match',
    title: best.length === 1 ? `New job match: ${name(best[0])}` : `${best.length} new job matches`,
    message: `${listed.join('; ')}${more}. Open Job Automation to review and apply early.`,
  };
};
