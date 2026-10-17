// Turns raw application_events rows into a readable, de-duplicated timeline.
// Event rows are written by many pages with different event_type values, so the
// kind of event is worked out from the type, title and description together.

type JoinOne<T> = T | T[] | null | undefined;

export interface ActivityEventRecord {
  id: string;
  title: string | null;
  description: string | null;
  event_type: string | null;
  event_date: string;
  application_id: string | null;
  applications?: JoinOne<{
    id: string;
    role_title: string | null;
    companies?: JoinOne<{ name: string | null }>;
  }>;
}

export type ActivityKind =
  | 'added'
  | 'status'
  | 'assessment'
  | 'interview'
  | 'offer'
  | 'rejection'
  | 'follow_up'
  | 'closed'
  | 'note'
  | 'email'
  | 'other';

export interface TimelineEvent {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string | null;
  date: string;
  // Only set when the application still exists, so the event can link to it.
  applicationId: string | null;
  // The event belonged to an application that has since been deleted.
  applicationDeleted: boolean;
  roleTitle: string | null;
  companyName: string | null;
}

export interface TimelineDay {
  key: string;
  label: string;
  events: TimelineEvent[];
}

const first = <T,>(value: JoinOne<T>): T | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

const STATUS_LABELS: Record<string, string> = {
  wishlist: 'Wishlist',
  applied: 'Applied',
  confirmation_received: 'Confirmed',
  assessment: 'Assessment',
  interview: 'Interview',
  final_interview: 'Final interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  ghosted: 'Ghosted',
  archived: 'Archived',
};

const toStatusKey = (text: string) => text.trim().toLowerCase().replace(/[\s-]+/g, '_');

const statusLabel = (status: string) => STATUS_LABELS[status] || status.replaceAll('_', ' ');

// Status changes are logged as "Status changed to X", "Moved from x to y." or
// "... moved from X to Y." depending on the page that wrote them.
export const parseStatusChange = (title: string, description: string) => {
  const fromTo = description.match(/from ([a-z _-]+?) to ([a-z _-]+?)\.?$/i);
  const toOnly = title.match(/^status changed to (.+)$/i);
  const to = fromTo?.[2] || toOnly?.[1] || (/marked as ghosted/i.test(title) ? 'ghosted' : null);

  if (!to) return null;

  const toKey = toStatusKey(to);
  if (!STATUS_LABELS[toKey]) return null;

  const fromKey = fromTo ? toStatusKey(fromTo[1]) : null;
  return { from: fromKey && STATUS_LABELS[fromKey] ? fromKey : null, to: toKey };
};

const describeStatusChange = (to: string): { kind: ActivityKind; title: string } => {
  switch (to) {
    case 'interview':
    case 'final_interview':
      return { kind: 'interview', title: `Moved to ${statusLabel(to)}` };
    case 'assessment':
      return { kind: 'assessment', title: 'Moved to Assessment' };
    case 'offer':
      return { kind: 'offer', title: 'Offer received' };
    case 'rejected':
      return { kind: 'rejection', title: 'Rejection received' };
    case 'ghosted':
      return { kind: 'closed', title: 'Marked as ghosted' };
    case 'withdrawn':
      return { kind: 'closed', title: 'Application withdrawn' };
    case 'archived':
      return { kind: 'closed', title: 'Archived' };
    default:
      return { kind: 'status', title: `Moved to ${statusLabel(to)}` };
  }
};

const ADDED_TYPES = [
  'created',
  'email_import',
  'job_automation',
  'shared_opportunity_added',
  'public_shared_opportunity_added',
];

const EMAIL_REJECTION_TYPES = ['email_auto_rejection', 'email_review_rejected', 'email_manual_rejection'];

// Manual activities logged from the application details page.
const MANUAL_KINDS: Record<string, ActivityKind> = {
  note: 'note',
  phone_call: 'note',
  follow_up: 'follow_up',
  recruiter_reply: 'email',
  email_sent: 'email',
  assessment: 'assessment',
  interview: 'interview',
};

// Journey buttons on the Applications page log these titles.
const JOURNEY_TITLES: Record<string, { kind: ActivityKind; title: string }> = {
  'interview reached': { kind: 'interview', title: 'Interview reached' },
  'awaiting final interview response': { kind: 'interview', title: 'Awaiting final interview response' },
  'declined after interview': { kind: 'rejection', title: 'Rejected after interview' },
  'offer accepted': { kind: 'offer', title: 'Offer accepted' },
  'offer declined': { kind: 'offer', title: 'Offer declined' },
};

const describeEvent = (event: ActivityEventRecord): Pick<TimelineEvent, 'kind' | 'title' | 'detail'> => {
  const type = event.event_type || '';
  const title = (event.title || '').trim();
  const description = (event.description || '').trim();

  if (ADDED_TYPES.includes(type)) {
    const status = description.match(/with status ([a-z _-]+?)\.?$/i)?.[1];
    const statusKey = status ? toStatusKey(status) : null;

    if (statusKey === 'applied') return { kind: 'added', title: 'Application submitted', detail: null };
    if (statusKey === 'wishlist') return { kind: 'added', title: 'Added to wishlist', detail: null };
    if (statusKey) return { kind: 'added', title: `Application added as ${statusLabel(statusKey)}`, detail: null };

    return { kind: 'added', title: title || 'Application added', detail: description || null };
  }

  if (EMAIL_REJECTION_TYPES.includes(type)) {
    return { kind: 'rejection', title: 'Rejection received', detail: description || null };
  }

  if (type === 'follow_up_completed' || type === 'notification_completed') {
    return { kind: 'follow_up', title: 'Follow-up completed', detail: null };
  }

  if (type === 'follow_up_scheduled') {
    return { kind: 'follow_up', title: title || 'Follow-up scheduled', detail: description || null };
  }

  if (type === 'follow_up_generated') {
    return { kind: 'follow_up', title: 'Follow-up message drafted', detail: null };
  }

  if (type === 'interview_prep_updated') {
    return { kind: 'interview', title: 'Interview prep updated', detail: description || null };
  }

  if (type === 'application_restored') {
    return { kind: 'status', title: 'Restored from archive', detail: null };
  }

  if (MANUAL_KINDS[type]) {
    return { kind: MANUAL_KINDS[type], title: title || 'Activity logged', detail: description || null };
  }

  const journey = JOURNEY_TITLES[title.toLowerCase()];
  if (journey) return { ...journey, detail: null };

  const change = parseStatusChange(title, description);
  if (change) {
    return {
      ...describeStatusChange(change.to),
      detail: change.from && change.from !== change.to
        ? `${statusLabel(change.from)} → ${statusLabel(change.to)}`
        : null,
    };
  }

  return {
    kind: type.startsWith('email') ? 'email' : 'other',
    title: title || 'Activity',
    detail: description && description !== title ? description : null,
  };
};

export const toTimelineEvent = (event: ActivityEventRecord): TimelineEvent => {
  const application = first(event.applications);

  return {
    id: event.id,
    ...describeEvent(event),
    date: event.event_date,
    applicationId: application?.id || null,
    applicationDeleted: Boolean(event.application_id) && !application,
    roleTitle: application?.role_title || null,
    companyName: first(application?.companies)?.name || null,
  };
};

// The same change is sometimes logged twice in quick succession (double clicks,
// a re-run sync, or two pages recording one move).
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export const buildTimeline = (events: ActivityEventRecord[]): TimelineEvent[] => {
  const lastKept = new Map<string, number>();

  return events
    .filter((event) => !Number.isNaN(new Date(event.event_date).getTime()))
    .map(toTimelineEvent)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .filter((event) => {
      const key = [event.applicationId || 'none', event.kind, event.title, event.detail || ''].join('|');
      const time = new Date(event.date).getTime();
      const previous = lastKept.get(key);

      if (previous !== undefined && previous - time <= DUPLICATE_WINDOW_MS) {
        // Extend the window so a burst of repeats collapses into one.
        lastKept.set(key, time);
        return false;
      }

      lastKept.set(key, time);
      return true;
    });
};

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const groupTimelineByDay = (events: TimelineEvent[], now: Date = new Date()): TimelineDay[] => {
  const today = dayKey(now);
  const yesterdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterday = dayKey(yesterdayDate);
  const days: TimelineDay[] = [];

  for (const event of events) {
    const date = new Date(event.date);
    const key = dayKey(date);
    let day = days[days.length - 1];

    if (!day || day.key !== key) {
      const label =
        key === today
          ? 'Today'
          : key === yesterday
            ? 'Yesterday'
            : date.toLocaleDateString('en-GB', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
              });

      day = { key, label, events: [] };
      days.push(day);
    }

    day.events.push(event);
  }

  return days;
};
