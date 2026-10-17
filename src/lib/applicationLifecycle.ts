// Shared rules for application status, lifecycle dates and derived metrics.
// Every page that counts applications or saves a status change uses these,
// so the dashboard, analytics, follow-ups and notifications always agree.

export type LifecycleStatus =
  | 'wishlist'
  | 'applied'
  | 'confirmation_received'
  | 'assessment'
  | 'interview'
  | 'final_interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn'
  | 'ghosted'
  | 'archived';

export interface LifecycleRecord {
  status: string;
  archived?: boolean | null;
  date_applied?: string | null;
  created_at?: string | null;
  follow_up_date?: string | null;
  response_received_at?: string | null;
  assessment_received_at?: string | null;
  interview_started_at?: string | null;
  final_interview_started_at?: string | null;
  offer_received_at?: string | null;
  rejected_at?: string | null;
  withdrawn_at?: string | null;
  ghosted_at?: string | null;
  reached_interview?: boolean | null;
  rejected_after_interview?: boolean | null;
  final_response_pending?: boolean | null;
  interview_count?: number | null;
  outcome_reason?: string | null;
}

export type LifecycleUpdate = Record<string, string | boolean | number | null>;

export const FOLLOW_UP_UPCOMING_DAYS = 7;

export const CLOSED_STATUSES: string[] = ['offer', 'rejected', 'withdrawn', 'ghosted', 'archived'];

// Statuses that mean the employer replied. Withdrawn and ghosted are not replies.
export const RESPONSE_STATUSES: string[] = [
  'confirmation_received',
  'assessment',
  'interview',
  'final_interview',
  'offer',
  'rejected',
];

const INTERVIEW_STATUSES = ['interview', 'final_interview'];

const isValidDate = (value?: string | null): value is string =>
  Boolean(value) && !Number.isNaN(new Date(value as string).getTime());

export const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const isArchived = (app: LifecycleRecord) =>
  Boolean(app.archived) || app.status === 'archived';

export const isSubmitted = (app: LifecycleRecord) => app.status !== 'wishlist';

// Still in play: not archived and not closed. Includes wishlist items.
export const isActive = (app: LifecycleRecord) =>
  !isArchived(app) && !CLOSED_STATUSES.includes(app.status);

export const hasReachedOffer = (app: LifecycleRecord) =>
  app.status === 'offer' || Boolean(app.offer_received_at);

// Later stages imply earlier ones, so offers <= interviews <= responses.
export const hasReachedInterview = (app: LifecycleRecord) =>
  Boolean(
    app.reached_interview ||
      app.interview_started_at ||
      app.final_interview_started_at ||
      app.rejected_after_interview ||
      INTERVIEW_STATUSES.includes(app.status) ||
      hasReachedOffer(app)
  );

// Older ghosted records were stamped with response_received_at at the same
// moment as ghosted_at; that stamp is not a real reply.
export const getGenuineResponseReceivedAt = (app: LifecycleRecord) =>
  app.response_received_at && app.response_received_at !== app.ghosted_at
    ? app.response_received_at
    : null;

// Earliest evidence of a reply from the employer.
export const getResponseDate = (app: LifecycleRecord) => {
  const dates = [
    getGenuineResponseReceivedAt(app),
    app.assessment_received_at,
    app.interview_started_at,
    app.final_interview_started_at,
    app.offer_received_at,
    app.rejected_at,
  ].filter(isValidDate);

  if (dates.length === 0) return null;

  return dates.reduce((earliest, date) =>
    new Date(date).getTime() < new Date(earliest).getTime() ? date : earliest
  );
};

export const hasResponse = (app: LifecycleRecord) =>
  hasReachedInterview(app) ||
  RESPONSE_STATUSES.includes(app.status) ||
  getResponseDate(app) !== null;

export const getAppliedDate = (app: LifecycleRecord) => app.date_applied || app.created_at || null;

export const getDaysBetween = (start?: string | null, end?: string | null) => {
  if (!isValidDate(start) || !isValidDate(end)) return null;

  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000));
};

export const getDaysToResponse = (app: LifecycleRecord) =>
  getDaysBetween(getAppliedDate(app), getResponseDate(app));

// Days after applying before a silent application needs a nudge.
export const NO_RESPONSE_DAYS = 7;

// Days since applying for an active application still waiting on a real reply
// (an automated confirmation doesn't count), or null when it isn't waiting.
export const getDaysWithoutReply = (app: LifecycleRecord, now: Date = new Date()) => {
  if (!isActive(app)) return null;

  const waiting =
    (app.status === 'applied' && !hasResponse(app)) || app.status === 'confirmation_received';

  return waiting ? getDaysBetween(getAppliedDate(app), now.toISOString()) : null;
};

export const isAwaitingFinalResponse = (app: LifecycleRecord) =>
  isActive(app) &&
  INTERVIEW_STATUSES.includes(app.status) &&
  app.final_response_pending !== false;

export type FollowUpBucket = 'overdue' | 'today' | 'upcoming' | 'later';

// Follow-ups only matter for applications that are still in play.
export const getFollowUpBucket = (
  app: LifecycleRecord,
  now: Date = new Date()
): FollowUpBucket | null => {
  if (!isActive(app) || !isValidDate(app.follow_up_date)) return null;

  const today = startOfDay(now);
  const day = startOfDay(new Date(app.follow_up_date));
  const upcomingLimit = new Date(today);
  upcomingLimit.setDate(today.getDate() + FOLLOW_UP_UPCOMING_DAYS);

  if (day < today) return 'overdue';
  if (day.getTime() === today.getTime()) return 'today';
  if (day <= upcomingLimit) return 'upcoming';
  return 'later';
};

// The furthest stage a restored application had reached before it was closed.
export const getFurthestActiveStatus = (app: LifecycleRecord): LifecycleStatus => {
  if (app.final_interview_started_at) return 'final_interview';
  if (hasReachedInterview(app)) return 'interview';
  if (app.assessment_received_at) return 'assessment';

  // Rejecting stamps response_received_at too; that alone doesn't mean it was confirmed.
  const responseAt = getGenuineResponseReceivedAt(app);
  if (responseAt && responseAt !== app.rejected_at) return 'confirmation_received';

  return 'applied';
};

// Builds the fields to save when an application moves to `status`.
// `prev` is the current record, or null when creating a new application.
// Existing lifecycle dates are kept, so the first time a stage was reached is preserved.
export const buildStatusUpdate = (
  status: string,
  prev: LifecycleRecord | null,
  now: string = new Date().toISOString()
): LifecycleUpdate => {
  const update: LifecycleUpdate = {
    status,
    last_status_changed_at: now,
    status_updated_at: now,
  };

  const stamp = (field: keyof LifecycleRecord) => {
    if (!prev?.[field]) update[field] = now;
  };

  const markInterview = () => {
    update.reached_interview = true;
    update.interview_count = Math.max(prev?.interview_count || 0, 1);
  };

  // Rejected and archived applications live in the archive; anything else is active.
  if (status === 'rejected' || status === 'archived') {
    update.archived = true;
    if (!prev?.archived) update.archived_at = now;
  } else if (prev?.archived) {
    update.archived = false;
    update.archived_at = null;
  }

  if (RESPONSE_STATUSES.includes(status) && !getGenuineResponseReceivedAt(prev || { status })) {
    update.response_received_at = now;
  }

  // Moving back into the pipeline undoes a previous close.
  if (!CLOSED_STATUSES.includes(status)) {
    if (prev?.rejected_at) update.rejected_at = null;
    if (prev?.withdrawn_at) update.withdrawn_at = null;
    if (prev?.ghosted_at) {
      update.ghosted_at = null;
      // Drop the old automatic stamp too, or it would look like a real reply.
      if (prev.response_received_at === prev.ghosted_at && !('response_received_at' in update)) {
        update.response_received_at = null;
      }
    }
    if (prev?.outcome_reason) update.outcome_reason = null;
    if (prev?.rejected_after_interview) update.rejected_after_interview = false;
  }

  switch (status) {
    case 'wishlist':
    case 'applied':
    case 'confirmation_received':
      update.final_response_pending = false;
      break;

    case 'assessment':
      stamp('assessment_received_at');
      update.final_response_pending = false;
      break;

    case 'interview':
      stamp('interview_started_at');
      markInterview();
      update.final_response_pending = true;
      break;

    case 'final_interview':
      stamp('interview_started_at');
      stamp('final_interview_started_at');
      markInterview();
      update.final_response_pending = true;
      break;

    case 'offer':
      stamp('offer_received_at');
      if (prev && hasReachedInterview(prev)) markInterview();
      update.final_response_pending = false;
      update.outcome_reason = 'offer_received';
      break;

    case 'rejected': {
      stamp('rejected_at');
      update.final_response_pending = false;

      if (prev && hasReachedInterview(prev)) {
        markInterview();
        update.rejected_after_interview = true;
        update.outcome_reason = 'rejected_after_interview';
      } else {
        update.rejected_after_interview = false;
        update.outcome_reason =
          prev && (prev.status === 'assessment' || prev.assessment_received_at)
            ? 'rejected_after_assessment'
            : 'rejected_before_interview';
      }
      break;
    }

    case 'withdrawn':
      stamp('withdrawn_at');
      update.final_response_pending = false;
      update.outcome_reason = 'withdrawn';
      break;

    case 'ghosted':
      stamp('ghosted_at');
      update.final_response_pending = false;
      update.outcome_reason = 'ghosted';
      break;

    case 'archived':
      update.final_response_pending = false;
      break;
  }

  return update;
};
