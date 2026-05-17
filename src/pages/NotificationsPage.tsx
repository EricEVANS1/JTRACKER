import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  Clock,
  Inbox,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

/**
 * DEVELOPMENT NOTES — NOTIFICATIONS PAGE
 *
 * Added/improved:
 * 1. Database-backed notifications from public.notifications.
 * 2. Realtime notification refresh using Supabase postgres_changes.
 * 3. Unread/read support with Mark Read and Mark All Read.
 * 4. Shared opportunity notifications that open /shared-with-me.
 * 5. Smart job-search alerts retained from the previous version:
 *    follow-ups, inactive applications, interviews, assessments, offers.
 * 6. Filtering by All, Unread, Shared Opportunities, and Smart Alerts.
 * 7. Stats updated to include Unread database notifications.
 *
 * Important architecture note:
 * - Database notifications are persisted.
 * - Smart alerts are generated from application data and are not stored yet.
 */

type NotificationPriority = 'urgent' | 'today' | 'upcoming' | 'insight';
type NotificationSource = 'database' | 'smart';

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

interface DatabaseNotification {
  id: string;
  user_id: string;
  actor_user_id: string | null;
  type: string;
  title: string;
  message: string | null;
  related_shared_opportunity_id: string | null;
  related_application_id: string | null;
  read: boolean;
  created_at: string;
}

interface NotificationItem {
  id: string;
  title: string;
  description: string;
  priority: NotificationPriority;
  type: string;
  source: NotificationSource;
  read?: boolean;
  applicationId?: string | null;
  sharedOpportunityId?: string | null;
  company?: string;
  date?: string | null;
  createdAt?: string | null;
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

const getDatabaseNotificationPriority = (type: string): NotificationPriority => {
  if (type === 'shared_opportunity') return 'today';
  if (type.includes('urgent')) return 'urgent';
  if (type.includes('follow_up')) return 'today';
  return 'insight';
};

const inputCls =
  'w-full border border-slate-200 rounded-xl pl-10 pr-3 py-3 text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition';

export const NotificationsPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [applications, setApplications] = useState<Application[]>([]);
  const [databaseNotifications, setDatabaseNotifications] = useState<DatabaseNotification[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState('');
  const [markingAllRead, setMarkingAllRead] = useState(false);

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'smart' | 'shared'>('all');

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

  const fetchDatabaseNotifications = async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from('notifications')
      .select(`
        id,
        user_id,
        actor_user_id,
        type,
        title,
        message,
        related_shared_opportunity_id,
        related_application_id,
        read,
        created_at
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      setError(error.message);
      return;
    }

    setDatabaseNotifications(data || []);
  };

  const loadPage = async () => {
    setLoading(true);
    await Promise.all([fetchApplications(), fetchDatabaseNotifications()]);
    setLoading(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchApplications(), fetchDatabaseNotifications()]);
    setRefreshing(false);
  };

  useEffect(() => {
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`notifications-page-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchDatabaseNotifications();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const persistedNotifications = useMemo<NotificationItem[]>(() => {
    return databaseNotifications.map((notification) => ({
      id: notification.id,
      title: notification.title,
      description: notification.message || 'New activity in JTracker.',
      priority: getDatabaseNotificationPriority(notification.type),
      type: notification.type,
      source: 'database',
      read: notification.read,
      applicationId: notification.related_application_id,
      sharedOpportunityId: notification.related_shared_opportunity_id,
      date: notification.created_at,
      createdAt: notification.created_at,
    }));
  }, [databaseNotifications]);

  const smartNotifications = useMemo<NotificationItem[]>(() => {
    const now = new Date();
    const items: NotificationItem[] = [];

    applications.forEach((app) => {
      const company = app.companies?.name || 'Unknown Company';
      const inactiveDays = getDaysSince(
        app.last_status_changed_at || app.date_applied || app.created_at
      );

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
            source: 'smart',
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
            source: 'smart',
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
            source: 'smart',
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
          source: 'smart',
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
          source: 'smart',
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
          source: 'smart',
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
          source: 'smart',
          applicationId: app.id,
          company,
          date: app.last_status_changed_at,
        });
      }
    });

    return items;
  }, [applications]);

  const notifications = useMemo(() => {
    return [...persistedNotifications, ...smartNotifications].sort((a, b) => {
      const priorityOrder: Record<NotificationPriority, number> = {
        urgent: 0,
        today: 1,
        upcoming: 2,
        insight: 3,
      };

      const priorityDifference = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDifference !== 0) return priorityDifference;

      const aDate = new Date(a.date || a.createdAt || 0).getTime();
      const bDate = new Date(b.date || b.createdAt || 0).getTime();

      return bDate - aDate;
    });
  }, [persistedNotifications, smartNotifications]);

  const filteredNotifications = useMemo(() => {
    const term = search.toLowerCase();

    return notifications.filter((item) => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'unread' && item.source === 'database' && !item.read) ||
        (filter === 'smart' && item.source === 'smart') ||
        (filter === 'shared' && item.type === 'shared_opportunity');

      if (!matchesFilter) return false;

      if (!term.trim()) return true;

      return (
        item.title.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term) ||
        item.company?.toLowerCase().includes(term) ||
        item.type.toLowerCase().includes(term)
      );
    });
  }, [notifications, search, filter]);

  const stats = useMemo(() => {
    return {
      urgent: notifications.filter((item) => item.priority === 'urgent').length,
      today: notifications.filter((item) => item.priority === 'today').length,
      upcoming: notifications.filter((item) => item.priority === 'upcoming').length,
      unread: databaseNotifications.filter((item) => !item.read).length,
    };
  }, [notifications, databaseNotifications]);

  const handleMarkNotificationRead = async (notificationId: string) => {
    if (!user) return;

    setUpdatingId(notificationId);
    setError('');
    setMessage('');

    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)
      .eq('user_id', user.id);

    if (error) {
      setError(error.message);
      setUpdatingId('');
      return;
    }

    setDatabaseNotifications((prev) =>
      prev.map((item) => (item.id === notificationId ? { ...item, read: true } : item))
    );

    setMessage('Notification marked as read.');
    setUpdatingId('');
  };

  const handleMarkAllRead = async () => {
    if (!user) return;

    setMarkingAllRead(true);
    setError('');
    setMessage('');

    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false);

    if (error) {
      setError(error.message);
      setMarkingAllRead(false);
      return;
    }

    setDatabaseNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
    setMessage('All notifications marked as read.');
    setMarkingAllRead(false);
  };

  const handleOpenNotification = async (notification: NotificationItem) => {
    if (notification.source === 'database' && !notification.read) {
      await handleMarkNotificationRead(notification.id);
    }

    if (notification.type === 'shared_opportunity') {
      navigate('/shared-with-me');
      return;
    }

    if (notification.applicationId) {
      navigate(`/applications/${notification.applicationId}`);
    }
  };

  const handleMarkFollowUpDone = async (applicationId?: string | null) => {
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
            Real alerts from collaboration events and job-search intelligence, including shared opportunities,
            follow-ups, inactive applications, interviews, assessments, and offers.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Urgent" value={stats.urgent} tone="danger" />
          <StatCard label="Today" value={stats.today} tone="warning" />
          <StatCard label="Upcoming" value={stats.upcoming} tone="neutral" />
          <StatCard label="Unread" value={stats.unread} tone="muted" />
        </div>
      </div>

      {error && <AlertBox type="error" message={error} onClose={() => setError('')} />}
      {message && (
        <AlertBox type="success" message={message} onClose={() => setMessage('')} />
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 mb-6">
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_180px_140px_150px] gap-3">
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

          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="border border-slate-200 rounded-xl px-3 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <option value="all">All notifications</option>
            <option value="unread">Unread only</option>
            <option value="shared">Shared opportunities</option>
            <option value="smart">Smart alerts</option>
          </select>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>

          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={markingAllRead || stats.unread === 0}
            className="bg-slate-900 text-white rounded-xl px-4 py-3 text-sm hover:bg-slate-700 transition disabled:opacity-50"
          >
            {markingAllRead ? 'Saving...' : 'Mark all read'}
          </button>
        </div>
      </div>

      {filteredNotifications.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <CheckCircle2 size={38} className="mx-auto text-emerald-400 mb-3" />
          <h3 className="text-lg font-semibold">No active notifications</h3>
          <p className="text-slate-500 mt-2">
            You are clear for now. New alerts will appear when collaboration events or job-search actions need attention.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredNotifications.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              updating={updatingId === notification.id || updatingId === notification.applicationId}
              onOpen={handleOpenNotification}
              onMarkRead={handleMarkNotificationRead}
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
  onOpen,
  onMarkRead,
  onMarkFollowUpDone,
}: {
  notification: NotificationItem;
  updating: boolean;
  onOpen: (notification: NotificationItem) => void;
  onMarkRead: (notificationId: string) => void;
  onMarkFollowUpDone: (applicationId?: string | null) => void;
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

  const isUnreadDatabaseNotification =
    notification.source === 'database' && notification.read === false;

  return (
    <div className={`border rounded-2xl shadow-sm p-5 ${config.card}`}>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
        <div className="flex items-start gap-4">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${config.iconBox}`}>
            {notification.type === 'shared_opportunity' ? <Inbox size={21} /> : <Icon size={21} />}
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h3 className="font-semibold text-slate-900">{notification.title}</h3>

              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${config.badge}`}>
                {formatStatus(notification.priority)}
              </span>

              <span className="rounded-full px-2.5 py-1 text-xs font-medium bg-white border border-slate-200 text-slate-600">
                {notification.source === 'database' ? 'Event' : 'Smart Alert'}
              </span>

              {isUnreadDatabaseNotification && (
                <span className="rounded-full px-2.5 py-1 text-xs font-medium bg-slate-900 text-white">
                  Unread
                </span>
              )}
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
          {(notification.applicationId || notification.type === 'shared_opportunity') && (
            <button
              type="button"
              onClick={() => onOpen(notification)}
              className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm inline-flex items-center gap-2"
            >
              {notification.type === 'shared_opportunity' ? (
                <>
                  <Inbox size={15} />
                  Open Shared
                </>
              ) : (
                <>
                  <Briefcase size={15} />
                  Open Application
                </>
              )}
            </button>
          )}

          {isUnreadDatabaseNotification && (
            <button
              type="button"
              disabled={updating}
              onClick={() => onMarkRead(notification.id)}
              className="border border-slate-300 bg-white text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 transition disabled:opacity-50"
            >
              {updating ? 'Saving...' : 'Mark Read'}
            </button>
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
