// Dates, times and time zones for the interview calendar. No browser or
// Supabase imports, so it can be unit tested.
//
// An interview is stored once in interview_notes: `interview_date` is the exact
// moment (UTC, timestamptz) and `timezone` is the IANA zone it was arranged in
// (e.g. "Europe/London"). The calendar lays days out in the viewer's own zone,
// so an interview at 23:30 in New York appears on the next day in Warsaw.
// Calendar days are handled as plain "YYYY-MM-DD" keys, so daylight-saving
// changes never shift a day.

export type InterviewStatus = 'scheduled' | 'completed' | 'cancelled';

export const INTERVIEW_STATUSES: InterviewStatus[] = ['scheduled', 'completed', 'cancelled'];

// Suggestions for the stage field (free text in the database).
export const INTERVIEW_STAGES = [
  'Recruiter screen',
  'HR interview',
  'Hiring manager',
  'Technical interview',
  'Take-home review',
  'Panel interview',
  'Final interview',
  'Other',
];

export const isValidTimeZone = (timeZone: string | null | undefined): timeZone is string => {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
};

export const browserTimeZone = () => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimeZone(zone) ? zone : 'UTC';
};

// Every zone the browser knows, with the given ones first if missing.
export const timeZoneOptions = (...ensure: Array<string | null | undefined>) => {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  const extra = ensure.filter(isValidTimeZone).filter((zone) => !zones.includes(zone));
  return [...extra, ...(zones.length ? zones : ['UTC'])];
};

const pad = (value: number) => String(value).padStart(2, '0');

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

// The wall-clock date and time of `instant` in `timeZone`.
const zonedParts = (instant: Date, timeZone: string): ZonedParts => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
};

// How far `timeZone` is ahead of UTC at `instant`, in milliseconds.
const offsetAt = (instant: Date, timeZone: string) => {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
};

// The moment a wall-clock date ("2026-10-25") and time ("14:30") happen in
// `timeZone`. A time skipped by a daylight-saving change moves forward by the
// gap (02:30 on a spring-forward day becomes 03:30); a repeated time uses the
// first occurrence.
export const zonedDateTimeToUtc = (date: string, time: string, timeZone: string): Date => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) throw new Error('Enter a valid date and time.');
  if (!isValidTimeZone(timeZone)) throw new Error('Choose a valid time zone.');

  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // Try the offsets in force just before and after; keep one that maps back exactly.
  const candidates = [offsetAt(new Date(wall - 86_400_000), timeZone), offsetAt(new Date(wall + 86_400_000), timeZone)]
    .map((offset) => wall - offset)
    .sort((a, b) => a - b);
  for (const candidate of candidates) {
    const p = zonedParts(new Date(candidate), timeZone);
    if (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wall) return new Date(candidate);
  }
  // In a spring-forward gap: the earlier offset, which lands just after the jump.
  return new Date(wall - offsetAt(new Date(wall - 86_400_000), timeZone));
};

// The wall-clock "YYYY-MM-DD" and "HH:mm" of an instant in `timeZone`.
export const utcToZonedDateTime = (iso: string, timeZone: string) => {
  const p = zonedParts(new Date(iso), timeZone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
};

// The calendar day of an instant in `timeZone` ("YYYY-MM-DD").
export const dayKeyInZone = (iso: string | Date, timeZone: string) =>
  utcToZonedDateTime(typeof iso === 'string' ? iso : iso.toISOString(), timeZone).date;

// ── Plain calendar days ("YYYY-MM-DD"), done in UTC so DST never applies ──

const keyToUtc = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

const utcToKey = (time: number) => {
  const d = new Date(time);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

export const addDays = (key: string, days: number) => utcToKey(keyToUtc(key) + days * 86_400_000);

export const addMonths = (key: string, months: number) => {
  const [year, month] = key.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  return utcToKey(target.getTime());
};

// Monday-first, as is usual in Europe.
export const weekdayIndex = (key: string) => (new Date(keyToUtc(key)).getUTCDay() + 6) % 7;

export const startOfWeek = (key: string) => addDays(key, -weekdayIndex(key));

export const weekDays = (key: string) => Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(key), index));

export const startOfMonth = (key: string) => `${key.slice(0, 7)}-01`;

// Whole weeks covering the month of `key` (5 or 6 rows of 7 days).
export const monthGrid = (key: string) => {
  const first = startOfMonth(key);
  const last = addDays(addMonths(first, 1), -1);
  const start = startOfWeek(first);
  const end = addDays(startOfWeek(last), 6);
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
};

export const formatDayKey = (key: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(keyToUtc(key)));

// "09:30" in `timeZone`.
export const formatTimeInZone = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

// Short zone name at that moment, e.g. "BST", "GMT+2".
export const zoneAbbreviation = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' })
    .formatToParts(new Date(iso))
    .find((part) => part.type === 'timeZoneName')?.value ?? timeZone;

// ── Interview records ─────────────────────────────────────────────────────

export interface InterviewRecord {
  id: string;
  application_id: string;
  interview_stage: string | null;
  interview_date: string | null;
  notes: string | null;
  // Added by supabase/sql/2026-10-18_interview_calendar.sql; absent before it runs.
  status?: string | null;
  timezone?: string | null;
}

export const interviewStatus = (interview: Pick<InterviewRecord, 'status'>): InterviewStatus =>
  INTERVIEW_STATUSES.includes(interview.status as InterviewStatus) ? (interview.status as InterviewStatus) : 'scheduled';

// The zone to show and edit the interview in: its own, else the viewer's.
export const interviewTimeZone = (interview: Pick<InterviewRecord, 'timezone'>, fallback: string) =>
  isValidTimeZone(interview.timezone) ? interview.timezone : fallback;

// Scheduled but already past: it needs an outcome (completed or cancelled).
export const needsOutcome = (interview: InterviewRecord, now = Date.now()) =>
  interviewStatus(interview) === 'scheduled' &&
  Boolean(interview.interview_date) &&
  Date.parse(interview.interview_date as string) < now;

// Another live interview for the same application at the same moment.
export const findDuplicateInterview = (
  interviews: InterviewRecord[],
  candidate: { id?: string; application_id: string; interview_date: string },
) =>
  interviews.find(
    (interview) =>
      interview.id !== candidate.id &&
      interview.application_id === candidate.application_id &&
      interviewStatus(interview) !== 'cancelled' &&
      interview.interview_date !== null &&
      Date.parse(interview.interview_date) === Date.parse(candidate.interview_date),
  ) ?? null;

// Interviews grouped by the viewer's calendar day, earliest first.
export const groupByDay = <T extends InterviewRecord>(interviews: T[], viewerZone: string) => {
  const days = new Map<string, T[]>();
  for (const interview of interviews) {
    if (!interview.interview_date) continue;
    const key = dayKeyInZone(interview.interview_date, viewerZone);
    days.set(key, [...(days.get(key) ?? []), interview]);
  }
  for (const list of days.values()) {
    list.sort((a, b) => Date.parse(a.interview_date as string) - Date.parse(b.interview_date as string));
  }
  return days;
};

// The interview the application page's preparation notes refer to: the next
// scheduled one, else the most recent, else one without a date.
export const pickPrepInterview = <T extends InterviewRecord>(interviews: T[], now = Date.now()): T | null => {
  const dated = interviews
    .filter((interview) => interview.interview_date)
    .sort((a, b) => Date.parse(a.interview_date as string) - Date.parse(b.interview_date as string));
  const next = dated.find((interview) => interviewStatus(interview) === 'scheduled' && Date.parse(interview.interview_date as string) >= now);
  return next ?? dated.at(-1) ?? interviews[0] ?? null;
};

// The value for an <input type="datetime-local">: the moment in the browser's zone.
export const toDateTimeLocalValue = (iso: string | null | undefined, timeZone = browserTimeZone()) => {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  const { date, time } = utcToZonedDateTime(iso, timeZone);
  return `${date}T${time}`;
};
