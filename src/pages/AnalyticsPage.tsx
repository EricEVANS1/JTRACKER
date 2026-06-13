import React, { useEffect, useMemo, useState } from 'react';
import {
AlertCircle,
CheckCircle2,
Clock,
FileText,
RefreshCw,
Target,
TrendingUp,
Trophy,
X,
} from 'lucide-react';
import {
Bar,
BarChart,
Cell,
Line,
LineChart,
Pie,
PieChart,
ResponsiveContainer,
Tooltip,
XAxis,
YAxis,
} from 'recharts';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface CVVersionJoin {
name: string;
}

interface RawApplicationRecord {
id: string;
status: string;
source: string | null;
cv_version_id: string | null;
date_applied: string | null;
created_at: string;
updated_at?: string | null;
archived?: boolean | null;
archived_at?: string | null;

response_received_at?: string | null;
assessment_received_at?: string | null;
interview_started_at?: string | null;
final_interview_started_at?: string | null;
offer_received_at?: string | null;
rejected_at?: string | null;
withdrawn_at?: string | null;
ghosted_at?: string | null;
follow_up_date?: string | null;
priority?: string | null;
last_status_changed_at?: string | null;
status_updated_at?: string | null;

reached_interview?: boolean | null;
rejected_after_interview?: boolean | null;
final_response_pending?: boolean | null;
interview_count?: number | null;
outcome_reason?: string | null;

cv_versions?: CVVersionJoin | CVVersionJoin[] | null;
}

interface ApplicationRecord extends Omit<RawApplicationRecord, 'cv_versions'> {
cv_versions: CVVersionJoin | null;
}

interface PerformanceRow {
name: string;
applications: number;
responses: number;
interviews: number;
offers: number;
rejections: number;
responseRate: number;
interviewRate: number;
offerRate: number;
}

interface ActionItem {
title: string;
description: string;
}

const firstOrNull = <T,>(value: T | T[] | null | undefined): T | null => {
if (Array.isArray(value)) return value[0] ?? null;
return value ?? null;
};

const chartColors = [
'#0f172a',
'#334155',
'#64748b',
'#94a3b8',
'#cbd5e1',
'#475569',
'#1e293b',
];

const responseStatuses = [
'confirmation_received',
'assessment',
'interview',
'final_interview',
'offer',
'rejected',
'withdrawn',
'ghosted',
];

const closedStatuses = ['offer', 'rejected', 'withdrawn', 'ghosted', 'archived'];

const formatLabel = (value: string) =>
value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

const getAppliedDate = (app: ApplicationRecord) => app.date_applied || app.created_at;


const getDaysBetween = (start?: string | null, end?: string | null) => {
if (!start || !end) return null;

const startTime = new Date(start).getTime();
const endTime = new Date(end).getTime();

if (Number.isNaN(startTime) || Number.isNaN(endTime)) return null;

return Math.max(0, Math.round((endTime - startTime) / (1000 * 60 * 60 * 24)));
};

const average = (values: number[]) => {
if (values.length === 0) return 0;
return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
};

const safePercent = (value: number, total: number) => {
if (!total || total <= 0) return 0;
return Math.round((value / total) * 100);
};

const getWeekKey = (date: string) => {
const d = new Date(date);
const year = d.getFullYear();
const firstDay = new Date(year, 0, 1);
const days = Math.floor((d.getTime() - firstDay.getTime()) / 86400000);
const week = Math.ceil((days + firstDay.getDay() + 1) / 7);

return `${year}-W${String(week).padStart(2, '0')}`;
};

const hasReachedInterview = (app: ApplicationRecord) =>
Boolean(
app.reached_interview ||
app.interview_started_at ||
app.final_interview_started_at ||
app.rejected_after_interview ||
app.status === 'interview' ||
app.status === 'final_interview' ||
app.status === 'offer'
);

const hasClearResponse = (app: ApplicationRecord) =>
responseStatuses.includes(app.status) ||
Boolean(
app.response_received_at ||
app.assessment_received_at ||
app.interview_started_at ||
app.final_interview_started_at ||
app.offer_received_at ||
app.rejected_at ||
app.withdrawn_at ||
app.ghosted_at
);

const isArchived = (app: ApplicationRecord) =>
Boolean(app.archived) || app.status === 'archived';

const isSubmitted = (app: ApplicationRecord) => app.status !== 'wishlist';

const isActive = (app: ApplicationRecord) =>
isSubmitted(app) && !isArchived(app) && !closedStatuses.includes(app.status);

const buildBottleneck = ({
submitted,
responseRate,
interviewRate,
offerRate,
responses,
interviews,
offers,
rejectedAfterInterview,
awaitingFinalResponse,
}: {
submitted: number;
responseRate: number;
interviewRate: number;
offerRate: number;
responses: number;
interviews: number;
offers: number;
rejectedAfterInterview: number;
awaitingFinalResponse: number;
}) => {
if (submitted === 0) {
return {
title: 'Not enough data yet',
stage: 'Start tracking',
description:
'Add submitted applications first. Once applications have statuses and lifecycle dates, Analytics will identify the main bottleneck.',
};
}

if (responseRate < 20) {
return {
title: 'Main bottleneck: response stage',
stage: 'Applications are not getting enough replies',
description:
'You are applying, but too few companies are replying. This usually points to CV targeting, keywords, role fit, application quality, or source selection.',
};
}

if (responses > 0 && interviewRate < 10) {
return {
title: 'Main bottleneck: screening to interview',
stage: 'Replies are not converting into interviews',
description:
'Companies are responding, but not enough applications are reaching interview stage. Review role fit, screening questions, salary expectations, and how closely your CV matches the job description.',
};
}

if (interviews >= 3 && offerRate === 0) {
return {
title: 'Main bottleneck: interview conversion',
stage: 'Interviews are not becoming offers',
description:
'You are reaching interviews, but offers are not coming through yet. Focus on interview preparation, technical examples, STAR answers, and stronger closing questions.',
};
}

if (rejectedAfterInterview > 0 && rejectedAfterInterview >= Math.max(2, Math.round(interviews / 2))) {
return {
title: 'Main bottleneck: post-interview outcomes',
stage: 'Too many interviews are ending in rejection',
description:
'A large share of interview-stage applications were declined after interview. Review interview feedback, technical depth, communication examples, and role alignment.',
};
}

if (awaitingFinalResponse > 0) {
return {
title: 'Current focus: follow-up discipline',
stage: 'Some interview-stage applications are still pending',
description:
'You have applications waiting for final responses. Track follow-ups carefully and send polite follow-up messages after a reasonable waiting period.',
};
}

if (offers > 0) {
return {
title: 'Strong progress: offer conversion exists',
stage: 'Your process has produced offers',
description:
'You have evidence that your job-search process can work. Study the CV version, source, and role type that produced the offer and repeat that pattern.',
};
}

return {
title: 'Balanced progress',
stage: 'Your data is becoming useful',
description:
'You have enough activity to start learning from the numbers. Keep updating statuses, lifecycle dates, CV versions, and sources after every recruiter interaction.',
};
};

export const AnalyticsPage: React.FC = () => {
const { user } = useAuth();

const [applications, setApplications] = useState<ApplicationRecord[]>([]);
const [loading, setLoading] = useState(true);
const [refreshing, setRefreshing] = useState(false);
const [error, setError] = useState('');

const fetchAnalytics = async () => {
if (!user) return;


setError('');

const { data, error } = await supabase
  .from('applications')
  .select(`
    id,
    status,
    source,
    cv_version_id,
    date_applied,
    created_at,
    updated_at,
    archived,
    archived_at,
    response_received_at,
    assessment_received_at,
    interview_started_at,
    final_interview_started_at,
    offer_received_at,
    rejected_at,
    withdrawn_at,
    ghosted_at,
    follow_up_date,
    priority,
    last_status_changed_at,
    status_updated_at,
    reached_interview,
    rejected_after_interview,
    final_response_pending,
    interview_count,
    outcome_reason,
    cv_versions (
      name
    )
  `)
  .eq('user_id', user.id)
  .order('created_at', { ascending: false });

if (error) {
  setError(error.message);
  return;
}

const normalised: ApplicationRecord[] = ((data || []) as RawApplicationRecord[]).map(
  (app) => ({
    ...app,
    cv_versions: firstOrNull(app.cv_versions),
  })
);

setApplications(normalised);


};

const loadAnalytics = async () => {
setLoading(true);
await fetchAnalytics();
setLoading(false);
};

const handleRefresh = async () => {
setRefreshing(true);
await fetchAnalytics();
setRefreshing(false);
};

useEffect(() => {
loadAnalytics();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [user?.id]);

const analytics = useMemo(() => {
const total = applications.length;
const submittedApps = applications.filter(isSubmitted);
const submitted = submittedApps.length;


const active = applications.filter(isActive).length;
const archived = applications.filter(isArchived).length;

const responses = submittedApps.filter(hasClearResponse).length;
const interviews = submittedApps.filter(hasReachedInterview).length;
const offers = submittedApps.filter((app) => app.status === 'offer' || Boolean(app.offer_received_at)).length;
const rejections = submittedApps.filter((app) => app.status === 'rejected').length;
const rejectedAfterInterview = submittedApps.filter((app) => Boolean(app.rejected_after_interview)).length;
const awaitingFinalResponse = submittedApps.filter(
  (app) =>
    Boolean(app.final_response_pending) ||
    (!isArchived(app) && ['interview', 'final_interview'].includes(app.status))
).length;

const ghosted = submittedApps.filter((app) => app.status === 'ghosted').length;

const responseRate = safePercent(responses, submitted);
const interviewRate = safePercent(interviews, submitted);
const offerRate = safePercent(offers, submitted);
const rejectionRate = safePercent(rejections, submitted);
const postInterviewDeclineRate = safePercent(rejectedAfterInterview, interviews);

const responseTimes = submittedApps
  .map((app) => getDaysBetween(getAppliedDate(app), app.response_received_at))
  .filter((value): value is number => value !== null);

const interviewTimes = submittedApps
  .map((app) => getDaysBetween(getAppliedDate(app), app.interview_started_at || app.final_interview_started_at))
  .filter((value): value is number => value !== null);

const offerTimes = submittedApps
  .map((app) => getDaysBetween(getAppliedDate(app), app.offer_received_at))
  .filter((value): value is number => value !== null);

const rejectionTimes = submittedApps
  .map((app) => getDaysBetween(getAppliedDate(app), app.rejected_at))
  .filter((value): value is number => value !== null);

const now = new Date();

const followUpsDue = submittedApps.filter((app) => {
  if (!app.follow_up_date) return false;
  if (isArchived(app) || closedStatuses.includes(app.status)) return false;

  return new Date(app.follow_up_date) <= now;
}).length;

const sourceCounts = submittedApps.reduce<
  Record<
    string,
    {
      applications: number;
      responses: number;
      interviews: number;
      offers: number;
      rejections: number;
    }
  >
>((acc, app) => {
  const source = app.source ? formatLabel(app.source) : 'Unknown';

  if (!acc[source]) {
    acc[source] = {
      applications: 0,
      responses: 0,
      interviews: 0,
      offers: 0,
      rejections: 0,
    };
  }

  acc[source].applications += 1;

  if (hasClearResponse(app)) acc[source].responses += 1;
  if (hasReachedInterview(app)) acc[source].interviews += 1;
  if (app.status === 'offer' || app.offer_received_at) acc[source].offers += 1;
  if (app.status === 'rejected') acc[source].rejections += 1;

  return acc;
}, {});

const sourceChartData: PerformanceRow[] = Object.entries(sourceCounts)
  .map(([source, stats]) => ({
    name: source,
    applications: stats.applications,
    responses: stats.responses,
    interviews: stats.interviews,
    offers: stats.offers,
    rejections: stats.rejections,
    responseRate: safePercent(stats.responses, stats.applications),
    interviewRate: safePercent(stats.interviews, stats.applications),
    offerRate: safePercent(stats.offers, stats.applications),
  }))
  .sort((a, b) => b.interviewRate - a.interviewRate || b.applications - a.applications);

const statusCounts = submittedApps.reduce<Record<string, number>>((acc, app) => {
  const status = isArchived(app) && app.status !== 'rejected'
    ? `${formatLabel(app.status)} / Archived`
    : formatLabel(app.status);

  acc[status] = (acc[status] || 0) + 1;
  return acc;
}, {});

const statusChartData = Object.entries(statusCounts)
  .map(([status, count]) => ({
    name: status,
    value: count,
  }))
  .sort((a, b) => b.value - a.value);

const cvCounts = submittedApps.reduce<
  Record<
    string,
    {
      total: number;
      responses: number;
      interviews: number;
      offers: number;
      rejections: number;
    }
  >
>((acc, app) => {
  const cvName = app.cv_versions?.name || 'No CV selected';

  if (!acc[cvName]) {
    acc[cvName] = {
      total: 0,
      responses: 0,
      interviews: 0,
      offers: 0,
      rejections: 0,
    };
  }

  acc[cvName].total += 1;

  if (hasClearResponse(app)) acc[cvName].responses += 1;
  if (hasReachedInterview(app)) acc[cvName].interviews += 1;
  if (app.status === 'offer' || app.offer_received_at) acc[cvName].offers += 1;
  if (app.status === 'rejected') acc[cvName].rejections += 1;

  return acc;
}, {});

const cvPerformanceData: PerformanceRow[] = Object.entries(cvCounts)
  .map(([cv, stats]) => ({
    name: cv,
    applications: stats.total,
    responses: stats.responses,
    interviews: stats.interviews,
    offers: stats.offers,
    rejections: stats.rejections,
    responseRate: safePercent(stats.responses, stats.total),
    interviewRate: safePercent(stats.interviews, stats.total),
    offerRate: safePercent(stats.offers, stats.total),
  }))
  .sort((a, b) => b.interviewRate - a.interviewRate || b.responseRate - a.responseRate || b.applications - a.applications);

const weeklyCounts = submittedApps.reduce<
  Record<
    string,
    {
      week: string;
      applications: number;
      responses: number;
      interviews: number;
      offers: number;
    }
  >
>((acc, app) => {
  const appliedDate = getAppliedDate(app);
  const week = getWeekKey(appliedDate);

  if (!acc[week]) {
    acc[week] = {
      week,
      applications: 0,
      responses: 0,
      interviews: 0,
      offers: 0,
    };
  }

  acc[week].applications += 1;

  if (hasClearResponse(app)) acc[week].responses += 1;
  if (hasReachedInterview(app)) acc[week].interviews += 1;
  if (app.status === 'offer' || app.offer_received_at) acc[week].offers += 1;

  return acc;
}, {});

const weeklyTrendData = Object.values(weeklyCounts)
  .sort((a, b) => a.week.localeCompare(b.week))
  .slice(-8);

const funnelData = [
  { stage: 'Submitted', count: submitted },
  { stage: 'Responses', count: responses },
  { stage: 'Interviews', count: interviews },
  { stage: 'Offers', count: offers },
];

const bestSource =
  sourceChartData.length > 0 ? sourceChartData[0] : null;

const bestCV =
  cvPerformanceData.length > 0 ? cvPerformanceData[0] : null;

const bottleneck = buildBottleneck({
  submitted,
  responseRate,
  interviewRate,
  offerRate,
  responses,
  interviews,
  offers,
  rejectedAfterInterview,
  awaitingFinalResponse,
});

const story =
  submitted === 0
    ? 'No submitted applications have been recorded yet. Add applications with CV versions, sources, and status updates to unlock your job-search story.'
    : `You have submitted ${submitted} application${submitted === 1 ? '' : 's'}. ${responses} received a clear response, ${interviews} reached interview stage, and ${offers} became offer${offers === 1 ? '' : 's'}. Your current story shows a ${responseRate}% response rate, ${interviewRate}% interview rate, and ${offerRate}% offer rate.`;

const sourceStory = bestSource
  ? `${bestSource.name} is currently your strongest source by interview conversion, with ${bestSource.interviewRate}% interview rate from ${bestSource.applications} application${bestSource.applications === 1 ? '' : 's'}.`
  : 'There is not enough source data yet. Add sources such as LinkedIn, company website, recruiter, referral, or Pracuj.pl to compare quality.';

const cvStory = bestCV
  ? `${bestCV.name} is currently your strongest CV version by interview conversion, with ${bestCV.interviewRate}% interview rate from ${bestCV.applications} application${bestCV.applications === 1 ? '' : 's'}.`
  : 'There is not enough CV data yet. Attach CV versions to applications so the system can identify which CV is performing best.';

const actions: ActionItem[] = [];

if (followUpsDue > 0) {
  actions.push({
    title: 'Clear overdue follow-ups',
    description: `${followUpsDue} application${followUpsDue === 1 ? ' has' : 's have'} follow-up dates due. Send polite follow-up messages or update the status.`,
  });
}

if (responseRate < 25 && submitted >= 10) {
  actions.push({
    title: 'Improve CV targeting',
    description:
      'Your response rate is low. Tailor the CV summary, skills, and bullet points more closely to each job description before applying.',
  });
}

if (responses > 0 && interviewRate < 10) {
  actions.push({
    title: 'Improve screening conversion',
    description:
      'You are getting some responses, but not enough interviews. Review screening answers, salary expectations, and role fit.',
  });
}

if (interviews >= 3 && offers === 0) {
  actions.push({
    title: 'Focus on interview preparation',
    description:
      'You are reaching interviews but not offers yet. Practise STAR stories, technical examples, and role-specific questions.',
  });
}

if (bestCV) {
  actions.push({
    title: 'Reuse your strongest CV version',
    description: `Use ${bestCV.name} more often for similar roles, because it currently has the strongest interview conversion.`,
  });
}

if (bestSource) {
  actions.push({
    title: 'Prioritise stronger sources',
    description: `Apply more through ${bestSource.name} or similar sources if the roles match your profile.`,
  });
}

if (actions.length === 0) {
  actions.push({
    title: 'Keep collecting clean data',
    description:
      'Update each application after every recruiter response. Analytics becomes more accurate when statuses, CV versions, and sources are complete.',
  });
}

return {
  total,
  submitted,
  active,
  archived,
  responses,
  interviews,
  offers,
  rejections,
  rejectedAfterInterview,
  awaitingFinalResponse,
  ghosted,
  responseRate,
  interviewRate,
  offerRate,
  rejectionRate,
  postInterviewDeclineRate,
  avgDaysToResponse: average(responseTimes),
  avgDaysToInterview: average(interviewTimes),
  avgDaysToOffer: average(offerTimes),
  avgDaysToRejection: average(rejectionTimes),
  followUpsDue,
  sourceChartData,
  statusChartData,
  cvPerformanceData,
  weeklyTrendData,
  funnelData,
  bestSource,
  bestCV,
  bottleneck,
  story,
  sourceStory,
  cvStory,
  actions: actions.slice(0, 5),
};


}, [applications]);

if (loading) {
return <AnalyticsSkeleton />;
}

return ( <div className="w-full max-w-full overflow-hidden"> <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8"> <div className="min-w-0"> <h2 className="text-2xl sm:text-3xl font-bold mb-1 break-words">
Analytics </h2>


      <p className="text-slate-500 text-sm sm:text-base break-words">
        Understand your job-search story: effort, responses, interviews, offers, bottlenecks, CV performance, and next actions.
      </p>
    </div>

    <button
      type="button"
      onClick={handleRefresh}
      disabled={refreshing}
      className="w-full sm:w-auto self-start lg:self-auto bg-slate-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-700 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
    >
      <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
      {refreshing ? 'Refreshing...' : 'Refresh'}
    </button>
  </div>

  {error && (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 flex items-start gap-3 overflow-hidden">
      <AlertCircle size={16} className="shrink-0 mt-0.5" />
      <span className="text-sm flex-1 break-words">{error}</span>

      <button
        onClick={() => setError('')}
        className="text-red-400 hover:text-red-600 shrink-0"
      >
        <X size={16} />
      </button>
    </div>
  )}

  <StoryCard
    title="Your job-search story"
    description={analytics.story}
    footer={`${analytics.bottleneck.title}: ${analytics.bottleneck.stage}`}
    icon={Target}
  />

  <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
    <MetricCard
      label="Submitted"
      value={analytics.submitted}
      helper="Applications sent, excluding wishlist items."
      icon={FileText}
    />

    <MetricCard
      label="Responses"
      value={analytics.responses}
      helper={`${analytics.responseRate}% of submitted applications received a clear response.`}
      icon={CheckCircle2}
    />

    <MetricCard
      label="Interviews Reached"
      value={analytics.interviews}
      helper={`${analytics.interviewRate}% of submitted applications reached interview stage.`}
      icon={TrendingUp}
    />

    <MetricCard
      label="Offers"
      value={analytics.offers}
      helper={`${analytics.offerRate}% of submitted applications became offers.`}
      icon={Trophy}
    />
  </div>

  <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
    <MetricCard
      label="Active"
      value={analytics.active}
      helper="Applications still in your live pipeline."
    />

    <MetricCard
      label="Archived"
      value={analytics.archived}
      helper="Closed or removed from the active pipeline."
    />

    <MetricCard
      label="Rejected"
      value={analytics.rejections}
      helper={`${analytics.rejectionRate}% of submitted applications are rejected.`}
    />

    <MetricCard
      label="After Interview"
      value={analytics.rejectedAfterInterview}
      helper={`${analytics.postInterviewDeclineRate}% of interview-stage applications were declined after interview.`}
    />
  </div>

  <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6 mb-8">
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
          <AlertCircle size={18} className="text-slate-600" />
        </div>

        <div className="min-w-0">
          <h3 className="text-lg font-semibold break-words">
            {analytics.bottleneck.title}
          </h3>

          <p className="text-sm text-slate-500 mt-1 break-words">
            {analytics.bottleneck.stage}
          </p>
        </div>
      </div>

      <p className="text-sm text-slate-600 leading-relaxed break-words">
        {analytics.bottleneck.description}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
        <SmallStat label="Response Rate" value={`${analytics.responseRate}%`} />
        <SmallStat label="Interview Rate" value={`${analytics.interviewRate}%`} />
        <SmallStat label="Offer Rate" value={`${analytics.offerRate}%`} />
      </div>
    </div>

    <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-6 shadow-sm overflow-hidden">
      <p className="text-xs uppercase tracking-widest text-slate-400 mb-3">
        Recommended next actions
      </p>

      <div className="space-y-4">
        {analytics.actions.map((action) => (
          <div key={action.title} className="border border-white/10 rounded-xl p-3 bg-white/5">
            <p className="text-sm font-semibold break-words">{action.title}</p>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed break-words">
              {action.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  </div>

  <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-sm mb-8 overflow-hidden">
    <h3 className="text-lg font-semibold mb-2">Journey funnel</h3>

    <p className="text-sm text-slate-500 mb-5 break-words">
      This shows where applications drop off: submitted applications, clear responses, interviews reached, and offers.
    </p>

    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      <div className="h-[280px] sm:h-72 w-full overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={analytics.funnelData}>
            <XAxis dataKey="stage" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#0f172a" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-3">
        <ExplanationCard
          title="For every 100 applications"
          description={`Around ${analytics.responseRate} receive a clear response, ${analytics.interviewRate} reach interview stage, and ${analytics.offerRate} become offers.`}
        />

        <ExplanationCard
          title="Interview-stage risk"
          description={`${analytics.rejectedAfterInterview} of ${analytics.interviews} interview-stage applications were declined after interview.`}
        />

        <ExplanationCard
          title="Still waiting"
          description={`${analytics.awaitingFinalResponse} interview-stage application${analytics.awaitingFinalResponse === 1 ? ' is' : 's are'} awaiting final response.`}
        />
      </div>
    </div>
  </div>

  <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6 mb-8">
    <ChartCard
      title="Weekly application trend"
      description="A simple view of application activity and outcomes over the last tracked weeks."
      isEmpty={analytics.weeklyTrendData.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={analytics.weeklyTrendData}>
          <XAxis dataKey="week" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Line type="monotone" dataKey="applications" stroke="#0f172a" strokeWidth={2} />
          <Line type="monotone" dataKey="responses" stroke="#64748b" strokeWidth={2} />
          <Line type="monotone" dataKey="interviews" stroke="#334155" strokeWidth={2} />
          <Line type="monotone" dataKey="offers" stroke="#94a3b8" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>

    <ChartCard
      title="Applications by status"
      description="Current distribution of submitted applications by status, including archived outcomes."
      isEmpty={analytics.statusChartData.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={analytics.statusChartData}
            dataKey="value"
            nameKey="name"
            outerRadius={90}
            innerRadius={45}
            paddingAngle={3}
          >
            {analytics.statusChartData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  </div>

  <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6 mb-8">
    <PerformanceSection
      title="Source performance story"
      description={analytics.sourceStory}
      rows={analytics.sourceChartData}
      emptyTitle="No source data yet"
      emptyDescription="Add sources such as LinkedIn, company website, recruiter, referral, or Pracuj.pl."
    />

    <PerformanceSection
      title="CV performance story"
      description={analytics.cvStory}
      rows={analytics.cvPerformanceData}
      emptyTitle="No CV data yet"
      emptyDescription="Attach CV versions to applications to compare performance."
    />
  </div>

  <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
    <MetricCard
      label="Avg Days to Response"
      value={`${analytics.avgDaysToResponse}d`}
      helper="Average time from application to first response."
      icon={Clock}
    />

    <MetricCard
      label="Avg Days to Interview"
      value={`${analytics.avgDaysToInterview}d`}
      helper="Average time from application to interview stage."
      icon={TrendingUp}
    />

    <MetricCard
      label="Avg Days to Offer"
      value={`${analytics.avgDaysToOffer}d`}
      helper="Average time from application to offer."
      icon={Trophy}
    />

    <MetricCard
      label="Follow-ups Due"
      value={analytics.followUpsDue}
      helper="Active applications with overdue follow-up dates."
      icon={AlertCircle}
    />
  </div>
</div>


);
};

const StoryCard = ({
title,
description,
footer,
icon: Icon,
}: {
title: string;
description: string;
footer: string;
icon: React.ElementType;
}) => (

  <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-6 shadow-sm mb-6 overflow-hidden">
    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
      <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
        <Icon size={22} />
      </div>


  <div className="min-w-0">
    <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">
      Story summary
    </p>

    <h3 className="text-lg sm:text-xl font-semibold mb-2 break-words">
      {title}
    </h3>

    <p className="text-sm text-slate-300 leading-relaxed break-words">
      {description}
    </p>

    <p className="text-sm text-white mt-4 font-medium break-words">
      {footer}
    </p>
  </div>
</div>


  </div>
);

const MetricCard = ({
label,
value,
helper,
icon: Icon,
}: {
label: string;
value: string | number;
helper: string;
icon?: React.ElementType;
}) => (

  <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm overflow-hidden">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-slate-500 break-words">{label}</p>
        <p className="text-2xl sm:text-3xl font-bold mt-3 break-words">{value}</p>
      </div>


  {Icon && (
    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
      <Icon size={18} className="text-slate-600" />
    </div>
  )}
</div>

<p className="text-xs text-slate-400 mt-4 leading-relaxed break-words">
  {helper}
</p>


  </div>
);

const SmallStat = ({ label, value }: { label: string; value: string }) => (

  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
    <p className="text-xs text-slate-400">{label}</p>
    <p className="text-lg font-bold text-slate-900 mt-1">{value}</p>
  </div>
);

const ExplanationCard = ({
title,
description,
}: {
title: string;
description: string;
}) => (

  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
    <p className="text-sm font-semibold text-slate-900 break-words">{title}</p>
    <p className="text-xs text-slate-500 mt-1 leading-relaxed break-words">
      {description}
    </p>
  </div>
);

const PerformanceSection = ({
title,
description,
rows,
emptyTitle,
emptyDescription,
}: {
title: string;
description: string;
rows: PerformanceRow[];
emptyTitle: string;
emptyDescription: string;
}) => (

  <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm overflow-hidden">
    <h3 className="text-lg font-semibold mb-2 break-words">{title}</h3>


<p className="text-sm text-slate-500 mb-5 leading-relaxed break-words">
  {description}
</p>

{rows.length === 0 ? (
  <EmptyState title={emptyTitle} description={emptyDescription} />
) : (
  <>
    <div className="h-[260px] sm:h-72 w-full overflow-hidden mb-5">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows.slice(0, 8)}>
          <XAxis dataKey="name" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="applications" fill="#cbd5e1" radius={[8, 8, 0, 0]} />
          <Bar dataKey="responses" fill="#64748b" radius={[8, 8, 0, 0]} />
          <Bar dataKey="interviews" fill="#0f172a" radius={[8, 8, 0, 0]} />
          <Bar dataKey="offers" fill="#94a3b8" radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>

    <div className="space-y-3">
      {rows.slice(0, 5).map((row) => (
        <div
          key={row.name}
          className="border border-slate-200 rounded-xl p-4 bg-slate-50 overflow-hidden"
        >
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-sm text-slate-900 break-words">
                {row.name}
              </p>

              <p className="text-xs text-slate-500 mt-1 break-words">
                {row.applications} apps · {row.responseRate}% response ·{' '}
                {row.interviewRate}% interview · {row.offerRate}% offer
              </p>
            </div>

            <span className="shrink-0 rounded-full bg-slate-900 text-white text-xs font-medium px-2.5 py-1 w-fit">
              {row.interviews} interviews
            </span>
          </div>
        </div>
      ))}
    </div>
  </>
)}


  </div>
);

const ChartCard = ({
title,
description,
isEmpty,
children,
}: {
title: string;
description: string;
isEmpty: boolean;
children: React.ReactNode;
}) => (

  <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm overflow-hidden">
    <h3 className="text-lg font-semibold mb-2 break-words">{title}</h3>


<p className="text-sm text-slate-500 mb-4 break-words">{description}</p>

{isEmpty ? (
  <EmptyState
    title="No data available"
    description="Add more applications to generate this chart."
  />
) : (
  <div className="h-[280px] sm:h-72 w-full overflow-hidden">{children}</div>
)}


  </div>
);

const EmptyState = ({
title,
description,
}: {
title: string;
description: string;
}) => (

  <div className="border border-dashed border-slate-200 rounded-xl p-6 sm:p-8 text-center bg-slate-50 overflow-hidden">
    <p className="font-semibold text-slate-700 break-words">{title}</p>


<p className="text-sm text-slate-500 mt-1 break-words">{description}</p>


  </div>
);

const AnalyticsSkeleton = () => (

  <div className="w-full max-w-full overflow-hidden">
    <div className="mb-8">
      <div className="h-8 w-44 bg-slate-200 rounded-lg animate-pulse mb-2" />
      <div className="h-4 w-full max-w-96 bg-slate-100 rounded-lg animate-pulse" />
    </div>


<div className="h-36 bg-slate-200 rounded-2xl animate-pulse mb-6" />

<div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
  {Array.from({ length: 4 }).map((_, index) => (
    <div
      key={index}
      className="h-32 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
    >
      <div className="h-4 w-24 bg-slate-100 rounded animate-pulse mb-5" />
      <div className="h-8 w-16 bg-slate-200 rounded animate-pulse" />
    </div>
  ))}
</div>


  </div>
);
