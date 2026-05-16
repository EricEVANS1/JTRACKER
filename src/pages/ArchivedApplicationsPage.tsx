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

interface RawArchivedApplication
  extends Omit<Application, 'companies'> {
  companies?: CompanyJoin | CompanyJoin[] | null;
}

interface ArchivedApplication extends Omit<RawArchivedApplication, 'companies'> {
  companies: CompanyJoin | null;
}

const firstOrNull = <T,>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const formatStatus = (status: string) =>
  status.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

const formatDateTime = (date?: string | null) => {
  if (!date) return '-';

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

const inputCls =
  'w-full border border-slate-200 rounded-xl pl-10 pr-3 py-3 text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition';

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
        )
      `)
      .eq('user_id', user.id)
      .eq('archived', true)
      .order('archived_at', { ascending: false });

    if (error) {
      setError(error.message);
      return;
    }

    const normalized: ArchivedApplication[] = ((data || []) as RawArchivedApplication[]).map(
      (application) => ({
        ...application,
        companies: firstOrNull(application.companies),
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

  const filteredApplications = useMemo(() => {
    const term = search.toLowerCase();

    return applications.filter((application) => {
      if (!term.trim()) return true;

      return (
        application.role_title.toLowerCase().includes(term) ||
        application.companies?.name.toLowerCase().includes(term) ||
        application.status.toLowerCase().includes(term) ||
        application.source?.toLowerCase().includes(term)
      );
    });
  }, [applications, search]);

  const stats = useMemo(() => {
    return {
      total: applications.length,
      rejected: applications.filter((app) => app.status === 'rejected').length,
      withdrawn: applications.filter((app) => app.status === 'withdrawn').length,
      ghosted: applications.filter((app) => app.status === 'ghosted').length,
    };
  }, [applications]);

  const handleRestoreApplication = async (application: ArchivedApplication) => {
    if (!user) return;

    setRestoringId(application.id);
    setError('');
    setMessage('');

    const { error } = await supabase
      .from('applications')
      .update({
        archived: false,
        archived_at: null,
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
      description: 'Application was restored from archive.',
      event_date: new Date().toISOString(),
    });

    setApplications((prev) => prev.filter((item) => item.id !== application.id));
    setMessage('Application restored.');
    setRestoringId('');
  };

  const handleDeleteApplication = async (applicationId: string) => {
    const confirmed = window.confirm(
      'Delete this archived application permanently? This cannot be undone.'
    );

    if (!confirmed || !user) return;

    setDeletingId(applicationId);
    setError('');
    setMessage('');

    const { error } = await supabase
      .from('applications')
      .delete()
      .eq('id', applicationId)
      .eq('user_id', user.id)
      .eq('archived', true);

    if (error) {
      setError(error.message);
      setDeletingId('');
      return;
    }

    setApplications((prev) =>
      prev.filter((application) => application.id !== applicationId)
    );

    setMessage('Archived application permanently deleted.');
    setDeletingId('');
  };

  if (loading) {
    return <ArchivedSkeleton />;
  }

  return (
    <div>
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Archive size={30} className="text-slate-700" />
            <h1 className="text-3xl font-bold">Archived Applications</h1>
          </div>

          <p className="text-slate-500 max-w-2xl">
            Review archived applications, restore them to your active pipeline, or permanently delete old records.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Archived" value={stats.total} />
          <StatCard label="Rejected" value={stats.rejected} />
          <StatCard label="Withdrawn" value={stats.withdrawn} />
          <StatCard label="Ghosted" value={stats.ghosted} />
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
              placeholder="Search archived role, company, source, or status..."
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

      {filteredApplications.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <Archive size={38} className="mx-auto text-slate-300 mb-3" />
          <h3 className="text-lg font-semibold">No archived applications found</h3>
          <p className="text-slate-500 mt-2">
            Archived applications will appear here when you move them out of your active pipeline.
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
                  <th className="text-left px-4 py-3">Archived</th>
                  <th className="text-left px-4 py-3">Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredApplications.map((application) => (
                  <tr
                    key={application.id}
                    className="border-b border-slate-100 last:border-b-0"
                  >
                    <td className="px-4 py-4">
                      {application.companies?.name || 'Unknown Company'}
                    </td>

                    <td className="px-4 py-4 font-medium">
                      {application.role_title}
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
                className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-slate-500">
                      {application.companies?.name || 'Unknown Company'}
                    </p>

                    <h3 className="font-semibold mt-1">
                      {application.role_title}
                    </h3>
                  </div>

                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusClass(
                      application.status
                    )}`}
                  >
                    {formatStatus(application.status)}
                  </span>
                </div>

                <p className="text-sm text-slate-500 mt-4">
                  Archived: {formatDateTime(application.archived_at)}
                </p>

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
  onDelete: (applicationId: string) => void;
}) => (
  <div className="flex flex-wrap items-center gap-3">
    <Link
      to={`/applications/${application.id}`}
      className="text-slate-900 underline text-sm"
    >
      View
    </Link>

    {application.application_link && (
      <a
        href={application.application_link}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 text-sm"
      >
        Job
        <ExternalLink size={14} />
      </a>
    )}

    <button
      onClick={() => onRestore(application)}
      disabled={restoring || deleting}
      className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-900 text-sm disabled:opacity-50"
    >
      <RotateCcw size={15} />
      {restoring ? 'Restoring...' : 'Restore'}
    </button>

    <button
      onClick={() => onDelete(application.id)}
      disabled={deleting || restoring}
      className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 text-sm disabled:opacity-50"
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

    <span className="text-sm flex-1">{message}</span>

    <button onClick={onClose} className="opacity-70 hover:opacity-100">
      <X size={16} />
    </button>
  </div>
);

const StatCard = ({ label, value }: { label: string; value: number }) => (
  <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 min-w-[105px] shadow-sm">
    <p className="text-xs text-slate-400">{label}</p>
    <p className="text-xl font-bold text-slate-900">{value}</p>
  </div>
);

const ArchivedSkeleton = () => (
  <div>
    <div className="mb-8">
      <div className="h-8 w-72 bg-slate-200 rounded-lg animate-pulse mb-2" />
      <div className="h-4 w-96 bg-slate-100 rounded-lg animate-pulse" />
    </div>

    <div className="h-16 bg-white border border-slate-200 rounded-2xl animate-pulse mb-6" />

    <div className="h-80 bg-white border border-slate-200 rounded-2xl animate-pulse" />
  </div>
);