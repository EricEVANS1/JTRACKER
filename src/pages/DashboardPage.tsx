// src/pages/DashboardPage.tsx
//
// Dashboard — JTracker pipeline intelligence view.
//
// Engineering notes:
// - Keep "current status" separate from "historical journey".
// - A rejected application can still have reached interview stage.
// - Percentages should always use a clear denominator.
// - Wishlist roles are excluded from submitted-application conversion metrics.
// - This makes the dashboard useful for decision-making, not just counting statuses.

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Archive,
  Briefcase,
  CalendarCheck,
  CheckCircle2,
  Clock,
  FileText,
  MailCheck,
  RefreshCw,
  Target,
  TrendingUp,
  Trophy,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Link } from 'react-router-dom';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useOnboarding } from '../hooks/useOnboarding';
import type { Application } from '../types/application';

type DashboardApplication = Application & {
  reached_interview?: boolean | null;
  rejected_after_interview?: boolean | null;
  final_response_pending?: boolean | null;
  interview_count?: number | null;
  outcome_reason?: string | null;
  interview_started_at?: string | null;
  final_interview_started_at?: string | null;
  response_received_at?: string | null;
  assessment_received_at?: string | null;
  offer_received_at?: string | null;
  rejected_at?: string | null;
  withdrawn_at?: string | null;
  ghosted_at?: string | null;
  archived?: boolean | null;
};

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
  gmail_message_id: string | null;
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

const chartColors = [
  '#0f172a',
  '#334155',
  '#64748b',
  '#94a3b8',
  '#cbd5e1',
  '#475569',
  '#1e293b',
];

const closedStatuses = ['rejected', 'withdrawn', 'ghosted', 'archived'];

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

const formatStatus = (status: string) =>
  status.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

const formatDateTime = (date: string) =>
  new Date(date).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const formatDuration = (ms?: number | null) => {
  if (!ms) return '0s';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const safePercent = (value: number, total: number) => {
  if (!total || total <= 0) return 0;
  return Math.round((value / total) * 100);
};

const hasReachedInterview = (app: DashboardApplication) =>
  Boolean(
    app.reached_interview ||
      app.interview_started_at ||
      app.final_interview_started_at ||
      ['interview', 'final_interview', 'offer'].includes(app.status)
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
      emailEventsResult,
      ignoredEmailsResult,
      syncSessionsResult,
      recruitersResult,
      recruiterInteractionsResult,
      cvVersionsResult,
    ] = await Promise.all([
      supabase
        .from('applications')
        .select('*')
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
        .from('email_events')
        .select('id, gmail_message_id, received_at, application_id')
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
      setApplications((applicationsResult.data || []) as DashboardApplication[]);
    }

    if (eventsResult.error) {
      setError(eventsResult.error.message);
    } else {
      setRecentEvents((eventsResult.data || []) as unknown as RecentEvent[]);
    }

    if (emailEventsResult.error) {
      setError(emailEventsResult.error.message);
    } else {
      setEmailEvents(emailEventsResult.data || []);
    }

    if (ignoredEmailsResult.error) {
      setError(ignoredEmailsResult.error.message);
    } else {
      setIgnoredEmails(ignoredEmailsResult.data || []);
    }

    if (syncSessionsResult.error) {
      setError(syncSessionsResult.error.message);
    } else {
      setLatestSync((syncSessionsResult.data?.[0] || null) as GmailSyncSession | null);
    }

    if (recruitersResult.error) {
      setError(recruitersResult.error.message);
    } else {
      setRecruiters(recruitersResult.data || []);
    }

    if (recruiterInteractionsResult.error) {
      setError(recruiterInteractionsResult.error.message);
    } else {
      setRecruiterInteractions(recruiterInteractionsResult.data || []);
    }

    if (cvVersionsResult.error) {
      setError(cvVersionsResult.error.message);
    } else {
      setCvVersions(cvVersionsResult.data || []);
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const stats = useMemo(() => {
    const total = applications.length;

    // Product metric note:
    // Wishlist roles are tracked, but they are not real submitted applications.
    // They should not dilute response, interview, rejection, or offer rates.
    const wishlist = applications.filter((app) => app.status === 'wishlist').length;

    const submitted = applications.filter((app) => app.status !== 'wishlist').length;

    const archived = applications.filter(
      (app) => app.archived || app.status === 'archived'
    ).length;

    const active = applications.filter(
      (app) =>
        !app.archived &&
        !closedStatuses.includes(app.status) &&
        app.status !== 'wishlist'
    ).length;

    const pending = applications.filter((app) =>
      ['applied', 'confirmation_received'].includes(app.status)
    ).length;

    const assessments = applications.filter((app) => app.status === 'assessment').length;

    const currentInterviews = applications.filter((app) =>
      ['interview', 'final_interview'].includes(app.status)
    ).length;

    // Historical interview metric:
    // This counts every application that ever reached interview stage,
    // even if the current status is now rejected.
    const totalInterviewsReached = applications.filter((app) =>
      hasReachedInterview(app)
    ).length;

    const awaitingFinalInterviewResponse = applications.filter((app) =>
      Boolean(app.final_response_pending) ||
      ['interview', 'final_interview'].includes(app.status)
    ).length;

    const rejectedAfterInterview = applications.filter((app) =>
      Boolean(app.rejected_after_interview)
    ).length;

    const offers = applications.filter((app) => app.status === 'offer').length;

    const rejections = applications.filter((app) => app.status === 'rejected').length;

    const rejectedBeforeInterview = applications.filter(
      (app) =>
        app.status === 'rejected' &&
        !app.rejected_after_interview &&
        !hasReachedInterview(app)
    ).length;

    const withdrawn = applications.filter((app) => app.status === 'withdrawn').length;
    const ghosted = applications.filter((app) => app.status === 'ghosted').length;

    const clearResponses = applications.filter((app) =>
      responseStatuses.includes(app.status)
    ).length;

    const closedResponses = applications.filter((app) =>
      ['rejected', 'withdrawn', 'ghosted', 'offer'].includes(app.status)
    ).length;

    const responseRate = safePercent(clearResponses, submitted);
    const historicalInterviewRate = safePercent(totalInterviewsReached, submitted);
    const currentInterviewRate = safePercent(currentInterviews, submitted);
    const offerRate = safePercent(offers, submitted);
    const rejectionRate = safePercent(rejections, submitted);
    const postInterviewDeclineRate = safePercent(
      rejectedAfterInterview,
      totalInterviewsReached
    );

    const statusCounts = applications.reduce<Record<string, number>>((acc, app) => {
      acc[app.status] = (acc[app.status] || 0) + 1;
      return acc;
    }, {});

    const statusChartData = Object.entries(statusCounts)
      .map(([status, count]) => ({
        name: formatStatus(status),
        value: count,
      }))
      .sort((a, b) => b.value - a.value);

    const rejectionBreakdownData = [
      {
        name: 'Before Interview',
        value: rejectedBeforeInterview,
      },
      {
        name: 'After Interview',
        value: rejectedAfterInterview,
      },
    ].filter((item) => item.value > 0);

    return {
      total,
      wishlist,
      submitted,
      active,
      archived,
      pending,
      assessments,
      currentInterviews,
      totalInterviewsReached,
      awaitingFinalInterviewResponse,
      rejectedAfterInterview,
      rejectedBeforeInterview,
      offers,
      rejections,
      withdrawn,
      ghosted,
      closedResponses,
      clearResponses,
      responseRate,
      historicalInterviewRate,
      currentInterviewRate,
      offerRate,
      rejectionRate,
      postInterviewDeclineRate,
      statusChartData,
      rejectionBreakdownData,
    };
  }, [applications]);

  const gmailStats = useMemo(() => {
    const gmailEmails = emailEvents.filter((item) => item.gmail_message_id);
    const linkedEmails = emailEvents.filter((item) => item.application_id);

    const scanned = latestSync?.scanned_count || 0;
    const accepted = latestSync?.accepted_count || 0;
    const review = latestSync?.review_count || 0;
    const rejected = latestSync?.rejected_count || 0;

    const acceptanceRate = safePercent(accepted, scanned);
    const reviewRate = safePercent(review, scanned);
    const rejectionRate = safePercent(rejected, scanned);

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

    if (stats.totalInterviewsReached > 0) {
      return `${stats.total} applications tracked. ${stats.submitted} have been submitted, ${stats.clearResponses} received a clear response, and ${stats.totalInterviewsReached} reached interview stage. You currently have ${stats.awaitingFinalInterviewResponse} interview-stage application awaiting a final response, while ${stats.rejectedAfterInterview} previous interview-stage applications were declined.`;
    }

    if (stats.responseRate < 25) {
      return `${stats.total} applications tracked. Your response rate is currently ${stats.responseRate}%, so the main focus should be CV targeting, stronger keywords, and follow-ups.`;
    }

    return `${stats.total} applications tracked. ${stats.submitted} have been submitted and ${stats.clearResponses} have received a clear response. Keep updating statuses after every recruiter interaction or email response.`;
  }, [stats]);

  const metricCards = [
    {
      label: 'Total Applications',
      value: stats.total,
      icon: Briefcase,
      helper: 'All tracked roles, including wishlist items',
    },
    {
      label: 'Submitted',
      value: stats.submitted,
      icon: TrendingUp,
      helper: 'Applications actually sent',
    },
    {
      label: 'Waiting',
      value: stats.pending,
      icon: Clock,
      helper: 'Applied or confirmation received',
    },
    {
      label: 'Assessments',
      value: stats.assessments,
      icon: FileText,
      helper: 'Currently at assessment stage',
    },
    {
      label: 'Current Interviews',
      value: stats.currentInterviews,
      icon: CalendarCheck,
      helper: 'Currently in interview stage',
    },
    {
      label: 'Archived',
      value: stats.archived,
      icon: Archive,
      helper: 'Closed or hidden records',
    },
  ];

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (!loading && !onboardingComplete) {
    return (
      <div className="w-full max-w-full overflow-hidden">
        <div className="max-w-5xl mx-auto">
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
                  your dashboard will show pipeline performance, response rates,
                  interviews, offers, Gmail sync insights, CV versions, and recent
                  activity.
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

  return (
    <div className="w-full max-w-full overflow-hidden">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8">
        <div className="min-w-0">
          <h2 className="text-2xl sm:text-3xl font-bold mb-1 break-words">Dashboard</h2>
          <p className="text-slate-500 text-sm sm:text-base break-words">
            Job search overview, conversion metrics, interview journey, Gmail sync performance, recruiters, CVs, and recent activity.
          </p>
        </div>

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

      <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-6 shadow-sm mb-6 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <Target size={22} />
          </div>

          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">
              Pipeline Story
            </p>
            <h3 className="text-base sm:text-lg font-semibold mb-1 break-words">
              {stats.total} applications tracked · {stats.submitted} submitted
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed break-words">
              {insight}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
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

      <SectionHeader
        title="Interview Journey"
        description="Historical interview progress, including applications that later became rejected."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <MiniCard
          label="Interviews Reached"
          value={stats.totalInterviewsReached}
          icon={CalendarCheck}
          helper="Historical total, including rejected interview outcomes"
        />

        <MiniCard
          label="Awaiting Final Response"
          value={stats.awaitingFinalInterviewResponse}
          icon={Clock}
          helper="Interview-stage applications still pending"
        />

        <MiniCard
          label="Declined After Interview"
          value={stats.rejectedAfterInterview}
          icon={XCircle}
          helper="Rejected after reaching interview stage"
        />

        <MiniCard
          label="Post-Interview Decline Rate"
          value={stats.postInterviewDeclineRate}
          icon={TrendingUp}
          helper={`${stats.rejectedAfterInterview} of ${stats.totalInterviewsReached} interview-stage applications declined`}
          suffix="%"
        />
      </div>

      <SectionHeader
        title="Conversion Metrics"
        description="Each percentage shows the numerator and denominator so the metric is easier to understand."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <RateCard
          label="Response Rate"
          value={`${stats.responseRate}%`}
          helper={`${stats.clearResponses} of ${stats.submitted} submitted applications received a clear response`}
        />

        <RateCard
          label="Historical Interview Rate"
          value={`${stats.historicalInterviewRate}%`}
          helper={`${stats.totalInterviewsReached} of ${stats.submitted} submitted applications reached interview stage`}
        />

        <RateCard
          label="Rejection Rate"
          value={`${stats.rejectionRate}%`}
          helper={`${stats.rejections} of ${stats.submitted} submitted applications were rejected`}
          negative
        />

        <RateCard
          label="Offer Rate"
          value={`${stats.offerRate}%`}
          helper={`${stats.offers} offers recorded from ${stats.submitted} submitted applications`}
          positive
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <RateCard
          label="Current Interview Stage"
          value={`${stats.currentInterviewRate}%`}
          helper={`${stats.currentInterviews} of ${stats.submitted} submitted applications are currently in interview stage`}
        />

        <RateCard
          label="Rejected Before Interview"
          value={String(stats.rejectedBeforeInterview)}
          helper="Rejected applications with no interview recorded"
          negative
        />

        <RateCard
          label="Withdrawn"
          value={String(stats.withdrawn)}
          helper="Applications you chose to withdraw"
        />

        <RateCard
          label="Ghosted"
          value={String(stats.ghosted)}
          helper="Applications marked as no clear response"
        />
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
        <div className="space-y-6 min-w-0">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 overflow-hidden">
            <h3 className="text-lg sm:text-xl font-semibold break-words">
              Applications by Current Status
            </h3>
            <p className="text-slate-500 text-sm mt-1 mb-6 break-words">
              Current state of your application pipeline. Historical interview outcomes are shown separately above.
            </p>

            {stats.statusChartData.length === 0 ? (
              <EmptyState
                title="No status data yet"
                description="Add applications to see your pipeline distribution."
                actionLabel="Add Application"
                actionHref="/applications"
              />
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-[1fr_220px] gap-6 items-center">
                <div className="h-64 sm:h-72 min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={stats.statusChartData}
                        dataKey="value"
                        nameKey="name"
                        outerRadius={95}
                        innerRadius={55}
                        paddingAngle={3}
                      >
                        {stats.statusChartData.map((_, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={chartColors[index % chartColors.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-3 min-w-0">
                  {stats.statusChartData.map((item, index) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{
                            backgroundColor: chartColors[index % chartColors.length],
                          }}
                        />
                        <span className="text-slate-600 truncate">{item.name}</span>
                      </div>

                      <span className="font-semibold text-slate-900 shrink-0">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

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
              <RateCard
                label="Accepted Rate"
                value={`${gmailStats.acceptanceRate}%`}
                helper={`${gmailStats.accepted} of ${gmailStats.scanned} scanned emails were accepted`}
                positive
              />
              <RateCard
                label="Review Rate"
                value={`${gmailStats.reviewRate}%`}
                helper={`${gmailStats.review} of ${gmailStats.scanned} scanned emails need review`}
              />
              <RateCard
                label="Rejected Rate"
                value={`${gmailStats.rejectionRate}%`}
                helper={`${gmailStats.rejected} of ${gmailStats.scanned} scanned emails were rejected`}
                negative
              />
            </div>

            {latestSync?.error_message && (
              <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm break-words">
                Latest sync error: {latestSync.error_message}
              </div>
            )}
          </div>
        </div>

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
      </div>
    </div>
  );
};

const SectionHeader = ({
  title,
  description,
}: {
  title: string;
  description: string;
}) => (
  <div className="mb-4">
    <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
    <p className="text-sm text-slate-500 mt-1">{description}</p>
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
  helper,
  positive,
  negative,
}: {
  label: string;
  value: string;
  helper?: string;
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

    {helper && (
      <p className="text-xs text-slate-400 mt-3 leading-relaxed break-words">
        {helper}
      </p>
    )}
  </div>
);

const MiniCard = ({
  label,
  value,
  icon: Icon,
  helper,
  suffix = '',
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  helper: string;
  suffix?: string;
}) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm overflow-hidden">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-slate-500 break-words">{label}</p>
        <p className="text-2xl sm:text-3xl font-bold mt-3 break-words">
          {value}
          {suffix}
        </p>
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

    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
      {Array.from({ length: 6 }).map((_, index) => (
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