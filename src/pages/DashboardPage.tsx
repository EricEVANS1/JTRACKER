import React, { useEffect, useMemo, useState } from 'react';
import {
AlertCircle,
Bell,
Briefcase,
CalendarCheck,
CheckCircle2,
Clock,
FileText,
MailCheck,
RefreshCw,
Target,
Timer,
TrendingUp,
Trophy,
UserRound,
X,
XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useOnboarding } from '../hooks/useOnboarding';

type ApplicationStatus =
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

interface DashboardApplication {
id: string;
role_title: string | null;
status: ApplicationStatus;
archived: boolean | null;
date_applied: string | null;
created_at: string;
updated_at: string | null;
follow_up_date?: string | null;
response_received_at?: string | null;
assessment_received_at?: string | null;
interview_started_at?: string | null;
final_interview_started_at?: string | null;
offer_received_at?: string | null;
rejected_at?: string | null;
withdrawn_at?: string | null;
ghosted_at?: string | null;
last_status_changed_at?: string | null;
status_updated_at?: string | null;
reached_interview?: boolean | null;
final_response_pending?: boolean | null;
rejected_after_interview?: boolean | null;
}

interface RecentEvent {
id: string;
title: string;
description: string | null;
event_date: string;
applications?: {
role_title: string;
companies?: {
name: string;
} | null;
} | null;
}

interface NotificationItem {
id: string;
title: string | null;
message: string | null;
type: string | null;
read: boolean | null;
created_at: string;
}

interface GmailSyncSession {
id: string;
scanned_count: number | null;
accepted_count: number | null;
review_count: number | null;
rejected_count: number | null;
processing_time_ms: number | null;
status: string | null;
error_message: string | null;
created_at: string;
}

interface EmailEvent {
id: string;
provider_message_id: string | null;
received_at: string | null;
application_id: string | null;
}

interface IgnoredEmailEvent {
id: string;
}

interface Recruiter {
id: string;
}

interface RecruiterInteraction {
id: string;
}

interface CVVersion {
id: string;
}

const responseStatuses: ApplicationStatus[] = [
'confirmation_received',
'assessment',
'interview',
'final_interview',
'offer',
'rejected',
'withdrawn',
'ghosted',
];

const closedStatuses: ApplicationStatus[] = [
'offer',
'rejected',
'withdrawn',
'ghosted',
'archived',
];

const funnelStatuses: { value: ApplicationStatus; label: string }[] = [
{ value: 'wishlist', label: 'Wishlist' },
{ value: 'applied', label: 'Applied' },
{ value: 'confirmation_received', label: 'Response' },
{ value: 'assessment', label: 'Assessment' },
{ value: 'interview', label: 'Interview' },
{ value: 'final_interview', label: 'Final' },
{ value: 'offer', label: 'Offer' },
{ value: 'rejected', label: 'Rejected' },
{ value: 'withdrawn', label: 'Withdrawn' },
{ value: 'ghosted', label: 'Ghosted' },
{ value: 'archived', label: 'Archived' },
];

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

const formatShortDate = (date?: string | null) => {
if (!date) return 'Not set';

return new Date(date).toLocaleDateString('en-GB', {
day: 'numeric',
month: 'short',
});
};

const formatDuration = (ms?: number | null) => {
if (!ms) return '0s';
if (ms < 1000) return `${ms}ms`;
return `${(ms / 1000).toFixed(1)}s`;
};

const getAppliedDate = (app: DashboardApplication) => app.date_applied || app.created_at;

const getDaysBetween = (start?: string | null, end?: string | null) => {
if (!start || !end) return null;

const startTime = new Date(start).getTime();
const endTime = new Date(end).getTime();

if (Number.isNaN(startTime) || Number.isNaN(endTime)) return null;

return Math.max(0, Math.round((endTime - startTime) / 86400000));
};

const average = (values: number[]) => {
if (values.length === 0) return 0;
return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
};

const isSameDay = (date: Date, compareTo: Date) =>
date.getFullYear() === compareTo.getFullYear() &&
date.getMonth() === compareTo.getMonth() &&
date.getDate() === compareTo.getDate();

const startOfDay = (date: Date) =>
new Date(date.getFullYear(), date.getMonth(), date.getDate());

const isActiveApplication = (app: DashboardApplication) =>
!app.archived && !closedStatuses.includes(app.status);

const hasReachedInterview = (app: DashboardApplication) =>
Boolean(
app.reached_interview ||
app.interview_started_at ||
app.final_interview_started_at ||
app.status === 'interview' ||
app.status === 'final_interview' ||
app.status === 'offer'
);

export const DashboardPage: React.FC = () => {
const { user } = useAuth();

const {
onboardingComplete,
completedSteps,
completedCount,
totalSteps,
progressPercent,
dismissOnboarding,
} = useOnboarding();

const [applications, setApplications] = useState<DashboardApplication[]>([]);
const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);
const [notifications, setNotifications] = useState<NotificationItem[]>([]);
const [emailEvents, setEmailEvents] = useState<EmailEvent[]>([]);
const [ignoredEmails, setIgnoredEmails] = useState<IgnoredEmailEvent[]>([]);
const [latestSync, setLatestSync] = useState<GmailSyncSession | null>(null);
const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
const [recruiterInteractions, setRecruiterInteractions] = useState<RecruiterInteraction[]>([]);
const [cvVersions, setCvVersions] = useState<CVVersion[]>([]);

const [loading, setLoading] = useState(true);
const [refreshing, setRefreshing] = useState(false);
const [error, setError] = useState('');

const fetchDashboardData = async () => {
if (!user) return;


setError('');

const [
  applicationsResult,
  eventsResult,
  notificationsResult,
  emailEventsResult,
  ignoredEmailsResult,
  syncSessionsResult,
  recruitersResult,
  recruiterInteractionsResult,
  cvVersionsResult,
] = await Promise.all([
  supabase
    .from('applications')
    .select(`
      id,
      role_title,
      status,
      archived,
      date_applied,
      created_at,
      updated_at,
      follow_up_date,
      response_received_at,
      assessment_received_at,
      interview_started_at,
      final_interview_started_at,
      offer_received_at,
      rejected_at,
      withdrawn_at,
      ghosted_at,
      last_status_changed_at,
      status_updated_at,
      reached_interview,
      final_response_pending,
      rejected_after_interview
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false }),

  supabase
    .from('application_events')
    .select(`
      id,
      title,
      description,
      event_date,
      applications (
        role_title,
        companies (
          name
        )
      )
    `)
    .eq('user_id', user.id)
    .order('event_date', { ascending: false })
    .limit(8),

  supabase
    .from('notifications')
    .select('id, title, message, type, read, created_at')
    .eq('user_id', user.id)
    .eq('read', false)
    .order('created_at', { ascending: false })
    .limit(5),

  supabase
    .from('email_events')
    .select('id, provider_message_id, received_at, application_id')
    .eq('user_id', user.id),

  supabase
    .from('ignored_email_events')
    .select('id')
    .eq('user_id', user.id),

  supabase
    .from('gmail_sync_sessions')
    .select(`
      id,
      scanned_count,
      accepted_count,
      review_count,
      rejected_count,
      processing_time_ms,
      status,
      error_message,
      created_at
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1),

  supabase.from('recruiters').select('id').eq('user_id', user.id),

  supabase
    .from('recruiter_interactions')
    .select('id')
    .eq('user_id', user.id),

  supabase.from('cv_versions').select('id').eq('user_id', user.id),
]);

if (applicationsResult.error) {
  setError(applicationsResult.error.message);
} else {
  const normalised = ((applicationsResult.data || []) as DashboardApplication[]).map((app) => ({
    ...app,
    status: app.status || 'applied',
  }));

  setApplications(normalised);
}

if (eventsResult.error) setError(eventsResult.error.message);
else setRecentEvents((eventsResult.data || []) as unknown as RecentEvent[]);

if (notificationsResult.error) setError(notificationsResult.error.message);
else setNotifications((notificationsResult.data || []) as NotificationItem[]);

if (emailEventsResult.error) setError(emailEventsResult.error.message);
else setEmailEvents(emailEventsResult.data || []);

if (ignoredEmailsResult.error) setError(ignoredEmailsResult.error.message);
else setIgnoredEmails(ignoredEmailsResult.data || []);

if (syncSessionsResult.error) setError(syncSessionsResult.error.message);
else setLatestSync((syncSessionsResult.data?.[0] || null) as GmailSyncSession | null);

if (recruitersResult.error) setError(recruitersResult.error.message);
else setRecruiters(recruitersResult.data || []);

if (recruiterInteractionsResult.error) setError(recruiterInteractionsResult.error.message);
else setRecruiterInteractions(recruiterInteractionsResult.data || []);

if (cvVersionsResult.error) setError(cvVersionsResult.error.message);
else setCvVersions(cvVersionsResult.data || []);

};

const loadDashboard = async () => {
setLoading(true);
await fetchDashboardData();
setLoading(false);
};

const handleRefresh = async () => {
setRefreshing(true);
await fetchDashboardData();
setRefreshing(false);
};

useEffect(() => {
loadDashboard();
}, [user?.id]);

const stats = useMemo(() => {
const total = applications.length;
const active = applications.filter(isActiveApplication).length;
const archived = applications.filter((app) => app.archived || app.status === 'archived').length;

const responses = applications.filter((app) =>
  responseStatuses.includes(app.status) || Boolean(app.response_received_at)
).length;

const interviews = applications.filter(hasReachedInterview).length;
const offers = applications.filter((app) => app.status === 'offer' || Boolean(app.offer_received_at)).length;
const rejections = applications.filter((app) => app.status === 'rejected' || Boolean(app.rejected_at)).length;

const responseRate = total > 0 ? Math.round((responses / total) * 100) : 0;
const interviewRate = responses > 0 ? Math.round((interviews / responses) * 100) : 0;
const offerRate = interviews > 0 ? Math.round((offers / interviews) * 100) : 0;
const rejectionRate = total > 0 ? Math.round((rejections / total) * 100) : 0;

const responseTimes = applications
  .map((app) => getDaysBetween(getAppliedDate(app), app.response_received_at))
  .filter((value): value is number => value !== null);

const avgTimeToResponse = average(responseTimes);

return {
  total,
  active,
  archived,
  responses,
  interviews,
  offers,
  rejections,
  responseRate,
  interviewRate,
  offerRate,
  rejectionRate,
  avgTimeToResponse,
};


}, [applications]);

const todayStats = useMemo(() => {
const now = new Date();
const today = startOfDay(now);
const inSevenDays = new Date(today);
inSevenDays.setDate(today.getDate() + 7);


const activeApplications = applications.filter(isActiveApplication);

const overdueFollowUps = activeApplications.filter((app) => {
  if (!app.follow_up_date) return false;

  const date = new Date(app.follow_up_date);
  if (Number.isNaN(date.getTime())) return false;

  return startOfDay(date) < today;
});

const dueTodayFollowUps = activeApplications.filter((app) => {
  if (!app.follow_up_date) return false;

  const date = new Date(app.follow_up_date);
  if (Number.isNaN(date.getTime())) return false;

  return isSameDay(date, today);
});

const upcomingFollowUps = activeApplications.filter((app) => {
  if (!app.follow_up_date) return false;

  const date = new Date(app.follow_up_date);
  if (Number.isNaN(date.getTime())) return false;

  const day = startOfDay(date);

  return day > today && day <= inSevenDays;
});

const awaitingFinalResponse = activeApplications.filter((app) =>
  Boolean(app.final_response_pending) ||
  ['interview', 'final_interview'].includes(app.status)
);

const suggestedFollowUps = activeApplications.filter((app) => {
  if (app.follow_up_date) return false;

  const appliedDate = new Date(getAppliedDate(app));
  if (Number.isNaN(appliedDate.getTime())) return false;

  const daysSinceApplied = getDaysBetween(appliedDate.toISOString(), now.toISOString()) || 0;

  if (app.status === 'applied' && !app.response_received_at && daysSinceApplied >= 7) {
    return true;
  }

  const assessmentDays = getDaysBetween(app.assessment_received_at, now.toISOString()) || 0;

  if (app.status === 'assessment' && assessmentDays >= 5) {
    return true;
  }

  const interviewDays =
    getDaysBetween(
      app.final_interview_started_at || app.interview_started_at,
      now.toISOString()
    ) || 0;

  if (['interview', 'final_interview'].includes(app.status) && interviewDays >= 5) {
    return true;
  }

  return false;
});

return {
  overdueFollowUps,
  dueTodayFollowUps,
  upcomingFollowUps,
  awaitingFinalResponse,
  suggestedFollowUps,
  unreadNotifications: notifications.length,
};


}, [applications, notifications]);

const funnelData = useMemo(() => {
return funnelStatuses.map((status) => {
const count = applications.filter((app) => {
if (status.value === 'archived') {
return app.archived || app.status === 'archived';
}


    return app.status === status.value && !app.archived;
  }).length;

  return {
    ...status,
    count,
  };
});


}, [applications]);

const actionItems = useMemo(() => {
return [
...todayStats.overdueFollowUps.slice(0, 3).map((app) => ({
id: `overdue-${app.id}`,
title: app.role_title || 'Untitled role',
reason: `Follow-up overdue since ${formatShortDate(app.follow_up_date)}`,
href: '/applications',
tone: 'danger' as const,
})),
...todayStats.dueTodayFollowUps.slice(0, 3).map((app) => ({
id: `today-${app.id}`,
title: app.role_title || 'Untitled role',
reason: 'Follow-up due today',
href: '/applications',
tone: 'warning' as const,
})),
...todayStats.awaitingFinalResponse.slice(0, 3).map((app) => ({
id: `final-${app.id}`,
title: app.role_title || 'Untitled role',
reason: 'Awaiting final response after interview',
href: '/applications',
tone: 'info' as const,
})),
...todayStats.suggestedFollowUps.slice(0, 3).map((app) => ({
id: `suggested-${app.id}`,
title: app.role_title || 'Untitled role',
reason: 'Suggested follow-up based on waiting time',
href: '/applications',
tone: 'neutral' as const,
})),
].slice(0, 6);
}, [todayStats]);

const gmailStats = useMemo(() => {
const gmailEmails = emailEvents.filter((item) => item.provider_message_id);
const linkedEmails = emailEvents.filter((item) => item.application_id);


const scanned = latestSync?.scanned_count || 0;
const accepted = latestSync?.accepted_count || 0;
const review = latestSync?.review_count || 0;
const rejected = latestSync?.rejected_count || 0;

const acceptanceRate = scanned > 0 ? Math.round((accepted / scanned) * 100) : 0;
const reviewRate = scanned > 0 ? Math.round((review / scanned) * 100) : 0;
const rejectionRate = scanned > 0 ? Math.round((rejected / scanned) * 100) : 0;

return {
  totalEmails: gmailEmails.length,
  linkedEmails: linkedEmails.length,
  ignoredEmails: ignoredEmails.length,
  scanned,
  accepted,
  review,
  rejected,
  acceptanceRate,
  reviewRate,
  rejectionRate,
  latestImport: latestSync?.created_at || '',
  latestStatus: latestSync?.status || 'No sync yet',
  processingTime: latestSync?.processing_time_ms || 0,
};


}, [emailEvents, ignoredEmails, latestSync]);

const insight = useMemo(() => {
if (stats.total === 0) {
return 'Start by adding your first application. Once you add data, this dashboard will show real pipeline performance.';
}


if (todayStats.overdueFollowUps.length > 0) {
  return 'You have overdue follow-ups. Handle these first so active opportunities do not go cold.';
}

if (todayStats.awaitingFinalResponse.length > 0) {
  return 'You are waiting on interview outcomes. Keep final-response follow-ups visible and up to date.';
}

if (stats.offerRate > 0) {
  return 'You have offers in the pipeline. Focus on follow-ups, negotiation, and keeping active opportunities organised.';
}

if (stats.interviewRate >= 20) {
  return 'Your interview conversion looks healthy. Keep tracking recruiter interactions and prepare deeply for active interviews.';
}

if (stats.responseRate < 25) {
  return 'Your response rate is low. Improve CV targeting, track which CV versions perform best, and apply more selectively.';
}

return 'Your pipeline is active. Keep updating statuses after every recruiter interaction or email response.';


}, [stats, todayStats]);

const metricCards = [
{
label: 'Applications',
value: stats.total,
icon: Briefcase,
helper: `${stats.active} active · ${stats.archived} archived`,
},
{
label: 'Response Rate',
value: `${stats.responseRate}%`,
icon: TrendingUp,
helper: `${stats.responses} applications received a response`,
},
{
label: 'Interviews',
value: stats.interviews,
icon: CalendarCheck,
helper: `${stats.interviewRate}% interview conversion from responses`,
},
{
label: 'Offers',
value: stats.offers,
icon: Trophy,
helper: `${stats.offerRate}% offer conversion from interviews`,
},
];

if (loading) {
return <DashboardSkeleton />;
}

if (!loading && !onboardingComplete) {
return ( <div className="w-full max-w-full overflow-hidden"> <div className="max-w-5xl mx-auto">
{error && <ErrorMessage error={error} onClear={() => setError('')} />}


      <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-8 shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <Target size={28} />
          </div>

          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-slate-400 mb-2">
              First-time setup
            </p>

            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 break-words">
              Welcome to JTracker
            </h1>

            <p className="mt-3 text-sm sm:text-base text-slate-600 max-w-2xl leading-relaxed break-words">
              Start by adding your first job application. Once you have data,
              your dashboard will show today’s follow-ups, pipeline performance,
              response rates, interviews, offers, CV versions, and recent activity.
            </p>

            <div className="mt-6">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-sm font-medium text-slate-700">
                  Getting Started
                </span>

                <span className="text-sm text-slate-500">
                  {completedCount}/{totalSteps} completed
                </span>
              </div>

              <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className="h-full bg-slate-900 transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          <OnboardingStep
            icon={Briefcase}
            title="Add applications"
            description="Save roles, companies, statuses, links, notes, salary ranges, and source information."
          />

          <OnboardingStep
            icon={FileText}
            title="Upload CV versions"
            description="Track which CV version you used so you can learn what works best."
          />

          <OnboardingStep
            icon={CalendarCheck}
            title="Manage follow-ups"
            description="Set follow-up dates and keep opportunities from going cold."
          />
        </div>

        <div className="mt-8 rounded-2xl bg-slate-50 border border-slate-200 p-4 sm:p-5">
          <h2 className="font-semibold text-slate-900 mb-2">
            Recommended first actions
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <SetupChecklistItem
              label="Add your first application"
              completed={completedSteps.hasApplication}
            />

            <SetupChecklistItem
              label="Add or upload a CV version"
              completed={completedSteps.hasCV}
            />

            <SetupChecklistItem
              label="Save recruiter contacts"
              completed={completedSteps.hasRecruiter}
            />

            <SetupChecklistItem
              label="Track follow-ups"
              completed={completedSteps.hasFollowUp}
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mt-8">
          <Link
            to="/applications"
            className="inline-flex justify-center items-center rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-700 transition"
          >
            Add First Application
          </Link>

          <Link
            to="/cv-manager"
            className="inline-flex justify-center items-center rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            Upload CV Version
          </Link>

          <Link
            to="/recruiters"
            className="inline-flex justify-center items-center rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            Add Recruiter
          </Link>
        </div>

        <button
          type="button"
          onClick={dismissOnboarding}
          className="mt-5 text-sm text-slate-500 hover:text-slate-700 transition"
        >
          Dismiss onboarding
        </button>
      </div>
    </div>
  </div>
);


}

return ( <div className="w-full max-w-full overflow-hidden"> <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6"> <div className="min-w-0"> <h2 className="text-2xl sm:text-3xl font-bold mb-1 break-words">Dashboard</h2> <p className="text-slate-500 text-sm sm:text-base break-words">
Today’s job-search actions, pipeline health, follow-ups, notifications, and recent activity. </p> </div>


    <button
      type="button"
      onClick={handleRefresh}
      disabled={refreshing}
      className="w-full sm:w-auto bg-slate-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-700 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
    >
      <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
      {refreshing ? 'Refreshing...' : 'Refresh'}
    </button>
  </div>

  {error && <ErrorMessage error={error} onClear={() => setError('')} />}

  <TodayStrip
    overdueFollowUps={todayStats.overdueFollowUps.length}
    dueTodayFollowUps={todayStats.dueTodayFollowUps.length}
    upcomingFollowUps={todayStats.upcomingFollowUps.length}
    awaitingFinalResponse={todayStats.awaitingFinalResponse.length}
    unreadNotifications={todayStats.unreadNotifications}
  />

  <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-6 shadow-sm mb-6 overflow-hidden">
    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
      <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
        <Target size={22} />
      </div>

      <div className="min-w-0">
        <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">
          Command centre insight
        </p>
        <h3 className="text-base sm:text-lg font-semibold mb-1 break-words">
          {stats.active} active applications from {stats.total} total
        </h3>
        <p className="text-sm text-slate-300 leading-relaxed break-words">
          {insight}
        </p>
      </div>
    </div>
  </div>

  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
    {metricCards.map((card) => {
      const Icon = card.icon;

      return (
        <div
          key={card.label}
          className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-md transition overflow-hidden"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-slate-500 break-words">{card.label}</p>
              <p className="text-2xl sm:text-3xl font-bold mt-3 break-words">
                {card.value}
              </p>
            </div>

            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
              <Icon size={19} className="text-slate-600" />
            </div>
          </div>

          <p className="text-xs text-slate-400 mt-3 break-words">{card.helper}</p>
        </div>
      );
    })}
  </div>

  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
    <RateCard label="Average Time to Response" value={`${stats.avgTimeToResponse} days`} />
    <RateCard label="Interview Conversion" value={`${stats.interviewRate}%`} />
    <RateCard label="Offer Conversion" value={`${stats.offerRate}%`} positive />
    <RateCard label="Rejection Rate" value={`${stats.rejectionRate}%`} negative />
  </div>

  <PipelineFunnel data={funnelData} />

  <div className="grid grid-cols-1 xl:grid-cols-[1fr_0.9fr] gap-6 mb-8">
    <ActionNeededPanel actionItems={actionItems} />
    <NotificationsPanel notifications={notifications} />
  </div>

  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
    <MiniCard
      label="CV Versions"
      value={cvVersions.length}
      icon={FileText}
      helper="Stored CVs for tracking"
    />
    <MiniCard
      label="Recruiters"
      value={recruiters.length}
      icon={UserRound}
      helper="Saved recruiter contacts"
    />
    <MiniCard
      label="Recruiter Interactions"
      value={recruiterInteractions.length}
      icon={CheckCircle2}
      helper="Logged communication history"
    />
  </div>

  <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6">
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
          <MailCheck size={20} className="text-slate-700" />
        </div>

        <div className="min-w-0">
          <h3 className="text-lg sm:text-xl font-semibold break-words">
            Gmail Sync Summary
          </h3>
          <p className="text-slate-500 text-sm break-words">
            Real sync data from your Gmail sync sessions.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <SummaryCard label="Emails Processed" value={gmailStats.totalEmails} />
        <SummaryCard label="Emails Linked" value={gmailStats.linkedEmails} />
        <SummaryCard label="Ignored Emails" value={gmailStats.ignoredEmails} />
        <SummaryCard label="Latest Scanned" value={gmailStats.scanned} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <SummaryCard label="Accepted" value={gmailStats.accepted} />
        <SummaryCard label="Needs Review" value={gmailStats.review} />
        <SummaryCard label="Rejected" value={gmailStats.rejected} />

        <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 overflow-hidden">
          <p className="text-sm text-slate-500">Latest Sync</p>
          <p className="text-sm font-semibold mt-2 text-slate-900 break-words">
            {gmailStats.latestImport
              ? formatDateTime(gmailStats.latestImport)
              : 'No sync yet'}
          </p>
          <p className="text-xs text-slate-400 mt-1 break-words">
            {gmailStats.latestStatus} · {formatDuration(gmailStats.processingTime)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
        <RateCard label="Accepted Rate" value={`${gmailStats.acceptanceRate}%`} positive />
        <RateCard label="Review Rate" value={`${gmailStats.reviewRate}%`} />
        <RateCard label="Rejected Rate" value={`${gmailStats.rejectionRate}%`} negative />
      </div>

      {latestSync?.error_message && (
        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm break-words">
          Latest sync error: {latestSync.error_message}
        </div>
      )}
    </div>

    <RecentActivityPanel recentEvents={recentEvents} />
  </div>
</div>


);
};

const TodayStrip = ({
overdueFollowUps,
dueTodayFollowUps,
upcomingFollowUps,
awaitingFinalResponse,
unreadNotifications,
}: {
overdueFollowUps: number;
dueTodayFollowUps: number;
upcomingFollowUps: number;
awaitingFinalResponse: number;
unreadNotifications: number;
}) => (

  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-5 mb-6 overflow-hidden">
    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
      <div>
        <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">Today</p>
        <h3 className="text-lg font-semibold text-slate-900">
          What needs attention now
        </h3>
      </div>


  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 w-full lg:w-auto">
    <TodayPill
      label="Overdue follow-ups"
      value={overdueFollowUps}
      icon={Clock}
      href="/applications"
      urgent={overdueFollowUps > 0}
    />

    <TodayPill
      label="Due today"
      value={dueTodayFollowUps}
      icon={CalendarCheck}
      href="/applications"
      urgent={dueTodayFollowUps > 0}
    />

    <TodayPill
      label="Upcoming follow-ups"
      value={upcomingFollowUps}
      icon={Timer}
      href="/applications"
    />

    <TodayPill
      label="Awaiting final response"
      value={awaitingFinalResponse}
      icon={MailCheck}
      href="/applications"
      urgent={awaitingFinalResponse > 0}
    />

    <TodayPill
      label="Unread notifications"
      value={unreadNotifications}
      icon={Bell}
      href="/notifications"
      urgent={unreadNotifications > 0}
    />
  </div>
</div>


  </div>
);

const TodayPill = ({
label,
value,
icon: Icon,
href,
urgent,
}: {
label: string;
value: number;
icon: React.ElementType;
href: string;
urgent?: boolean;
}) => (

  <Link
    to={href}
    className={`rounded-xl border px-3 py-3 transition hover:shadow-sm overflow-hidden ${
      urgent
        ? 'bg-red-50 border-red-200 text-red-700'
        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-white'
    }`}
  >
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xl font-bold">{value}</p>
        <p className="text-xs break-words">{label}</p>
      </div>


  <Icon size={18} className="shrink-0 opacity-70" />
</div>


  </Link>
);

const PipelineFunnel = ({
data,
}: {
data: { value: ApplicationStatus; label: string; count: number }[];
}) => {
const maxCount = Math.max(...data.map((item) => item.count), 1);

return ( <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 mb-8 overflow-hidden"> <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6"> <div> <h3 className="text-lg sm:text-xl font-semibold">Pipeline Funnel</h3> <p className="text-sm text-slate-500 mt-1">
See where applications sit across the full status journey. </p> </div>

    <Link
      to="/applications"
      className="inline-flex justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 transition"
    >
      Manage Applications
    </Link>
  </div>

  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
    {data.map((item) => {
      const width = Math.max(8, Math.round((item.count / maxCount) * 100));

      return (
        <div key={item.value} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-sm font-medium text-slate-700">{item.label}</p>
            <p className="text-lg font-bold text-slate-900">{item.count}</p>
          </div>

          <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-slate-900 transition-all"
              style={{ width: `${width}%` }}
            />
          </div>
        </div>
      );
    })}
  </div>
</div>


);
};

const ActionNeededPanel = ({
actionItems,
}: {
actionItems: {
id: string;
title: string;
reason: string;
href: string;
tone: 'danger' | 'warning' | 'info' | 'neutral';
}[];
}) => (

  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 overflow-hidden">
    <h3 className="text-lg sm:text-xl font-semibold mb-1">Action Needed</h3>
    <p className="text-sm text-slate-500 mb-5">
      Follow-ups and interview-response items that should not be missed.
    </p>


{actionItems.length === 0 ? (
  <EmptyState
    title="No urgent actions"
    description="You have no overdue follow-ups or urgent interview-response items right now."
    actionLabel="View Applications"
    actionHref="/applications"
  />
) : (
  <div className="space-y-3">
    {actionItems.map((item) => (
      <Link
        key={item.id}
        to={item.href}
        className="block border border-slate-200 rounded-xl p-4 hover:bg-slate-50 transition"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 break-words">{item.title}</p>
            <p className="text-sm text-slate-500 mt-1 break-words">{item.reason}</p>
          </div>

          <span
            className={`text-xs rounded-full px-2.5 py-1 shrink-0 ${
              item.tone === 'danger'
                ? 'bg-red-50 text-red-700'
                : item.tone === 'warning'
                  ? 'bg-amber-50 text-amber-700'
                  : item.tone === 'info'
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'bg-slate-100 text-slate-600'
            }`}
          >
            Open
          </span>
        </div>
      </Link>
    ))}
  </div>
)}


  </div>
);

const NotificationsPanel = ({
notifications,
}: {
notifications: NotificationItem[];
}) => (

  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 overflow-hidden">
    <div className="flex items-start justify-between gap-3 mb-5">
      <div>
        <h3 className="text-lg sm:text-xl font-semibold">Unread Notifications</h3>
        <p className="text-sm text-slate-500 mt-1">
          Important alerts should be visible, not hidden behind a bell.
        </p>
      </div>

  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
    <Bell size={18} className="text-slate-700" />
  </div>
</div>

{notifications.length === 0 ? (
  <EmptyState
    title="No unread notifications"
    description="New shared opportunities and system alerts will appear here."
  />
) : (
  <div className="space-y-3">
    {notifications.map((notification) => (
      <div
        key={notification.id}
        className="border border-slate-200 rounded-xl p-4 hover:bg-slate-50 transition"
      >
        <p className="font-semibold text-slate-900 break-words">
          {notification.title || 'Notification'}
        </p>

        {notification.message && (
          <p className="text-sm text-slate-600 mt-1 break-words">
            {notification.message}
          </p>
        )}

        <p className="text-xs text-slate-400 mt-2">
          {formatDateTime(notification.created_at)}
        </p>
      </div>
    ))}
  </div>
)}


  </div>
);

const RecentActivityPanel = ({
recentEvents,
}: {
recentEvents: RecentEvent[];
}) => (

  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 min-w-0 overflow-hidden">
    <h3 className="text-lg sm:text-xl font-semibold mb-1 break-words">
      Recent Activity
    </h3>
    <p className="text-slate-500 text-sm mb-6 break-words">
      Latest updates from your job search.
    </p>


{recentEvents.length === 0 ? (
  <EmptyState
    title="No recent activity"
    description="Activity will appear here when applications are created, updated, or imported."
    actionLabel="Add Application"
    actionHref="/applications"
  />
) : (
  <div className="space-y-4">
    {recentEvents.map((event) => (
      <div
        key={event.id}
        className="border border-slate-200 rounded-xl p-4 hover:bg-slate-50 transition overflow-hidden"
      >
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 size={15} className="text-slate-500 shrink-0" />
              <h4 className="font-semibold text-slate-900 break-words">
                {event.title}
              </h4>
            </div>

            {event.applications?.role_title && (
              <p className="text-sm text-slate-500 break-words">
                {event.applications.companies?.name
                  ? `${event.applications.role_title} · ${event.applications.companies.name}`
                  : event.applications.role_title}
              </p>
            )}

            {event.description && (
              <p className="text-sm text-slate-600 mt-2 leading-relaxed break-words">
                {event.description}
              </p>
            )}
          </div>

          <span className="text-xs text-slate-400 whitespace-nowrap shrink-0">
            {formatDateTime(event.event_date)}
          </span>
        </div>
      </div>
    ))}
  </div>
)}


  </div>
);

const ErrorMessage = ({
error,
onClear,
}: {
error: string;
onClear: () => void;
}) => (

  <div className="bg-red-50 text-red-700 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-3 overflow-hidden">
    <AlertCircle size={16} className="shrink-0 mt-0.5" />
    <span className="text-sm flex-1 break-words">{error}</span>
    <button onClick={onClear} className="text-red-400 hover:text-red-600 shrink-0">
      <X size={16} />
    </button>
  </div>
);

const OnboardingStep = ({
icon: Icon,
title,
description,
}: {
icon: React.ElementType;
title: string;
description: string;
}) => (

  <div className="rounded-2xl border border-slate-200 p-5 bg-white overflow-hidden">
    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center mb-4">
      <Icon size={18} className="text-slate-700" />
    </div>


<h3 className="font-semibold text-slate-900 break-words">{title}</h3>

<p className="text-sm text-slate-500 mt-2 leading-relaxed break-words">
  {description}
</p>


  </div>
);

const SetupChecklistItem = ({
label,
completed,
}: {
label: string;
completed?: boolean;
}) => (

  <div
    className={`flex items-center gap-2 rounded-xl border px-3 py-3 transition overflow-hidden ${
      completed
        ? 'bg-emerald-50 border-emerald-200'
        : 'bg-white border-slate-200'
    }`}
  >
    <CheckCircle2
      size={15}
      className={`shrink-0 ${completed ? 'text-emerald-600' : 'text-slate-500'}`}
    />


<span className={`${completed ? 'text-emerald-700' : 'text-slate-600'} break-words`}>
  {label}
</span>

  </div>
);

const RateCard = ({
label,
value,
positive,
negative,
}: {
label: string;
value: string;
positive?: boolean;
negative?: boolean;
}) => (

  <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm overflow-hidden">
    <p className="text-sm text-slate-500 break-words">{label}</p>
    <div className="flex items-end justify-between gap-3 mt-3">
      <p className="text-2xl sm:text-3xl font-bold break-words">{value}</p>
      {positive && <Trophy size={18} className="text-slate-400 shrink-0" />}
      {negative && <XCircle size={18} className="text-slate-400 shrink-0" />}
    </div>
  </div>
);

const MiniCard = ({
label,
value,
icon: Icon,
helper,
}: {
label: string;
value: number;
icon: React.ElementType;
helper: string;
}) => (

  <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm overflow-hidden">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-slate-500 break-words">{label}</p>
        <p className="text-2xl sm:text-3xl font-bold mt-3 break-words">{value}</p>
      </div>


  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
    <Icon size={19} className="text-slate-600" />
  </div>
</div>

<p className="text-xs text-slate-400 mt-3 break-words">{helper}</p>


  </div>
);

const SummaryCard = ({
label,
value,
}: {
label: string;
value: number;
}) => (

  <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 overflow-hidden">
    <p className="text-sm text-slate-500 break-words">{label}</p>
    <p className="text-2xl font-bold mt-2 text-slate-900 break-words">{value}</p>
  </div>
);

const EmptyState = ({
title,
description,
actionLabel,
actionHref,
}: {
title: string;
description: string;
actionLabel?: string;
actionHref?: string;
}) => (

  <div className="border border-dashed border-slate-200 rounded-xl p-6 sm:p-8 text-center bg-slate-50 overflow-hidden">
    <p className="font-semibold text-slate-700 break-words">{title}</p>


<p className="text-sm text-slate-500 mt-1 break-words">
  {description}
</p>

{actionLabel && actionHref && (
  <Link
    to={actionHref}
    className="inline-flex mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 transition"
  >
    {actionLabel}
  </Link>
)}


  </div>
);

const DashboardSkeleton = () => (

  <div className="w-full max-w-full overflow-hidden">
    <div className="mb-8">
      <div className="h-8 w-44 bg-slate-200 rounded-lg animate-pulse mb-2" />
      <div className="h-4 w-full max-w-96 bg-slate-100 rounded-lg animate-pulse" />
    </div>


<div className="h-28 bg-slate-200 rounded-2xl animate-pulse mb-6" />

<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
  {Array.from({ length: 4 }).map((_, index) => (
    <div
      key={index}
      className="h-32 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
    >
      <div className="h-4 w-24 bg-slate-100 rounded animate-pulse mb-5" />
      <div className="h-8 w-12 bg-slate-200 rounded animate-pulse" />
    </div>
  ))}
</div>

  </div>
);
