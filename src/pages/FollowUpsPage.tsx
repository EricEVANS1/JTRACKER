import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquareText,
  RefreshCw,
  Search,
  Send,
  X,
} from 'lucide-react';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useOnboarding } from '../hooks/useOnboarding';
import { OnboardingHint } from '../components/OnboardingHint';

interface CompanyJoin {
  name: string;
}

interface RawApplicationItem {
  id: string;
  role_title: string;
  status: string;
  source?: string | null;
  application_link?: string | null;
  date_applied?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  last_status_changed_at?: string | null;
  response_received_at?: string | null;
  assessment_received_at?: string | null;
  interview_started_at?: string | null;
  final_interview_started_at?: string | null;
  offer_received_at?: string | null;
  rejected_at?: string | null;
  follow_up_date?: string | null;
  companies?: CompanyJoin | CompanyJoin[] | null;
}

interface ApplicationItem extends Omit<RawApplicationItem, 'companies'> {
  companies: CompanyJoin | null;
}

type FollowUpGroup =
  | 'overdue'
  | 'today'
  | 'upcoming'
  | 'assessment'
  | 'interview'
  | 'no_response'
  | 'missing';

type FilterValue = 'all' | FollowUpGroup;

type AlertType = 'error' | 'success';

type FollowUpItem = ApplicationItem & {
  group: FollowUpGroup;
  lastActivity?: string | null;
  daysSinceActivity: number;
  daysSinceApplied: number;
  suggestedAction: string;
  urgencyScore: number;
};

const firstOrNull = <T,>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const inputCls =
  'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition';

const ACTIVE_STATUSES = [
  'wishlist',
  'applied',
  'confirmation_received',
  'assessment',
  'interview',
  'final_interview',
  'ghosted',
];

const formatStatus = (status: string) =>
  status.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

const formatDate = (date?: string | null) => {
  if (!date) return 'Not set';

  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const formatDateTime = (date?: string | null) => {
  if (!date) return 'Not set';

  return new Date(date).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const toDateTimeLocal = (date?: string | null) => {
  if (!date) return '';

  const d = new Date(date);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60 * 1000);

  return local.toISOString().slice(0, 16);
};

const getDaysSince = (date?: string | null) => {
  if (!date) return 999;

  const now = new Date().getTime();
  const target = new Date(date).getTime();

  return Math.max(0, Math.floor((now - target) / (1000 * 60 * 60 * 24)));
};

const getDateInDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
};

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const getFollowUpGroup = (app: ApplicationItem): FollowUpGroup => {
  if (app.follow_up_date) {
    const now = new Date();
    const target = new Date(app.follow_up_date);

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    if (target < todayStart) return 'overdue';
    if (isSameDay(target, now)) return 'today';
    return 'upcoming';
  }

  if (app.status === 'assessment') return 'assessment';
  if (app.status === 'interview' || app.status === 'final_interview') return 'interview';

  const waitingStatuses = ['applied', 'confirmation_received'];
  const daysSinceApplied = getDaysSince(app.date_applied || app.created_at);

  if (waitingStatuses.includes(app.status) && daysSinceApplied >= 10) {
    return 'no_response';
  }

  return 'missing';
};

const getGroupPriority = (group: FollowUpGroup) => {
  const priority: Record<FollowUpGroup, number> = {
    overdue: 0,
    today: 1,
    assessment: 2,
    interview: 3,
    no_response: 4,
    upcoming: 5,
    missing: 6,
  };

  return priority[group];
};

const getSuggestedAction = (app: ApplicationItem, group: FollowUpGroup, daysSinceApplied: number) => {
  if (group === 'overdue') return 'Follow up now or snooze if this opportunity is no longer urgent.';
  if (group === 'today') return 'Send the planned follow-up today.';
  if (app.status === 'assessment') return 'Check the assessment deadline and complete the task before following up.';
  if (app.status === 'final_interview') return 'Send a polite next-steps message if you have not heard back recently.';
  if (app.status === 'interview') return 'Send a thank-you note or ask about the next step after the interview.';
  if (group === 'no_response') {
    return daysSinceApplied >= 21
      ? 'Consider one final follow-up or mark this as ghosted later.'
      : 'Send a short follow-up asking whether there is any update on your application.';
  }
  if (group === 'upcoming') return 'Follow-up is already scheduled.';
  return 'Set a follow-up date so this application does not get forgotten.';
};

const getUrgencyScore = (app: ApplicationItem, group: FollowUpGroup, daysSinceApplied: number) => {
  if (group === 'overdue') return 100;
  if (group === 'today') return 90;
  if (app.status === 'assessment') return 85;
  if (app.status === 'final_interview') return 80;
  if (app.status === 'interview') return 75;
  if (group === 'no_response' && daysSinceApplied >= 21) return 70;
  if (group === 'no_response') return 60;
  if (group === 'upcoming') return 40;
  return 20;
};

const buildFollowUpMessage = (app: FollowUpItem) => {
  const companyName = app.companies?.name || 'your team';
  const roleTitle = app.role_title;

  if (app.status === 'interview' || app.status === 'final_interview') {
    return `Subject: Follow-up on ${roleTitle}\n\nDear Hiring Team,\n\nI hope you are doing well.\n\nThank you again for the opportunity to discuss the ${roleTitle} position with ${companyName}. I enjoyed learning more about the role and the team, and I remain very interested in the opportunity.\n\nI wanted to kindly ask whether there are any updates regarding the next steps in the process.\n\nThank you for your time and consideration.\n\nBest regards,\nEric`;
  }

  if (app.status === 'assessment') {
    return `Subject: Follow-up on ${roleTitle} assessment\n\nDear Hiring Team,\n\nI hope you are doing well.\n\nI am writing to follow up regarding the ${roleTitle} assessment for ${companyName}. I remain very interested in the role and wanted to confirm whether there are any updates or additional next steps required from my side.\n\nThank you for your time and consideration.\n\nBest regards,\nEric`;
  }

  return `Subject: Follow-up on ${roleTitle} application\n\nDear Hiring Team,\n\nI hope you are doing well.\n\nI recently applied for the ${roleTitle} position with ${companyName}, and I wanted to kindly follow up to ask whether there are any updates regarding my application.\n\nI remain very interested in the opportunity and would be happy to provide any additional information if needed.\n\nThank you for your time and consideration.\n\nBest regards,\nEric`;
};

export const FollowUpsPage: React.FC = () => {
  const { user } = useAuth();
  const { onboardingComplete, completedSteps, refreshOnboarding } = useOnboarding();

  const [applications, setApplications] = useState<ApplicationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<FilterValue>('all');
  const [selectedMessageApp, setSelectedMessageApp] = useState<FollowUpItem | null>(null);
  const [followUpMessage, setFollowUpMessage] = useState('');
  const [copied, setCopied] = useState(false);

  const fetchApplications = async () => {
    if (!user) return;

    setError('');

    const { data, error } = await supabase
      .from('applications')
      .select(`
        id,
        role_title,
        status,
        source,
        application_link,
        date_applied,
        updated_at,
        created_at,
        last_status_changed_at,
        response_received_at,
        assessment_received_at,
        interview_started_at,
        final_interview_started_at,
        offer_received_at,
        rejected_at,
        follow_up_date,
        companies (
          name
        )
      `)
      .eq('user_id', user.id)
      .in('status', ACTIVE_STATUSES)
      .order('follow_up_date', { ascending: true, nullsFirst: false });

    if (error) {
      setError(error.message);
      return;
    }

    const normalized: ApplicationItem[] = ((data || []) as RawApplicationItem[]).map(
      (app) => ({
        ...app,
        companies: firstOrNull(app.companies),
      })
    );

    setApplications(normalized);
  };

  const loadPage = async () => {
    setLoading(true);
    await fetchApplications();
    setLoading(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchApplications();
    setRefreshing(false);
  };

  useEffect(() => {
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const followUps = useMemo<FollowUpItem[]>(() => {
    return applications
      .map((app) => {
        const group = getFollowUpGroup(app);
        const lastActivity = app.last_status_changed_at || app.updated_at || app.created_at;
        const daysSinceActivity = getDaysSince(lastActivity);
        const daysSinceApplied = getDaysSince(app.date_applied || app.created_at);

        return {
          ...app,
          group,
          lastActivity,
          daysSinceActivity,
          daysSinceApplied,
          suggestedAction: getSuggestedAction(app, group, daysSinceApplied),
          urgencyScore: getUrgencyScore(app, group, daysSinceApplied),
        };
      })
      .filter((app) => {
        const term = search.toLowerCase().trim();

        const matchesSearch =
          !term ||
          app.role_title.toLowerCase().includes(term) ||
          app.companies?.name.toLowerCase().includes(term) ||
          app.status.toLowerCase().includes(term) ||
          app.suggestedAction.toLowerCase().includes(term);

        const matchesGroup = groupFilter === 'all' || app.group === groupFilter;

        return matchesSearch && matchesGroup;
      })
      .sort((a, b) => {
        const groupDiff = getGroupPriority(a.group) - getGroupPriority(b.group);
        if (groupDiff !== 0) return groupDiff;

        if (b.urgencyScore !== a.urgencyScore) {
          return b.urgencyScore - a.urgencyScore;
        }

        const aDate = a.follow_up_date ? new Date(a.follow_up_date).getTime() : Infinity;
        const bDate = b.follow_up_date ? new Date(b.follow_up_date).getTime() : Infinity;

        return aDate - bDate;
      });
  }, [applications, search, groupFilter]);

  const stats = useMemo(() => {
    const grouped = applications.map((app) => getFollowUpGroup(app));

    return {
      overdue: grouped.filter((group) => group === 'overdue').length,
      today: grouped.filter((group) => group === 'today').length,
      assessment: grouped.filter((group) => group === 'assessment').length,
      interview: grouped.filter((group) => group === 'interview').length,
      noResponse: grouped.filter((group) => group === 'no_response').length,
      upcoming: grouped.filter((group) => group === 'upcoming').length,
      missing: grouped.filter((group) => group === 'missing').length,
    };
  }, [applications]);

  const saveApplicationEvent = async (
    applicationId: string,
    eventType: string,
    title: string,
    description: string
  ) => {
    if (!user) return;

    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: applicationId,
      event_type: eventType,
      title,
      description,
      event_date: new Date().toISOString(),
    });
  };

  const handleSetFollowUp = async (applicationId: string, value: string) => {
    if (!user) return;

    setSavingId(applicationId);
    setError('');
    setMessage('');

    const followUpDate = value ? new Date(value).toISOString() : null;

    const { error } = await supabase
      .from('applications')
      .update({ follow_up_date: followUpDate })
      .eq('id', applicationId)
      .eq('user_id', user.id);

    if (error) {
      setError(error.message);
      setSavingId(null);
      return;
    }

    await saveApplicationEvent(
      applicationId,
      'follow_up_scheduled',
      followUpDate ? 'Follow-up scheduled' : 'Follow-up cleared',
      followUpDate
        ? `Follow-up scheduled for ${formatDateTime(followUpDate)}.`
        : 'Follow-up date was cleared.'
    );

    setApplications((prev) =>
      prev.map((app) =>
        app.id === applicationId ? { ...app, follow_up_date: followUpDate } : app
      )
    );

    setMessage(followUpDate ? 'Follow-up date updated.' : 'Follow-up cleared.');
    await refreshOnboarding();
    setSavingId(null);
  };

  const handleSnooze = async (app: ApplicationItem, days: number) => {
    await handleSetFollowUp(app.id, toDateTimeLocal(getDateInDays(days)));
    setMessage(`Follow-up snoozed for ${days} day${days === 1 ? '' : 's'}.`);
  };

  const handleMarkDone = async (app: ApplicationItem) => {
    if (!user) return;

    setSavingId(app.id);
    setError('');
    setMessage('');

    const { error } = await supabase
      .from('applications')
      .update({ follow_up_date: null })
      .eq('id', app.id)
      .eq('user_id', user.id);

    if (error) {
      setError(error.message);
      setSavingId(null);
      return;
    }

    await saveApplicationEvent(
      app.id,
      'follow_up_completed',
      'Follow-up completed',
      `Follow-up completed for ${app.role_title}.`
    );

    setApplications((prev) =>
      prev.map((item) =>
        item.id === app.id ? { ...item, follow_up_date: null } : item
      )
    );

    setMessage('Follow-up marked as completed.');
    await refreshOnboarding();
    setSavingId(null);
  };

  const handleMarkGhosted = async (app: ApplicationItem) => {
    if (!user) return;

    const confirmed = window.confirm(
      `Mark ${app.role_title} as ghosted? This will remove it from the active follow-up queue.`
    );

    if (!confirmed) return;

    setSavingId(app.id);
    setError('');
    setMessage('');

    const { error } = await supabase
      .from('applications')
      .update({
        status: 'ghosted',
        follow_up_date: null,
        ghosted_at: new Date().toISOString(),
      })
      .eq('id', app.id)
      .eq('user_id', user.id);

    if (error) {
      setError(error.message);
      setSavingId(null);
      return;
    }

    await saveApplicationEvent(
      app.id,
      'status_changed',
      'Application marked as ghosted',
      `Application was marked as ghosted after ${getDaysSince(app.date_applied || app.created_at)} days without a response.`
    );

    setApplications((prev) => prev.filter((item) => item.id !== app.id));
    setMessage('Application marked as ghosted.');
    setSavingId(null);
  };

  const handleGenerateMessage = (app: FollowUpItem) => {
    setSelectedMessageApp(app);
    setFollowUpMessage(buildFollowUpMessage(app));
    setCopied(false);
  };

  const handleCopyMessage = async () => {
    if (!followUpMessage.trim()) return;

    await navigator.clipboard.writeText(followUpMessage);
    setCopied(true);
  };

  if (loading) {
    return <FollowUpsSkeleton />;
  }

  return (
    <div className="w-full max-w-full overflow-hidden">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <Clock3 className="text-slate-700 shrink-0" size={30} />
            <h1 className="text-2xl sm:text-3xl font-bold break-words">
              Follow-Ups
            </h1>
          </div>

          <p className="text-slate-500 text-sm sm:text-base break-words max-w-3xl">
            Your smart action queue for overdue follow-ups, interviews, assessments,
            and applications that have gone quiet.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="w-full sm:w-auto self-start lg:self-auto border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && <AlertBox type="error" message={error} onClose={() => setError('')} />}
      {message && <AlertBox type="success" message={message} onClose={() => setMessage('')} />}

      {!onboardingComplete && !completedSteps.hasFollowUp && (
        <OnboardingHint
          title="Set your first follow-up reminder"
          description="Follow-up reminders help you stay consistent with recruiters and avoid losing active opportunities."
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard label="Overdue" value={stats.overdue} tone="danger" />
        <StatCard label="Due Today" value={stats.today} tone="warning" />
        <StatCard label="Assessments" value={stats.assessment} tone="purple" />
        <StatCard label="Interviews" value={stats.interview} tone="blue" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="No Response" value={stats.noResponse} tone="neutral" compact />
        <StatCard label="Upcoming" value={stats.upcoming} tone="muted" compact />
        <StatCard label="Needs Date" value={stats.missing} tone="muted" compact />
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 mb-6 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-3">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search role, company, status, or recommended action..."
              className={`${inputCls} pl-9`}
            />
          </div>

          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value as FilterValue)}
            className={inputCls}
          >
            <option value="all">All action items</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="assessment">Assessments</option>
            <option value="interview">Interviews</option>
            <option value="no_response">No response</option>
            <option value="upcoming">Upcoming</option>
            <option value="missing">Needs follow-up date</option>
          </select>
        </div>
      </div>

      {followUps.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-10 text-center shadow-sm overflow-hidden">
          <CheckCircle2 size={34} className="mx-auto text-emerald-400 mb-3" />
          <h3 className="text-lg font-semibold mb-1 break-words">
            No follow-ups found
          </h3>
          <p className="text-slate-500 text-sm break-words">
            You are clear for now, or your current filters returned no results.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {followUps.map((app) => (
            <FollowUpCard
              key={app.id}
              app={app}
              saving={savingId === app.id}
              onSetFollowUp={handleSetFollowUp}
              onMarkDone={handleMarkDone}
              onSnooze={handleSnooze}
              onGenerateMessage={handleGenerateMessage}
              onMarkGhosted={handleMarkGhosted}
            />
          ))}
        </div>
      )}

      {selectedMessageApp && (
        <MessageModal
          app={selectedMessageApp}
          message={followUpMessage}
          copied={copied}
          onChange={setFollowUpMessage}
          onCopy={handleCopyMessage}
          onClose={() => setSelectedMessageApp(null)}
        />
      )}
    </div>
  );
};

const FollowUpCard = ({
  app,
  saving,
  onSetFollowUp,
  onMarkDone,
  onSnooze,
  onGenerateMessage,
  onMarkGhosted,
}: {
  app: FollowUpItem;
  saving: boolean;
  onSetFollowUp: (applicationId: string, value: string) => void;
  onMarkDone: (app: ApplicationItem) => void;
  onSnooze: (app: ApplicationItem, days: number) => void;
  onGenerateMessage: (app: FollowUpItem) => void;
  onMarkGhosted: (app: ApplicationItem) => void;
}) => {
  const groupStyle = {
    overdue: 'bg-red-50 text-red-700 border-red-200',
    today: 'bg-amber-50 text-amber-700 border-amber-200',
    upcoming: 'bg-blue-50 text-blue-700 border-blue-200',
    assessment: 'bg-violet-50 text-violet-700 border-violet-200',
    interview: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    no_response: 'bg-orange-50 text-orange-700 border-orange-200',
    missing: 'bg-slate-50 text-slate-600 border-slate-200',
  }[app.group];

  const groupLabel = {
    overdue: 'Overdue',
    today: 'Due Today',
    upcoming: 'Upcoming',
    assessment: 'Assessment',
    interview: 'Interview Follow-up',
    no_response: 'No Response',
    missing: 'Needs Date',
  }[app.group];

  const showGhostedAction =
    app.group === 'no_response' && app.daysSinceApplied >= 21 && app.status !== 'ghosted';

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-md transition overflow-hidden">
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
              <Mail size={18} className="text-slate-600" />
            </div>

            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-950 break-words">
                {app.role_title}
              </h2>
              <p className="text-sm text-slate-500 mt-0.5 break-words">
                {app.companies?.name || 'Unknown Company'}
              </p>

              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full text-xs font-medium">
                  {formatStatus(app.status)}
                </span>

                <span
                  className={`border px-2.5 py-1 rounded-full text-xs font-medium ${groupStyle}`}
                >
                  {groupLabel}
                </span>

                {app.daysSinceApplied >= 21 && ['applied', 'confirmation_received'].includes(app.status) && (
                  <span className="bg-zinc-100 text-zinc-700 px-2.5 py-1 rounded-full text-xs font-medium">
                    Possibly Ghosted
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-start gap-2">
              <CalendarClock size={16} className="text-slate-500 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Recommended action
                </p>
                <p className="text-sm text-slate-700 mt-1 break-words">
                  {app.suggestedAction}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-5">
            <Meta label="Applied" value={formatDate(app.date_applied || app.created_at)} />
            <Meta label="Follow-up" value={formatDateTime(app.follow_up_date)} />
            <Meta label="Last Activity" value={formatDateTime(app.lastActivity)} />
            <Meta label="Quiet For" value={`${app.daysSinceActivity} days`} />
          </div>
        </div>

        <div className="xl:min-w-[320px] space-y-3">
          <label>
            <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Set Follow-up
            </span>
            <input
              key={app.follow_up_date || app.id}
              type="datetime-local"
              defaultValue={toDateTimeLocal(app.follow_up_date)}
              disabled={saving}
              onBlur={(e) => onSetFollowUp(app.id, e.target.value)}
              className={inputCls}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => onSnooze(app, 3)}
              className="border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm hover:bg-slate-50 transition disabled:opacity-50"
            >
              Snooze 3d
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() => onSnooze(app, 7)}
              className="border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm hover:bg-slate-50 transition disabled:opacity-50"
            >
              Snooze 7d
            </button>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={() => onGenerateMessage(app)}
            className="w-full border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <MessageSquareText size={15} />
            Generate Message
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={() => onMarkDone(app)}
            className="w-full bg-slate-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-700 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            {saving ? 'Saving...' : 'Mark Done'}
          </button>

          {showGhostedAction && (
            <button
              type="button"
              disabled={saving}
              onClick={() => onMarkGhosted(app)}
              className="w-full border border-orange-200 bg-orange-50 text-orange-700 px-4 py-2 rounded-lg text-sm hover:bg-orange-100 transition disabled:opacity-50"
            >
              Mark as Ghosted
            </button>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2">
            <a
              href={`/applications/${app.id}`}
              className="w-full border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 transition inline-flex items-center justify-center gap-2"
            >
              Open Application
              <ExternalLink size={14} />
            </a>

            {app.application_link && (
              <a
                href={app.application_link}
                target="_blank"
                rel="noreferrer"
                className="w-full border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 transition inline-flex items-center justify-center gap-2"
              >
                Job Link
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const MessageModal = ({
  app,
  message,
  copied,
  onChange,
  onCopy,
  onClose,
}: {
  app: FollowUpItem;
  message: string;
  copied: boolean;
  onChange: (value: string) => void;
  onCopy: () => void;
  onClose: () => void;
}) => (
  <div className="fixed inset-0 z-50 bg-slate-950/40 p-4 flex items-center justify-center">
    <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-3xl bg-white shadow-xl border border-slate-200">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900 break-words">
            Follow-up message
          </h2>
          <p className="text-sm text-slate-500 mt-1 break-words">
            {app.role_title} · {app.companies?.name || 'Unknown Company'}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <X size={18} />
        </button>
      </div>

      <div className="p-5 overflow-y-auto max-h-[70vh]">
        <textarea
          value={message}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-80 w-full rounded-2xl border border-slate-200 p-4 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-slate-400"
        />

        <div className="mt-4 flex flex-col sm:flex-row gap-3 sm:justify-end">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Copy size={15} />
            {copied ? 'Copied' : 'Copy'}
          </button>

          <a
            href={`mailto:?subject=${encodeURIComponent(
              message.split('\n')[0]?.replace(/^Subject:\s*/i, '') || `Follow-up on ${app.role_title}`
            )}&body=${encodeURIComponent(message.replace(/^Subject:.*\n\n?/i, ''))}`}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            <Send size={15} />
            Open Email App
          </a>
        </div>
      </div>
    </div>
  </div>
);

const AlertBox = ({
  type,
  message,
  onClose,
}: {
  type: AlertType;
  message: string;
  onClose: () => void;
}) => (
  <div
    className={`rounded-xl p-4 mb-6 flex items-start gap-3 border overflow-hidden ${
      type === 'error'
        ? 'bg-red-50 border-red-200 text-red-700'
        : 'bg-emerald-50 border-emerald-200 text-emerald-700'
    }`}
  >
    {type === 'error' ? (
      <AlertCircle size={16} className="shrink-0 mt-0.5" />
    ) : (
      <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
    )}
    <span className="text-sm flex-1 break-words">{message}</span>
    <button onClick={onClose} className="opacity-70 hover:opacity-100 shrink-0">
      <X size={16} />
    </button>
  </div>
);

const StatCard = ({
  label,
  value,
  tone,
  compact = false,
}: {
  label: string;
  value: number;
  tone: 'danger' | 'warning' | 'neutral' | 'muted' | 'purple' | 'blue';
  compact?: boolean;
}) => {
  const toneClass = {
    danger: 'bg-red-50 border-red-200 text-red-700',
    warning: 'bg-amber-50 border-amber-200 text-amber-700',
    neutral: 'bg-orange-50 border-orange-200 text-orange-700',
    muted: 'bg-white border-slate-200 text-slate-900',
    purple: 'bg-violet-50 border-violet-200 text-violet-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
  }[tone];

  return (
    <div
      className={`border rounded-2xl shadow-sm overflow-hidden ${toneClass} ${
        compact ? 'p-4' : 'p-4 sm:p-5'
      }`}
    >
      <p className="text-sm opacity-80 break-words">{label}</p>
      <p className={`${compact ? 'text-2xl' : 'text-2xl sm:text-3xl'} font-bold mt-2 break-words`}>
        {value}
      </p>
    </div>
  );
};

const Meta = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 overflow-hidden">
    <p className="text-[11px] text-slate-400 break-words">{label}</p>
    <p className="text-sm font-medium text-slate-700 break-words">{value}</p>
  </div>
);

const FollowUpsSkeleton = () => (
  <div className="w-full max-w-full overflow-hidden">
    <div className="mb-8">
      <div className="h-8 w-52 bg-slate-200 rounded-lg animate-pulse mb-2" />
      <div className="h-4 w-full max-w-96 bg-slate-100 rounded-lg animate-pulse" />
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="h-28 bg-white border border-slate-200 rounded-2xl animate-pulse"
        />
      ))}
    </div>

    <div className="h-16 bg-white border border-slate-200 rounded-2xl animate-pulse mb-6" />

    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="h-44 bg-white border border-slate-200 rounded-2xl animate-pulse"
        />
      ))}
    </div>
  </div>
);
