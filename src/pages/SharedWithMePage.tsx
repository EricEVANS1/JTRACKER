import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  Inbox,
  MapPin,
  PlusCircle,
  RefreshCw,
  UserRound,
  X,
} from 'lucide-react';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { SharedOpportunity } from '../types/sharedOpportunity';

interface SenderProfile {
  full_name: string | null;
  email: string | null;
}

interface SharedOpportunityWithSender extends SharedOpportunity {
  sender_profile?: SenderProfile | null;
  added_to_applications_at?: string | null;
  added_application_id?: string | null;
  experience_snapshot?: string | null;
}

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

export const SharedWithMePage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<SharedOpportunityWithSender[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingToApplicationsId, setSavingToApplicationsId] = useState<string | null>(null);

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const fetchShared = async () => {
    if (!user) return;

    setError('');

    const { data: shares, error: sharesError } = await supabase
      .from('shared_opportunities')
      .select('*')
      .eq('recipient_user_id', user.id)
      .order('created_at', { ascending: false });

    if (sharesError) {
      setError(sharesError.message);
      return;
    }

    const senderIds = [
      ...new Set(
        (shares || [])
          .map((share) => share.sender_user_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];

    let profileMap = new Map<string, SenderProfile>();

    if (senderIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', senderIds);

      if (profilesError) {
        setError(profilesError.message);
        return;
      }

      profileMap = new Map(
        (profiles || []).map((profile) => [
          profile.id,
          {
            full_name: profile.full_name,
            email: profile.email,
          },
        ])
      );
    }

    const normalized: SharedOpportunityWithSender[] = (
      (shares || []) as SharedOpportunityWithSender[]
    ).map((item) => ({
      ...item,
      sender_profile: item.sender_user_id
        ? profileMap.get(item.sender_user_id) || null
        : null,
    }));

    setItems(normalized);
  };

  const loadPage = async () => {
    setLoading(true);
    await fetchShared();
    setLoading(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchShared();
    setRefreshing(false);
  };

  useEffect(() => {
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleCopySummary = async (item: SharedOpportunityWithSender) => {
    const summary = `Opportunity shared via JTracker

${item.role_title}
${item.company_name || 'Unknown Company'}${item.location ? ` — ${item.location}` : ''}

${item.job_link || 'No job link provided'}

${item.note || ''}`;

    await navigator.clipboard.writeText(summary.trim());
    setMessage('Opportunity summary copied.');
  };

  const getOrCreateCompanyId = async (
    companyName: string | null | undefined
  ): Promise<string | null> => {
    if (!user || !companyName?.trim()) return null;

    const cleanCompanyName = companyName.trim();

    const { data: existingCompany, error: findError } = await supabase
      .from('companies')
      .select('id')
      .eq('user_id', user.id)
      .ilike('name', cleanCompanyName)
      .maybeSingle();

    if (findError) throw new Error(findError.message);

    if (existingCompany) return existingCompany.id;

    const { data: newCompany, error: companyError } = await supabase
      .from('companies')
      .insert({
        user_id: user.id,
        name: cleanCompanyName,
      })
      .select('id')
      .single();

    if (companyError) throw new Error(companyError.message);

    return newCompany.id;
  };

  const handleAddToApplications = async (item: SharedOpportunityWithSender) => {
    if (!user) return;

    if (item.added_application_id) {
      navigate(`/applications/${item.added_application_id}`);
      return;
    }

    setSavingToApplicationsId(item.id);
    setError('');
    setMessage('');

    try {
      const companyId = await getOrCreateCompanyId(item.company_name);
      const now = new Date().toISOString();

      const { data: insertedApplication, error: insertError } = await supabase
        .from('applications')
        .insert({
          user_id: user.id,
          company_id: companyId,
          role_title: item.role_title,
          application_link: item.job_link || null,
          location: item.location || null,
          status: 'wishlist',
          source: 'Shared via JTracker',
          notes: item.note
            ? `Shared opportunity note:\n${item.note}`
            : 'Added from a shared JTracker opportunity.',
          date_applied: null,
          last_status_changed_at: now,
        })
        .select('id')
        .single();

      if (insertError) throw new Error(insertError.message);

      await supabase.from('application_events').insert({
        user_id: user.id,
        application_id: insertedApplication.id,
        event_type: 'created_from_shared_opportunity',
        title: 'Application created from shared opportunity',
        description: `Created from shared role: ${item.role_title}.`,
        event_date: now,
      });

      const { error: updateShareError } = await supabase
        .from('shared_opportunities')
        .update({
          added_to_applications_at: now,
          added_application_id: insertedApplication.id,
        })
        .eq('id', item.id)
        .eq('recipient_user_id', user.id);

      if (updateShareError) throw new Error(updateShareError.message);

      setItems((prev) =>
        prev.map((sharedItem) =>
          sharedItem.id === item.id
            ? {
                ...sharedItem,
                added_to_applications_at: now,
                added_application_id: insertedApplication.id,
              }
            : sharedItem
        )
      );

      setSavingToApplicationsId(null);
      navigate(`/applications/${insertedApplication.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add opportunity.');
      setSavingToApplicationsId(null);
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-full overflow-hidden">
        <div className="h-8 w-52 bg-slate-200 rounded-lg animate-pulse mb-2" />
        <div className="h-4 w-full max-w-96 bg-slate-100 rounded-lg animate-pulse mb-8" />

        <div className="space-y-4">
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-44 bg-white border border-slate-200 rounded-2xl animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-full overflow-hidden">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5 mb-8">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <Inbox size={28} className="text-slate-700 shrink-0" />
            <h2 className="text-2xl sm:text-3xl font-bold break-words">
              Shared With Me
            </h2>
          </div>

          <p className="text-slate-500 text-sm sm:text-base max-w-2xl">
            Opportunities other JTracker users shared with you. You can add them to your
            own applications and complete the details from there.
          </p>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="w-full sm:w-auto border border-slate-200 bg-white rounded-xl px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && <AlertBox type="error" message={error} onClose={() => setError('')} />}
      {message && <AlertBox type="success" message={message} onClose={() => setMessage('')} />}

      {items.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-10 text-center">
          <Briefcase size={38} className="mx-auto text-slate-400 mb-3" />
          <h3 className="text-lg font-semibold">No shared opportunities yet</h3>
          <p className="text-slate-500 text-sm sm:text-base mt-2 max-w-md mx-auto">
            When someone shares a role with you inside JTracker, it will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const senderName =
              item.sender_profile?.full_name ||
              item.sender_profile?.email ||
              'JTracker user';

            const alreadyAdded = Boolean(item.added_application_id);

            return (
              <div
                key={item.id}
                className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 overflow-hidden"
              >
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h3 className="text-lg sm:text-xl font-bold text-slate-900 break-words">
                        {item.role_title}
                      </h3>

                      {item.include_status && item.status_snapshot && (
                        <span className="rounded-full px-2.5 py-1 text-xs bg-slate-100 text-slate-700 capitalize">
                          {item.status_snapshot.replaceAll('_', ' ')}
                        </span>
                      )}

                      {alreadyAdded && (
                        <span className="rounded-full px-2.5 py-1 text-xs bg-emerald-50 text-emerald-700">
                          Added to Applications
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-4 text-sm text-slate-600 mb-3">
                      <span className="inline-flex items-center gap-1.5 break-words">
                        <Briefcase size={15} className="shrink-0" />
                        {item.company_name || 'Unknown Company'}
                      </span>

                      {item.location && (
                        <span className="inline-flex items-center gap-1.5 break-words">
                          <MapPin size={15} className="shrink-0" />
                          {item.location}
                        </span>
                      )}

                      <span className="inline-flex items-center gap-1.5 break-words">
                        <UserRound size={15} className="shrink-0" />
                        Shared by {senderName}
                      </span>
                    </div>

                    {item.note && (
                      <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-3 mb-3 whitespace-pre-wrap break-words">
                        {item.note}
                      </p>
                    )}

                    {item.include_notes && item.notes_snapshot && (
                      <p className="text-sm text-slate-700 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 whitespace-pre-wrap break-words">
                        Sender notes: {item.notes_snapshot}
                      </p>
                    )}

                    {item.include_experience && item.experience_snapshot && (
                      <p className="text-sm text-slate-700 bg-blue-50 border border-blue-200 rounded-xl p-3 mb-3 whitespace-pre-wrap break-words">
                        Experience: {item.experience_snapshot}
                      </p>
                    )}

                    <p className="text-xs text-slate-500 break-words">
                      Shared {formatDateTime(item.created_at)}
                      {item.added_to_applications_at
                        ? ` · Added ${formatDateTime(item.added_to_applications_at)}`
                        : ''}
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 lg:justify-end w-full lg:w-auto">
                    {alreadyAdded ? (
                      <button
                        onClick={() => navigate(`/applications/${item.added_application_id}`)}
                        className="w-full sm:w-auto border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm inline-flex items-center justify-center gap-2 hover:bg-slate-50"
                      >
                        <Eye size={15} />
                        View Application
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAddToApplications(item)}
                        disabled={savingToApplicationsId === item.id}
                        className="w-full sm:w-auto bg-slate-900 text-white px-4 py-2 rounded-lg text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <PlusCircle size={15} />
                        {savingToApplicationsId === item.id
                          ? 'Adding...'
                          : 'Add to Applications'}
                      </button>
                    )}

                    <button
                      onClick={() => handleCopySummary(item)}
                      className="w-full sm:w-auto border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm inline-flex items-center justify-center gap-2 hover:bg-slate-50"
                    >
                      <Copy size={15} />
                      Copy
                    </button>

                    {item.job_link && (
                      <a
                        href={item.job_link}
                        target="_blank"
                        rel="noreferrer"
                        className="w-full sm:w-auto border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm inline-flex items-center justify-center gap-2 hover:bg-slate-50"
                      >
                        Open Role
                        <ExternalLink size={15} />
                      </a>
                    )}
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
        ? 'bg-red-50 text-red-700 border-red-200'
        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
    }`}
  >
    {type === 'error' ? (
      <AlertCircle size={18} className="mt-0.5 shrink-0" />
    ) : (
      <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
    )}

    <p className="text-sm flex-1 break-words">{message}</p>

    <button onClick={onClose} className="shrink-0 opacity-70 hover:opacity-100">
      <X size={16} />
    </button>
  </div>
);