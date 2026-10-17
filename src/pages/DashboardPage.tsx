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
interview_notes?: { interview_date: string | null }[] | null;
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
const [unreadCount, setUnreadCount] = useState(0);
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
      rejected_after_interview,
      outcome_reason,
      interview_notes (
        interview_date
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
    .select('id, title, message, type, read, created_at', { count: 'exact' })
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

if (notificationsResult.error) {
  setError(notificationsResult.error.message);
} else {
  // Only the newest few are listed; the count covers every unread notification.
  setNotifications((notificationsResult.data || []) as NotificationItem[]);
  setUnreadCount(notificationsResult.count ?? (notificationsResult.data || []).length);
}

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

  <PipelineFunnel
    data={funnelData}
    reachedData={reachedData}
    total={stats.total}
    submitted={stats.submitted}
  />

  <div className="grid grid-cols-1 xl:grid-cols-[1fr_0.9fr] gap-6 mb-8">
    <ActionNeededPanel
      actionItems={actionNeeded.items}
      categories={actionNeeded.categories}
      totalApplications={actionNeeded.totalApplications}
    />
    <NotificationsPanel notifications={notifications} total={unreadCount} />
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
      href="/follow-ups?filter=overdue"
      urgent={overdueFollowUps > 0}
    />

    <TodayPill
      label="Due today"
      value={dueTodayFollowUps}
      icon={CalendarCheck}
      href="/follow-ups?filter=today"
      urgent={dueTodayFollowUps > 0}
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
      urgent={awaitingFinalResponse > 0}
    />

    <TodayPill
      label="Unread notifications"
      value={unreadNotifications}
      icon={Bell}
      href="/notifications?filter=unread"
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
  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 mb-8">
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h3 className="text-lg sm:text-xl font-semibold">Pipeline Funnel</h3>
        <p className="text-sm text-slate-500 mt-1 break-words">
          {mode === 'current'
            ? `Where your ${total} ${total === 1 ? 'application sits' : 'applications sit'} right now. Each one is counted once, at its current status.`
            : `How far your ${submitted} submitted ${submitted === 1 ? 'application' : 'applications'} got, including ones that have since closed.`}{' '}
          Select a stage to see its applications.
        </p>
      </div>

      <div className="flex flex-col sm:items-end gap-3 shrink-0">
        <div role="group" aria-label="Funnel view" className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm">
          {(['current', 'reached'] as FunnelMode[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 transition ${
                mode === option ? 'bg-white text-slate-900 shadow-sm font-medium' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {option === 'current' ? 'Now' : 'Furthest reached'}
            </button>
          ))}
        </div>

        <Link
          to="/applications"
          className="inline-flex justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 transition"
        >
          Manage Applications
        </Link>
      </div>
    </div>

    {mode === 'current' ? (
      <div className="space-y-5">
        {groups.map((group) => (
          <div key={group.id}>
            <p className="text-xs font-medium uppercase tracking-widest text-slate-400 mb-2">
              {group.title}
            </p>

            <div className={`grid ${group.gridCls} gap-3`}>
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
        <p className="text-xs font-medium uppercase tracking-widest text-slate-400 mb-2">
          Furthest stage reached
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
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
              describe={(count, share) =>
                `${count} of ${submitted} submitted ${submitted === 1 ? 'application' : 'applications'} reached ${item.label} (${share}%).`
              }
              emptyText={`No applications have reached ${item.label} yet.`}
            />
          ))}
        </div>
      </div>
    )}
  </div>
);
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
    <div className="flex items-start justify-between gap-2 mb-3">
      <p className={`text-sm font-medium break-words ${isEmpty ? 'text-slate-400' : 'text-slate-700'}`}>
        {label}
      </p>
      <p className={`text-lg font-bold leading-none ${isEmpty ? 'text-slate-300' : 'text-slate-900'}`}>
        {count}
      </p>
    </div>

    <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
      <div
        className="h-full rounded-full bg-slate-900 transition-all"
        style={{ width: `${width}%` }}
      />
    </div>

    <p className="text-xs text-slate-400 mt-2">{isEmpty ? 'None yet' : `${share}% of ${baseLabel}`}</p>

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
      className="group relative rounded-xl border border-dashed border-slate-200 bg-white p-3 sm:p-4"
    >
      {body}
    </div>
  );
}

return (
  <Link
    to={href}
    aria-describedby={tooltipId}
    className="group relative block rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4 hover:bg-white hover:border-slate-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 transition"
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

  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 overflow-hidden">
    <h3 className="text-lg sm:text-xl font-semibold mb-1">Action Needed</h3>
    <p className="text-sm text-slate-500 mb-5 break-words">
      {totalApplications > actionItems.length
        ? `The ${actionItems.length} most urgent of ${totalApplications} applications that need action.`
        : 'Follow-ups, interviews, offers and replies that should not be missed.'}
    </p>


{actionItems.length === 0 ? (
  <EmptyState
    title="No urgent actions"
    description="Nothing needs a follow-up, decision or reply right now."
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

{categories.length > 0 && (
  <div className="mt-5 border-t border-slate-100 pt-4">
    <p className="text-xs font-medium uppercase tracking-widest text-slate-400 mb-1">By category</p>
    <ul className="divide-y divide-slate-100">
      {categories.map((category) => (
        <li key={category.key}>
          <Link
            to={category.href}
            className="group flex items-center justify-between gap-3 py-2 text-sm text-slate-600 hover:text-slate-900"
          >
            <span className="min-w-0 break-words">{category.label}</span>
            <span className="flex items-center gap-3 shrink-0">
              <span className="font-semibold text-slate-900">{category.count}</span>
              <span className="text-xs text-slate-400 group-hover:text-slate-700">View all →</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  </div>
)}


  </div>
);

const NotificationsPanel = ({
notifications,
total,
}: {
notifications: NotificationItem[];
total: number;
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

{total > notifications.length && (
  <Link
    to="/notifications?filter=unread"
    className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-sm text-slate-600 hover:text-slate-900"
  >
    <span>Showing {notifications.length} of {total} unread</span>
    <span className="text-xs text-slate-400">View all →</span>
  </Link>
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
