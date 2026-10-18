import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Plus,
  TriangleAlert,
  X,
  XCircle,
} from 'lucide-react';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  addDays,
  addMonths,
  browserTimeZone,
  dayKeyInZone,
  findDuplicateInterview,
  formatDayKey,
  formatTimeInZone,
  groupByDay,
  INTERVIEW_STAGES,
  interviewStatus,
  interviewTimeZone,
  monthGrid,
  needsOutcome,
  startOfMonth,
  timeZoneOptions,
  utcToZonedDateTime,
  weekDays,
  zonedDateTimeToUtc,
  zoneAbbreviation,
  type InterviewRecord,
  type InterviewStatus,
} from '../lib/interviewSchedule';

// ─── data ────────────────────────────────────────────────────────────────────

interface ApplicationOption {
  id: string;
  role_title: string | null;
  status: string | null;
  archived: boolean | null;
  companies: { name: string | null } | { name: string | null }[] | null;
}

interface CalendarInterview extends InterviewRecord {
  application: ApplicationOption | null;
}

type CalendarView = 'upcoming' | 'week' | 'month';

interface InterviewForm {
  id: string | null;
  applicationId: string;
  stage: string;
  date: string;
  time: string;
  timeZone: string;
  notes: string;
}

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const isView = (value: string | null): value is CalendarView => VIEWS.some((view) => view.value === value);
const isDayKey = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

const companyName = (application: ApplicationOption | null | undefined) => {
  const company = Array.isArray(application?.companies) ? application?.companies[0] : application?.companies;
  return company?.name || null;
};

const applicationLabel = (application: ApplicationOption | null | undefined) =>
  application
    ? [application.role_title || 'Untitled role', companyName(application)].filter(Boolean).join(' — ')
    : 'Application not found';

// Postgres "column does not exist": the calendar migration hasn't run.
const isMissingColumn = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === '42703' || /column .* does not exist/i.test(error.message || '')));

const STATUS_STYLES: Record<InterviewStatus, string> = {
  scheduled: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
};

const STATUS_LABELS: Record<InterviewStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2';
const BUTTON_PRIMARY = `inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${FOCUS_RING}`;
const BUTTON_SECONDARY = `inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${FOCUS_RING}`;
const INPUT = 'w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-50';

// ─── page ────────────────────────────────────────────────────────────────────

export const InterviewsPage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewerZone = useMemo(() => browserTimeZone(), []);
  const todayKey = dayKeyInZone(new Date(), viewerZone);

  const view: CalendarView = isView(searchParams.get('view')) ? (searchParams.get('view') as CalendarView) : 'upcoming';
  const focusDay = isDayKey(searchParams.get('date')) ? (searchParams.get('date') as string) : todayKey;
  const applicationFilter = searchParams.get('application');

  const [interviews, setInterviews] = useState<CalendarInterview[]>([]);
  const [applications, setApplications] = useState<ApplicationOption[]>([]);
  // False until supabase/sql/2026-10-18_interview_calendar.sql has run.
  const [hasStatusColumns, setHasStatusColumns] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<InterviewForm | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // "Now" as of the last load, for past and upcoming.
  const [loadedAt, setLoadedAt] = useState(0);

  const updateParams = (changes: Record<string, string | null>) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  };

  const load = useCallback(async () => {
    if (!user) return;
    setError('');

    const [probe, interviewsResult, applicationsResult] = await Promise.all([
      supabase.from('interview_notes').select('id, status, timezone').eq('user_id', user.id).limit(1),
      supabase.from('interview_notes').select('*').eq('user_id', user.id).order('interview_date', { ascending: true }),
      supabase
        .from('applications')
        .select('id, role_title, status, archived, companies ( name )')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
    ]);

    if (probe.error && !isMissingColumn(probe.error)) setError(probe.error.message);
    setHasStatusColumns(!probe.error);

    if (interviewsResult.error || applicationsResult.error) {
      setError((interviewsResult.error || applicationsResult.error)?.message || 'Could not load interviews.');
      setLoading(false);
      return;
    }

    const apps = (applicationsResult.data || []) as ApplicationOption[];
    const byId = new Map(apps.map((app) => [app.id, app]));
    setApplications(apps);
    setLoadedAt(Date.now());
    setInterviews(
      ((interviewsResult.data || []) as InterviewRecord[]).map((interview) => ({
        ...interview,
        application: byId.get(interview.application_id) ?? null,
      })),
    );
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const visible = useMemo(
    () => (applicationFilter ? interviews.filter((item) => item.application_id === applicationFilter) : interviews),
    [interviews, applicationFilter],
  );
  const byDay = useMemo(() => groupByDay(visible, viewerZone), [visible, viewerZone]);
  const filteredApplication = applications.find((app) => app.id === applicationFilter) ?? null;

  // ── create / edit ──────────────────────────────────────────────────────────

  const openCreate = (day?: string) => {
    setMessage('');
    setForm({
      id: null,
      applicationId: applicationFilter || '',
      stage: '',
      date: day || (focusDay >= todayKey ? focusDay : todayKey),
      time: '10:00',
      timeZone: viewerZone,
      notes: '',
    });
  };

  const openEdit = (interview: CalendarInterview) => {
    setMessage('');
    const zone = interviewTimeZone(interview, viewerZone);
    const when = interview.interview_date ? utcToZonedDateTime(interview.interview_date, zone) : { date: '', time: '' };
    setForm({
      id: interview.id,
      applicationId: interview.application_id,
      stage: interview.interview_stage || '',
      date: when.date,
      time: when.time,
      timeZone: zone,
      notes: interview.notes || '',
    });
  };

  const logEvent = async (applicationId: string, eventType: string, title: string, description: string) => {
    if (!user) return;
    // The activity timeline is a convenience; the interview itself is already saved.
    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: applicationId,
      event_type: eventType,
      title,
      description,
      event_date: new Date().toISOString(),
    });
  };

  const describeWhen = (iso: string, zone: string) =>
    `${formatDayKey(dayKeyInZone(iso, zone), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} ${formatTimeInZone(iso, zone)} (${zone})`;

  const saveForm = async (current: InterviewForm): Promise<string | null> => {
    if (!user) return 'You are signed out.';
    if (!current.applicationId) return 'Choose the application this interview is for.';
    if (!current.date || !current.time) return 'Enter the interview date and time.';

    let interviewDate: string;
    try {
      interviewDate = zonedDateTimeToUtc(current.date, current.time, current.timeZone).toISOString();
    } catch (err) {
      return err instanceof Error ? err.message : 'Enter a valid date and time.';
    }

    const duplicate = findDuplicateInterview(interviews, {
      id: current.id ?? undefined,
      application_id: current.applicationId,
      interview_date: interviewDate,
    });
    if (duplicate) return 'This application already has an interview at that time.';

    const existing = current.id ? interviews.find((item) => item.id === current.id) ?? null : null;
    const rescheduled = Boolean(existing?.interview_date) && Date.parse(existing!.interview_date!) !== Date.parse(interviewDate);
    const stage = current.stage.trim() || null;

    const fields: Record<string, unknown> = {
      application_id: current.applicationId,
      interview_stage: stage,
      interview_date: interviewDate,
      notes: current.notes.trim() || null,
      ...(hasStatusColumns ? { timezone: current.timeZone } : {}),
    };
    // A new date brings a cancelled interview back.
    if (hasStatusColumns && existing && rescheduled && interviewStatus(existing) === 'cancelled') {
      Object.assign(fields, { status: 'scheduled', cancelled_at: null });
    }

    const label = stage || 'Interview';
    if (existing) {
      const { error: updateError } = await supabase
        .from('interview_notes')
        .update(fields)
        .eq('id', existing.id)
        .eq('user_id', user.id);
      if (updateError) return updateError.message;

      if (rescheduled) {
        await logEvent(
          current.applicationId,
          'interview_rescheduled',
          `${label} rescheduled`,
          `Moved from ${describeWhen(existing.interview_date!, interviewTimeZone(existing, viewerZone))} to ${describeWhen(interviewDate, current.timeZone)}.`,
        );
      } else {
        await logEvent(current.applicationId, 'interview_updated', `${label} updated`, `Interview details updated.`);
      }
      setMessage(rescheduled ? 'Interview rescheduled.' : 'Interview updated.');
    } else {
      const { error: insertError } = await supabase.from('interview_notes').insert({
        user_id: user.id,
        questions: [],
        ...fields,
        ...(hasStatusColumns ? { status: 'scheduled' } : {}),
      });
      if (insertError) return insertError.message;

      await logEvent(current.applicationId, 'interview_scheduled', `${label} scheduled`, `Scheduled for ${describeWhen(interviewDate, current.timeZone)}.`);
      setMessage('Interview scheduled.');
    }

    // Show the week of the saved interview.
    if (view !== 'upcoming') updateParams({ date: dayKeyInZone(interviewDate, viewerZone) });
    await load();
    return null;
  };

  const setStatus = async (interview: CalendarInterview, status: 'completed' | 'cancelled'): Promise<string | null> => {
    if (!user) return 'You are signed out.';
    if (!hasStatusColumns) return 'Completing and cancelling need the calendar database update (supabase/sql/2026-10-18_interview_calendar.sql).';

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('interview_notes')
      .update(status === 'completed' ? { status, completed_at: now, cancelled_at: null } : { status, cancelled_at: now })
      .eq('id', interview.id)
      .eq('user_id', user.id);
    if (updateError) return updateError.message;

    const label = interview.interview_stage || 'Interview';
    await logEvent(
      interview.application_id,
      status === 'completed' ? 'interview_completed' : 'interview_cancelled',
      `${label} ${status}`,
      interview.interview_date
        ? `${status === 'completed' ? 'Completed' : 'Cancelled'}: ${describeWhen(interview.interview_date, interviewTimeZone(interview, viewerZone))}.`
        : `${status === 'completed' ? 'Completed' : 'Cancelled'}.`,
    );
    setMessage(status === 'completed' ? 'Interview marked as completed.' : 'Interview cancelled.');
    await load();
    return null;
  };

  const deleteInterview = async (interview: CalendarInterview): Promise<string | null> => {
    if (!user) return 'You are signed out.';
    const { error: deleteError } = await supabase.from('interview_notes').delete().eq('id', interview.id).eq('user_id', user.id);
    if (deleteError) return deleteError.message;

    await logEvent(interview.application_id, 'interview_deleted', `${interview.interview_stage || 'Interview'} deleted`, 'Interview removed from the calendar.');
    setMessage('Interview deleted.');
    await load();
    return null;
  };

  // ── render ─────────────────────────────────────────────────────────────────

  const editing = form?.id ? interviews.find((item) => item.id === form.id) ?? null : null;

  return (
    <div className="w-full max-w-full">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5">
        <div className="min-w-0">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">Interviews</h2>
          <p className="text-sm text-slate-500 mt-1">
            Every interview linked to its application. Times are shown in your time zone ({viewerZone}).
          </p>
        </div>
        <button type="button" onClick={() => openCreate()} className={BUTTON_PRIMARY} disabled={loading}>
          <Plus size={16} />
          Schedule interview
        </button>
      </div>

      {!hasStatusColumns && !loading && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex gap-2">
          <TriangleAlert size={16} className="shrink-0 mt-0.5" />
          <span>
            Marking interviews completed or cancelled, and saving their time zone, need a one-off database update:{' '}
            <code className="text-xs">supabase/sql/2026-10-18_interview_calendar.sql</code>. Scheduling and rescheduling work now.
          </span>
        </div>
      )}

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span className="flex-1 break-words">{error}</span>
          <button type="button" onClick={() => { setLoading(true); void load(); }} className="shrink-0 font-medium underline">
            Try again
          </button>
        </div>
      )}

      {message && (
        <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 flex items-start gap-2">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
          <span className="flex-1">{message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setMessage('')} className="shrink-0 text-emerald-500 hover:text-emerald-800">
            <X size={16} />
          </button>
        </div>
      )}

      {applicationFilter && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Showing interviews for</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 font-medium text-slate-800">
            {filteredApplication ? applicationLabel(filteredApplication) : 'one application'}
            <button type="button" aria-label="Show all interviews" onClick={() => updateParams({ application: null })} className="text-slate-400 hover:text-slate-700">
              <X size={14} />
            </button>
          </span>
          <Link to={`/applications/${applicationFilter}`} className="text-slate-600 underline hover:text-slate-900">
            Open application
          </Link>
        </div>
      )}

      {/* View switcher and period navigation */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Calendar view" className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-sm">
          {VIEWS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={view === option.value}
              onClick={() => { setSelectedDay(null); updateParams({ view: option.value }); }}
              className={`rounded-md px-3 py-1.5 transition-colors ${FOCUS_RING} ${
                view === option.value ? 'bg-white text-slate-900 shadow-sm font-medium' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {view !== 'upcoming' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={view === 'week' ? 'Previous week' : 'Previous month'}
              onClick={() => { setSelectedDay(null); updateParams({ date: view === 'week' ? addDays(focusDay, -7) : addMonths(focusDay, -1) }); }}
              className={`${BUTTON_SECONDARY} px-2.5`}
            >
              <ChevronLeft size={16} />
            </button>
            <button type="button" onClick={() => { setSelectedDay(null); updateParams({ date: null }); }} className={BUTTON_SECONDARY}>
              Today
            </button>
            <button
              type="button"
              aria-label={view === 'week' ? 'Next week' : 'Next month'}
              onClick={() => { setSelectedDay(null); updateParams({ date: view === 'week' ? addDays(focusDay, 7) : addMonths(focusDay, 1) }); }}
              className={`${BUTTON_SECONDARY} px-2.5`}
            >
              <ChevronRight size={16} />
            </button>
            <h3 className="ml-1 text-base font-semibold text-slate-900" aria-live="polite">
              {view === 'week' ? weekTitle(focusDay) : formatDayKey(startOfMonth(focusDay), { month: 'long', year: 'numeric' })}
            </h3>
          </div>
        )}
      </div>

      {loading ? (
        <CalendarSkeleton view={view} />
      ) : view === 'upcoming' ? (
        <UpcomingView
          interviews={visible}
          viewerZone={viewerZone}
          todayKey={todayKey}
          now={loadedAt}
          canSetStatus={hasStatusColumns}
          onEdit={openEdit}
          onCreate={() => openCreate()}
          onStatus={async (interview, status) => {
            const problem = await setStatus(interview, status);
            if (problem) setError(problem);
          }}
        />
      ) : view === 'week' ? (
        <WeekView days={weekDays(focusDay)} byDay={byDay} viewerZone={viewerZone} todayKey={todayKey} onEdit={openEdit} onCreate={openCreate} />
      ) : (
        <MonthView
          focusDay={focusDay}
          byDay={byDay}
          viewerZone={viewerZone}
          todayKey={todayKey}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          onEdit={openEdit}
          onCreate={openCreate}
        />
      )}

      {form && (
        <InterviewDialog
          form={form}
          interview={editing}
          applications={applications}
          viewerZone={viewerZone}
          canSetStatus={hasStatusColumns}
          onChange={setForm}
          onClose={() => setForm(null)}
          onSave={saveForm}
          onStatus={setStatus}
          onDelete={deleteInterview}
        />
      )}
    </div>
  );
};

const weekTitle = (key: string) => {
  const days = weekDays(key);
  const first = days[0];
  const last = days[6];
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  return sameMonth
    ? `${formatDayKey(first, { day: 'numeric' })}–${formatDayKey(last, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : `${formatDayKey(first, { day: 'numeric', month: 'short' })} – ${formatDayKey(last, { day: 'numeric', month: 'short', year: 'numeric' })}`;
};

const relativeDayLabel = (key: string, todayKey: string) => {
  if (key === todayKey) return 'Today';
  if (key === addDays(todayKey, 1)) return 'Tomorrow';
  return formatDayKey(key, { weekday: 'long', day: 'numeric', month: 'long' });
};

// ─── interview line ──────────────────────────────────────────────────────────

const StatusBadge = ({ status }: { status: InterviewStatus }) => (
  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
    {STATUS_LABELS[status]}
  </span>
);

// "10:00" in the viewer's zone, plus the interview's own time if it was set elsewhere.
const InterviewTime = ({ interview, viewerZone, showDate }: { interview: CalendarInterview; viewerZone: string; showDate?: boolean }) => {
  if (!interview.interview_date) return <span className="text-slate-400">No time set</span>;
  const own = interviewTimeZone(interview, viewerZone);
  return (
    <span>
      {showDate && (
        <span className="font-semibold text-slate-900">
          {formatDayKey(dayKeyInZone(interview.interview_date, viewerZone), { weekday: 'short', day: 'numeric', month: 'short' })}{' '}
        </span>
      )}
      <span className="font-semibold tabular-nums text-slate-900">{formatTimeInZone(interview.interview_date, viewerZone)}</span>
      {own !== viewerZone && (
        <span className="text-slate-500">
          {' '}· {formatTimeInZone(interview.interview_date, own)} {zoneAbbreviation(interview.interview_date, own)} ({own})
        </span>
      )}
    </span>
  );
};

const InterviewRow = ({
  interview,
  viewerZone,
  onEdit,
  actions,
  showDate,
}: {
  interview: CalendarInterview;
  viewerZone: string;
  onEdit: (interview: CalendarInterview) => void;
  actions?: React.ReactNode;
  showDate?: boolean;
}) => {
  const status = interviewStatus(interview);
  return (
    <li className={`flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:flex-row sm:items-center ${status === 'cancelled' ? 'opacity-70' : ''}`}>
      <button
        type="button"
        onClick={() => onEdit(interview)}
        className={`min-w-0 flex-1 rounded-md text-left ${FOCUS_RING}`}
        aria-label={`Edit ${interview.interview_stage || 'interview'} for ${applicationLabel(interview.application)}`}
      >
        <p className="text-sm">
          <InterviewTime interview={interview} viewerZone={viewerZone} showDate={showDate} />
        </p>
        <p className={`text-sm font-medium text-slate-900 break-words ${status === 'cancelled' ? 'line-through' : ''}`}>
          {applicationLabel(interview.application)}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          {interview.interview_stage && <span>{interview.interview_stage}</span>}
          {status !== 'scheduled' && <StatusBadge status={status} />}
        </p>
      </button>
      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
        {actions}
        <Link
          to={`/applications/${interview.application_id}`}
          className={`rounded-md text-xs font-medium text-slate-500 underline hover:text-slate-900 ${FOCUS_RING}`}
        >
          Application
        </Link>
      </div>
    </li>
  );
};

// ─── upcoming ────────────────────────────────────────────────────────────────

const UpcomingView = ({
  interviews,
  viewerZone,
  todayKey,
  now,
  canSetStatus,
  onEdit,
  onCreate,
  onStatus,
}: {
  interviews: CalendarInterview[];
  viewerZone: string;
  todayKey: string;
  now: number;
  canSetStatus: boolean;
  onEdit: (interview: CalendarInterview) => void;
  onCreate: () => void;
  onStatus: (interview: CalendarInterview, status: 'completed' | 'cancelled') => void;
}) => {
  const awaitingOutcome = interviews.filter((item) => needsOutcome(item, now));
  const unscheduled = interviews.filter((item) => !item.interview_date && interviewStatus(item) === 'scheduled');
  const upcoming = interviews.filter(
    (item) => item.interview_date && interviewStatus(item) === 'scheduled' && Date.parse(item.interview_date) >= now,
  );
  const days = [...groupByDay(upcoming, viewerZone).entries()].sort(([a], [b]) => a.localeCompare(b));

  if (!awaitingOutcome.length && !unscheduled.length && !upcoming.length) {
    return (
      <EmptyCalendar
        title="No upcoming interviews"
        description="Schedule an interview for one of your applications and it will appear here, in the week and in the month."
        onCreate={onCreate}
      />
    );
  }

  const quickActions = (interview: CalendarInterview) =>
    canSetStatus ? (
      <>
        <button type="button" onClick={() => onStatus(interview, 'completed')} className={`${BUTTON_SECONDARY} px-2.5 py-1 text-xs`}>
          <CheckCircle2 size={13} /> Completed
        </button>
        <button type="button" onClick={() => onStatus(interview, 'cancelled')} className={`${BUTTON_SECONDARY} px-2.5 py-1 text-xs`}>
          <XCircle size={13} /> Cancelled
        </button>
      </>
    ) : null;

  return (
    <div className="space-y-6">
      {awaitingOutcome.length > 0 && (
        <section aria-labelledby="outcome-heading" className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <h3 id="outcome-heading" className="text-sm font-semibold text-amber-900 mb-1">How did these go?</h3>
          <p className="text-xs text-amber-800 mb-3">These interviews have passed. Mark each as completed or cancelled.</p>
          <ul className="space-y-2">
            {awaitingOutcome.map((interview) => (
              <InterviewRow key={interview.id} interview={interview} viewerZone={viewerZone} onEdit={onEdit} actions={quickActions(interview)} showDate />
            ))}
          </ul>
        </section>
      )}

      {days.map(([day, list]) => (
        <section key={day} aria-labelledby={`day-${day}`}>
          <h3 id={`day-${day}`} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
            {relativeDayLabel(day, todayKey)}
          </h3>
          <ul className="space-y-2">
            {list.map((interview) => (
              <InterviewRow key={interview.id} interview={interview} viewerZone={viewerZone} onEdit={onEdit} />
            ))}
          </ul>
        </section>
      ))}

      {upcoming.length === 0 && (
        <p className="text-sm text-slate-500">Nothing else is scheduled.</p>
      )}

      {unscheduled.length > 0 && (
        <section aria-labelledby="unscheduled-heading">
          <h3 id="unscheduled-heading" className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
            No date yet
          </h3>
          <ul className="space-y-2">
            {unscheduled.map((interview) => (
              <InterviewRow key={interview.id} interview={interview} viewerZone={viewerZone} onEdit={onEdit} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

// ─── week ────────────────────────────────────────────────────────────────────

const CalendarChip = ({
  interview,
  viewerZone,
  onEdit,
}: {
  interview: CalendarInterview;
  viewerZone: string;
  onEdit: (interview: CalendarInterview) => void;
}) => {
  const status = interviewStatus(interview);
  const company = companyName(interview.application) || interview.application?.role_title || 'Interview';
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onEdit(interview);
      }}
      title={`${applicationLabel(interview.application)}${interview.interview_stage ? ` · ${interview.interview_stage}` : ''}`}
      className={`w-full truncate rounded-md border px-1.5 py-1 text-left text-xs transition-colors ${FOCUS_RING} ${
        status === 'cancelled'
          ? 'border-slate-200 bg-slate-50 text-slate-400 line-through'
          : status === 'completed'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            : 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
      }`}
    >
      <span className="font-semibold tabular-nums">{interview.interview_date ? formatTimeInZone(interview.interview_date, viewerZone) : ''}</span>{' '}
      {company}
    </button>
  );
};

const WeekView = ({
  days,
  byDay,
  viewerZone,
  todayKey,
  onEdit,
  onCreate,
}: {
  days: string[];
  byDay: Map<string, CalendarInterview[]>;
  viewerZone: string;
  todayKey: string;
  onEdit: (interview: CalendarInterview) => void;
  onCreate: (day?: string) => void;
}) => {
  const total = days.reduce((sum, day) => sum + (byDay.get(day)?.length ?? 0), 0);
  return (
    <div>
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-7">
        {days.map((day) => {
          const list = byDay.get(day) ?? [];
          const isToday = day === todayKey;
          return (
            <section
              key={day}
              aria-label={formatDayKey(day, { weekday: 'long', day: 'numeric', month: 'long' })}
              className={`rounded-xl border bg-white p-2 lg:min-h-48 ${isToday ? 'border-slate-900' : 'border-slate-200'}`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className={`text-xs font-semibold ${isToday ? 'text-slate-900' : 'text-slate-500'}`}>
                  {formatDayKey(day, { weekday: 'short' })}{' '}
                  <span className={`ml-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 ${isToday ? 'bg-slate-900 text-white' : 'text-slate-900'}`}>
                    {formatDayKey(day, { day: 'numeric' })}
                  </span>
                </p>
                <button
                  type="button"
                  aria-label={`Schedule an interview on ${formatDayKey(day, { weekday: 'long', day: 'numeric', month: 'long' })}`}
                  onClick={() => onCreate(day)}
                  className={`rounded-md p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-700 ${FOCUS_RING}`}
                >
                  <Plus size={14} />
                </button>
              </div>
              {list.length ? (
                <div className="space-y-1.5">
                  {list.map((interview) => (
                    <CalendarChip key={interview.id} interview={interview} viewerZone={viewerZone} onEdit={onEdit} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-300 lg:hidden">No interviews</p>
              )}
            </section>
          );
        })}
      </div>
      {total === 0 && <p className="mt-4 text-center text-sm text-slate-500">No interviews this week.</p>}
    </div>
  );
};

// ─── month ───────────────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_CELL_LIMIT = 3;

const MonthView = ({
  focusDay,
  byDay,
  viewerZone,
  todayKey,
  selectedDay,
  onSelectDay,
  onEdit,
  onCreate,
}: {
  focusDay: string;
  byDay: Map<string, CalendarInterview[]>;
  viewerZone: string;
  todayKey: string;
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
  onEdit: (interview: CalendarInterview) => void;
  onCreate: (day?: string) => void;
}) => {
  const days = monthGrid(focusDay);
  const month = focusDay.slice(0, 7);
  const monthTotal = days.filter((day) => day.startsWith(month)).reduce((sum, day) => sum + (byDay.get(day)?.length ?? 0), 0);
  const selected = selectedDay ? byDay.get(selectedDay) ?? [] : [];

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="py-2">{label}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const list = byDay.get(day) ?? [];
            const inMonth = day.startsWith(month);
            const isToday = day === todayKey;
            const isSelected = day === selectedDay;
            return (
              <div
                key={day}
                className={`min-h-16 sm:min-h-28 border-b border-r border-slate-100 p-1 sm:p-1.5 ${inMonth ? 'bg-white' : 'bg-slate-50/60'} ${isSelected ? 'ring-2 ring-inset ring-slate-900' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => onSelectDay(isSelected ? null : day)}
                  aria-pressed={isSelected}
                  aria-label={`${formatDayKey(day, { weekday: 'long', day: 'numeric', month: 'long' })}: ${list.length} ${list.length === 1 ? 'interview' : 'interviews'}`}
                  className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums ${FOCUS_RING} ${
                    isToday ? 'bg-slate-900 text-white font-semibold' : inMonth ? 'text-slate-800 hover:bg-slate-100' : 'text-slate-400 hover:bg-slate-100'
                  }`}
                >
                  {formatDayKey(day, { day: 'numeric' })}
                </button>
                {/* Phones: a dot per interview; tap the day to list them below. */}
                {list.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-0.5 sm:hidden" aria-hidden="true">
                    {list.slice(0, 4).map((interview) => (
                      <span
                        key={interview.id}
                        className={`h-1.5 w-1.5 rounded-full ${
                          interviewStatus(interview) === 'cancelled' ? 'bg-slate-300' : interviewStatus(interview) === 'completed' ? 'bg-emerald-500' : 'bg-indigo-500'
                        }`}
                      />
                    ))}
                  </div>
                )}
                <div className="mt-1 hidden space-y-1 sm:block">
                  {list.slice(0, MONTH_CELL_LIMIT).map((interview) => (
                    <CalendarChip key={interview.id} interview={interview} viewerZone={viewerZone} onEdit={onEdit} />
                  ))}
                  {list.length > MONTH_CELL_LIMIT && (
                    <button type="button" onClick={() => onSelectDay(day)} className="text-xs font-medium text-slate-500 hover:text-slate-900">
                      +{list.length - MONTH_CELL_LIMIT} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {monthTotal === 0 && !selectedDay && <p className="mt-4 text-center text-sm text-slate-500">No interviews this month.</p>}

      {selectedDay && (
        <section aria-labelledby="selected-day-heading" className="mt-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 id="selected-day-heading" className="text-sm font-semibold text-slate-900">
              {relativeDayLabel(selectedDay, todayKey)}
            </h3>
            <button type="button" onClick={() => onCreate(selectedDay)} className={`${BUTTON_SECONDARY} px-3 py-1.5 text-xs`}>
              <Plus size={13} /> Schedule on this day
            </button>
          </div>
          {selected.length ? (
            <ul className="space-y-2">
              {selected.map((interview) => (
                <InterviewRow key={interview.id} interview={interview} viewerZone={viewerZone} onEdit={onEdit} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No interviews on this day.</p>
          )}
        </section>
      )}
    </div>
  );
};

// ─── dialog ──────────────────────────────────────────────────────────────────

const InterviewDialog = ({
  form,
  interview,
  applications,
  viewerZone,
  canSetStatus,
  onChange,
  onClose,
  onSave,
  onStatus,
  onDelete,
}: {
  form: InterviewForm;
  interview: CalendarInterview | null;
  applications: ApplicationOption[];
  viewerZone: string;
  canSetStatus: boolean;
  onChange: (form: InterviewForm) => void;
  onClose: () => void;
  onSave: (form: InterviewForm) => Promise<string | null>;
  onStatus: (interview: CalendarInterview, status: 'completed' | 'cancelled') => Promise<string | null>;
  onDelete: (interview: CalendarInterview) => Promise<string | null>;
}) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Once per opening: focus the first field, close on Escape, and give focus
  // back to whatever opened the dialog.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);

  const status = interview ? interviewStatus(interview) : 'scheduled';
  const zones = useMemo(() => timeZoneOptions(viewerZone, form.timeZone), [viewerZone, form.timeZone]);
  // Active applications to choose from, plus the linked one if it's archived.
  const choices = applications.filter((app) => !app.archived || app.id === form.applicationId);

  let preview = '';
  if (form.date && form.time && form.timeZone !== viewerZone) {
    try {
      const instant = zonedDateTimeToUtc(form.date, form.time, form.timeZone).toISOString();
      preview = `${formatDayKey(dayKeyInZone(instant, viewerZone), { weekday: 'short', day: 'numeric', month: 'short' })} ${formatTimeInZone(instant, viewerZone)} in your time zone (${viewerZone}).`;
    } catch {
      preview = '';
    }
  }

  const run = async (label: string, action: () => Promise<string | null>) => {
    setBusy(label);
    setProblem('');
    const failure = await action();
    setBusy(null);
    if (failure) setProblem(failure);
    else onClose();
  };

  const set = <K extends keyof InterviewForm>(key: K, value: InterviewForm[K]) => onChange({ ...form, [key]: value });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="interview-dialog-title"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 id="interview-dialog-title" className="text-lg font-semibold text-slate-900">
              {interview ? 'Edit interview' : 'Schedule interview'}
            </h2>
            {interview && (
              <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                <StatusBadge status={status} />
                {status === 'cancelled' && <span>Choose a new date and save to reschedule.</span>}
              </p>
            )}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className={`rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 ${FOCUS_RING}`}>
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run('save', () => onSave(form));
          }}
          className="space-y-4"
        >
          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1">Application</span>
            <select ref={firstFieldRef} value={form.applicationId} onChange={(event) => set('applicationId', event.target.value)} className={INPUT} required>
              <option value="">Choose an application…</option>
              {choices.map((app) => (
                <option key={app.id} value={app.id}>{applicationLabel(app)}</option>
              ))}
            </select>
            {choices.length === 0 && (
              <span className="mt-1 block text-xs text-slate-500">
                Add an application first: <Link to="/applications" className="underline">Applications</Link>.
              </span>
            )}
          </label>

          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1">Interview stage</span>
            <input
              value={form.stage}
              onChange={(event) => set('stage', event.target.value)}
              list="interview-stage-options"
              placeholder="e.g. Technical interview"
              className={INPUT}
            />
            <datalist id="interview-stage-options">
              {INTERVIEW_STAGES.map((stage) => <option key={stage} value={stage} />)}
            </datalist>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">Date</span>
              <input type="date" value={form.date} onChange={(event) => set('date', event.target.value)} className={INPUT} required />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">Time</span>
              <input type="time" value={form.time} onChange={(event) => set('time', event.target.value)} className={INPUT} required />
            </label>
          </div>

          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1">Time zone</span>
            <select value={form.timeZone} onChange={(event) => set('timeZone', event.target.value)} className={INPUT}>
              {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              {preview || 'The time zone the interview was arranged in.'}
              {!canSetStatus && ' Not saved until the calendar database update has run.'}
            </span>
          </label>

          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1">Notes</span>
            <textarea
              value={form.notes}
              onChange={(event) => set('notes', event.target.value)}
              rows={3}
              placeholder="Interviewers, meeting link, what to prepare…"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </label>

          {problem && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{problem}</p>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {interview && (
                confirmDelete ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void run('delete', () => onDelete(interview))}
                    className={`${BUTTON_SECONDARY} border-red-300 text-red-700 hover:bg-red-50`}
                  >
                    {busy === 'delete' && <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />}
                    Confirm delete
                  </button>
                ) : (
                  <button type="button" onClick={() => setConfirmDelete(true)} className={`${BUTTON_SECONDARY} text-red-700`}>
                    Delete
                  </button>
                )
              )}
              {interview && status === 'scheduled' && (
                <>
                  <button
                    type="button"
                    disabled={!canSetStatus || busy !== null}
                    title={canSetStatus ? undefined : 'Needs the calendar database update'}
                    onClick={() => void run('cancel', () => onStatus(interview, 'cancelled'))}
                    className={BUTTON_SECONDARY}
                  >
                    {busy === 'cancel' ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" /> : <XCircle size={14} />}
                    Cancel interview
                  </button>
                  <button
                    type="button"
                    disabled={!canSetStatus || busy !== null}
                    title={canSetStatus ? undefined : 'Needs the calendar database update'}
                    onClick={() => void run('complete', () => onStatus(interview, 'completed'))}
                    className={BUTTON_SECONDARY}
                  >
                    {busy === 'complete' ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" /> : <CheckCircle2 size={14} />}
                    Mark completed
                  </button>
                </>
              )}
            </div>
            <button type="submit" disabled={busy !== null} className={`${BUTTON_PRIMARY} shrink-0 whitespace-nowrap`}>
              {busy === 'save' && <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />}
              {interview ? 'Save changes' : 'Schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── states ──────────────────────────────────────────────────────────────────

const EmptyCalendar = ({ title, description, onCreate }: { title: string; description: string; onCreate: () => void }) => (
  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center">
    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white">
      <CalendarDays size={18} className="text-slate-400" />
    </div>
    <p className="text-sm font-semibold text-slate-800">{title}</p>
    <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>
    <button type="button" onClick={onCreate} className={`${BUTTON_PRIMARY} mt-4`}>
      <Plus size={16} />
      Schedule interview
    </button>
  </div>
);

const CalendarSkeleton = ({ view }: { view: CalendarView }) => (
  <div aria-busy="true">
    <span role="status" className="sr-only">Loading interviews…</span>
    {view === 'month' ? (
      <div className="grid grid-cols-7 gap-1" aria-hidden="true">
        {Array.from({ length: 35 }).map((_, index) => (
          <div key={index} className="h-16 sm:h-28 rounded-lg bg-slate-100 animate-pulse motion-reduce:animate-none" />
        ))}
      </div>
    ) : view === 'week' ? (
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-7" aria-hidden="true">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="h-20 lg:h-48 rounded-xl bg-slate-100 animate-pulse motion-reduce:animate-none" />
        ))}
      </div>
    ) : (
      <div className="space-y-3" aria-hidden="true">
        <div className="h-3 w-24 rounded bg-slate-100 animate-pulse motion-reduce:animate-none" />
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <Clock size={16} className="text-slate-200" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/3 rounded bg-slate-100 animate-pulse motion-reduce:animate-none" />
              <div className="h-3 w-1/2 rounded bg-slate-100 animate-pulse motion-reduce:animate-none" />
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);
