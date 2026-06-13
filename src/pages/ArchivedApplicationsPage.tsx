import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Archive,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Application } from '../types/application';

interface CompanyJoin {
  name: string;
}

interface CVVersionJoin {
  id: string;
  name: string;
}

interface RecruiterJoin {
  id: string;
  name: string;
  email: string | null;
}

interface RawArchivedApplication extends Omit<Application, 'companies' | 'cv_versions' | 'recruiters'> {
  companies?: CompanyJoin | CompanyJoin[] | null;
  cv_versions?: CVVersionJoin | CVVersionJoin[] | null;
  recruiters?: RecruiterJoin | RecruiterJoin[] | null;

  response_received_at?: string | null;
  assessment_received_at?: string | null;
  interview_started_at?: string | null;
  final_interview_started_at?: string | null;
  offer_received_at?: string | null;
  rejected_at?: string | null;
  withdrawn_at?: string | null;
  ghosted_at?: string | null;
  last_status_changed_at?: string | null;
  status_updated_at?: string | null;

  reached_interview?: boolean | null;
  rejected_after_interview?: boolean | null;
  final_response_pending?: boolean | null;
  interview_count?: number | null;
  outcome_reason?: string | null;
}

interface ArchivedApplication
  extends Omit<RawArchivedApplication, 'companies' | 'cv_versions' | 'recruiters'> {
  companies: CompanyJoin | null;
  cv_versions: CVVersionJoin | null;
  recruiters: RecruiterJoin | null;
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

const statusClass = (status: string) => {
  const styles: Record<string, string> = {
    wishlist: 'bg-slate-100 text-slate-700',
    applied: 'bg-blue-50 text-blue-700',
    confirmation_received: 'bg-cyan-50 text-cyan-700',
    assessment: 'bg-violet-50 text-violet-700',
    interview: 'bg-indigo-50 text-indigo-700',
    final_interview: 'bg-purple-50 text-purple-700',
    offer: 'bg-emerald-50 text-emerald-700',
    rejected: 'bg-red-50 text-red-700',
    withdrawn: 'bg-slate-100 text-slate-600',
    ghosted: 'bg-amber-50 text-amber-700',
    archived: 'bg-zinc-100 text-zinc-600',
  };

  return styles[status] || styles.archived;
};

const outcomeClass = (application: ArchivedApplication) => {
  if (application.rejected_after_interview) return 'bg-red-50 text-red-700';
  if (application.final_response_pending) return 'bg-indigo-50 text-indigo-700';
  if (application.reached_interview) return 'bg-emerald-50 text-emerald-700';

  return 'bg-slate-100 text-slate-600';
};

const getOutcomeLabel = (application: ArchivedApplication) => {
  if (application.rejected_after_interview) return 'Declined after interview';
  if (application.final_response_pending) return 'Awaiting interview response';
  if (application.reached_interview) return 'Interview reached';
  if (application.outcome_reason) return formatStatus(application.outcome_reason);

  return 'No interview recorded';
};

const inputCls =
  'w-full border border-slate-200 rounded-xl pl-10 pr-3 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition';

export const ArchivedApplicationsPage: React.FC = () => {
  const { user } = useAuth();

  const [applications, setApplications] = useState<ArchivedApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [deletingId, setDeletingId] = useState('');
  const [restoringId, setRestoringId] = useState('');

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');

  const fetchApplications = async () => {
    if (!user) return;

    setError('');

    const { data, error } = await supabase
      .from('applications')
      .select(`
        *,
        companies (
          name
        ),
        cv_versions (
          id,
          name
        ),
        recruiters (
          id,
          name,
          email
        )
      `)
      .eq('user_id', user.id)
      .or('archived.eq.true,status.eq.archived')
      .order('archived_at', { ascending: false, nullsFirst: false });

    if (error) {
      setError(error.message);
      return;
    }

    const normalised: ArchivedApplication[] = ((data || []) as RawArchivedApplication[]).map(
      (application) => ({
        ...application,
        companies: firstOrNull(application.companies),
        cv_versions: firstOrNull(application.cv_versions),
        recruiters: firstOrNull(application.recruiters),
      })
    );

    setApplications(normalised);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const filteredApplications = useMemo(() => {
    const term = search.toLowerCase().trim();

    return applications.filter((application) => {
      if (!term) return true;

      return (
        application.role_title.toLowerCase().includes(term) ||
        Boolean(application.companies?.name?.toLowerCase().includes(term)) ||
        application.status.toLowerCase().includes(term) ||
        Boolean(application.source?.toLowerCase().includes(term)) ||
        Boolean(application.cv_versions?.name?.toLowerCase().includes(term)) ||
        Boolean(application.outcome_reason?.toLowerCase().includes(term))
      );
    });
  }, [applications, search]);

  const stats = useMemo(() => {
    return {
      total: applications.length,
      rejected: applications.filter((app) => app.status === 'rejected').length,
      withdrawn: applications.filter((app) => app.status === 'withdrawn').length,
      ghosted: applications.filter((app) => app.status === 'ghosted').length,
      interviewReached: applications.filter(
        (app) =>
          app.reached_interview ||
          app.interview_started_at ||
          app.final_interview_started_at ||
          app.rejected_after_interview
      ).length,
      rejectedAfterInterview: applications.filter((app) => app.rejected_after_interview).length,
    };
  }, [applications]);

  const handleRestoreApplication = async (application: ArchivedApplication) => {
    if (!user) return;

    const confirmed = window.confirm(
      'Restore this application to your active pipeline?'
    );

    if (!confirmed) return;

    setRestoringId(application.id);
    setError('');
    setMessage('');

    const now = new Date().toISOString();

    const { error } = await supabase
      .from('applications')
      .update({
        archived: false,
        archived_at: null,
        status: application.status === 'archived' ? 'applied' : application.status,
        last_status_changed_at: now,
        status_updated_at: now,
      })
      .eq('id', application.id)
      .eq('user_id', user.id);

    if (error) {
      setError(error.message);
      setRestoringId('');
      return;
    }

    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: application.id,
      event_type: 'application_restored',
      title: 'Application restored',
      description: 'Application was restored from the archive into the active pipeline.',
      event_date: now,
    });

    setApplications((prev) => prev.filter((item) => item.id !== application.id));
    setMessage('Application restored to active pipeline.');
    setRestoringId('');
  };

  const handleDeleteApplication = async (application: ArchivedApplication) => {
    const confirmed = window.confirm(
      `Permanently delete "${application.role_title}"? This cannot be undone.`
    );

    if (!confirmed || !user) return;

    setDeletingId(application.id);
    setError('');
    setMessage('');

    const { error } = await supabase
      .from('applications')
      .delete()
      .eq('id', application.id)
      .eq('user_id', user.id)
      .or('archived.eq.true,status.eq.archived');

    if (error) {
      setError(error.message);
      setDeletingId('');
      return;
    }

    setApplications((prev) =>
      prev.filter((item) => item.id !== application.id)
    );

    setMessage('Archived application permanently deleted.');
    setDeletingId('');
  };

  if (loading) {
    return <ArchivedSkeleton />;
  }

  return (
    <div className="w-full max-w-full overflow-hidden">
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6 mb-8">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <Archive size={28} className="text-slate-700 shrink-0" />
            <h1 className="text-2xl sm:text-3xl font-bold break-words">
              Archived Applications
            </h1>
          </div>

          <p className="text-slate-500 max-w-2xl text-sm sm:text-base break-words">
            Review closed applications, restore useful records, or permanently delete old entries.
            Archived records remain useful for interview history, CV performance, and rejection analysis.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 w-full xl:w-auto">
          <StatCard label="Archived" value={stats.total} />
          <StatCard label="Rejected" value={stats.rejected} />
          <StatCard label="Withdrawn" value={stats.withdrawn} />
          <StatCard label="Ghosted" value={stats.ghosted} />
          <StatCard label="Interviews" value={stats.interviewReached} />
          <StatCard label="After Interview" value={stats.rejectedAfterInterview} />
        </div>
      </div>

      {error && <AlertBox type="error" message={error} onClose={() => setError('')} />}
      {message && <AlertBox type="success" message={message} onClose={() => setMessage('')} />}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 mb-6 overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_140px] gap-3">
          <div className="relative">
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search archived role, company, CV version, source, or status..."
              className={inputCls}
            />
          </div>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {filteredApplications.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-10 text-center">
          <Archive size={38} className="mx-auto text-slate-300 mb-3" />
          <h3 className="text-lg font-semibold">No archived applications found</h3>
          <p className="text-slate-500 text-sm sm:text-base mt-2 max-w-xl mx-auto">
            Applications will appear here after you archive them from the active pipeline.
            Rejected applications are not automatically archived unless you choose to move them here.
          </p>
        </div>
      ) : (
        <>
          <div className="hidden xl:block bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3">Company</th>
                  <th className="text-left px-4 py-3">Role</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Outcome</th>
                  <th className="text-left px-4 py-3">CV</th>
                  <th className="text-left px-4 py-3">Archived</th>
                  <th className="text-left px-4 py-3">Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredApplications.map((application) => (
                  <tr
                    key={application.id}
                    className="border-b border-slate-100 last:border-b-0 align-top"
                  >
                    <td className="px-4 py-4 break-words">
                      {application.companies?.name || 'Unknown Company'}
                    </td>

                    <td className="px-4 py-4 font-medium break-words">
                      <div>{application.role_title}</div>
                      {application.source && (
                        <p className="text-xs text-slate-400 mt-1">
                          Source: {formatStatus(application.source)}
                        </p>
                      )}
                    </td>

                    <td className="px-4 py-4">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusClass(
                          application.status
                        )}`}
                      >
                        {formatStatus(application.status)}
                      </span>
                    </td>

                    <td className="px-4 py-4">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-medium ${outcomeClass(
                          application
                        )}`}
                      >
                        {getOutcomeLabel(application)}
                      </span>
                    </td>

                    <td className="px-4 py-4 text-slate-500">
                      {application.cv_versions?.name || 'No CV'}
                    </td>

                    <td className="px-4 py-4 text-slate-500">
                      {formatDateTime(application.archived_at)}
                    </td>

                    <td className="px-4 py-4">
                      <ApplicationActions
                        application={application}
                        deleting={deletingId === application.id}
                        restoring={restoringId === application.id}
                        onRestore={handleRestoreApplication}
                        onDelete={handleDeleteApplication}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="xl:hidden space-y-4">
            {filteredApplications.map((application) => (
              <div
                key={application.id}
                className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-5 overflow-hidden"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-500 break-words">
                      {application.companies?.name || 'Unknown Company'}
                    </p>

                    <h3 className="font-semibold mt-1 break-words">
                      {application.role_title}
                    </h3>

                    {application.cv_versions?.name && (
                      <p className="text-xs text-slate-400 mt-1">
                        CV: {application.cv_versions.name}
                      </p>
                    )}
                  </div>

                  <span
                    className={`w-fit px-2.5 py-1 rounded-full text-xs font-medium ${statusClass(
                      application.status
                    )}`}
                  >
                    {formatStatus(application.status)}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 mt-4">
                  <span
                    className={`w-fit px-2.5 py-1 rounded-full text-xs font-medium ${outcomeClass(
                      application
                    )}`}
                  >
                    {getOutcomeLabel(application)}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 text-sm">
                  <CompactMeta label="Archived" value={formatDateTime(application.archived_at)} />
                  <CompactMeta label="Source" value={application.source ? formatStatus(application.source) : 'Not set'} />
                  <CompactMeta label="Interview Count" value={String(application.interview_count || 0)} />
                  <CompactMeta label="Recruiter" value={application.recruiters?.name || 'None'} />
                </div>

                {application.notes && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 whitespace-pre-wrap">
                    {application.notes}
                  </div>
                )}

                <div className="mt-4">
                  <ApplicationActions
                    application={application}
                    deleting={deletingId === application.id}
                    restoring={restoringId === application.id}
                    onRestore={handleRestoreApplication}
                    onDelete={handleDeleteApplication}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const ApplicationActions = ({
  application,
  deleting,
  restoring,
  onRestore,
  onDelete,
}: {
  application: ArchivedApplication;
  deleting: boolean;
  restoring: boolean;
  onRestore: (application: ArchivedApplication) => void;
  onDelete: (application: ArchivedApplication) => void;
}) => (
  <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
    <Link
      to={`/applications/${application.id}`}
      className="text-slate-900 underline text-sm w-full sm:w-auto text-center sm:text-left"
    >
      View
    </Link>

    {application.application_link && (
      <a
        href={application.application_link}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center justify-center gap-1 text-slate-600 hover:text-slate-900 text-sm w-full sm:w-auto"
      >
        Job
        <ExternalLink size={14} />
      </a>
    )}

    <button
      onClick={() => onRestore(application)}
      disabled={restoring || deleting}
      className="inline-flex items-center justify-center gap-1 text-emerald-700 hover:text-emerald-900 text-sm disabled:opacity-50 w-full sm:w-auto"
    >
      <RotateCcw size={15} />
      {restoring ? 'Restoring...' : 'Restore'}
    </button>

    <button
      onClick={() => onDelete(application)}
      disabled={deleting || restoring}
      className="inline-flex items-center justify-center gap-1 text-red-600 hover:text-red-800 text-sm disabled:opacity-50 w-full sm:w-auto"
    >
      <Trash2 size={15} />
      {deleting ? 'Deleting...' : 'Delete'}
    </button>
  </div>
);

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
      <RotateCcw size={16} className="shrink-0 mt-0.5" />
    )}

    <span className="text-sm flex-1 break-words">{message}</span>

    <button onClick={onClose} className="opacity-70 hover:opacity-100 shrink-0">
      <X size={16} />
    </button>
  </div>
);

const StatCard = ({ label, value }: { label: string; value: number }) => (
  <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
    <p className="text-xs text-slate-400">{label}</p>
    <p className="text-xl font-bold text-slate-900">{value}</p>
  </div>
);

const CompactMeta = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 min-w-0">
    <p className="text-[11px] text-slate-400">{label}</p>
    <p className="text-sm font-medium text-slate-700 break-words">{value}</p>
  </div>
);

const ArchivedSkeleton = () => (
  <div className="w-full max-w-full overflow-hidden">
    <div className="mb-8">
      <div className="h-8 w-full max-w-72 bg-slate-200 rounded-lg animate-pulse mb-2" />
      <div className="h-4 w-full max-w-96 bg-slate-100 rounded-lg animate-pulse" />
    </div>

    <div className="h-20 sm:h-16 bg-white border border-slate-200 rounded-2xl animate-pulse mb-6" />

    <div className="h-80 bg-white border border-slate-200 rounded-2xl animate-pulse" />
  </div>
);