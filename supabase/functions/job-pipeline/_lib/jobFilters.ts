// Job search filters modelled on LinkedIn's: date posted, work model
// (on-site / remote / hybrid) and experience level, plus dropping postings
// that are no longer open. Used by the job-pipeline function when it saves
// jobs and by the Job Automation page when it lists them, so both agree.
// No Deno or browser imports.

const DAY_MS = 24 * 60 * 60 * 1000;
// "1 day ago" is stored as exactly 24h before the search; allow for the
// minutes between the search and the check.
const DATE_GRACE_MS = 60 * 60 * 1000;

// ── Date posted ──────────────────────────────────────────────────────────

export type DatePosted = 'past_24_hours' | 'past_week' | 'past_month' | 'any_time';

// Stored in user_job_preferences.max_job_age_days: 1, 7, 30, or 0 for any time.
export const DATE_POSTED_OPTIONS: Array<{ value: DatePosted; label: string; maxAgeDays: number }> = [
  { value: 'past_24_hours', label: 'Past 24 hours', maxAgeDays: 1 },
  { value: 'past_week', label: 'Past week', maxAgeDays: 7 },
  { value: 'past_month', label: 'Past month', maxAgeDays: 30 },
  { value: 'any_time', label: 'Any time', maxAgeDays: 0 },
];

// Older saved values (any number of days) map to the nearest wider option.
export const datePostedFromMaxAge = (maxAgeDays: number | null | undefined): DatePosted => {
  if (maxAgeDays == null) return 'past_week';
  if (maxAgeDays <= 0) return 'any_time';
  if (maxAgeDays <= 1) return 'past_24_hours';
  if (maxAgeDays <= 7) return 'past_week';
  if (maxAgeDays <= 30) return 'past_month';
  return 'any_time';
};

export const maxAgeFromDatePosted = (value: DatePosted) =>
  DATE_POSTED_OPTIONS.find((option) => option.value === value)?.maxAgeDays ?? 7;

export const datePostedLabel = (maxAgeDays: number | null | undefined) =>
  DATE_POSTED_OPTIONS.find((option) => option.value === datePostedFromMaxAge(maxAgeDays))?.label ?? 'Past week';

// Jobs without a known posting date never pass (LinkedIn always has one; an
// undated result is usually an old page).
export const isPostedWithin = (postedAt: string | null | undefined, maxAgeDays: number, now = Date.now()) => {
  if (!postedAt) return false;
  const posted = Date.parse(postedAt);
  if (Number.isNaN(posted)) return false;
  if (maxAgeDays <= 0) return true;
  return now - posted <= maxAgeDays * DAY_MS + DATE_GRACE_MS;
};

// ── Closed postings ──────────────────────────────────────────────────────

const CLOSED_PATTERNS = [
  /no longer accepting applications/i,
  /this job is no longer available/i,
  /(position|role|vacancy) (has been|is) (filled|closed)/i,
  /applications? (are |is )?(now )?closed/i,
  /oferta (wygasła|nieaktualna|jest nieaktualna)/i,
  /rekrutacja (została )?zakończona/i,
];

export const isClosedPosting = (text: string | null | undefined) =>
  CLOSED_PATTERNS.some((pattern) => pattern.test(text || ''));

// ── Work model ───────────────────────────────────────────────────────────

export type WorkModel = 'onsite' | 'remote' | 'hybrid';

export const WORK_MODEL_OPTIONS: Array<{ value: 'any' | WorkModel; label: string }> = [
  { value: 'any', label: 'Any' },
  { value: 'onsite', label: 'On-site' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
];

// Whole words, including Polish letters.
const hasAny = (text: string, phrases: string[]) =>
  phrases.some((phrase) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(text),
  );

// The posting's work model, or null when it doesn't say. Hybrid wins over
// remote ("hybrid, 2 days remote"); a bare "remote" in a long description
// ("no remote work") isn't enough on its own.
export const classifyWorkModel = (
  job: { title?: string | null; location?: string | null; description?: string | null },
  workFromHome = false,
): WorkModel | null => {
  const heading = `${job.title || ''} ${job.location || ''}`;
  const all = `${heading} ${job.description || ''}`;

  if (hasAny(all, ['hybrid', 'hybrydowa', 'hybrydowo', 'praca hybrydowa'])) return 'hybrid';
  if (
    workFromHome ||
    hasAny(heading, ['remote', 'zdalnie', 'zdalna']) ||
    hasAny(all, ['fully remote', '100% remote', 'remote-first', 'remote first', 'work from home', 'praca zdalna', 'w pełni zdalna'])
  ) {
    return 'remote';
  }
  if (hasAny(all, ['on-site', 'onsite', 'on site', 'office-based', 'office based', 'praca stacjonarna', 'stacjonarnie'])) return 'onsite';
  return null;
};

// Like LinkedIn, a posting that doesn't say counts as on-site.
export const matchesWorkModel = (preference: string | null | undefined, jobModel: WorkModel | null) => {
  if (!preference || preference === 'any') return true;
  return (jobModel ?? 'onsite') === preference;
};

// ── Experience level ─────────────────────────────────────────────────────

export type ExperienceLevel = 'internship' | 'entry' | 'associate' | 'mid_senior' | 'director' | 'executive';

export const EXPERIENCE_LEVEL_OPTIONS: Array<{ value: ExperienceLevel; label: string }> = [
  { value: 'internship', label: 'Internship' },
  { value: 'entry', label: 'Entry level' },
  { value: 'associate', label: 'Associate' },
  { value: 'mid_senior', label: 'Mid-Senior level' },
  { value: 'director', label: 'Director' },
  { value: 'executive', label: 'Executive' },
];

export const experienceLevelLabel = (value: string) =>
  EXPERIENCE_LEVEL_OPTIONS.find((option) => option.value === value)?.label ?? value;

const LEVEL_TITLE_WORDS: Array<[ExperienceLevel, string[]]> = [
  ['internship', ['intern', 'internship', 'trainee', 'apprentice', 'apprenticeship', 'praktykant', 'praktykantka', 'praktyki', 'stażysta', 'stażystka', 'staż']],
  ['executive', ['chief', 'ceo', 'cto', 'cfo', 'coo', 'cio', 'cmo', 'vp', 'vice president', 'svp', 'evp', 'prezes', 'executive director']],
  ['director', ['director', 'head of', 'dyrektor', 'dyrektorka']],
  ['mid_senior', ['senior', 'sr', 'sr.', 'lead', 'principal', 'staff', 'manager', 'team leader', 'kierownik', 'kierowniczka', 'starszy', 'starsza', 'ekspert', 'ekspertka', 'expert']],
  ['entry', ['junior', 'jr', 'jr.', 'entry level', 'entry-level', 'graduate', 'młodszy', 'młodsza', 'absolwent', 'absolwentka']],
];

// LinkedIn takes the level from the employer; we only have the text, so this
// is an estimate. The title decides first, then the description; a posting
// that gives no sign of its level counts as Associate.
export const estimateExperienceLevel = (job: { title?: string | null; description?: string | null }): ExperienceLevel => {
  const title = job.title || '';
  const description = job.description || '';

  for (const [level, words] of LEVEL_TITLE_WORDS) {
    if (hasAny(title, words)) return level;
  }

  if (hasAny(description, ['no experience required', 'no experience needed', 'entry level', 'entry-level', 'graduate scheme', 'graduate programme', 'graduate program', 'bez doświadczenia'])) {
    return 'entry';
  }

  const years = [...description.matchAll(/(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs?|lat)\b/giu)]
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value < 30);
  if (years.length) {
    const required = Math.min(...years);
    if (required >= 5) return 'mid_senior';
    if (required <= 1) return 'entry';
  }

  return 'associate';
};

export const matchesExperienceLevels = (selected: readonly string[] | null | undefined, level: ExperienceLevel) =>
  !selected?.length || selected.includes(level);

// ── All filters ──────────────────────────────────────────────────────────

export interface JobFilterPreferences {
  max_job_age_days?: number | null;
  work_model?: string | null;
  experience_levels?: readonly string[] | null;
}

export interface FilterableJob {
  title?: string | null;
  location?: string | null;
  description?: string | null;
  source_posted_at?: string | null;
}

export type FilterReason = 'date' | 'closed' | 'work_model' | 'experience_level';

// Why a job is filtered out, or null when it passes every filter.
export const filterReason = (
  job: FilterableJob,
  preferences: JobFilterPreferences,
  options: { workFromHome?: boolean; now?: number } = {},
): FilterReason | null => {
  const maxAgeDays = preferences.max_job_age_days ?? 7;

  if (!isPostedWithin(job.source_posted_at, maxAgeDays, options.now)) return 'date';
  if (isClosedPosting(`${job.title || ''} ${job.description || ''}`)) return 'closed';
  if (!matchesWorkModel(preferences.work_model, classifyWorkModel(job, options.workFromHome))) return 'work_model';
  if (!matchesExperienceLevels(preferences.experience_levels, estimateExperienceLevel(job))) return 'experience_level';
  return null;
};

export const applyJobFilters = <T extends FilterableJob>(
  jobs: T[],
  preferences: JobFilterPreferences,
  options: { workFromHome?: (job: T) => boolean; now?: number } = {},
) => {
  const kept: T[] = [];
  const removed: Record<FilterReason, number> = { date: 0, closed: 0, work_model: 0, experience_level: 0 };

  for (const job of jobs) {
    const reason = filterReason(job, preferences, { workFromHome: options.workFromHome?.(job), now: options.now });
    if (reason) removed[reason]++;
    else kept.push(job);
  }

  return { kept, removed };
};
