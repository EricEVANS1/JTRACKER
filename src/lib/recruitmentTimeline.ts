// The recruitment timeline on the application page: the application's own
// lifecycle dates (the single source of truth), with its interview records
// listed under the interview stage. Nothing here is stored separately.
//
// A missing date is shown as missing. The activity log and interview records
// can suggest a date, but it is only saved when the user chooses it.

import {
  getGenuineResponseReceivedAt,
  hasReachedStage,
  isArchived,
  type LifecycleRecord,
} from './applicationLifecycle';
import { parseStatusChange } from './activityTimeline';
import { dayKeyInZone, interviewStatus, type InterviewRecord } from './interviewSchedule';

export type MilestoneKey =
  | 'applied'
  | 'response'
  | 'assessment'
  | 'interview'
  | 'final_interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn'
  | 'ghosted';

// The application column that holds each milestone's date.
export const MILESTONE_COLUMNS = {
  applied: 'date_applied',
  response: 'response_received_at',
  assessment: 'assessment_received_at',
  interview: 'interview_started_at',
  final_interview: 'final_interview_started_at',
  offer: 'offer_received_at',
  rejected: 'rejected_at',
  withdrawn: 'withdrawn_at',
  ghosted: 'ghosted_at',
} as const satisfies Record<MilestoneKey, keyof LifecycleRecord>;

export type MilestoneColumn = (typeof MILESTONE_COLUMNS)[MilestoneKey];

export const MILESTONE_LABELS: Record<MilestoneKey, string> = {
  applied: 'Applied',
  response: 'First response',
  assessment: 'Assessment',
  interview: 'First interview',
  final_interview: 'Final interview',
  offer: 'Offer received',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  ghosted: 'Ghosted',
};

// date_applied is a calendar date; the others are exact moments.
export const isDateOnlyMilestone = (key: MilestoneKey) => key === 'applied';

const DECISIONS: MilestoneKey[] = ['offer', 'rejected', 'withdrawn', 'ghosted'];

export type MilestoneState =
  // The date is recorded.
  | 'recorded'
  // The application got this far, but the date wasn't recorded.
  | 'missing'
  // No sign the application got this far (or the stage was skipped).
  | 'not_reached'
  // Still open: no decision yet.
  | 'pending';

export interface MilestoneSuggestion {
  date: string;
  source: string;
}

export interface Milestone {
  key: MilestoneKey;
  label: string;
  column: MilestoneColumn;
  state: MilestoneState;
  date: string | null;
  // Calendar day in the viewer's zone, for ordering and gaps.
  dayKey: string | null;
  // Whole days since the previous recorded milestone.
  daysSincePrevious: number | null;
  previousLabel: string | null;
  // Recorded earlier than a stage that comes before it.
  outOfOrder: boolean;
  suggestion: MilestoneSuggestion | null;
}

export interface TimelineEventRecord {
  id: string;
  event_type: string | null;
  title: string | null;
  description: string | null;
  event_date: string;
}

const isValid = (value: string | null | undefined): value is string =>
  Boolean(value) && !Number.isNaN(Date.parse(value as string));

// "YYYY-MM-DD" for a stored value: date_applied as is, timestamps in the viewer's zone.
export const milestoneDayKey = (value: string | null | undefined, viewerZone: string) => {
  if (!isValid(value)) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : dayKeyInZone(value, viewerZone);
};

export const daysBetweenKeys = (from: string, to: string) => {
  const toUtc = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
};

export type TimelineApplication = LifecycleRecord & { id?: string };

const decisionKeys = (app: TimelineApplication): MilestoneKey[] => {
  // The current outcome, plus any other outcome date on record (e.g. an offer
  // later withdrawn from), so recorded history is never hidden.
  const keys = DECISIONS.filter((key) => app.status === key || isValid(app[MILESTONE_COLUMNS[key]] as string | null));
  return keys;
};

const reached = (app: TimelineApplication, key: MilestoneKey) => {
  switch (key) {
    case 'applied':
      return hasReachedStage(app, 'applied');
    case 'response':
      return hasReachedStage(app, 'responded');
    case 'assessment':
      return hasReachedStage(app, 'assessment');
    case 'interview':
      return hasReachedStage(app, 'interview');
    case 'final_interview':
      return hasReachedStage(app, 'final_interview');
    default:
      return app.status === key;
  }
};

const STATUS_NAMES: Record<string, string> = {
  applied: 'Applied',
  confirmation_received: 'Confirmed',
  assessment: 'Assessment',
  interview: 'Interview',
  final_interview: 'Final interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  ghosted: 'Ghosted',
};

// What the activity log or interview records say about a milestone's date.
// Earliest evidence first; only offered, never saved automatically.
export const findSuggestion = (
  key: MilestoneKey,
  events: TimelineEventRecord[],
  interviews: InterviewRecord[],
  now = Date.now(),
): MilestoneSuggestion | null => {
  const candidates: MilestoneSuggestion[] = [];

  const statusFor: Partial<Record<MilestoneKey, string[]>> = {
    applied: ['applied'],
    response: ['confirmation_received'],
    assessment: ['assessment'],
    interview: ['interview'],
    final_interview: ['final_interview'],
    offer: ['offer'],
    rejected: ['rejected'],
    withdrawn: ['withdrawn'],
    ghosted: ['ghosted'],
  };

  for (const event of events) {
    if (!isValid(event.event_date)) continue;
    const title = event.title || '';
    const description = event.description || '';
    const type = (event.event_type || '').toLowerCase();

    const change = parseStatusChange(title, description);
    if (change && statusFor[key]?.includes(change.to)) {
      candidates.push({ date: event.event_date, source: `Status changed to ${STATUS_NAMES[change.to] || change.to}` });
      continue;
    }
    // "Application added with status Applied." from the Applications page.
    if (key === 'applied' && type === 'created' && /status applied/i.test(description)) {
      candidates.push({ date: event.event_date, source: 'Added to JTracker as Applied' });
      continue;
    }
    // Activities logged by hand on the application page.
    if ((key === 'assessment' && type === 'assessment') || (key === 'interview' && type === 'interview')) {
      candidates.push({ date: event.event_date, source: title || `${MILESTONE_LABELS[key]} logged` });
    }
  }

  if (key === 'interview' || key === 'final_interview') {
    for (const interview of interviews) {
      if (!isValid(interview.interview_date) || interviewStatus(interview) === 'cancelled') continue;
      if (Date.parse(interview.interview_date) > now) continue; // hasn't happened yet
      if (key === 'final_interview' && !/final/i.test(interview.interview_stage || '')) continue;
      candidates.push({ date: interview.interview_date, source: `Interview record: ${interview.interview_stage || 'Interview'}` });
    }
  }

  candidates.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return candidates[0] ?? null;
};

export const buildRecruitmentTimeline = (
  app: TimelineApplication,
  options: { events?: TimelineEventRecord[]; interviews?: InterviewRecord[]; viewerZone: string; now?: number },
): Milestone[] => {
  const { events = [], interviews = [], viewerZone, now = Date.now() } = options;
  const decisions = decisionKeys(app);
  const keys: MilestoneKey[] = ['applied', 'response', 'assessment', 'interview', 'final_interview', ...decisions];

  const milestones: Milestone[] = keys.map((key) => {
    const column = MILESTONE_COLUMNS[key];
    const raw =
      key === 'response'
        ? getGenuineResponseReceivedAt(app) // an old ghosting stamp isn't a reply
        : (app[column] as string | null | undefined);
    const date = isValid(raw) ? raw : null;
    const state: MilestoneState = date ? 'recorded' : reached(app, key) ? 'missing' : 'not_reached';

    return {
      key,
      label: MILESTONE_LABELS[key],
      column,
      state,
      date,
      dayKey: milestoneDayKey(date, viewerZone),
      daysSincePrevious: null,
      previousLabel: null,
      outOfOrder: false,
      suggestion: state === 'recorded' ? null : findSuggestion(key, events, interviews, now),
    };
  });

  // An open application has no decision yet.
  if (!decisions.length && !isArchived(app) && app.status !== 'wishlist') {
    milestones.push({
      key: 'offer',
      label: 'Decision',
      column: MILESTONE_COLUMNS.offer,
      state: 'pending',
      date: null,
      dayKey: null,
      daysSincePrevious: null,
      previousLabel: null,
      outOfOrder: false,
      suggestion: null,
    });
  }

  // Gaps and order checks between recorded milestones, in stage order.
  let previous: Milestone | null = null;
  for (const milestone of milestones) {
    if (!milestone.dayKey) continue;
    if (previous?.dayKey) {
      const days = daysBetweenKeys(previous.dayKey, milestone.dayKey);
      if (days < 0) {
        milestone.outOfOrder = true;
      } else {
        milestone.daysSincePrevious = days;
        milestone.previousLabel = previous.label;
      }
    }
    if (!milestone.outOfOrder) previous = milestone;
  }

  return milestones;
};

// "Applied → Offer received: 32 days", from the first and last recorded dates.
export const totalDuration = (milestones: Milestone[]) => {
  const recorded = milestones.filter((milestone) => milestone.dayKey && !milestone.outOfOrder);
  if (recorded.length < 2) return null;
  const first = recorded[0];
  const last = recorded[recorded.length - 1];
  return { from: first.label, to: last.label, days: daysBetweenKeys(first.dayKey as string, last.dayKey as string) };
};

export const formatDays = (days: number) => (days === 0 ? 'same day' : days === 1 ? '1 day' : `${days} days`);
