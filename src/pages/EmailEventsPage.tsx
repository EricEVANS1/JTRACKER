import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Mail,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useAIEmailAnalysis } from '../hooks/useAIEmailAnalysis';

interface CompanySummary {
  name: string;
}

interface ApplicationSummary {
  id: string;
  role_title: string;
  companies?: CompanySummary | null;
}

interface RawApplicationSummary {
  id: string;
  role_title: string;
  companies?: CompanySummary | CompanySummary[] | null;
}

interface RawEmailEvent {
  id: string;
  sender: string | null;
  subject: string | null;
  snippet: string | null;
  detected_status: string | null;
  received_at: string | null;
  gmail_message_id: string | null;
  applications?: RawApplicationSummary | RawApplicationSummary[] | null;
}

interface EmailEvent {
  id: string;
  sender: string | null;
  subject: string | null;
  snippet: string | null;
  detected_status: string | null;
  received_at: string | null;
  gmail_message_id: string | null;
  applications?: ApplicationSummary | null;
}

const firstOrNull = <T,>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const normalizeEmailEvent = (email: RawEmailEvent): EmailEvent => {
  const application = firstOrNull(email.applications);

  return {
    id: email.id,
    sender: email.sender,
    subject: email.subject,
    snippet: email.snippet,
    detected_status: email.detected_status,
    received_at: email.received_at,
    gmail_message_id: email.gmail_message_id,
    applications: application
      ? {
          id: application.id,
          role_title: application.role_title,
          companies: firstOrNull(application.companies),
        }
      : null,
  };
};

const statusStyles: Record<string, { badge: string; icon: React.ReactNode }> = {
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

const urgencyColors = {
  high: 'bg-red-50 border-red-200 text-red-800',
  medium: 'bg-amber-50 border-amber-200 text-amber-800',
  low: 'bg-slate-50 border-slate-200 text-slate-700',
};

const urgencyDot = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-slate-400',
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
  const [expandedInsights, setExpandedInsights] = useState<Record<string, boolean>>({});

  const {
    analyzeEmail,
    analyzeBatch,
    insights,
    analyzing,
    batchInsight,
    batchAnalyzing,
    error: aiError,
  } = useAIEmailAnalysis();

  const fetchEmailEvents = async () => {
    if (!user) {
      setEmails([]);
      setLoading(false);
      return;
    }

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
      setEmails([]);
    } else {
      const normalizedEmails = ((data || []) as RawEmailEvent[]).map(normalizeEmailEvent);
      setEmails(normalizedEmails);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchEmailEvents();
  }, [user]);

  const filteredEmails = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return emails;

    return emails.filter((email) => {
      const company = email.applications?.companies?.name || '';
      const role = email.applications?.role_title || '';
      const status = email.detected_status || '';

      return (
        (email.subject || '').toLowerCase().includes(query) ||
        (email.sender || '').toLowerCase().includes(query) ||
        (email.snippet || '').toLowerCase().includes(query) ||
        status.toLowerCase().includes(query) ||
        role.toLowerCase().includes(query) ||
        company.toLowerCase().includes(query)
      );
    });
  }, [emails, searchTerm]);

  const stats = useMemo(() => {
    return {
      total: emails.length,
      interviews: emails.filter((email) => email.detected_status === 'interview').length,
      offers: emails.filter((email) => email.detected_status === 'offer').length,
      rejections: emails.filter((email) => email.detected_status === 'rejected').length,
    };
  }, [emails]);

  const toggleExpanded = (id: string) => {
    setExpandedEmails((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const toggleInsight = (id: string) => {
    setExpandedInsights((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleAnalyzeEmail = (email: EmailEvent) => {
    analyzeEmail(
      email.id,
      email.subject || '',
      email.sender || '',
      email.snippet || '',
      email.detected_status || 'unknown'
    );

    setExpandedInsights((prev) => ({
      ...prev,
      [email.id]: true,
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
            Gmail recruitment events enhanced with AI-powered insights. Analyze individual emails
            or get a strategic overview of your job search pipeline.
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

      <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-6 mb-8 text-white">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="bg-white/10 rounded-xl p-2.5">
              <TrendingUp size={20} className="text-white" />
            </div>

            <div>
              <h3 className="font-semibold text-lg">AI Pipeline Advisor</h3>
              <p className="text-slate-400 text-sm">
                Strategic analysis of your recruitment email pipeline.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => analyzeBatch(emails)}
            disabled={batchAnalyzing || emails.length === 0}
            className="flex items-center justify-center gap-2 bg-white text-slate-900 px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-slate-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {batchAnalyzing ? (
              <>
                <div className="w-4 h-4 border-2 border-slate-400 border-t-slate-900 rounded-full animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Analyze All {emails.length} Emails
              </>
            )}
          </button>
        </div>

        {batchInsight ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
            <div className="bg-white/10 rounded-xl p-4 md:col-span-3">
              <p className="text-slate-300 text-xs font-semibold uppercase tracking-wide mb-2">
                Pipeline Overview
              </p>
              <p className="text-white text-sm leading-relaxed">{batchInsight.patternSummary}</p>
            </div>

            <div className="bg-white/10 rounded-xl p-4">
              <p className="text-slate-300 text-xs font-semibold uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <CheckCircle2 size={13} /> Top Opportunities
              </p>

              {batchInsight.topOpportunities.length > 0 ? (
                <ul className="space-y-2">
                  {batchInsight.topOpportunities.map((opportunity, index) => (
                    <li key={index} className="text-sm text-white flex items-start gap-2">
                      <span className="text-emerald-400 mt-0.5 shrink-0">→</span>
                      {opportunity}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400">No strong opportunities detected yet.</p>
              )}
            </div>

            <div className="bg-white/10 rounded-xl p-4">
              <p className="text-slate-300 text-xs font-semibold uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <AlertTriangle size={13} /> Watch Out For
              </p>

              {batchInsight.concerningTrends.length > 0 ? (
                <ul className="space-y-2">
                  {batchInsight.concerningTrends.map((trend, index) => (
                    <li key={index} className="text-sm text-white flex items-start gap-2">
                      <span className="text-amber-400 mt-0.5 shrink-0">!</span>
                      {trend}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400">No major concerns detected.</p>
              )}
            </div>

            <div className="bg-emerald-500/20 border border-emerald-500/30 rounded-xl p-4">
              <p className="text-emerald-300 text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Zap size={13} /> This Week&apos;s Focus
              </p>
              <p className="text-sm text-white leading-relaxed">{batchInsight.recommendedFocus}</p>
            </div>
          </div>
        ) : (
          <p className="text-slate-400 text-sm">
            Click “Analyze All Emails” to get AI-powered strategic insights about your job search.
          </p>
        )}
      </div>

      {(error || aiError) && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 mb-6">
          {error || aiError}
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
            Gmail-linked recruitment emails will appear here after Gmail Sync processes
            and links them to applications.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {filteredEmails.map((email) => {
            const statusKey = email.detected_status || 'unknown';
            const statusStyle = statusStyles[statusKey] || statusStyles.unknown;
            const expanded = expandedEmails[email.id];
            const insightExpanded = expandedInsights[email.id];
            const insight = insights[email.id];
            const isAnalyzing = analyzing[email.id];

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

                          {insight && (
                            <span
                              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${urgencyColors[insight.urgency]}`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${urgencyDot[insight.urgency]}`}
                              />
                              {insight.urgency.charAt(0).toUpperCase() +
                                insight.urgency.slice(1)}{' '}
                              Priority
                            </span>
                          )}

                          {insight && insight.confidence < 80 && (
                            <span className="bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1 rounded-full text-xs font-semibold">
                              Review Needed
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
                              type="button"
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

                        <div className="mt-4">
                          {!insight && !isAnalyzing && (
                            <button
                              type="button"
                              onClick={() => handleAnalyzeEmail(email)}
                              className="inline-flex items-center gap-2 bg-gradient-to-r from-slate-800 to-slate-700 text-white px-4 py-2 rounded-xl text-sm font-medium hover:from-slate-700 hover:to-slate-600 transition"
                            >
                              <Sparkles size={15} />
                              Analyze with AI
                            </button>
                          )}

                          {isAnalyzing && (
                            <div className="inline-flex items-center gap-2 bg-slate-100 px-4 py-2 rounded-xl text-sm text-slate-600">
                              <div className="w-3.5 h-3.5 border-2 border-slate-400 border-t-slate-700 rounded-full animate-spin" />
                              AI analyzing...
                            </div>
                          )}

                          {insight && (
                            <div className="border border-slate-200 rounded-xl overflow-hidden">
                              <button
                                type="button"
                                onClick={() => toggleInsight(email.id)}
                                className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-slate-50 to-white hover:from-slate-100 transition text-left"
                              >
                                <div className="flex items-center gap-2">
                                  <Sparkles size={15} className="text-slate-700" />
                                  <span className="text-sm font-semibold text-slate-800">
                                    AI Insight
                                  </span>
                                  <span className="text-xs text-slate-500">
                                    {insight.confidence}% confidence
                                  </span>
                                </div>

                                {insightExpanded ? (
                                  <ChevronUp size={16} className="text-slate-500" />
                                ) : (
                                  <ChevronDown size={16} className="text-slate-500" />
                                )}
                              </button>

                              {insightExpanded && (
                                <div className="p-4 space-y-4 bg-white border-t border-slate-100">
                                  <div>
                                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                                      Summary
                                    </p>
                                    <p className="text-sm text-slate-700 leading-relaxed">
                                      {insight.summary}
                                    </p>
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                                        Suggested Action
                                      </p>
                                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                                        <p className="text-sm text-emerald-800">
                                          {insight.suggestedAction}
                                        </p>
                                      </div>
                                    </div>

                                    <div>
                                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                                        Email Tone
                                      </p>
                                      <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                                        <p className="text-sm text-slate-700">{insight.tone}</p>
                                      </div>
                                    </div>
                                  </div>

                                  {insight.keyDetails.length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                                        Key Details
                                      </p>
                                      <ul className="space-y-1">
                                        {insight.keyDetails.map((detail, index) => (
                                          <li
                                            key={index}
                                            className="flex items-start gap-2 text-sm text-slate-700"
                                          >
                                            <span className="text-blue-500 mt-0.5 shrink-0">•</span>
                                            {detail}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  {insight.followUpDate && (
                                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
                                      <Clock size={14} className="text-amber-700 shrink-0" />
                                      <p className="text-sm text-amber-800">
                                        Follow up by:{' '}
                                        <strong>
                                          {new Date(insight.followUpDate).toLocaleDateString()}
                                        </strong>
                                      </p>
                                    </div>
                                  )}

                                  {insight.redFlags && insight.redFlags.length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2">
                                        Red Flags
                                      </p>

                                      {insight.redFlags.map((flag, index) => (
                                        <div
                                          key={index}
                                          className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2 mb-2"
                                        >
                                          <AlertTriangle
                                            size={14}
                                            className="text-red-600 shrink-0 mt-0.5"
                                          />
                                          <p className="text-sm text-red-700">{flag}</p>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

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

const StatRow = ({ label, value }: { label: string; value: number }) => (
  <div className="flex items-center justify-between">
    <span className="text-sm text-slate-500">{label}</span>
    <span className="font-semibold">{value}</span>
  </div>
);