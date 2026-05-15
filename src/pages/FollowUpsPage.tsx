import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Mail,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface CompanyJoin {
  name: string;
}

interface RawApplicationItem {
  id: string;
  role_title: string;
  status: string;
  updated_at?: string | null;
  created_at?: string | null;
  last_status_changed_at?: string | null;
  follow_up_date?: string | null;
  companies?: CompanyJoin | CompanyJoin[] | null;
}

interface ApplicationItem extends Omit<RawApplicationItem, 'companies'> {
  companies: CompanyJoin | null;
}

type FollowUpGroup = 'overdue' | 'today' | 'upcoming' | 'missing';

const firstOrNull = <T,>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const inputCls =
  'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition';

const formatStatus = (status: string) =>
  status.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

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

const getFollowUpGroup = (followUpDate?: string | null): FollowUpGroup => {
  if (!followUpDate) return 'missing';

  const now = new Date();
  const target = new Date(followUpDate);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  if (target < todayStart) return 'overdue';
  if (target >= todayStart && target <= todayEnd) return 'today';

  return 'upcoming';
};

const getGroupPriority = (group: FollowUpGroup) => {
  if (group === 'overdue') return 0;
  if (group === 'today') return 1;
  if (group === 'upcoming') return 2;
  return 3;
};

export const FollowUpsPage: React.FC = () => {
  const { user } = useAuth();

  const [applications, setApplications] = useState<ApplicationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<'all' | FollowUpGroup>('all');

  const fetchApplications = async () => {
    if (!user) return;

    setError('');

    const { data, error } = await supabase
      .from('applications')
      .select(`
        id,
        role_title,
        status,
        updated_at,
        created_at,
        last_status_changed_at,
        follow_up_date,
        companies (
          name
        )
      `)
      .eq('user_id', user.id)
      .not('status', 'in', '("rejected","offer","archived","withdrawn")')
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
  }, [user]);

  const followUps = useMemo(() => {
    return applications
      .map((app) => {
        const group = getFollowUpGroup(app.follow_up_date);
        const lastActivity = app.last_status_changed_at || app.updated_at || app.created_at;
        const daysSinceActivity = getDaysSince(lastActivity);

        return {
          ...app,
          group,
          lastActivity,
          daysSinceActivity,
        };
      })
      .filter((app) => {
        const term = search.toLowerCase();

        const matchesSearch =
          !search.trim() ||
          app.role_title.toLowerCase().includes(term) ||
          app.companies?.name.toLowerCase().includes(term) ||
          app.status.toLowerCase().includes(term);

        const matchesGroup = groupFilter === 'all' || app.group === groupFilter;

        return matchesSearch && matchesGroup;
      })
      .sort((a, b) => {
        const groupDiff = getGroupPriority(a.group) - getGroupPriority(b.group);
        if (groupDiff !== 0) return groupDiff;

        const aDate = a.follow_up_date ? new Date(a.follow_up_date).getTime() : Infinity;
        const bDate = b.follow_up_date ? new Date(b.follow_up_date).getTime() : Infinity;

        return aDate - bDate;
      });
  }, [applications, search, groupFilter]);

  const stats = useMemo(() => {
    return {
      overdue: applications.filter((app) => getFollowUpGroup(app.follow_up_date) === 'overdue')
        .length,
      today: applications.filter((app) => getFollowUpGroup(app.follow_up_date) === 'today')
        .length,
      upcoming: applications.filter((app) => getFollowUpGroup(app.follow_up_date) === 'upcoming')
        .length,
      missing: applications.filter((app) => getFollowUpGroup(app.follow_up_date) === 'missing')
        .length,
    };
  }, [applications]);

  const handleSetFollowUp = async (applicationId: string, value: string) => {
    if (!user) return;

    setSavingId(applicationId);
    setError('');
    setMessage('');

    const followUpDate = value ? new Date(value).toISOString() : null;

    const { error } = await supabase
      .from('applications')
      .update({
        follow_up_date: followUpDate,
      })
      .eq('id', applicationId)
      .eq('user_id', user.id);

    if (error) {
      setError(error.message);
      setSavingId(null);
      return;
    }

    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: applicationId,
      event_type: 'follow_up_scheduled',
      title: followUpDate ? 'Follow-up scheduled' : 'Follow-up cleared',
      description: followUpDate
        ? `Follow-up scheduled for ${formatDateTime(followUpDate)}.`
        : 'Follow-up date was cleared.',
      event_date: new Date().toISOString(),
    });

    setApplications((prev) =>
      prev.map((app) =>
        app.id === applicationId
          ? {
              ...app,
              follow_up_date: followUpDate,
            }
          : app
      )
    );

    setMessage(followUpDate ? 'Follow-up date updated.' : 'Follow-up cleared.');
    setSavingId(null);
  };

  const handleMarkDone = async (app: ApplicationItem) => {
    if (!user) return;

    setSavingId(app.id);
    setError('');
    setMessage('');

    const { error } = await supabase
      .from('applications')
      .update({
        follow_up_date: null,
      })
      .eq('id', app.id)
      .eq('user_id', user.id);

    if (error) {
      setError(error.message);
      setSavingId(null);
      return;
    }

    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: app.id,
      event_type: 'follow_up_completed',
      title: 'Follow-up completed',
      description: `Follow-up completed for ${app.role_title}.`,
      event_date: new Date().toISOString(),
    });

    setApplications((prev) =>
      prev.map((item) =>
        item.id === app.id
          ? {
              ...item,
              follow_up_date: null,
            }
          : item
      )
    );

    setMessage('Follow-up marked as completed.');
    setSavingId(null);
  };

  if (loading) {
    return <FollowUpsSkeleton />;
  }

  return (
    <div>
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Clock3 className="text-slate-700" size={30} />
            <h1 className="text-3xl font-bold">Follow-Ups</h1>
          </div>

          <p className="text-slate-500 text-sm">
            Manage overdue, due today, upcoming, and missing follow-up dates.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="self-start lg:self-auto border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 transition disabled:opacity-50 inline-flex items-center gap-2"
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && <AlertBox type="error" message={error} onClose={() => setError('')} />}
      {message && (
        <AlertBox type="success" message={message} onClose={() => setMessage('')} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Overdue" value={stats.overdue} tone="danger" />
        <StatCard label="Due Today" value={stats.today} tone="warning" />
        <StatCard label="Upcoming" value={stats.upcoming} tone="neutral" />
        <StatCard label="No Date Set" value={stats.missing} tone="muted" />
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-3">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search role, company, or status..."
              className={`${inputCls} pl-9`}
            />
          </div>

          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value as 'all' | FollowUpGroup)}
            className={inputCls}
          >
            <option value="all">All follow-ups</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="upcoming">Upcoming</option>
            <option value="missing">No date set</option>
          </select>
        </div>
      </div>

      {followUps.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center shadow-sm">
          <CheckCircle2 size={34} className="mx-auto text-emerald-400 mb-3" />
          <h3 className="text-lg font-semibold mb-1">No follow-ups found</h3>
          <p className="text-slate-500 text-sm">
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
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FollowUpCard = ({
  app,
  saving,
  onSetFollowUp,
  onMarkDone,
}: {
  app: ApplicationItem & {
    group: FollowUpGroup;
    lastActivity?: string | null;
    daysSinceActivity: number;
  };
  saving: boolean;
  onSetFollowUp: (applicationId: string, value: string) => void;
  onMarkDone: (app: ApplicationItem) => void;
}) => {
  const groupStyle = {
    overdue: 'bg-red-50 text-red-700 border-red-200',
    today: 'bg-amber-50 text-amber-700 border-amber-200',
    upcoming: 'bg-blue-50 text-blue-700 border-blue-200',
    missing: 'bg-slate-50 text-slate-600 border-slate-200',
  }[app.group];

  const groupLabel = {
    overdue: 'Overdue',
    today: 'Due Today',
    upcoming: 'Upcoming',
    missing: 'No Date Set',
  }[app.group];

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition">
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-5">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
              <Mail size={18} className="text-slate-600" />
            </div>

            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-950 truncate">
                {app.role_title}
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
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

                {app.daysSinceActivity >= 21 && (
                  <span className="bg-zinc-100 text-zinc-700 px-2.5 py-1 rounded-full text-xs font-medium">
                    Possibly Ghosted
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
            <Meta label="Follow-up Date" value={formatDateTime(app.follow_up_date)} />
            <Meta label="Last Activity" value={formatDateTime(app.lastActivity)} />
            <Meta label="Days Since Activity" value={`${app.daysSinceActivity} days`} />
          </div>
        </div>

        <div className="xl:min-w-[280px] space-y-3">
          <label>
            <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Set Follow-up
            </span>
            <input
              type="datetime-local"
              defaultValue={toDateTimeLocal(app.follow_up_date)}
              disabled={saving}
              onBlur={(e) => onSetFollowUp(app.id, e.target.value)}
              className={inputCls}
            />
          </label>

          <button
            type="button"
            disabled={saving}
            onClick={() => onMarkDone(app)}
            className="w-full bg-slate-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-700 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <CheckCircle2 size={15} />
            {saving ? 'Saving...' : 'Mark Follow-up Done'}
          </button>
        </div>
      </div>
    </div>
  );
};

const AlertBox = ({
  type,
  message,
  onClose,
}: {
  type: 'error' | 'success';
  message: string;
  onClose: () => void;
}) => (
  <div
    className={`rounded-xl p-4 mb-6 flex items-start gap-3 border ${
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
    <span className="text-sm flex-1">{message}</span>
    <button onClick={onClose} className="opacity-70 hover:opacity-100">
      <X size={16} />
    </button>
  </div>
);

const StatCard = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'danger' | 'warning' | 'neutral' | 'muted';
}) => {
  const toneClass = {
    danger: 'bg-red-50 border-red-200 text-red-700',
    warning: 'bg-amber-50 border-amber-200 text-amber-700',
    neutral: 'bg-blue-50 border-blue-200 text-blue-700',
    muted: 'bg-white border-slate-200 text-slate-900',
  }[tone];

  return (
    <div className={`border rounded-2xl p-5 shadow-sm ${toneClass}`}>
      <p className="text-sm opacity-80">{label}</p>
      <p className="text-3xl font-bold mt-3">{value}</p>
    </div>
  );
};

const Meta = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
    <p className="text-[11px] text-slate-400">{label}</p>
    <p className="text-sm font-medium text-slate-700 truncate">{value}</p>
  </div>
);

const FollowUpsSkeleton = () => (
  <div>
    <div className="mb-8">
      <div className="h-8 w-52 bg-slate-200 rounded-lg animate-pulse mb-2" />
      <div className="h-4 w-96 bg-slate-100 rounded-lg animate-pulse" />
    </div>

    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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