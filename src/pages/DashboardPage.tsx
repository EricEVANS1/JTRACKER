import React, { useEffect, useMemo, useState } from 'react';
import {
AlertCircle,
Bell,
Briefcase,
CalendarCheck,
CheckCircle2,
ChevronRight,
Clock,
FileText,
Inbox,
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
import { useGmailToken } from '../hooks/useGmailToken';
import {
buildGmailSyncSummary,
type EmailEventRecord,
type GmailSyncSummary,
type SyncSessionRecord,
} from '../lib/gmailSyncSummary';
import {
buildTimeline,
groupTimelineByDay,
type ActivityEventRecord,
type ActivityKind,
type TimelineEvent,
} from '../lib/activityTimeline';
import {
NO_RESPONSE_DAYS,
REACHED_STAGES,
getDaysBetween,
getDaysWithoutReply,
getUpcomingInterviewDate,
hasReachedStage,
isOfferAwaitingDecision,
type ReachedStage,
getDaysToResponse,
getFollowUpBucket,
hasReachedInterview,
hasReachedOffer,
hasResponse,
isActive,
isArchived,
isAwaitingFinalResponse,
isSubmitted,
type FollowUpBucket,
} from '../lib/applicationLifecycle';

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
outcome_reason?: string | null;
interview_notes?: { interview_date: string | null; status?: string | null }[] | null;
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

interface NotificationItem {
id: string;
title: string | null;
message: string | null;
type: string | null;
read: boolean | null;
created_at: string;
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

type FunnelGroup = 'progress' | 'outcome';

const funnelStatuses: { value: ApplicationStatus; label: string; group: FunnelGroup }[] = [
{ value: 'wishlist', label: 'Wishlist', group: 'progress' },
{ value: 'applied', label: 'Applied', group: 'progress' },
{ value: 'confirmation_received', label: 'Confirmed', group: 'progress' },
{ value: 'assessment', label: 'Assessment', group: 'progress' },
{ value: 'interview', label: 'Interview', group: 'progress' },
{ value: 'final_interview', label: 'Final interview', group: 'progress' },
{ value: 'offer', label: 'Offer', group: 'outcome' },
{ value: 'rejected', label: 'Rejected', group: 'outcome' },
{ value: 'withdrawn', label: 'Withdrawn', group: 'outcome' },
{ value: 'ghosted', label: 'Ghosted', group: 'outcome' },
{ value: 'archived', label: 'Archived', group: 'outcome' },
];

interface FunnelStage {
value: ApplicationStatus;
label: string;
group: FunnelGroup;
count: number;
}

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

const average = (values: number[]) => {
if (values.length === 0) return 0;
return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
};

// Assessment in progress with no follow-up scheduled.
const getAssessmentReason = (app: DashboardApplication, now: Date) => {
if (!isActive(app) || app.status !== 'assessment' || getFollowUpBucket(app, now)) return null;

const days = getDaysBetween(
  app.assessment_received_at ||
    app.last_status_changed_at ||
    app.status_updated_at ||
    app.updated_at ||
    app.created_at,
  now.toISOString()
) || 0;

return days === 0
  ? 'Assessment received today'
  : `Assessment outstanding for ${days} day${days === 1 ? '' : 's'}`;
};

// Still waiting on a reply, with no follow-up scheduled.
const getNoReplyReason = (app: DashboardApplication, now: Date) => {
if (getFollowUpBucket(app, now)) return null;

const days = getDaysWithoutReply(app, now);

return days !== null && days >= NO_RESPONSE_DAYS
  ? `No response ${days} days after applying`
  : null;
};

const formatInterviewDate = (date: string) =>
new Date(date).toLocaleString('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

type ActionTone = 'danger' | 'warning' | 'info' | 'neutral';

interface ActionItem {
id: string;
title: string;
reason: string;
href: string;
tone: ActionTone;
}

interface ActionCategory {
key: string;
label: string;
count: number;
href: string;
}

// Shared look for the dashboard's cards, buttons and focus states.
const CARD = 'bg-white border border-slate-200 rounded-2xl shadow-sm';
const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2';
const BUTTON_PRIMARY = `inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${FOCUS_RING}`;
const BUTTON_SECONDARY = `inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-400 active:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors ${FOCUS_RING}`;

// Title, one line of description and an optional icon or action.
const PanelHeader = ({
title,
description,
aside,
}: {
title: string;
description?: React.ReactNode;
aside?: React.ReactNode;
}) => (
  <div className="flex items-start justify-between gap-3 mb-4">
    <div className="min-w-0">
      <h3 className="text-base sm:text-lg font-semibold text-slate-900 break-words">{title}</h3>
      {description && <p className="text-sm text-slate-500 mt-0.5 break-words">{description}</p>}
    </div>
    {aside && <div className="shrink-0 flex items-center gap-2">{aside}</div>}
  </div>
);

export const DashboardPage: React.FC = () => {
const { user } = useAuth();

const {
loading: onboardingLoading,
onboardingComplete,
completedSteps,
completedCount,
totalSteps,
progressPercent,
dismissOnboarding,
} = useOnboarding();

const [applications, setApplications] = useState<DashboardApplication[]>([]);
const [recentEvents, setRecentEvents] = useState<ActivityEventRecord[]>([]);
const [activityError, setActivityError] = useState('');
const [notifications, setNotifications] = useState<NotificationItem[]>([]);
const [unreadCount, setUnreadCount] = useState(0);
const [gmailSessions, setGmailSessions] = useState<SyncSessionRecord[]>([]);
const [gmailEmailEvents, setGmailEmailEvents] = useState<EmailEventRecord[]>([]);
const [gmailImportIds, setGmailImportIds] = useState<(string | null)[]>([]);
const [gmailDismissed, setGmailDismissed] = useState(0);
const [gmailSyncEnabled, setGmailSyncEnabled] = useState<boolean | null>(null);
const [gmailError, setGmailError] = useState('');
const { gmailConnected, minutesRemaining } = useGmailToken();
const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
const [recruiterInteractions, setRecruiterInteractions] = useState<RecruiterInteraction[]>([]);
const [cvVersions, setCvVersions] = useState<CVVersion[]>([]);

const [loading, setLoading] = useState(true);
const [refreshing, setRefreshing] = useState(false);
const [error, setError] = useState('');
const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

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
  gmailImportsResult,
  emailSettingsResult,
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
      rejected_after_interview,
      outcome_reason,
      interview_notes (
        *
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false }),

  supabase
    .from('application_events')
    .select(`
      id,
      title,
      description,
      event_type,
      event_date,
      application_id,
      applications (
        id,
        role_title,
        companies (
          name
        )
      )
    `)
    .eq('user_id', user.id)
    .order('event_date', { ascending: false })
    // Extra rows leave room for removing duplicates and "Show more".
    .limit(40),

  supabase
    .from('notifications')
    .select('id, title, message, type, read, created_at', { count: 'exact' })
    .eq('user_id', user.id)
    .eq('read', false)
    .order('created_at', { ascending: false })
    .limit(5),

  // Gmail Sync: only what the Email Sync page stores for Gmail.
  supabase
    .from('email_events')
    .select('id, application_id, detected_status')
    .eq('user_id', user.id)
    .eq('provider', 'gmail'),

  supabase
    .from('ignored_email_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('provider', 'gmail'),

  supabase
    .from('email_sync_sessions')
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
    .eq('provider', 'gmail')
    .order('created_at', { ascending: false })
    .limit(10),

  supabase
    .from('application_events')
    .select('application_id')
    .eq('user_id', user.id)
    .eq('event_type', 'email_import')
    .ilike('title', '%gmail%'),

  supabase
    .from('user_settings')
    .select('gmail_sync_enabled')
    .eq('user_id', user.id)
    .maybeSingle(),

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

if (eventsResult.error) {
  setActivityError(eventsResult.error.message);
} else {
  setActivityError('');
  setRecentEvents((eventsResult.data || []) as unknown as ActivityEventRecord[]);
}

if (notificationsResult.error) {
  setError(notificationsResult.error.message);
} else {
  // Only the newest few are listed; the count covers every unread notification.
  setNotifications((notificationsResult.data || []) as NotificationItem[]);
  setUnreadCount(notificationsResult.count ?? (notificationsResult.data || []).length);
}

// Gmail problems are shown in the Gmail Sync card rather than for the whole page.
const gmailFailure = [emailEventsResult, ignoredEmailsResult, syncSessionsResult, gmailImportsResult, emailSettingsResult]
  .find((result) => result.error)?.error;

if (gmailFailure) {
  setGmailError(gmailFailure.message);
} else {
  setGmailError('');
  setGmailEmailEvents((emailEventsResult.data || []) as EmailEventRecord[]);
  setGmailDismissed(ignoredEmailsResult.count ?? 0);
  setGmailSessions((syncSessionsResult.data || []) as SyncSessionRecord[]);
  setGmailImportIds((gmailImportsResult.data || []).map((row) => row.application_id));
  // Email Sync treats a missing settings row as sync enabled.
  setGmailSyncEnabled(emailSettingsResult.data?.gmail_sync_enabled ?? true);
}

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
setLastUpdated(new Date());
setLoading(false);
};

const handleRefresh = async () => {
setRefreshing(true);
await fetchDashboardData();
setLastUpdated(new Date());
setRefreshing(false);
};

useEffect(() => {
loadDashboard();
}, [user?.id]);

const stats = useMemo(() => {
const total = applications.length;
const active = applications.filter(isActive).length;
const archived = applications.filter(isArchived).length;

// Rates are based on submitted applications; wishlist items were never sent.
const submittedApps = applications.filter(isSubmitted);
const submitted = submittedApps.length;

const responses = submittedApps.filter(hasResponse).length;
const interviews = submittedApps.filter(hasReachedInterview).length;
const offers = submittedApps.filter(hasReachedOffer).length;
const rejections = submittedApps.filter((app) => app.status === 'rejected').length;

const responseRate = submitted > 0 ? Math.round((responses / submitted) * 100) : 0;
const interviewRate = responses > 0 ? Math.round((interviews / responses) * 100) : 0;
const offerRate = interviews > 0 ? Math.round((offers / interviews) * 100) : 0;
const rejectionRate = submitted > 0 ? Math.round((rejections / submitted) * 100) : 0;

const responseTimes = submittedApps
  .map(getDaysToResponse)
  .filter((value): value is number => value !== null);

const avgTimeToResponse = average(responseTimes);

return {
  total,
  active,
  archived,
  submitted,
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

const activeApplications = applications.filter(isActive);
const inBucket = (bucket: FollowUpBucket) =>
  activeApplications.filter((app) => getFollowUpBucket(app, now) === bucket);

const overdueFollowUps = inBucket('overdue');
const dueTodayFollowUps = inBucket('today');
const upcomingFollowUps = inBucket('upcoming');
const awaitingFinalResponse = activeApplications.filter(isAwaitingFinalResponse);

const upcomingInterviews = activeApplications
  .filter((app) => getUpcomingInterviewDate(app, now) !== null)
  .sort(
    (a, b) =>
      new Date(getUpcomingInterviewDate(a, now) || 0).getTime() -
      new Date(getUpcomingInterviewDate(b, now) || 0).getTime()
  );
const offersAwaitingDecision = applications.filter(isOfferAwaitingDecision);
const outstandingAssessments = activeApplications.filter((app) => getAssessmentReason(app, now) !== null);
const awaitingReply = activeApplications.filter((app) => getNoReplyReason(app, now) !== null);

return {
  overdueFollowUps,
  dueTodayFollowUps,
  upcomingFollowUps,
  awaitingFinalResponse,
  upcomingInterviews,
  offersAwaitingDecision,
  outstandingAssessments,
  awaitingReply,
  unreadNotifications: unreadCount,
};


}, [applications, unreadCount]);

// How many applications ever got as far as each stage.
const reachedData = useMemo(() => {
return REACHED_STAGES.map((stage) => ({
  ...stage,
  count: applications.filter((app) => hasReachedStage(app, stage.value)).length,
}));
}, [applications]);

// Each application is counted once, at its current status, so stages sum to the total.
const timeline = useMemo(() => buildTimeline(recentEvents), [recentEvents]);

const funnelData = useMemo<FunnelStage[]>(() => {
return funnelStatuses.map((stage) => ({
  ...stage,
  count: applications.filter((app) => app.status === stage.value).length,
}));
}, [applications]);

// Every category links to a list holding exactly its applications, so the
// totals here match what "View all" shows.
const actionNeeded = useMemo(() => {
const now = new Date();
const listed = new Set<string>();

const overdueByDate = [...todayStats.overdueFollowUps].sort(
  (a, b) => new Date(a.follow_up_date || 0).getTime() - new Date(b.follow_up_date || 0).getTime()
);

const categories: (ActionCategory & {
  apps: DashboardApplication[];
  tone: ActionTone;
  getReason: (app: DashboardApplication) => string;
})[] = [
  {
    key: 'overdue',
    label: 'Overdue follow-ups',
    href: '/follow-ups?filter=overdue',
    apps: overdueByDate,
    tone: 'danger',
    getReason: (app) => `Follow-up overdue since ${formatShortDate(app.follow_up_date)}`,
    count: 0,
  },
  {
    key: 'today',
    label: 'Follow-ups due today',
    href: '/follow-ups?filter=today',
    apps: todayStats.dueTodayFollowUps,
    tone: 'warning',
    getReason: () => 'Follow-up due today',
    count: 0,
  },
  {
    key: 'interview',
    label: 'Interviews in the next 7 days',
    href: '/applications?view=upcoming_interviews',
    apps: todayStats.upcomingInterviews,
    tone: 'info',
    getReason: (app) => `Interview on ${formatInterviewDate(getUpcomingInterviewDate(app, now) || '')}`,
    count: 0,
  },
  {
    key: 'offer',
    label: 'Offers awaiting your decision',
    href: '/applications?view=offers_awaiting_decision',
    apps: todayStats.offersAwaitingDecision,
    tone: 'warning',
    getReason: () => 'Offer received: accept or decline',
    count: 0,
  },
  {
    key: 'final',
    label: 'Awaiting final response',
    href: '/applications?view=awaiting_final_response',
    apps: todayStats.awaitingFinalResponse,
    tone: 'info',
    getReason: () => 'Awaiting final response after interview',
    count: 0,
  },
  {
    key: 'assessment',
    label: 'Assessments in progress',
    href: '/follow-ups?filter=assessment',
    apps: todayStats.outstandingAssessments,
    tone: 'neutral',
    getReason: (app) => getAssessmentReason(app, now) || 'Assessment in progress',
    count: 0,
  },
  {
    key: 'no_reply',
    label: 'No response yet',
    href: '/follow-ups?filter=no_response',
    apps: todayStats.awaitingReply,
    tone: 'neutral',
    getReason: (app) => getNoReplyReason(app, now) || 'No response yet',
    count: 0,
  },
];

// Each application is listed once, under its most urgent action.
const items: ActionItem[] = categories
  .flatMap((category) =>
    category.apps
      .filter((app) => !listed.has(app.id))
      .slice(0, 3)
      .map((app) => {
        listed.add(app.id);

        return {
          id: `${category.key}-${app.id}`,
          title: app.role_title || 'Untitled role',
          reason: category.getReason(app),
          href: `/applications/${app.id}`,
          tone: category.tone,
        };
      })
  )
  .slice(0, 6);

const uniqueApplications = new Set(categories.flatMap((category) => category.apps.map((app) => app.id)));

return {
  items,
  totalApplications: uniqueApplications.size,
  categories: categories
    .filter((category) => category.apps.length > 0)
    .map(({ key, label, href, apps }) => ({ key, label, href, count: apps.length })),
};
}, [todayStats]);

const gmailSummary = useMemo(
() =>
  buildGmailSyncSummary({
    sessions: gmailSessions,
    emailEvents: gmailEmailEvents,
    importedApplicationIds: gmailImportIds,
    dismissedCount: gmailDismissed,
  }),
[gmailSessions, gmailEmailEvents, gmailImportIds, gmailDismissed]
);

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
helper: `${stats.responses} of ${stats.submitted} submitted applications received a response`,
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

// Wait for the first-time setup check too, so the welcome screen never
// flashes up before the dashboard (or the other way round).
if (loading || onboardingLoading) {
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
                  className="h-full bg-slate-900 transition-all duration-500 motion-reduce:transition-none"
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
            className={`${BUTTON_PRIMARY} py-2.5`}
          >
            Add First Application
          </Link>

          <Link
            to="/cv-manager"
            className={`${BUTTON_SECONDARY} py-2.5`}
          >
            Upload CV Version
          </Link>

          <Link
            to="/recruiters"
            className={`${BUTTON_SECONDARY} py-2.5`}
          >
            Add Recruiter
          </Link>
        </div>

        <button
          type="button"
          onClick={dismissOnboarding}
          className={`mt-5 rounded-md text-sm text-slate-500 hover:text-slate-700 transition-colors ${FOCUS_RING}`}
        >
          Dismiss onboarding
        </button>
      </div>
    </div>
  </div>
);


}

return (
  <div className="relative w-full max-w-full overflow-hidden animate-fade-in motion-reduce:animate-none" aria-busy={refreshing}>
    {refreshing && <RefreshBar />}

    <div className="flex items-start justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 break-words">Dashboard</h2>
        <p className="text-slate-500 text-sm mt-1 break-words">
          Today’s actions, pipeline health and recent activity.
        </p>
      </div>

      <div className="flex flex-col items-end gap-1 shrink-0">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-busy={refreshing}
          className={BUTTON_SECONDARY}
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin motion-reduce:animate-none' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        {lastUpdated && !refreshing && (
          <span role="status" className="text-xs text-slate-400 inline-flex items-center gap-1">
            <CheckCircle2 size={12} className="text-emerald-500" />
            Updated {formatTime(lastUpdated.toISOString())}
          </span>
        )}
      </div>
    </div>

    {error && <ErrorMessage error={error} onClear={() => setError('')} />}

    <TodayStrip
      overdueFollowUps={todayStats.overdueFollowUps.length}
      dueTodayFollowUps={todayStats.dueTodayFollowUps.length}
      upcomingFollowUps={todayStats.upcomingFollowUps.length}
      awaitingFinalResponse={todayStats.awaitingFinalResponse.length}
      unreadNotifications={todayStats.unreadNotifications}
    />

    <div className="bg-slate-900 text-white rounded-2xl px-4 py-4 sm:px-5 shadow-sm mb-5 overflow-hidden">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
          <Target size={18} />
        </div>

        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-widest text-slate-400">
            Command centre insight
          </p>
          <h3 className="text-sm sm:text-base font-semibold mt-0.5 break-words">
            {stats.active} active applications from {stats.total} total
          </h3>
          <p className="text-sm text-slate-300 mt-1 leading-relaxed break-words">
            {insight}
          </p>
        </div>
      </div>
    </div>

    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-4">
      {metricCards.map((card) => (
        <StatCard key={card.label} label={card.label} value={card.value} icon={card.icon} helper={card.helper} />
      ))}
    </div>

    <section aria-labelledby="conversion-heading" className={`${CARD} p-4 sm:p-5 mb-5`}>
      <h3 id="conversion-heading" className="text-sm font-semibold text-slate-900 mb-3">Conversion</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
        <RateCard
          label="Average Time to Response"
          value={stats.responses > 0 ? `${stats.avgTimeToResponse} ${stats.avgTimeToResponse === 1 ? 'day' : 'days'}` : '—'}
          helper={stats.responses > 0 ? `Across ${stats.responses} ${stats.responses === 1 ? 'response' : 'responses'}` : 'No responses yet'}
        />
        <RateCard
          label="Interview Conversion"
          value={`${stats.interviewRate}%`}
          percent={stats.interviewRate}
          helper={`${stats.interviews} of ${stats.responses} responses`}
        />
        <RateCard
          label="Offer Conversion"
          value={`${stats.offerRate}%`}
          percent={stats.offerRate}
          helper={`${stats.offers} of ${stats.interviews} interviews`}
          tone="positive"
        />
        <RateCard
          label="Rejection Rate"
          value={`${stats.rejectionRate}%`}
          percent={stats.rejectionRate}
          helper={`${stats.rejections} of ${stats.submitted} submitted`}
          tone="negative"
        />
      </div>
    </section>

    <PipelineFunnel
      data={funnelData}
      reachedData={reachedData}
      total={stats.total}
      submitted={stats.submitted}
    />

    <div className="grid grid-cols-1 xl:grid-cols-[1fr_0.9fr] gap-5 mb-5 items-start">
      <ActionNeededPanel
        actionItems={actionNeeded.items}
        categories={actionNeeded.categories}
        totalApplications={actionNeeded.totalApplications}
      />
      <NotificationsPanel notifications={notifications} total={unreadCount} />
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
      <MiniCard
        label="CV Versions"
        value={cvVersions.length}
        icon={FileText}
        helper="Stored CVs for tracking"
        href="/cv-manager"
      />
      <MiniCard
        label="Recruiters"
        value={recruiters.length}
        icon={UserRound}
        helper="Saved recruiter contacts"
        href="/recruiters"
      />
      <MiniCard
        label="Recruiter Interactions"
        value={recruiterInteractions.length}
        icon={CheckCircle2}
        helper="Logged communication history"
        href="/recruiters"
      />
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-5 items-start">
      <GmailSyncPanel
        summary={gmailSummary}
        connected={gmailConnected}
        minutesRemaining={minutesRemaining}
        syncEnabled={gmailSyncEnabled}
        loading={refreshing}
        error={gmailError}
        onReload={handleRefresh}
      />

      <RecentActivityPanel timeline={timeline} loading={refreshing} error={activityError} />
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
  <section aria-labelledby="today-heading" className={`${CARD} p-4 sm:p-5 mb-5`}>
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <h3 id="today-heading" className="text-base font-semibold text-slate-900">
        What needs attention now
      </h3>
      <p className="text-[11px] font-medium uppercase tracking-widest text-slate-400">Today</p>
    </div>

    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
      <TodayPill
        label="Overdue follow-ups"
        value={overdueFollowUps}
        icon={Clock}
        href="/follow-ups?filter=overdue"
        tone="danger"
      />
      <TodayPill
        label="Due today"
        value={dueTodayFollowUps}
        icon={CalendarCheck}
        href="/follow-ups?filter=today"
        tone="warning"
      />
      <TodayPill
        label="Upcoming follow-ups"
        value={upcomingFollowUps}
        icon={Timer}
        href="/follow-ups?filter=upcoming"
      />
      <TodayPill
        label="Awaiting final response"
        value={awaitingFinalResponse}
        icon={MailCheck}
        href="/applications?view=awaiting_final_response"
        tone="warning"
      />
      <TodayPill
        label="Unread notifications"
        value={unreadNotifications}
        icon={Bell}
        href="/notifications?filter=unread"
        tone="info"
      />
    </div>
  </section>
);

// Only a non-zero count takes the tile's colour, so red means "act on this".
const TODAY_TONES: Record<'danger' | 'warning' | 'info' | 'neutral', string> = {
  danger: 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100/70',
  warning: 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100/70',
  info: 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100/70',
  neutral: 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-white hover:border-slate-300',
};

const TodayPill = ({
label,
value,
icon: Icon,
href,
tone = 'neutral',
}: {
label: string;
value: number;
icon: React.ElementType;
href: string;
tone?: 'danger' | 'warning' | 'info' | 'neutral';
}) => (
  <Link
    to={href}
    className={`group rounded-xl border px-3 py-2.5 transition-colors ${FOCUS_RING} ${
      value > 0 ? TODAY_TONES[tone] : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600'
    }`}
  >
    <div className="flex items-center justify-between gap-2">
      <p className="text-xl font-semibold tabular-nums leading-tight">{value}</p>
      <Icon size={16} className="shrink-0 opacity-70" />
    </div>
    <p className="text-xs mt-0.5 leading-snug">{label}</p>
  </Link>
);

type FunnelMode = 'current' | 'reached';

const PipelineFunnel = ({
data,
reachedData,
total,
submitted,
}: {
data: FunnelStage[];
reachedData: { value: ReachedStage; label: string; count: number }[];
total: number;
submitted: number;
}) => {
const [mode, setMode] = useState<FunnelMode>('current');

const groups: { id: FunnelGroup; title: string; gridCls: string }[] = [
  { id: 'progress', title: 'In progress', gridCls: 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-6' },
  { id: 'outcome', title: 'Outcomes', gridCls: 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-5' },
];

const currentMax = Math.max(...data.map((item) => item.count), 1);
const reachedMax = Math.max(...reachedData.map((item) => item.count), 1);

return (
  <section className={`${CARD} p-4 sm:p-5 mb-5`}>
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h3 className="text-base sm:text-lg font-semibold text-slate-900">Pipeline Funnel</h3>
        <p className="text-sm text-slate-500 mt-0.5 break-words">
          {mode === 'current'
            ? `Where your ${total} ${total === 1 ? 'application sits' : 'applications sit'} right now. Each one is counted once, at its current status.`
            : `How far your ${submitted} submitted ${submitted === 1 ? 'application' : 'applications'} got, including ones that have since closed.`}{' '}
          Select a stage to see its applications.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:flex-col sm:items-end shrink-0">
        <div role="group" aria-label="Funnel view" className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-sm">
          {(['current', 'reached'] as FunnelMode[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={`flex-1 whitespace-nowrap rounded-md px-3 py-1 transition-colors ${FOCUS_RING} ${
                mode === option ? 'bg-white text-slate-900 shadow-sm font-medium' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {option === 'current' ? 'Now' : 'Furthest reached'}
            </button>
          ))}
        </div>

        <Link
          to="/applications"
          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md text-sm font-medium text-slate-600 hover:text-slate-900 ${FOCUS_RING}`}
        >
          Manage Applications
          <ChevronRight size={15} />
        </Link>
      </div>
    </div>

    {mode === 'current' ? (
      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.id}>
            <p className="text-[11px] font-medium uppercase tracking-widest text-slate-400 mb-2">
              {group.title}
            </p>

            <div className={`grid ${group.gridCls} gap-2 sm:gap-3`}>
              {data
                .filter((item) => item.group === group.id)
                .map((item) => (
                  <FunnelStageCard
                    key={item.value}
                    id={`current-${item.value}`}
                    label={item.label}
                    count={item.count}
                    maxCount={currentMax}
                    base={total}
                    baseLabel="all"
                    href={`/applications?status=${item.value}`}
                    barClass={STAGE_BAR_COLOURS[item.value] || 'bg-slate-900'}
                    describe={(count, share) =>
                      `${count} ${count === 1 ? 'application is' : 'applications are'} at ${item.label} (${share}% of ${total}).`
                    }
                    emptyText={`No applications are at ${item.label} right now.`}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div>
        <p className="text-[11px] font-medium uppercase tracking-widest text-slate-400 mb-2">
          Furthest stage reached
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3">
          {reachedData.map((item) => (
            <FunnelStageCard
              key={item.value}
              id={`reached-${item.value}`}
              label={item.label}
              count={item.count}
              maxCount={reachedMax}
              base={submitted}
              baseLabel="applied"
              href={`/applications?reached=${item.value}`}
              barClass={STAGE_BAR_COLOURS[item.value] || 'bg-slate-900'}
              describe={(count, share) =>
                `${count} of ${submitted} submitted ${submitted === 1 ? 'application' : 'applications'} reached ${item.label} (${share}%).`
              }
              emptyText={`No applications have reached ${item.label} yet.`}
            />
          ))}
        </div>
      </div>
    )}
  </section>
);
};

// Outcomes get their meaning's colour; stages in progress stay in the brand's slate.
const STAGE_BAR_COLOURS: Record<string, string> = {
  offer: 'bg-emerald-500',
  rejected: 'bg-rose-400',
  withdrawn: 'bg-slate-400',
  ghosted: 'bg-slate-400',
  archived: 'bg-slate-300',
};

const FunnelStageCard = ({
id,
label,
count,
maxCount,
base,
baseLabel,
href,
describe,
emptyText,
barClass,
}: {
id: string;
label: string;
count: number;
maxCount: number;
base: number;
baseLabel: string;
href: string;
describe: (count: number, share: number) => string;
emptyText: string;
barClass: string;
}) => {
const isEmpty = count === 0;
const share = base > 0 ? Math.round((count / base) * 100) : 0;
const width = isEmpty ? 0 : Math.max(4, Math.round((count / maxCount) * 100));
const tooltipId = `funnel-tip-${id}`;
const tooltip = isEmpty
  ? emptyText
  : `${describe(count, share)} Select to view ${count === 1 ? 'it' : 'them'}.`;

const body = (
  <>
    <div className="flex items-start justify-between gap-2 mb-2.5">
      <p className={`text-sm font-medium break-words ${isEmpty ? 'text-slate-400' : 'text-slate-700'}`}>
        {label}
      </p>
      <p className={`text-lg font-semibold leading-none tabular-nums ${isEmpty ? 'text-slate-300' : 'text-slate-900'}`}>
        {count}
      </p>
    </div>

    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${barClass}`}
        style={{ width: `${width}%` }}
      />
    </div>

    <p className="text-xs text-slate-400 mt-1.5">{isEmpty ? 'None yet' : `${share}% of ${baseLabel}`}</p>

    <span
      id={tooltipId}
      role="tooltip"
      className="pointer-events-none absolute inset-x-0 bottom-full z-20 mb-2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {tooltip}
    </span>
  </>
);

if (isEmpty) {
  return (
    <div
      aria-describedby={tooltipId}
      className="group relative rounded-xl border border-dashed border-slate-200 bg-white p-3"
    >
      {body}
    </div>
  );
}

return (
  <Link
    to={href}
    aria-describedby={tooltipId}
    className={`group relative block rounded-xl border border-slate-200 bg-slate-50 p-3 hover:bg-white hover:border-slate-300 hover:shadow-sm transition ${FOCUS_RING}`}
  >
    {body}
  </Link>
);
};

const ActionNeededPanel = ({
actionItems,
categories,
totalApplications,
}: {
actionItems: ActionItem[];
categories: ActionCategory[];
totalApplications: number;
}) => (

  <section className={`${CARD} p-4 sm:p-5 overflow-hidden`}>
    <PanelHeader
      title="Action Needed"
      description={
        totalApplications > actionItems.length
          ? `The ${actionItems.length} most urgent of ${totalApplications} applications that need action.`
          : 'Follow-ups, interviews, offers and replies that should not be missed.'
      }
    />


{actionItems.length === 0 ? (
  <EmptyState
    icon={CheckCircle2}
    title="No urgent actions"
    description="Nothing needs a follow-up, decision or reply right now."
    actionLabel="View Applications"
    actionHref="/applications"
  />
) : (
  <ul className="space-y-2">
    {actionItems.map((item) => (
      <li key={item.id}>
        <Link
          to={item.href}
          className={`group flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 hover:bg-slate-50 hover:border-slate-300 transition-colors ${FOCUS_RING}`}
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full shrink-0 ${
              item.tone === 'danger'
                ? 'bg-red-500'
                : item.tone === 'warning'
                  ? 'bg-amber-500'
                  : item.tone === 'info'
                    ? 'bg-indigo-500'
                    : 'bg-slate-400'
            }`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 break-words">{item.title}</p>
            <p className="text-sm text-slate-500 break-words">{item.reason}</p>
          </div>
          <ChevronRight size={16} className="shrink-0 text-slate-300 group-hover:text-slate-600" />
        </Link>
      </li>
    ))}
  </ul>
)}

{categories.length > 0 && (
  <div className="mt-4 border-t border-slate-100 pt-3">
    <p className="text-[11px] font-medium uppercase tracking-widest text-slate-400 mb-1">By category</p>
    <ul className="divide-y divide-slate-100">
      {categories.map((category) => (
        <li key={category.key}>
          <Link
            to={category.href}
            className={`group flex items-center justify-between gap-3 rounded-md py-2 text-sm text-slate-600 hover:text-slate-900 ${FOCUS_RING}`}
          >
            <span className="min-w-0 break-words">{category.label}</span>
            <span className="flex items-center gap-3 shrink-0">
              <span className="font-semibold text-slate-900 tabular-nums">{category.count}</span>
              <span className="text-xs text-slate-400 group-hover:text-slate-700">View all →</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  </div>
)}


  </section>
);

const NotificationsPanel = ({
notifications,
total,
}: {
notifications: NotificationItem[];
total: number;
}) => (

  <section className={`${CARD} p-4 sm:p-5 overflow-hidden`}>
    <PanelHeader
      title="Unread Notifications"
      description="Important alerts should be visible, not hidden behind a bell."
      aside={
        <span className="relative w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
          <Bell size={17} className="text-slate-700" />
          {total > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-indigo-600 px-1 text-[10px] font-semibold leading-[18px] text-white text-center tabular-nums">
              {total}
            </span>
          )}
        </span>
      }
    />

{notifications.length === 0 ? (
  <EmptyState
    icon={Bell}
    title="No unread notifications"
    description="New shared opportunities and system alerts will appear here."
  />
) : (
  <div className="space-y-2">
    {notifications.map((notification) => (
      <div
        key={notification.id}
        className="border border-slate-200 rounded-xl px-3 py-2.5"
      >
        <p className="text-sm font-semibold text-slate-900 break-words">
          {notification.title || 'Notification'}
        </p>

        {notification.message && (
          <p className="text-sm text-slate-600 mt-1 break-words">
            {notification.message}
          </p>
        )}

        <p className="text-xs text-slate-400 mt-1">
          {formatDateTime(notification.created_at)}
        </p>
      </div>
    ))}
  </div>
)}

{total > notifications.length && (
  <Link
    to="/notifications?filter=unread"
    className={`mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-sm text-slate-600 hover:text-slate-900 ${FOCUS_RING}`}
  >
    <span>Showing {notifications.length} of {total} unread</span>
    <span className="text-xs text-slate-400">View all →</span>
  </Link>
)}


  </section>
);

// Retry runs the existing sync on the Email Sync page, which keeps the Gmail
// connection and read-only permission handling in one place.
const GMAIL_SYNC_HREF = '/email-sync?sync=gmail';

const GmailStat = ({
label,
value,
hint,
}: {
label: string;
value: number;
hint?: string;
}) => (
<div className="rounded-xl border border-slate-200 bg-slate-50 p-3 min-w-0">
  <p className="text-xs text-slate-500 break-words">{label}</p>
  <p className="text-xl font-semibold mt-0.5 text-slate-900 tabular-nums">{value}</p>
  {hint && <p className="text-xs text-slate-400 mt-1 break-words">{hint}</p>}
</div>
);

const GmailSyncPanel = ({
summary,
connected,
minutesRemaining,
syncEnabled,
loading,
error,
onReload,
}: {
summary: GmailSyncSummary;
connected: boolean;
minutesRemaining: number;
syncEnabled: boolean | null;
loading: boolean;
error: string;
onReload: () => void;
}) => {
const { lastSuccess, lastFailure, lastRun, detected } = summary;
const neverSynced = !summary.lastAttempt;
const syncAction = connected
  ? { label: lastFailure ? 'Retry sync' : 'Sync now', href: GMAIL_SYNC_HREF }
  : { label: 'Reconnect Gmail', href: '/email-sync' };

const status =
  syncEnabled === false
    ? { label: 'Sync turned off', className: 'bg-amber-50 text-amber-700 border-amber-200' }
    : connected
      ? { label: `Connected · ${minutesRemaining} min left`, className: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
      : { label: 'Not connected', className: 'bg-slate-50 text-slate-600 border-slate-200' };

return (
  <div
    aria-busy={loading}
    className={`${CARD} p-4 sm:p-5 overflow-hidden min-w-0`}
  >
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
          <MailCheck size={18} className="text-slate-700" />
        </div>

        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold text-slate-900 break-words">Gmail Sync Summary</h3>
          <p className="text-slate-500 text-sm break-words">
            From your Gmail sync runs and the emails you've processed.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {loading && (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" />
            Updating
          </span>
        )}
        <span
          title="Gmail read access lasts one hour per browser session. Reconnect on Email Sync when it expires."
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${status.className}`}
        >
          {status.label}
        </span>
      </div>
    </div>

    {error ? (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="font-medium">Couldn't load Gmail sync data.</p>
        <p className="mt-1 break-words">{error}</p>
        <button
          type="button"
          onClick={onReload}
          className={`mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors ${FOCUS_RING}`}
        >
          <RefreshCw size={12} />
          Try again
        </button>
      </div>
    ) : loading && neverSynced && summary.emailsProcessed === 0 ? (
      <div className="space-y-3" aria-hidden="true">
        <div className="h-16 rounded-xl bg-slate-100 animate-pulse motion-reduce:animate-none" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-20 rounded-xl bg-slate-100 animate-pulse motion-reduce:animate-none" />
          ))}
        </div>
      </div>
    ) : (
      <div className="space-y-5">
        {syncEnabled === false && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Gmail sync is turned off.{' '}
            <Link to="/settings?tab=emailSync" className="font-medium underline">
              Turn it on in Settings
            </Link>
          </div>
        )}

        {neverSynced ? (
          <EmptyState
            icon={MailCheck}
            title="No Gmail syncs yet"
            description="Connect Gmail on Email Sync and run a sync to see results here."
            actionLabel="Go to Email Sync"
            actionHref="/email-sync"
          />
        ) : (
          <div
            className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
              lastFailure ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'
            }`}
          >
            <div className="min-w-0 text-sm">
              {lastFailure ? (
                <>
                  <p className="font-medium text-red-800 flex items-start gap-1.5">
                    <AlertCircle size={15} className="shrink-0 mt-0.5" />
                    <span>Last sync failed · {formatDateTime(lastFailure.created_at)}</span>
                  </p>
                  {lastFailure.error_message && (
                    <p className="text-red-700 mt-1 break-words">{lastFailure.error_message}</p>
                  )}
                  <p className="text-red-700/80 mt-1">
                    {lastSuccess
                      ? `Last successful sync: ${formatDateTime(lastSuccess.created_at)}`
                      : 'No successful sync yet.'}
                  </p>
                </>
              ) : (
                <p className="font-medium text-emerald-800 flex items-start gap-1.5">
                  <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
                  <span>
                    Last successful sync · {formatDateTime(lastSuccess?.created_at)}
                    {lastSuccess?.processing_time_ms ? (
                      <span className="font-normal text-emerald-700"> · took {formatDuration(lastSuccess.processing_time_ms)}</span>
                    ) : null}
                  </span>
                </p>
              )}
            </div>

            {syncEnabled !== false && (
              <Link
                to={syncAction.href}
                className={`inline-flex justify-center shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${FOCUS_RING} ${
                  lastFailure
                    ? 'bg-red-700 text-white hover:bg-red-800'
                    : 'bg-slate-900 text-white hover:bg-slate-700'
                }`}
              >
                {syncAction.label}
              </Link>
            )}
          </div>
        )}

        {lastRun && (
          <section>
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 mb-2">
              <h4 className="text-xs font-medium uppercase tracking-widest text-slate-400">Last successful sync</h4>
              {(lastRun.needsReview > 0 || lastRun.actionable > 0) && connected && (
                <Link to={GMAIL_SYNC_HREF} className="text-xs font-medium text-slate-600 hover:text-slate-900">
                  Review detected emails →
                </Link>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <GmailStat label="Emails scanned" value={lastRun.scanned} />
              <GmailStat label="Already processed" value={lastRun.alreadyProcessed} hint="Skipped as duplicates" />
              <GmailStat label="Matched or new" value={lastRun.actionable} hint="Incl. rejections applied automatically" />
              <GmailStat label="Needs review" value={lastRun.needsReview} />
              <GmailStat label="Filtered out" value={lastRun.filteredOut} hint="Not recruitment-related" />
            </div>
            {lastRun.needsReview > 0 && (
              <p className="text-xs text-slate-400 mt-2">
                Emails flagged for review appear again on Email Sync each time the sync runs, until you handle them.
              </p>
            )}
          </section>
        )}

        {!neverSynced && (
          <section>
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 mb-2">
              <h4 className="text-xs font-medium uppercase tracking-widest text-slate-400">All time from Gmail</h4>
              <Link to="/settings?tab=emailEvents" className="text-xs font-medium text-slate-600 hover:text-slate-900">
                View processed emails →
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <GmailStat
                label="Emails processed"
                value={summary.emailsProcessed}
                hint={summary.emailsNotLinked > 0 ? `${summary.emailsNotLinked} not linked to an application` : undefined}
              />
              <GmailStat
                label="Applications updated"
                value={summary.applicationsUpdated}
                hint="Unique applications"
              />
              <GmailStat label="New applications" value={summary.newApplications} hint="Created from an email" />
              <GmailStat label="Existing updated" value={summary.existingApplicationsUpdated} />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">Detected in processed emails:</span>
              {[
                ['Interviews', detected.interviews],
                ['Assessments', detected.assessments],
                ['Offers', detected.offers],
                ['Rejections', detected.rejections],
              ].map(([label, value]) => (
                <span key={label} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700">
                  {label} <span className="font-semibold text-slate-900">{value}</span>
                </span>
              ))}
              {summary.dismissed > 0 && (
                <span className="text-slate-400">· {summary.dismissed} dismissed by you</span>
              )}
            </div>
          </section>
        )}
      </div>
    )}
  </div>
);
};

const ACTIVITY_PREVIEW_COUNT = 10;

const activityStyles: Record<ActivityKind, { icon: React.ElementType; className: string }> = {
added: { icon: Briefcase, className: 'bg-blue-50 text-blue-700' },
status: { icon: TrendingUp, className: 'bg-slate-100 text-slate-600' },
assessment: { icon: FileText, className: 'bg-violet-50 text-violet-700' },
interview: { icon: CalendarCheck, className: 'bg-indigo-50 text-indigo-700' },
offer: { icon: Trophy, className: 'bg-emerald-50 text-emerald-700' },
rejection: { icon: XCircle, className: 'bg-red-50 text-red-700' },
follow_up: { icon: Clock, className: 'bg-amber-50 text-amber-700' },
closed: { icon: Timer, className: 'bg-slate-100 text-slate-500' },
note: { icon: FileText, className: 'bg-slate-100 text-slate-600' },
email: { icon: MailCheck, className: 'bg-cyan-50 text-cyan-700' },
other: { icon: CheckCircle2, className: 'bg-slate-100 text-slate-600' },
};

const formatTime = (date: string) =>
new Date(date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const RecentActivityPanel = ({
timeline,
loading,
error,
}: {
timeline: TimelineEvent[];
loading: boolean;
error: string;
}) => {
const [expanded, setExpanded] = useState(false);
const visible = expanded ? timeline : timeline.slice(0, ACTIVITY_PREVIEW_COUNT);
const days = groupTimelineByDay(visible);
const hiddenCount = timeline.length - ACTIVITY_PREVIEW_COUNT;

return (
  <div
    aria-busy={loading}
    className={`${CARD} p-4 sm:p-5 min-w-0 overflow-hidden`}
  >
    <PanelHeader
      title="Recent Activity"
      description="Latest updates across your applications, newest first."
      aside={
        loading ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" />
            Updating
          </span>
        ) : undefined
      }
    />

    {error ? (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 break-words flex items-start gap-2">
        <AlertCircle size={15} className="shrink-0 mt-0.5" />
        <span>Couldn't load recent activity. {error}</span>
      </div>
    ) : loading && timeline.length === 0 ? (
      <div className="space-y-4" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-full bg-slate-100 animate-pulse motion-reduce:animate-none shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3.5 w-2/3 rounded bg-slate-100 animate-pulse motion-reduce:animate-none" />
              <div className="h-3 w-1/2 rounded bg-slate-100 animate-pulse motion-reduce:animate-none" />
            </div>
          </div>
        ))}
      </div>
    ) : timeline.length === 0 ? (
      <EmptyState
        icon={Clock}
        title="No activity yet"
        description="Adding applications, changing statuses and completing follow-ups will show up here."
        actionLabel="Add Application"
        actionHref="/applications"
      />
    ) : (
      <div className="space-y-5">
        {days.map((day) => (
          <section key={day.key} aria-labelledby={`activity-day-${day.key}`}>
            <h4
              id={`activity-day-${day.key}`}
              className="text-xs font-medium uppercase tracking-widest text-slate-400 mb-2"
            >
              {day.label}
            </h4>

            <ol>
              {day.events.map((item, index) => (
                <li key={item.id} className="relative">
                  {index < day.events.length - 1 && (
                    // Connects this event's icon to the next one in the same day.
                    <span aria-hidden="true" className="absolute left-4 top-10 -bottom-2 w-px bg-slate-200" />
                  )}
                  <ActivityRow item={item} />
                </li>
              ))}
            </ol>
          </section>
        ))}

        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className={`w-full rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors ${FOCUS_RING}`}
          >
            {expanded ? 'Show less' : `Show ${hiddenCount} more`}
          </button>
        )}
      </div>
    )}
  </div>
);
};

const ActivityRow = ({ item }: { item: TimelineEvent }) => {
const { icon: Icon, className } = activityStyles[item.kind];
const subject = [item.roleTitle, item.companyName].filter(Boolean).join(' · ');

const content = (
  <div className="flex items-start gap-3">
    <span
      className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${className}`}
    >
      <Icon size={15} />
    </span>

    <div className="min-w-0 flex-1 pt-1">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900 break-words">{item.title}</p>
        <time
          dateTime={item.date}
          title={formatDateTime(item.date)}
          className="text-xs text-slate-400 whitespace-nowrap shrink-0"
        >
          {formatTime(item.date)}
        </time>
      </div>

      {subject ? (
        <p className="text-sm text-slate-600 break-words">{subject}</p>
      ) : item.applicationDeleted ? (
        <p className="text-sm text-slate-400 italic">Deleted application</p>
      ) : null}

      {item.detail && (
        <p className="text-xs text-slate-500 mt-1 break-words line-clamp-2">{item.detail}</p>
      )}
    </div>
  </div>
);

if (!item.applicationId) {
  return <div className="py-2">{content}</div>;
}

return (
  <Link
    to={`/applications/${item.applicationId}`}
    className={`block -mx-2 rounded-xl px-2 py-2 hover:bg-slate-50 transition-colors ${FOCUS_RING}`}
  >
    {content}
  </Link>
);
};

const ErrorMessage = ({
error,
onClear,
}: {
error: string;
onClear: () => void;
}) => (
  <div
    role="alert"
    className="bg-red-50 text-red-700 border border-red-200 rounded-xl px-4 py-3 mb-5 flex items-start gap-3 overflow-hidden"
  >
    <AlertCircle size={16} className="shrink-0 mt-0.5" />
    <span className="text-sm flex-1 break-words">{error}</span>
    <button
      type="button"
      onClick={onClear}
      aria-label="Dismiss error"
      className={`rounded-md text-red-400 hover:text-red-700 shrink-0 ${FOCUS_RING}`}
    >
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

// A headline number: label, value and one line of context.
const StatCard = ({
label,
value,
icon: Icon,
helper,
}: {
label: string;
value: number | string;
icon: React.ElementType;
helper: string;
}) => (
  <div className={`${CARD} p-4 sm:p-5 overflow-hidden`}>
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs sm:text-sm font-medium text-slate-500 break-words">{label}</p>
      <Icon size={16} className="text-slate-400 shrink-0" />
    </div>
    <p className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 mt-2 tabular-nums">{value}</p>
    <p className="text-xs text-slate-500 mt-1.5 leading-snug break-words">{helper}</p>
  </div>
);

// One rate in the Conversion card, with a bar for percentages.
const RateCard = ({
label,
value,
helper,
percent,
tone = 'neutral',
}: {
label: string;
value: string;
helper: string;
percent?: number;
tone?: 'positive' | 'negative' | 'neutral';
}) => (
  <div className="min-w-0">
    <p className="text-xs font-medium text-slate-500 break-words">{label}</p>
    <p className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900 mt-1 tabular-nums">{value}</p>
    {percent === undefined ? (
      // Keeps the helper text level with the rates that have a bar.
      <div aria-hidden="true" className="mt-2 h-1.5" />
    ) : (
      <div
        className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden"
        role="meter"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            tone === 'positive' ? 'bg-emerald-500' : tone === 'negative' ? 'bg-rose-400' : 'bg-slate-900'
          }`}
          style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
        />
      </div>
    )}
    <p className="text-xs text-slate-400 mt-1.5 break-words">{helper}</p>
  </div>
);

const MiniCard = ({
label,
value,
icon: Icon,
helper,
href,
}: {
label: string;
value: number;
icon: React.ElementType;
helper: string;
href: string;
}) => (
  <Link
    to={href}
    className={`${CARD} group flex items-center gap-3 px-4 py-3 hover:border-slate-300 hover:shadow transition ${FOCUS_RING}`}
  >
    <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
      <Icon size={17} className="text-slate-600" />
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium text-slate-700 break-words">{label}</p>
      <p className="text-xs text-slate-400 break-words">{helper}</p>
    </div>
    <p className="text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
    <ChevronRight size={16} className="text-slate-300 group-hover:text-slate-500 shrink-0" />
  </Link>
);

const EmptyState = ({
title,
description,
actionLabel,
actionHref,
icon: Icon = Inbox,
}: {
title: string;
description: string;
actionLabel?: string;
actionHref?: string;
icon?: React.ElementType;
}) => (
  <div className="border border-dashed border-slate-200 rounded-xl px-4 py-6 sm:py-8 text-center bg-slate-50/60 overflow-hidden">
    <div className="mx-auto mb-2 w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center">
      <Icon size={16} className="text-slate-400" />
    </div>
    <p className="text-sm font-semibold text-slate-700 break-words">{title}</p>
    <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto break-words">{description}</p>

    {actionLabel && actionHref && (
      <Link to={actionHref} className={`${BUTTON_PRIMARY} mt-4`}>
        {actionLabel}
      </Link>
    )}
  </div>
);

// Shown while Refresh reloads the data. Indeterminate: the dashboard can't
// tell how far along its queries are, so it shows activity, not a percentage.
const RefreshBar = () => (
  <div
    role="progressbar"
    aria-label="Refreshing dashboard"
    className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden rounded-full bg-slate-200"
  >
    <div className="h-full w-2/5 rounded-full bg-slate-900 animate-indeterminate motion-reduce:animate-none motion-reduce:w-full motion-reduce:opacity-40" />
  </div>
);

const SkeletonBlock = ({ className }: { className: string }) => (
  <div className={`rounded-lg bg-slate-100 animate-pulse motion-reduce:animate-none ${className}`} />
);

// Mirrors the dashboard's layout so nothing jumps when the data arrives.
const DashboardSkeleton = () => (
  <div className="w-full max-w-full overflow-hidden" aria-busy="true">
    <span className="sr-only" role="status">Loading dashboard…</span>

    <div className="flex items-start justify-between gap-3 mb-5" aria-hidden="true">
      <div className="space-y-2">
        <SkeletonBlock className="h-8 w-40 bg-slate-200" />
        <SkeletonBlock className="h-4 w-64 max-w-full" />
      </div>
      <SkeletonBlock className="h-9 w-24" />
    </div>

    <div className={`${CARD} p-4 sm:p-5 mb-5`} aria-hidden="true">
      <SkeletonBlock className="h-5 w-48 mb-3" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <SkeletonBlock key={index} className="h-16 rounded-xl" />
        ))}
      </div>
    </div>

    <SkeletonBlock className="h-24 rounded-2xl bg-slate-200 mb-5" />

    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-4" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className={`${CARD} p-4 sm:p-5`}>
          <SkeletonBlock className="h-4 w-24 mb-3" />
          <SkeletonBlock className="h-8 w-14 bg-slate-200 mb-2" />
          <SkeletonBlock className="h-3 w-32 max-w-full" />
        </div>
      ))}
    </div>

    <div className={`${CARD} p-4 sm:p-5 mb-5`} aria-hidden="true">
      <SkeletonBlock className="h-4 w-24 mb-4" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <SkeletonBlock className="h-3 w-28 max-w-full" />
            <SkeletonBlock className="h-7 w-16 bg-slate-200" />
            <SkeletonBlock className="h-1.5 w-full" />
          </div>
        ))}
      </div>
    </div>

    <div className={`${CARD} p-4 sm:p-5`} aria-hidden="true">
      <SkeletonBlock className="h-5 w-36 mb-4" />
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <SkeletonBlock key={index} className="h-20 rounded-xl" />
        ))}
      </div>
    </div>
  </div>
);
