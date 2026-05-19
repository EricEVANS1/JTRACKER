import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
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
  cv_versions?: CVVersionJoin | CVVersionJoin[] | null;
}

interface ApplicationRecord extends Omit<RawApplicationRecord, 'cv_versions'> {
  cv_versions: CVVersionJoin | null;
}

const firstOrNull = <T,>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const chartColors = ['#0f172a', '#334155', '#64748b', '#94a3b8', '#cbd5e1', '#475569', '#1e293b'];

const formatLabel = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

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

const getAppliedDate = (app: ApplicationRecord) => app.date_applied || app.created_at;

const getWeekKey = (date: string) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const firstDay = new Date(year, 0, 1);
  const days = Math.floor((d.getTime() - firstDay.getTime()) / 86400000);
  const week = Math.ceil((days + firstDay.getDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
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

    const normalized: ApplicationRecord[] = ((data || []) as RawApplicationRecord[]).map(
      (app) => ({
        ...app,
        cv_versions: firstOrNull(app.cv_versions),
      })
    );

    setApplications(normalized);
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

    const interviews = applications.filter((app) =>
      ['interview', 'final_interview'].includes(app.status)
    ).length;

    const offers = applications.filter((app) => app.status === 'offer').length;
    const rejections = applications.filter((app) => app.status === 'rejected').length;
    const ghosted = applications.filter((app) => app.status === 'ghosted').length;

    const responseRate = total > 0 ? Math.round((responses / total) * 100) : 0;
    const interviewRate = total > 0 ? Math.round((interviews / total) * 100) : 0;
    const offerRate = total > 0 ? Math.round((offers / total) * 100) : 0;
    const rejectionRate = total > 0 ? Math.round((rejections / total) * 100) : 0;

    const responseTimes = applications
      .map((app) => getDaysBetween(getAppliedDate(app), app.response_received_at))
      .filter((value): value is number => value !== null);

    const interviewTimes = applications
      .map((app) => getDaysBetween(getAppliedDate(app), app.interview_started_at))
      .filter((value): value is number => value !== null);

    const offerTimes = applications
      .map((app) => getDaysBetween(getAppliedDate(app), app.offer_received_at))
      .filter((value): value is number => value !== null);

    const rejectionTimes = applications
      .map((app) => getDaysBetween(getAppliedDate(app), app.rejected_at))
      .filter((value): value is number => value !== null);

    const now = new Date();

    const followUpsDue = applications.filter((app) => {
      if (!app.follow_up_date) return false;
      if (['offer', 'rejected', 'withdrawn', 'archived'].includes(app.status)) return false;
      return new Date(app.follow_up_date) <= now;
    }).length;

    const sourceCounts = applications.reduce<
      Record<
        string,
        {
          applications: number;
          responses: number;
          interviews: number;
          offers: number;
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
        };
      }

      acc[source].applications += 1;

      if (
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
      ) {
        acc[source].responses += 1;
      }

      if (['interview', 'final_interview'].includes(app.status)) {
        acc[source].interviews += 1;
      }

      if (app.status === 'offer') {
        acc[source].offers += 1;
      }

      return acc;
    }, {});

    const sourceChartData = Object.entries(sourceCounts)
      .map(([source, stats]) => ({
        name: source,
        applications: stats.applications,
        responses: stats.responses,
        interviews: stats.interviews,
        offers: stats.offers,
        responseRate: Math.round((stats.responses / stats.applications) * 100),
        interviewRate: Math.round((stats.interviews / stats.applications) * 100),
      }))
      .sort((a, b) => b.applications - a.applications);

    const statusCounts = applications.reduce<Record<string, number>>((acc, app) => {
      const status = formatLabel(app.status);
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    const statusChartData = Object.entries(statusCounts)
      .map(([status, count]) => ({
        name: status,
        value: count,
      }))
      .sort((a, b) => b.value - a.value);

    const cvCounts = applications.reduce<
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

      if (
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
      ) {
        acc[cvName].responses += 1;
      }

      if (['interview', 'final_interview'].includes(app.status)) {
        acc[cvName].interviews += 1;
      }

      if (app.status === 'offer') acc[cvName].offers += 1;
      if (app.status === 'rejected') acc[cvName].rejections += 1;

      return acc;
    }, {});

    const cvPerformanceData = Object.entries(cvCounts)
      .map(([cv, stats]) => ({
        name: cv,
        applications: stats.total,
        responses: stats.responses,
        interviews: stats.interviews,
        offers: stats.offers,
        rejections: stats.rejections,
        responseRate: Math.round((stats.responses / stats.total) * 100),
        interviewRate: Math.round((stats.interviews / stats.total) * 100),
        offerRate: Math.round((stats.offers / stats.total) * 100),
      }))
      .sort((a, b) => b.interviewRate - a.interviewRate || b.applications - a.applications);

    const weeklyCounts = applications.reduce<
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

      if (app.response_received_at) acc[week].responses += 1;
      if (app.interview_started_at || app.final_interview_started_at) acc[week].interviews += 1;
      if (app.offer_received_at) acc[week].offers += 1;

      return acc;
    }, {});

    const weeklyTrendData = Object.values(weeklyCounts)
      .sort((a, b) => a.week.localeCompare(b.week))
      .slice(-8);

    const funnelData = [
      { stage: 'Applied', count: total },
      { stage: 'Response', count: responses },
      { stage: 'Interview', count: interviews },
      { stage: 'Offer', count: offers },
    ];

    const bestSource =
      sourceChartData.length > 0 ? sourceChartData[0].name : 'Not enough data';

    const bestCV =
      cvPerformanceData.length > 0 ? cvPerformanceData[0].name : 'Not enough data';

    const healthScore = Math.min(
      100,
      Math.round(
        responseRate * 0.3 +
          interviewRate * 0.35 +
          offerRate * 0.25 +
          Math.min(total, 30) * 0.5 -
          followUpsDue * 2
      )
    );

    return {
      total,
      responses,
      interviews,
      offers,
      rejections,
      ghosted,
      responseRate,
      interviewRate,
      offerRate,
      rejectionRate,
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
      healthScore: Math.max(0, healthScore),
    };
  }, [applications]);

  const insight = useMemo(() => {
    if (analytics.total === 0) {
      return 'Add applications first. Once data exists, this page will show real conversion, timing, and CV/source performance.';
    }

    if (analytics.followUpsDue > 0) {
      return `You have ${analytics.followUpsDue} follow-up(s) due. Clearing these should be your next priority.`;
    }

    if (analytics.offerRate > 0) {
      return 'You have offer conversion data. Compare the CV and source that produced your strongest outcomes.';
    }

    if (analytics.avgDaysToResponse > 14) {
      return 'Your average response time is high. Track follow-ups more aggressively after 7–10 days.';
    }

    if (analytics.interviewRate >= 20) {
      return 'Your interview conversion is healthy. Focus on interview preparation and recruiter follow-ups.';
    }

    if (analytics.responseRate < 25) {
      return 'Your response rate is low. Improve CV targeting, application quality, and source selection.';
    }

    return 'Your analytics are becoming useful. Keep updating statuses and lifecycle dates after every recruiter interaction.';
  }, [analytics]);

  if (loading) {
    return <AnalyticsSkeleton />;
  }

  return (
    <div className="w-full max-w-full overflow-hidden">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8">
        <div className="min-w-0">
          <h2 className="text-2xl sm:text-3xl font-bold mb-1 break-words">
            Analytics
          </h2>
          <p className="text-slate-500 text-sm sm:text-base break-words">
            Real job-search performance based on conversion, timing, CVs, sources, and follow-ups.
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
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 shrink-0">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-6 shadow-sm mb-6 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <Target size={22} />
          </div>

          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">
              Analytics Insight
            </p>
            <h3 className="text-lg font-semibold mb-1 break-words">
              Job Search Health Score: {analytics.healthScore}/100
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed break-words">
              {insight}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Response Rate" value={`${analytics.responseRate}%`} />
        <MetricCard label="Interview Rate" value={`${analytics.interviewRate}%`} />
        <MetricCard label="Offer Rate" value={`${analytics.offerRate}%`} />
        <MetricCard label="Rejection Rate" value={`${analytics.rejectionRate}%`} />
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Avg Days to Response" value={`${analytics.avgDaysToResponse}d`} icon={Clock} />
        <MetricCard label="Avg Days to Interview" value={`${analytics.avgDaysToInterview}d`} icon={TrendingUp} />
        <MetricCard label="Avg Days to Offer" value={`${analytics.avgDaysToOffer}d`} icon={Trophy} />
        <MetricCard label="Follow-ups Due" value={analytics.followUpsDue} icon={AlertCircle} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-8">
        <HighlightCard label="Best Source" value={analytics.bestSource} icon={BarChart3} />
        <HighlightCard label="Best CV" value={analytics.bestCV} icon={FileText} />
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
        <ChartCard
          title="Weekly Application Trend"
          description="Applications, responses, interviews, and offers by week."
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
          title="Pipeline Funnel"
          description="Conversion from application to offer."
          isEmpty={analytics.funnelData.length === 0}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={analytics.funnelData}>
              <XAxis dataKey="stage" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#0f172a" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Source Quality"
          description="Compare application sources by response and interview quality."
          isEmpty={analytics.sourceChartData.length === 0}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={analytics.sourceChartData}>
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="applications" fill="#94a3b8" radius={[8, 8, 0, 0]} />
              <Bar dataKey="responses" fill="#64748b" radius={[8, 8, 0, 0]} />
              <Bar dataKey="interviews" fill="#0f172a" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Applications by Status"
          description="Current status distribution."
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

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm xl:col-span-2 overflow-hidden">
          <h3 className="text-lg font-semibold mb-2">CV Performance</h3>
          <p className="text-sm text-slate-500 mb-4">
            Compare applications, responses, interviews, and offers by CV version.
          </p>

          {analytics.cvPerformanceData.length === 0 ? (
            <EmptyState
              title="No CV data yet"
              description="Attach CV versions to applications to compare performance."
            />
          ) : (
            <>
              <div className="h-[280px] sm:h-80 w-full overflow-hidden">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.cvPerformanceData}>
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

              <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
                {analytics.cvPerformanceData.slice(0, 3).map((cv) => (
                  <div
                    key={cv.name}
                    className="border border-slate-200 rounded-xl p-4 bg-slate-50 overflow-hidden"
                  >
                    <p className="font-semibold text-sm text-slate-900 break-words">
                      {cv.name}
                    </p>
                    <p className="text-xs text-slate-500 mt-1 break-words">
                      {cv.applications} apps · {cv.responseRate}% response ·{' '}
                      {cv.interviewRate}% interview · {cv.offerRate}% offer
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const MetricCard = ({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
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
  </div>
);

const HighlightCard = ({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
}) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm overflow-hidden">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-slate-500 break-words">{label}</p>
        <p className="text-lg sm:text-xl font-bold mt-2 break-words">{value}</p>
      </div>

      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
        <Icon size={19} className="text-slate-600" />
      </div>
    </div>
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

    <div className="h-28 bg-slate-200 rounded-2xl animate-pulse mb-6" />

    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="h-28 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm"
        >
          <div className="h-4 w-24 bg-slate-100 rounded animate-pulse mb-5" />
          <div className="h-8 w-16 bg-slate-200 rounded animate-pulse" />
        </div>
      ))}
    </div>
  </div>
);