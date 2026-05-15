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
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Application } from '../types/application';

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

const formatStatus = (status: string) =>
  status
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

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

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();

  const [applications, setApplications] = useState<Application[]>([]);
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

      supabase
        .from('recruiters')
        .select('id')
        .eq('user_id', user.id),

      supabase
        .from('recruiter_interactions')
        .select('id')
        .eq('user_id', user.id),

      supabase
        .from('cv_versions')
        .select('id')
        .eq('user_id', user.id),
    ]);

    if (applicationsResult.error) {
      setError(applicationsResult.error.message);
    } else {
      setApplications(applicationsResult.data || []);
    }

    if (eventsResult.error) {
      setError(eventsResult.error.message);
    } else {
      setRecentEvents((eventsResult.data || []) as RecentEvent[]);
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
  }, [user]);

  const stats = useMemo(() => {
    const total = applications.length;
    const active = applications.filter((app) => !app.archived).length;
    const archived = applications.filter((app) => app.archived).length;

    const interviews = applications.filter((app) =>
      ['interview', 'final_interview'].includes(app.status)
    ).length;

    const offers = applications.filter((app) => app.status === 'offer').length;
    const rejections = applications.filter((app) => app.status === 'rejected').length;

    const pending = applications.filter((app) =>
      ['wishlist', 'applied'].includes(app.status)
    ).length;

    const responses = applications.filter((app) =>
      [
        'confirmation_received',
        'assessment',
        'interview',
        'final_interview',
        'offer',
        'rejected',
        'withdrawn',
        'ghosted',
      ].includes(app.status)
    ).length;

    const responseRate = total > 0 ? Math.round((responses / total) * 100) : 0;
    const interviewRate = total > 0 ? Math.round((interviews / total) * 100) : 0;
    const offerRate = total > 0 ? Math.round((offers / total) * 100) : 0;
    const rejectionRate = total > 0 ? Math.round((rejections / total) * 100) : 0;

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

    return {
      total,
      active,
      archived,
      pending,
      interviews,
      offers,
      rejections,
      responses,
      responseRate,
      interviewRate,
      offerRate,
      rejectionRate,
      statusChartData,
    };
  }, [applications]);

  const gmailStats = useMemo(() => {
    const gmailEmails = emailEvents.filter((item) => item.gmail_message_id);
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

    if (stats.offerRate > 0) {
      return 'You have offers in the pipeline. Focus on follow-ups, negotiation, and keeping active opportunities organized.';
    }

    if (stats.interviewRate >= 20) {
      return 'Your interview conversion looks healthy. Keep tracking recruiter interactions and prepare deeply for active interviews.';
    }

    if (stats.responseRate < 25) {
      return 'Your response rate is low. Improve your CV targeting, track which CV versions perform best, and apply more selectively.';
    }

    return 'Your pipeline is active. Keep updating statuses after every recruiter interaction or email response.';
  }, [stats]);

  const metricCards = [
    {
      label: 'Total Applications',
      value: stats.total,
      icon: Briefcase,
      helper: 'All tracked applications',
    },
    {
      label: 'Active',
      value: stats.active,
      icon: TrendingUp,
      helper: 'Currently open',
    },
    {
      label: 'Pending',
      value: stats.pending,
      icon: Clock,
      helper: 'Wishlist or applied',
    },
    {
      label: 'Interviews',
      value: stats.interviews,
      icon: CalendarCheck,
      helper: 'Interview stages',
    },
    {
      label: 'Offers',
      value: stats.offers,
      icon: Trophy,
      helper: 'Successful outcomes',
    },
    {
      label: 'Archived',
      value: stats.archived,
      icon: Archive,
      helper: 'Closed or hidden',
    },
  ];

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div>
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold mb-1">Dashboard</h2>
          <p className="text-slate-500 text-sm">
            Job search overview, Gmail sync performance, recruiters, CVs, and recent activity.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="self-start lg:self-auto bg-slate-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-700 transition disabled:opacity-50 inline-flex items-center gap-2"
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-3">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span className="text-sm flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-sm mb-6">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <Target size={22} />
          </div>

          <div>
            <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">
              Pipeline Insight
            </p>
            <h3 className="text-lg font-semibold mb-1">
              {stats.total > 0
                ? `${stats.active} active applications from ${stats.total} total`
                : 'No applications tracked yet'}
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed">{insight}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        {metricCards.map((card) => {
          const Icon = card.icon;

          return (
            <div
              key={card.label}
              className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-500">{card.label}</p>
                  <p className="text-3xl font-bold mt-3">{card.value}</p>
                </div>

                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                  <Icon size={19} className="text-slate-600" />
                </div>
              </div>

              <p className="text-xs text-slate-400 mt-3">{card.helper}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <RateCard label="Response Rate" value={`${stats.responseRate}%`} />
        <RateCard label="Interview Rate" value={`${stats.interviewRate}%`} />
        <RateCard label="Offer Rate" value={`${stats.offerRate}%`} positive />
        <RateCard label="Rejection Rate" value={`${stats.rejectionRate}%`} negative />
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
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
            <h3 className="text-xl font-semibold">Applications by Status</h3>
            <p className="text-slate-500 text-sm mt-1 mb-6">
              Breakdown of your current application pipeline.
            </p>

            {stats.statusChartData.length === 0 ? (
              <EmptyState
                title="No status data yet"
                description="Add applications to see your pipeline distribution."
              />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-6 items-center">
                <div className="h-72">
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

                <div className="space-y-3">
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

                      <span className="font-semibold text-slate-900">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                <MailCheck size={20} className="text-slate-700" />
              </div>

              <div>
                <h3 className="text-xl font-semibold">Gmail Sync Summary</h3>
                <p className="text-slate-500 text-sm">
                  Real sync data from your Gmail sync sessions.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <SummaryCard label="Emails Processed" value={gmailStats.totalEmails} />
              <SummaryCard label="Emails Linked" value={gmailStats.linkedEmails} />
              <SummaryCard label="Ignored Emails" value={gmailStats.ignoredEmails} />
              <SummaryCard label="Latest Scanned" value={gmailStats.scanned} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <SummaryCard label="Accepted" value={gmailStats.accepted} />
              <SummaryCard label="Needs Review" value={gmailStats.review} />
              <SummaryCard label="Rejected" value={gmailStats.rejected} />

              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                <p className="text-sm text-slate-500">Latest Sync</p>
                <p className="text-sm font-semibold mt-2 text-slate-900">
                  {gmailStats.latestImport
                    ? formatDateTime(gmailStats.latestImport)
                    : 'No sync yet'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {gmailStats.latestStatus} · {formatDuration(gmailStats.processingTime)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <RateCard label="Accepted Rate" value={`${gmailStats.acceptanceRate}%`} positive />
              <RateCard label="Review Rate" value={`${gmailStats.reviewRate}%`} />
              <RateCard label="Rejected Rate" value={`${gmailStats.rejectionRate}%`} negative />
            </div>

            {latestSync?.error_message && (
              <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
                Latest sync error: {latestSync.error_message}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <h3 className="text-xl font-semibold mb-1">Recent Activity</h3>
          <p className="text-slate-500 text-sm mb-6">
            Latest updates from your job search.
          </p>

          {recentEvents.length === 0 ? (
            <EmptyState
              title="No recent activity"
              description="Activity will appear here when applications are created, updated, or imported."
            />
          ) : (
            <div className="space-y-4">
              {recentEvents.map((event) => (
                <div
                  key={event.id}
                  className="border border-slate-200 rounded-xl p-4 hover:bg-slate-50 transition"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle2 size={15} className="text-slate-500 shrink-0" />
                        <h4 className="font-semibold text-slate-900 truncate">
                          {event.title}
                        </h4>
                      </div>

                      {event.applications?.role_title && (
                        <p className="text-sm text-slate-500">
                          {event.applications.companies?.name
                            ? `${event.applications.role_title} · ${event.applications.companies.name}`
                            : event.applications.role_title}
                        </p>
                      )}

                      {event.description && (
                        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                          {event.description}
                        </p>
                      )}
                    </div>

                    <span className="text-xs text-slate-400 whitespace-nowrap">
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
  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
    <p className="text-sm text-slate-500">{label}</p>
    <div className="flex items-end justify-between gap-3 mt-3">
      <p className="text-3xl font-bold">{value}</p>
      {positive && <Trophy size={18} className="text-slate-400" />}
      {negative && <XCircle size={18} className="text-slate-400" />}
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
  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm text-slate-500">{label}</p>
        <p className="text-3xl font-bold mt-3">{value}</p>
      </div>

      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
        <Icon size={19} className="text-slate-600" />
      </div>
    </div>

    <p className="text-xs text-slate-400 mt-3">{helper}</p>
  </div>
);

const SummaryCard = ({
  label,
  value,
}: {
  label: string;
  value: number;
}) => (
  <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
    <p className="text-sm text-slate-500">{label}</p>
    <p className="text-2xl font-bold mt-2 text-slate-900">{value}</p>
  </div>
);

const EmptyState = ({
  title,
  description,
}: {
  title: string;
  description: string;
}) => (
  <div className="border border-dashed border-slate-200 rounded-xl p-8 text-center bg-slate-50">
    <p className="font-semibold text-slate-700">{title}</p>
    <p className="text-sm text-slate-500 mt-1">{description}</p>
  </div>
);

const DashboardSkeleton = () => (
  <div>
    <div className="mb-8">
      <div className="h-8 w-44 bg-slate-200 rounded-lg animate-pulse mb-2" />
      <div className="h-4 w-96 bg-slate-100 rounded-lg animate-pulse" />
    </div>

    <div className="h-28 bg-slate-200 rounded-2xl animate-pulse mb-6" />

    <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
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