import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Download, Menu, X } from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { ErrorBoundary } from './ErrorBoundary';
import { OfferCelebration } from './OfferCelebration';
import { supabase } from '../lib/supabase';
import { useTheme, type ThemePreference } from '../lib/theme';
import {
  AnalyticsIcon,
  ApplicationsIcon,
  ArchiveIcon,
  BoardIcon,
  CompaniesIcon,
  CvTrackingIcon,
  DashboardIcon,
  FollowUpsIcon,
  InterviewsIcon,
  JTrackerLogo,
  MoonIcon,
  OffersIcon,
  RecruitersIcon,
  ResumeIcon,
  SearchIcon,
  SettingsIcon,
  ShareIcon,
  SunIcon,
  SystemThemeIcon,
  type JTrackerIcon,
} from './icons/JTrackerIcons';

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: JTrackerIcon }[] = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: SystemThemeIcon },
];

// Light / Dark / follow the system, kept on this device.
const ThemeSwitch: React.FC = () => {
  const { preference, setPreference } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#1E2740]">
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          onClick={() => setPreference(value)}
          title={value === 'system' ? 'Match your device' : `${label} theme`}
          className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
            preference === value
              ? 'bg-white text-slate-900 shadow-sm dark:bg-[#273357] dark:text-[#F9FAFF]'
              : 'text-slate-600 hover:text-slate-900 dark:hover:text-[#F9FAFF]'
          }`}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  );
};

export const AppLayout: React.FC<{ onInstall?: () => void }> = ({ onInstall }) => {
  const { user, signOut } = useAuth();
  const location = useLocation();

  const [sharedCount, setSharedCount] = useState(0);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    if (!user) return;

    const fetchSharedCount = async () => {
      const { count, error } = await supabase
        .from('shared_opportunities')
        .select('*', { count: 'exact', head: true })
        .eq('recipient_user_id', user.id);

      if (!error) {
        setSharedCount(count || 0);
      }
    };

    fetchSharedCount();

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

    return () => {
      supabase.removeChannel(sharedChannel);
    };
  }, [user]);

  const navItems = useMemo(
    () => [
      {
        label: 'Dashboard',
        path: '/dashboard',
        icon: DashboardIcon,
        enabled: true,
      },
      {
        label: 'Job Automation',
        path: '/job-automation',
        icon: SearchIcon,
        enabled: true,
      },
      {
        label: 'Applications',
        path: '/applications',
        icon: ApplicationsIcon,
        enabled: true,
      },
      {
        label: 'Follow-Ups',
        path: '/follow-ups',
        icon: FollowUpsIcon,
        enabled: true,
      },
      {
        label: 'Interviews',
        path: '/interviews',
        icon: InterviewsIcon,
        enabled: true,
      },
      {
        label: 'Offers',
        path: '/offers',
        icon: OffersIcon,
        enabled: true,
      },
      {
        label: 'Archived',
        path: '/archived-applications',
        icon: ArchiveIcon,
        enabled: true,
      },
      {
        label: 'Companies',
        path: '/companies',
        icon: CompaniesIcon,
        enabled: true,
      },
      {
        label: 'Analytics',
        path: '/analytics',
        icon: AnalyticsIcon,
        enabled: true,
      },
      {
        label: 'CV Manager',
        path: '/cv-manager',
        icon: CvTrackingIcon,
        enabled: true,
      },
      {
        label: 'Resume Builder',
        path: '/resume-builder',
        icon: ResumeIcon,
        enabled: true,
      },
      {
        label: 'Shared Opportunities',
        path: '/shared',
        icon: ShareIcon,
        enabled: true,
        badge: sharedCount > 0 ? String(sharedCount) : undefined,
      },
      {
        label: 'Recruiters',
        path: '/recruiters',
        icon: RecruitersIcon,
        enabled: true,
      },
      {
        label: 'Kanban',
        path: '/kanban',
        icon: BoardIcon,
        enabled: true,
      },
      {
        label: 'Settings',
        path: '/settings',
        icon: SettingsIcon,
        enabled: true,
      },
    ],
    [sharedCount]
  );

  const SidebarContent = () => (
    <>
      <div className="mb-8 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <JTrackerLogo size={40} className="shrink-0" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight">JTracker</h1>
            <p className="truncate text-xs text-slate-500">Track every opportunity</p>
          </div>
        </div>

        <button
          onClick={() => setMobileSidebarOpen(false)}
          className="lg:hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 shrink-0"
          aria-label="Close menu"
        >
          <X size={20} />
        </button>
      </div>

      <nav className="space-y-2 flex-1 overflow-y-auto overflow-x-hidden pr-1">
        {navItems.map((item) => {
          const Icon = item.icon;

          if (!item.enabled) {
            return (
              <div
                key={item.path}
                title={`${item.label} is paused for upgrades`}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 cursor-not-allowed opacity-60 overflow-hidden"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon size={18} className="shrink-0" dot="quiet" />
                  <span className="truncate">{item.label}</span>
                </div>

                {item.badge && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
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
              onClick={() => setMobileSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm font-medium transition overflow-hidden ${
                  isActive
                    ? 'bg-slate-900 text-white dark:bg-[#273357] dark:text-[#F9FAFF]'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-[#1E2740] dark:hover:text-[#F9FAFF]'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <div className="flex items-center gap-3 min-w-0">
                    {/* The dot stays quiet until its item is active. */}
                    <Icon size={18} className="shrink-0" dot={isActive ? 'accent' : 'quiet'} />
                    <span className="truncate">{item.label}</span>
                  </div>

                  {item.badge && (
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${
                        isActive
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

      <div className="border-t border-slate-200 pt-4 mt-4">
        <ThemeSwitch />

        <p className="text-xs text-slate-500 truncate mb-3 break-all">
          {user?.email}
        </p>

        {onInstall && (
          <button
            type="button"
            onClick={onInstall}
            className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            <Download size={16} />
            Install JTracker
          </button>
        )}

        <button
          onClick={signOut}
          className="w-full bg-slate-900 text-white rounded-lg px-3 py-2 text-sm hover:bg-slate-700 transition"
        >
          Sign Out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 overflow-x-hidden">
      <header className="lg:hidden sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3 flex items-center justify-between overflow-hidden">
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 shrink-0"
          aria-label="Open menu"
        >
          <Menu size={22} />
        </button>

        <div className="flex min-w-0 items-center gap-2 px-2">
          <JTrackerLogo size={28} className="shrink-0" />
          <h1 className="truncate text-base font-bold tracking-tight">JTracker</h1>
        </div>

        <div className="w-9 shrink-0" />
      </header>

      <aside className="hidden lg:fixed lg:left-0 lg:top-0 lg:flex lg:h-screen lg:w-64 bg-white border-r border-slate-200 p-5 flex-col overflow-hidden dark:bg-[#141C31]">
        <SidebarContent />
      </aside>

      {mobileSidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 overflow-hidden">
          <button
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileSidebarOpen(false)}
            aria-label="Close menu overlay"
          />

          <aside className="absolute left-0 top-0 h-full w-[85%] max-w-xs bg-white border-r border-slate-200 p-5 flex flex-col shadow-xl overflow-hidden dark:bg-[#141C31]">
            <SidebarContent />
          </aside>
        </div>
      )}

      <main className="w-full max-w-full overflow-x-hidden p-4 sm:p-6 lg:ml-64 lg:w-[calc(100%-16rem)] lg:p-8">
        {/* A crash in one page shows an error here; the sidebar keeps working. */}
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
        {import.meta.env.VITE_LOGO_DEV_PUBLISHABLE_KEY && (
          <footer className="mt-10 border-t border-slate-200 pt-4 text-right text-xs text-slate-500">
            Logos provided by{' '}
            <a className="underline hover:text-slate-700" href="https://www.logo.dev" target="_blank" rel="noopener noreferrer">
              Logo.dev
            </a>
          </footer>
        )}
      </main>

      <OfferCelebration />
    </div>
  );
};
