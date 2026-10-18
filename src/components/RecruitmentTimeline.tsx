import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarDays, Check, Loader2, Lightbulb, Pencil, Plus } from 'lucide-react';

import {
  buildRecruitmentTimeline,
  formatDays,
  isDateOnlyMilestone,
  totalDuration,
  type Milestone,
  type MilestoneColumn,
  type TimelineApplication,
  type TimelineEventRecord,
} from '../lib/recruitmentTimeline';
import {
  browserTimeZone,
  dayKeyInZone,
  formatDayKey,
  formatTimeInZone,
  interviewStatus,
  toDateTimeLocalValue,
  type InterviewRecord,
} from '../lib/interviewSchedule';

interface RecruitmentTimelineProps {
  application: TimelineApplication & { id: string };
  events: TimelineEventRecord[];
  interviews: InterviewRecord[];
  // Saves one lifecycle date on the application (null removes it). Returns an error message, or null.
  onSaveDate: (milestone: Milestone, value: string | null) => Promise<string | null>;
}

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2';

// "4 Sep 2026" for a calendar date, "4 Sep 2026, 11:00" for a moment.
const formatMilestoneDate = (value: string, viewerZone: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDayKey(value, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${formatDayKey(dayKeyInZone(value, viewerZone), { day: 'numeric', month: 'short', year: 'numeric' })}, ${formatTimeInZone(value, viewerZone)}`;
};

// The value an <input> needs for this milestone.
const inputValue = (milestone: Milestone, value: string | null, viewerZone: string) => {
  if (!value) return '';
  if (isDateOnlyMilestone(milestone.key)) return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : dayKeyInZone(value, viewerZone);
  return toDateTimeLocalValue(value, viewerZone);
};

// What to store: date_applied as "YYYY-MM-DD", the rest as an exact moment.
const storedValue = (milestone: Milestone, input: string) =>
  isDateOnlyMilestone(milestone.key) ? input : new Date(input).toISOString();

const STATE_TEXT: Record<Milestone['state'], string> = {
  recorded: '',
  missing: 'Reached, but the date wasn’t recorded',
  not_reached: 'Not reached, or not recorded',
  pending: 'Awaiting a decision',
};

export const RecruitmentTimeline: React.FC<RecruitmentTimelineProps> = ({ application, events, interviews, onSaveDate }) => {
  const viewerZone = useMemo(() => browserTimeZone(), []);
  const milestones = useMemo(
    () => buildRecruitmentTimeline(application, { events, interviews, viewerZone }),
    [application, events, interviews, viewerZone],
  );
  const total = totalDuration(milestones);
  const missingCount = milestones.filter((milestone) => milestone.state === 'missing').length;

  const [editing, setEditing] = useState<MilestoneColumn | null>(null);

  return (
    <section aria-labelledby="recruitment-timeline-heading" className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 id="recruitment-timeline-heading" className="text-lg font-semibold">Recruitment timeline</h2>
        <p className="text-sm text-slate-500">
          {total ? `${total.from} → ${total.to}: ${formatDays(total.days)}` : 'Add dates to see how long each stage took.'}
          {missingCount > 0 && <span className="text-amber-700"> · {missingCount} {missingCount === 1 ? 'date' : 'dates'} missing</span>}
        </p>
      </div>

      <ol className="relative">
        {milestones.map((milestone, index) => (
          <MilestoneRow
            key={`${milestone.key}-${milestone.label}`}
            milestone={milestone}
            last={index === milestones.length - 1}
            viewerZone={viewerZone}
            interviews={milestone.key === 'interview' && milestone.label !== 'Decision' ? interviews : []}
            applicationId={application.id}
            editing={editing === milestone.column && milestone.state !== 'pending'}
            onEdit={() => setEditing(milestone.column)}
            onDone={() => setEditing(null)}
            onSaveDate={onSaveDate}
          />
        ))}
      </ol>

      <p className="mt-3 text-xs text-slate-500">
        Dates come from this application’s status changes and edits. Changing one here updates the application.
      </p>
    </section>
  );
};

const MilestoneRow = ({
  milestone,
  last,
  viewerZone,
  interviews,
  applicationId,
  editing,
  onEdit,
  onDone,
  onSaveDate,
}: {
  milestone: Milestone;
  last: boolean;
  viewerZone: string;
  interviews: InterviewRecord[];
  applicationId: string;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onSaveDate: (milestone: Milestone, value: string | null) => Promise<string | null>;
}) => {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'save' | 'remove' | 'suggestion' | null>(null);
  const [problem, setProblem] = useState('');

  const save = async (kind: 'save' | 'remove' | 'suggestion', value: string | null) => {
    setBusy(kind);
    setProblem('');
    const failure = await onSaveDate(milestone, value);
    setBusy(null);
    if (failure) setProblem(failure);
    else onDone();
  };

  const startEdit = () => {
    setDraft(inputValue(milestone, milestone.date, viewerZone));
    setProblem('');
    onEdit();
  };

  const recorded = milestone.state === 'recorded';
  const dotClass = recorded
    ? milestone.outOfOrder
      ? 'border-red-500 bg-red-500 text-white'
      : 'border-slate-900 bg-slate-900 text-white'
    : milestone.state === 'missing'
      ? 'border-amber-500 bg-white text-amber-600'
      : 'border-slate-300 bg-white text-slate-300';

  const sortedInterviews = [...interviews].sort(
    (a, b) => Date.parse(a.interview_date || '9999') - Date.parse(b.interview_date || '9999'),
  );

  return (
    <li className="relative flex gap-3 pb-5 last:pb-0" aria-label={`${milestone.label}: ${recorded ? formatMilestoneDate(milestone.date as string, viewerZone) : STATE_TEXT[milestone.state]}`}>
      {!last && <span aria-hidden="true" className="absolute left-[11px] top-7 bottom-0 w-px bg-slate-200" />}
      <span
        aria-hidden="true"
        className={`relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${dotClass} ${
          milestone.state === 'pending' ? 'border-dashed' : ''
        }`}
      >
        {recorded ? <Check size={12} strokeWidth={3} /> : milestone.state === 'missing' ? <span className="text-xs font-bold">!</span> : null}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${recorded || milestone.state === 'missing' ? 'text-slate-900' : 'text-slate-500'}`}>{milestone.label}</p>
            {recorded ? (
              <p className="text-sm text-slate-700">
                <time dateTime={milestone.date as string}>{formatMilestoneDate(milestone.date as string, viewerZone)}</time>
                {milestone.daysSincePrevious !== null && milestone.previousLabel && (
                  <span className="text-slate-400"> · {formatDays(milestone.daysSincePrevious)} after {milestone.previousLabel}</span>
                )}
              </p>
            ) : (
              <p className={`text-sm ${milestone.state === 'missing' ? 'text-amber-700' : 'text-slate-400'}`}>{STATE_TEXT[milestone.state]}</p>
            )}
            {milestone.outOfOrder && (
              <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-red-700">
                <AlertTriangle size={12} />
                Earlier than the stage before it. Check this date.
              </p>
            )}
          </div>

          {milestone.state !== 'pending' && !editing && (
            <button
              type="button"
              onClick={startEdit}
              aria-label={`${recorded ? 'Edit' : 'Add'} ${milestone.label} date`}
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-500 hover:bg-white hover:text-slate-900 ${FOCUS_RING}`}
            >
              {recorded ? <Pencil size={12} /> : <Plus size={12} />}
              {recorded ? 'Edit' : 'Add date'}
            </button>
          )}
        </div>

        {/* Evidence for a missing date. Saved only if the user chooses it. */}
        {!recorded && milestone.suggestion && !editing && (
          <div className="mt-2 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-start gap-1.5">
              <Lightbulb size={13} className="mt-0.5 shrink-0 text-amber-500" />
              <span>
                {milestone.suggestion.source} on{' '}
                <span className="font-medium text-slate-900">{formatMilestoneDate(milestone.suggestion.date, viewerZone)}</span>
              </span>
            </span>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void save(
                  'suggestion',
                  isDateOnlyMilestone(milestone.key) ? dayKeyInZone(milestone.suggestion!.date, viewerZone) : milestone.suggestion!.date,
                )
              }
              className={`inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 ${FOCUS_RING}`}
            >
              {busy === 'suggestion' && <Loader2 size={12} className="animate-spin motion-reduce:animate-none" />}
              Use this date
            </button>
          </div>
        )}

        {editing && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!draft) {
                setProblem('Choose a date.');
                return;
              }
              void save('save', storedValue(milestone, draft));
            }}
            className="mt-2 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-end"
          >
            <label className="block flex-1">
              <span className="mb-1 block text-xs font-medium text-slate-600">{milestone.label} {isDateOnlyMilestone(milestone.key) ? 'date' : 'date and time'}</span>
              <input
                type={isDateOnlyMilestone(milestone.key) ? 'date' : 'datetime-local'}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                autoFocus
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={busy !== null}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 ${FOCUS_RING}`}
              >
                {busy === 'save' && <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />}
                Save
              </button>
              {recorded && milestone.key !== 'applied' && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void save('remove', null)}
                  className={`inline-flex h-9 items-center rounded-lg border border-slate-300 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 ${FOCUS_RING}`}
                >
                  Remove date
                </button>
              )}
              <button
                type="button"
                onClick={onDone}
                className={`inline-flex h-9 items-center rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 ${FOCUS_RING}`}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {problem && <p role="alert" className="mt-2 text-xs font-medium text-red-700">{problem}</p>}

        {/* Each interview round, from the interview records. */}
        {milestone.key === 'interview' && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            {sortedInterviews.length ? (
              <ul className="space-y-1">
                {sortedInterviews.map((interview) => {
                  const status = interviewStatus(interview);
                  return (
                    <li key={interview.id} className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                      <span className={`text-slate-700 ${status === 'cancelled' ? 'line-through text-slate-400' : ''}`}>
                        <span className="font-medium text-slate-900">{interview.interview_stage || 'Interview'}</span>
                        {' · '}
                        {interview.interview_date ? formatMilestoneDate(interview.interview_date, viewerZone) : 'No date yet'}
                      </span>
                      <span className="text-slate-400">{status === 'scheduled' ? 'Scheduled' : status === 'completed' ? 'Completed' : 'Cancelled'}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">No interview records yet.</p>
            )}
            <Link
              to={`/interviews?application=${applicationId}`}
              className={`mt-1.5 inline-flex items-center gap-1 rounded text-xs font-medium text-slate-600 underline hover:text-slate-900 ${FOCUS_RING}`}
            >
              <CalendarDays size={12} />
              {sortedInterviews.length ? 'Manage interviews in the calendar' : 'Schedule an interview'}
            </Link>
          </div>
        )}
      </div>
    </li>
  );
};
