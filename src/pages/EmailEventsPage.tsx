import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  Mail,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface EmailEvent {
  id: string;
  sender: string | null;
  subject: string | null;
  snippet: string | null;
  detected_status: string | null;
  received_at: string | null;
  gmail_message_id: string | null;

  applications?: {
    id: string;
    role_title: string;
    companies?: {
      name: string;
    } | null;
  } | null;
}

const statusStyles: Record<
  string,
  {
    badge: string;
    icon: React.ReactNode;
  }
> = {
  rejected: {
    badge: 'bg-red-100 text-red-700 border border-red-200',
    icon: <AlertTriangle size={14} />,
  },

  offer: {
    badge: 'bg-green-100 text-green-700 border border-green-200',
    icon: <CheckCircle2 size={14} />,
  },

  interview: {
    badge: 'bg-amber-100 text-amber-700 border border-amber-200',
    icon: <CalendarClock size={14} />,
  },

  assessment: {
    badge: 'bg-purple-100 text-purple-700 border border-purple-200',
    icon: <Sparkles size={14} />,
  },

  confirmation_received: {
    badge: 'bg-blue-100 text-blue-700 border border-blue-200',
    icon: <ShieldCheck size={14} />,
  },

  applied: {
    badge: 'bg-slate-100 text-slate-700 border border-slate-200',
    icon: <Briefcase size={14} />,
  },

  unknown: {
    badge: 'bg-slate-100 text-slate-700 border border-slate-200',
    icon: <Mail size={14} />,
  },
};

const formatStatus = (status: string) =>
  status.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

const inputCls =
  'w-full border border-slate-300 rounded-xl pl-11 pr-4 py-3 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition';

export const EmailEventsPage: React.FC = () => {
  const { user } = useAuth();

  const [emails, setEmails] = useState<EmailEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedEmails, setExpandedEmails] = useState<Record<string, boolean>>({});

  const fetchEmailEvents = async () => {
    if (!user) return;

    setLoading(true);
    setError('');

    const { data, error } = await supabase
      .from('email_events')
      .select(`
        id,
        sender,
        subject,
        snippet,
        detected_status,
        received_at,
        gmail_message_id,
        applications (
          id,
          role_title,
          companies (
            name
          )
        )
      `)
      .eq('user_id', user.id)
      .order('received_at', { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setEmails(data || []);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchEmailEvents();
  }, [user]);

  const filteredEmails = useMemo(() => {
    const query = searchTerm.toLowerCase();

    return emails.filter((email) => {
      const company = email.applications?.companies?.name || '';
      const role = email.applications?.role_title || '';

      return (
        (email.subject || '').toLowerCase().includes(query) ||
        (email.sender || '').toLowerCase().includes(query) ||
        (email.snippet || '').toLowerCase().includes(query) ||
        role.toLowerCase().includes(query) ||
        company.toLowerCase().includes(query)
      );
    });
  }, [emails, searchTerm]);

  const stats = useMemo(() => {
    const total = emails.length;

    const interviews = emails.filter(
      (email) => email.detected_status === 'interview'
    ).length;

    const offers = emails.filter(
      (email) => email.detected_status === 'offer'
    ).length;

    const rejections = emails.filter(
      (email) => email.detected_status === 'rejected'
    ).length;

    return {
      total,
      interviews,
      offers,
      rejections,
    };
  }, [emails]);

  const toggleExpanded = (id: string) => {
    setExpandedEmails((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-12 text-center">
        <div className="animate-pulse">
          <Mail size={36} className="mx-auto text-slate-400 mb-4" />
          <p className="text-slate-500">Loading Gmail intelligence events...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6 mb-8">
        <div>
          <h2 className="text-3xl font-bold mb-2">Email Intelligence Center</h2>

          <p className="text-slate-500 max-w-2xl">
            View Gmail recruitment events processed by JTracker, linked
            applications, and detected lifecycle changes.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 min-w-[280px]">
          <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-3">
            Gmail Processing Summary
          </p>

          <div className="space-y-3">
            <StatRow label="Total Email Events" value={stats.total} />
            <StatRow label="Interview Emails" value={stats.interviews} />
            <StatRow label="Offer Emails" value={stats.offers} />
            <StatRow label="Rejections" value={stats.rejections} />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 mb-6">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 mb-8">
        <div className="relative">
          <Search size={18} className="absolute left-4 top-3.5 text-slate-400" />

          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search company, role, sender, status, or email subject..."
            className={inputCls}
          />
        </div>
      </div>

      {filteredEmails.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-12 text-center">
          <Mail size={42} className="mx-auto text-slate-300 mb-4" />

          <h3 className="text-xl font-semibold">No Email Events Found</h3>

          <p className="text-slate-500 mt-2 max-w-md mx-auto">
            Gmail-linked recruitment emails will appear here after Gmail Sync
            processes and links them to applications.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {filteredEmails.map((email) => {
            const statusKey = email.detected_status || 'unknown';
            const statusStyle =
              statusStyles[statusKey] || statusStyles.unknown;

            const expanded = expandedEmails[email.id];

            return (
              <div
                key={email.id}
                className="bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md transition overflow-hidden"
              >
                <div className="p-6">
                  <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-5">
                    <div className="flex gap-4 flex-1">
                      <div className="bg-slate-100 rounded-2xl p-4 h-fit">
                        <Mail size={24} className="text-slate-600" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span
                            className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${statusStyle.badge}`}
                          >
                            {statusStyle.icon}
                            {formatStatus(statusKey)}
                          </span>

                          {email.gmail_message_id && (
                            <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full text-xs font-semibold">
                              Gmail Synced
                            </span>
                          )}
                        </div>

                        <h3 className="text-lg font-semibold break-words">
                          {email.subject || 'No subject'}
                        </h3>

                        <p className="text-sm text-slate-500 mt-1 break-all">
                          From: {email.sender || 'Unknown sender'}
                        </p>

                        <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-4">
                          <p
                            className={`text-sm text-slate-600 whitespace-pre-wrap ${
                              expanded ? '' : 'line-clamp-3'
                            }`}
                          >
                            {email.snippet || 'No email preview available.'}
                          </p>

                          {email.snippet && email.snippet.length > 220 && (
                            <button
                              onClick={() => toggleExpanded(email.id)}
                              className="text-sm text-slate-700 font-medium mt-3 hover:underline"
                            >
                              {expanded ? 'Show less' : 'Read more'}
                            </button>
                          )}
                        </div>

                        {email.applications?.role_title && (
                          <div className="mt-4">
                            <Link
                              to={`/applications/${email.applications.id}`}
                              className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-100 transition"
                            >
                              <Briefcase size={15} />

                              {email.applications.companies?.name || 'Unknown'} —{' '}
                              {email.applications.role_title}
                            </Link>
                          </div>
                        )}

                        {email.gmail_message_id && (
                          <div className="mt-4 text-xs text-slate-400 break-all">
                            Gmail Message ID: {email.gmail_message_id}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="xl:text-right shrink-0">
                      <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
                        Received
                      </p>

                      <p className="text-sm text-slate-600 mt-1">
                        {email.received_at
                          ? new Date(email.received_at).toLocaleString()
                          : 'No date'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const StatRow = ({
  label,
  value,
}: {
  label: string;
  value: number;
}) => (
  <div className="flex items-center justify-between">
    <span className="text-sm text-slate-500">{label}</span>
    <span className="font-semibold">{value}</span>
  </div>
);