import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Archive,
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  Clock3,
  Columns3,
  FileText,
  Inbox,
  LayoutDashboard,
  Mail,
  Settings,
  Users,
  Users2,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { FEATURES } from '../config/features';
import { supabase } from '../lib/supabase';

export const AppLayout: React.FC = () => {
  const { user, signOut } = useAuth();

  const [sharedCount, setSharedCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);

  useEffect(() => {
    if (!user) return;

    const fetchSharedCount = async () => {
      const { count, error } = await supabase
        .from('shared_opportunities')
        .select('*', { count: 'exact', head: true })
        .eq('recipient_user_id', user.id)
        .is('added_application_id', null);

      if (!error) {
        setSharedCount(count || 0);
      }
    };

    const fetchNotificationCount = async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false);

      if (!error) {
        setNotificationCount(count || 0);
      }
    };

    fetchSharedCount();
    fetchNotificationCount();

    const sharedChannel = supabase
      .channel(`shared-opportunities-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shared_opportunities',
          filter: `recipient_user_id=eq.${user.id}`,
        },
        fetchSharedCount
      )
      .subscribe();

    const notificationsChannel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        fetchNotificationCount
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sharedChannel);
      supabase.removeChannel(notificationsChannel);
    };
  }, [user]);

  const navItems = useMemo(
    () => [
      { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, enabled: true },
      { label: 'Applications', path: '/applications', icon: Briefcase, enabled: true },
      { label: 'Follow-Ups', path: '/follow-ups', icon: Clock3, enabled: true },
      { label: 'Archived', path: '/archived-applications', icon: Archive, enabled: true },
      { label: 'Companies', path: '/companies', icon: Building2, enabled: true },
      { label: 'Analytics', path: '/analytics', icon: BarChart3, enabled: true },
      { label: 'CV Manager', path: '/cv-manager', icon: FileText, enabled: true },

      {
        label: 'Gmail Sync',
        path: '/gmail-sync',
        icon: Mail,
        enabled: FEATURES.GMAIL_SYNC,
        badge: 'Paused',
      },

      {
        label: 'Email Events',
        path: '/email-events',
        icon: Inbox,
        enabled: FEATURES.EMAIL_EVENTS,
        badge: 'Paused',
      },

      {
        label: 'Notifications',
        path: '/notifications',
        icon: Bell,
        enabled: true,
        badge: notificationCount > 0 ? String(notificationCount) : undefined,
      },

      {
        label: 'Shared With Me',
        path: '/shared-with-me',
        icon: Users2,
        enabled: true,
        badge: sharedCount > 0 ? String(sharedCount) : undefined,
      },

      { label: 'Recruiters', path: '/recruiters', icon: Users, enabled: true },
      { label: 'Kanban', path: '/kanban', icon: Columns3, enabled: true },
      { label: 'Settings', path: '/settings', icon: Settings, enabled: true },
    ],
    [sharedCount, notificationCount]
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      <aside className="w-64 bg-white border-r border-slate-200 p-5 flex flex-col">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">JTracker</h1>
          <p className="text-sm text-slate-500">Track every opportunity</p>
        </div>

        <nav className="space-y-2 flex-1">
          {navItems.map((item) => {
            const Icon = item.icon;

            if (!item.enabled) {
              return (
                <div
                  key={item.path}
                  title={`${item.label} is paused for upgrades`}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 cursor-not-allowed opacity-60"
                >
                  <div className="flex items-center gap-3">
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </div>

                  {item.badge && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                      {item.badge}
                    </span>
                  )}
                </div>
              );
            }

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <div className="flex items-center gap-3">
                      <Icon size={18} />
                      <span>{item.label}</span>
                    </div>

                    {item.badge && (
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full ${
                          item.badge === 'Paused'
                            ? 'bg-slate-100 text-slate-500'
                            : isActive
                              ? 'bg-white text-slate-900'
                              : 'bg-slate-900 text-white'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 pt-4">
          <p className="text-xs text-slate-500 truncate mb-3">{user?.email}</p>

          <button
            onClick={signOut}
            className="w-full bg-slate-900 text-white rounded-lg px-3 py-2 text-sm hover:bg-slate-700 transition"
          >
            Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
};