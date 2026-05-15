import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  Clock,
  Mail,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

type NotificationPriority = 'urgent' | 'today' | 'upcoming' | 'insight';

interface CompanyJoin {
  name: string;
}

interface RawApplication {
  id: string;
  role_title: string;
  status: string;
  follow_up_date: string | null;
  last_status_changed_at: string | null;
  date_applied: string | null;
  created_at: string;
  priority?: string | null;
  companies?: CompanyJoin | CompanyJoin[] | null;
}

interface Application {
  id: string;
  role_title: string;
  status: string;
  follow_up_date: string | null;
  last_status_changed_at: string | null;
  date_applied: string | null;
  created_at: string;
  priority?: string | null;
  companies: CompanyJoin | null;
}

interface NotificationItem {
  id: string;
  title: string;
  description: string;
  priority: NotificationPriority;
  type: string;
  applicationId?: string;
  company?: string;
  date?: string | null;
}

const firstOrNull = <T,>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

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

const getDaysSince = (date?: string | null) => {
  if (!date) return 999;

  const now = new Date().getTime();
  const target = new Date(date).getTime();

  return Math.floor((now - target) / (1000 * 60 * 60 * 24));
};

const inputCls =
  'w-full border border-slate-200 rounded-xl pl-10 pr-3 py-3 text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition';

export const NotificationsPage: React.FC = () => {
  const { user } = useAuth();

  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');

  const fetchApplications = async () => {
    if (!user) return;

    setError('');

    const { data, error } = await supabase
      .from('applications')
      .select(`
        id,
        role_title,
        status,
        follow_up_date,
        last_status_changed_at,
        date_applied,
        created_at,
        priority,
        companies (
          name
        )
      `)
      .eq('user_id', user.id)
      .eq('archived', false)
      .order('follow_up_date', { ascending: true, nullsFirst: false });

    if (error) {
      setError(error.message);
      return;
    }

    const normalized: Application[] = ((data || []) as RawApplication[]).map((app) => ({
      ...app,
      companies: firstOrNull(app.companies),
    }));

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

  const notifications = useMemo(() => {
    const now = new Date();

    const items: NotificationItem[] = [];

    applications.forEach((app) => {
      const company = app.companies?.name || 'Unknown Company';
      const inactiveDays = getDaysSince(app.last_status_changed_at || app.date_applied || app.created_at);

      if (app.follow_up_date) {
        const followUpDate = new Date(app.follow_up_date);

        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);

        const todayEnd = new Date(now);
        todayEnd.setHours(23, 59, 59, 999);

        if (followUpDate < todayStart) {
          items.push({
            id: `overdue-${app.id}`,
            title: 'Follow-up overdue',
            description: `${app.role_title} at ${company} needs a follow-up. It was due on ${formatDateTime(app.follow_up_date)}.`,
            priority: 'urgent',
            type: 'follow_up_overdue',
            applicationId: app.id,
            company,
            date: app.follow_up_date,
          });
        } else if (followUpDate >= todayStart && followUpDate <= todayEnd) {
          items.push({
            id: `today-${app.id}`,
            title: 'Follow-up due today',
            description: `${app.role_title} at ${company} has a follow-up scheduled for today.`,
            priority: 'today',
            type: 'follow_up_today',
            applicationId: app.id,
            company,
            date: app.follow_up_date,
          });
        } else {
          items.push({
            id: `upcoming-${app.id}`,
            title: 'Upcoming follow-up',
            description: `${app.role_title} at ${company} has a follow-up scheduled for ${formatDateTime(app.follow_up_date)}.`,
            priority: 'upcoming',
            type: 'follow_up_upcoming',
            applicationId: app.id,
            company,
            date: app.follow_up_date,
          });
        }
      }

      if (
        inactiveDays >= 14 &&
        !['offer', 'rejected', 'withdrawn', 'ghosted'].includes(app.status)
      ) {
        items.push({
          id: `inactive-${app.id}`,
          title: inactiveDays >= 21 ? 'Possible ghosted application' : 'No activity recently',
          description: `${app.role_title} at ${company} has had no status change for ${inactiveDays} days.`,
          priority: inactiveDays >= 21 ? 'urgent' : 'insight',
          type: inactiveDays >= 21 ? 'possible_ghosted' : 'inactive_application',
          applicationId: app.id,
          company,
          date: app.last_status_changed_at || app.date_applied || app.created_at,
        });
      }

      if (['interview', 'final_interview'].includes(app.status)) {
        items.push({
          id: `interview-${app.id}`,
          title: 'Interview preparation needed',
          description: `${app.role_title} at ${company} is in ${formatStatus(app.status)} stage. Prepare questions and notes.`,
          priority: 'today',
          type: 'interview_prep',
          applicationId: app.id,
          company,
          date: app.last_status_changed_at,
        });
      }

      if (app.status === 'assessment') {
        items.push({
          id: `assessment-${app.id}`,
          title: 'Assessment pending',
          description: `${app.role_title} at ${company} is in assessment stage. Track deadline and completion.`,
          priority: 'today',
          type: 'assessment_pending',
          applicationId: app.id,
          company,
          date: app.last_status_changed_at,
        });
      }

      if (app.status === 'offer') {
        items.push({
          id: `offer-${app.id}`,
          title: 'Offer needs attention',
          description: `${app.role_title} at ${company} has an offer. Review compensation, deadlines, and next steps.`,
          priority: 'urgent',
          type: 'offer_action',
          applicationId: app.id,
          company,
          date: app.last_status_changed_at,
        });
      }
    });

    return items;
  }, [applications]);

  const filteredNotifications = useMemo(() => {
    const term = search.toLowerCase();

    return notifications.filter((item) => {
      if (!term.trim()) return true;

      return (
        item.title.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term) ||
        item.company?.toLowerCase().includes(term) ||
        item.type.toLowerCase().includes(term)
      );
    });
  }, [notifications, search]);

  const stats = useMemo(() => {
    return {
      urgent: notifications.filter((item) => item.priority === 'urgent').length,
      today: notifications.filter((item) => item.priority === 'today').length,
      upcoming: notifications.filter((item) => item.priority === 'upcoming').length,
      insight: notifications.filter((item) => item.priority === 'insight').length,
    };
  }, [notifications]);

  const handleMarkFollowUpDone = async (applicationId?: string) => {
    if (!user || !applicationId) return;

    setUpdatingId(applicationId);
    setError('');
    setMessage('');

    const { error } = await supabase
      .from('applications')
      .update({
        follow_up_date: null,
      })
      .eq('id', applicationId)
      .eq('user_id', user.id);

    if (error) {
      setError(error.message);
      setUpdatingId('');
      return;
    }

    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: applicationId,
      event_type: 'notification_completed',
      title: 'Notification completed',
      description: 'Follow-up reminder was marked as done from Notifications.',
      event_date: new Date().toISOString(),
    });

    setMessage('Follow-up marked as done.');
    await fetchApplications();
    setUpdatingId('');
  };

  if (loading) {
    return <NotificationsSkeleton />;
  }

  return (
    <div>
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Bell size={30} className="text-slate-700" />
            <h2 className="text-3xl font-bold">Notifications</h2>
          </div>

          <p className="text-slate-500 max-w-2xl">
            Real job-search alerts based on follow-ups, inactive applications, interview stages, assessments, and offers.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Urgent" value={stats.urgent} tone="danger" />
          <StatCard label="Today" value={stats.today} tone="warning" />
          <StatCard label="Upcoming" value={stats.upcoming} tone="neutral" />
          <StatCard label="Insights" value={stats.insight} tone="muted" />
        </div>
      </div>

      {error && <AlertBox type="error" message={error} onClose={() => setError('')} />}
      {message && (
        <AlertBox type="success" message={message} onClose={() => setMessage('')} />
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_140px] gap-3">
          <div className="relative">
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notifications, company, role, or type..."
              className={inputCls}
            />
          </div>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {filteredNotifications.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <CheckCircle2 size={38} className="mx-auto text-emerald-400 mb-3" />
          <h3 className="text-lg font-semibold">No active notifications</h3>
          <p className="text-slate-500 mt-2">
            You are clear for now. New alerts will appear when follow-ups, interviews, assessments, or inactive applications need attention.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredNotifications.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              updating={updatingId === notification.applicationId}
              onMarkFollowUpDone={handleMarkFollowUpDone}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const NotificationCard = ({
  notification,
  updating,
  onMarkFollowUpDone,
}: {
  notification: NotificationItem;
  updating: boolean;
  onMarkFollowUpDone: (applicationId?: string) => void;
}) => {
  const config = {
    urgent: {
      icon: AlertCircle,
      card: 'border-red-200 bg-red-50',
      iconBox: 'bg-red-100 text-red-700',
      badge: 'bg-red-100 text-red-700',
    },
    today: {
      icon: CalendarClock,
      card: 'border-amber-200 bg-amber-50',
      iconBox: 'bg-amber-100 text-amber-700',
      badge: 'bg-amber-100 text-amber-700',
    },
    upcoming: {
      icon: Clock,
      card: 'border-blue-200 bg-blue-50',
      iconBox: 'bg-blue-100 text-blue-700',
      badge: 'bg-blue-100 text-blue-700',
    },
    insight: {
      icon: Sparkles,
      card: 'border-slate-200 bg-white',
      iconBox: 'bg-slate-100 text-slate-700',
      badge: 'bg-slate-100 text-slate-700',
    },
  }[notification.priority];

  const Icon = config.icon;

  const isFollowUp =
    notification.type === 'follow_up_overdue' ||
    notification.type === 'follow_up_today' ||
    notification.type === 'follow_up_upcoming';

  return (
    <div className={`border rounded-2xl shadow-sm p-5 ${config.card}`}>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
        <div className="flex items-start gap-4">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${config.iconBox}`}>
            <Icon size={21} />
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h3 className="font-semibold text-slate-900">{notification.title}</h3>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${config.badge}`}>
                {formatStatus(notification.priority)}
              </span>
            </div>

            <p className="text-sm text-slate-600 leading-relaxed">
              {notification.description}
            </p>

            {notification.date && (
              <p className="text-xs text-slate-500 mt-2">
                Related date: {formatDateTime(notification.date)}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          {notification.applicationId && (
            <Link
              to={`/applications/${notification.applicationId}`}
              className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm inline-flex items-center gap-2"
            >
              <Briefcase size={15} />
              Open Application
            </Link>
          )}

          {isFollowUp && (
            <button
              type="button"
              disabled={updating}
              onClick={() => onMarkFollowUpDone(notification.applicationId)}
              className="border border-slate-300 bg-white text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 transition disabled:opacity-50"
            >
              {updating ? 'Saving...' : 'Mark Done'}
            </button>
          )}
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
    <div className={`border rounded-xl px-4 py-3 min-w-[105px] shadow-sm ${toneClass}`}>
      <p className="text-xs opacity-80">{label}</p>
      <p className="text-xl font-bold mt-1">{value}</p>
    </div>
  );
};

const NotificationsSkeleton = () => (
  <div>
    <div className="mb-8">
      <div className="h-8 w-56 bg-slate-200 rounded-lg animate-pulse mb-2" />
      <div className="h-4 w-96 bg-slate-100 rounded-lg animate-pulse" />
    </div>

    <div className="h-16 bg-white border border-slate-200 rounded-2xl animate-pulse mb-6" />

    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="h-32 bg-white border border-slate-200 rounded-2xl animate-pulse"
        />
      ))}
    </div>
  </div>
);