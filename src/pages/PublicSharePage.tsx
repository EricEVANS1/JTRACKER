import React, { useEffect, useState } from 'react';
import {
AlertCircle,
Briefcase,
CheckCircle2,
ExternalLink,
Loader2,
Lock,
Plus,
Share2,
UserPlus,
X,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface PublicSharedOpportunity {
id: string;
sender_user_id: string;
recipient_user_id: string | null;
application_id: string | null;
public_share_id: string | null;
role_title: string | null;
company_name: string | null;
location: string | null;
job_link: string | null;
note: string | null;
include_status: boolean | null;
include_notes: boolean | null;
include_experience: boolean | null;
status_snapshot: string | null;
notes_snapshot: string | null;
experience_snapshot: string | null;
created_at: string;
}

interface CompanyRecord {
id: string;
}

const formatDate = (date?: string | null) => {
if (!date) return 'Not set';

return new Date(date).toLocaleString('en-GB', {
day: 'numeric',
month: 'short',
year: 'numeric',
});
};

const formatStatus = (status?: string | null) => {
if (!status) return 'Not shared';

return status
.replaceAll('_', ' ')
.replace(/\b\w/g, (char) => char.toUpperCase());
};

export const PublicSharePage: React.FC = () => {
const { publicShareId } = useParams<{ publicShareId: string }>();
const { user } = useAuth();

const [opportunity, setOpportunity] = useState<PublicSharedOpportunity | null>(null);
const [loading, setLoading] = useState(true);
const [adding, setAdding] = useState(false);
const [error, setError] = useState('');
const [message, setMessage] = useState('');

const fetchSharedOpportunity = async () => {
if (!publicShareId) {
setError('Invalid share link.');
setLoading(false);
return;
}


setError('');

const { data, error } = await supabase
  .from('shared_opportunities')
  .select(`
    id,
    sender_user_id,
    recipient_user_id,
    application_id,
    public_share_id,
    role_title,
    company_name,
    location,
    job_link,
    note,
    include_status,
    include_notes,
    include_experience,
    status_snapshot,
    notes_snapshot,
    experience_snapshot,
    created_at
  `)
  .eq('public_share_id', publicShareId)
  .maybeSingle();

if (error) {
  setError(error.message);
  setLoading(false);
  return;
}

if (!data) {
  setError('This shared opportunity could not be found.');
  setLoading(false);
  return;
}

setOpportunity(data as PublicSharedOpportunity);
setLoading(false);


};

useEffect(() => {
fetchSharedOpportunity();
}, [publicShareId]);

const getOrCreateCompanyId = async (companyName?: string | null): Promise<string | null> => {
if (!user || !companyName?.trim()) return null;


const cleanName = companyName.trim();

const { data: existingCompany, error: findError } = await supabase
  .from('companies')
  .select('id')
  .eq('user_id', user.id)
  .ilike('name', cleanName)
  .maybeSingle();

if (findError) throw new Error(findError.message);

if (existingCompany) {
  return (existingCompany as CompanyRecord).id;
}

const { data: newCompany, error: createError } = await supabase
  .from('companies')
  .insert({
    user_id: user.id,
    name: cleanName,
  })
  .select('id')
  .single();

if (createError) throw new Error(createError.message);

return (newCompany as CompanyRecord).id;


};

const handleAddToTracker = async () => {
if (!user || !opportunity) return;


setAdding(true);
setError('');
setMessage('');

try {
  const companyId = await getOrCreateCompanyId(opportunity.company_name);
  const now = new Date().toISOString();

  const { data: insertedApplication, error: insertError } = await supabase
    .from('applications')
    .insert({
      user_id: user.id,
      company_id: companyId,
      role_title: opportunity.role_title || 'Untitled shared opportunity',
      application_link: opportunity.job_link || null,
      location: opportunity.location || null,
      source: 'shared_opportunity',
      status: 'wishlist',
      date_applied: null,
      notes: opportunity.note
        ? `Shared opportunity note:\n${opportunity.note}`
        : 'Added from a public shared opportunity.',
      priority: 'medium',
      last_status_changed_at: now,
      status_updated_at: now,
    })
    .select('id')
    .single();

  if (insertError) throw new Error(insertError.message);

  if (insertedApplication?.id) {
    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: insertedApplication.id,
      event_type: 'public_shared_opportunity_added',
      title: 'Public shared opportunity added',
      description: `Added ${opportunity.role_title || 'shared opportunity'} from a public share link.`,
      event_date: now,
    });
  }

  setMessage('Opportunity added to your tracker.');
} catch (err) {
  setError(err instanceof Error ? err.message : 'Failed to add opportunity.');
}

setAdding(false);


};

if (loading) {
return ( <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4"> <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-8 text-center"> <Loader2 size={28} className="animate-spin mx-auto text-slate-500 mb-3" /> <p className="text-sm text-slate-500">Loading shared opportunity...</p> </div> </div>
);
}

if (error && !opportunity) {
return ( <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4"> <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-8 max-w-lg w-full text-center"> <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4"> <AlertCircle size={24} className="text-red-600" /> </div>


      <h1 className="text-xl font-bold text-slate-900 mb-2">
        Share link unavailable
      </h1>

      <p className="text-sm text-slate-500 mb-6">
        {error}
      </p>

      <Link
        to="/"
        className="inline-flex justify-center rounded-xl bg-slate-900 px-5 py-3 text-sm text-white hover:bg-slate-700 transition"
      >
        Go to JTracker
      </Link>
    </div>
  </div>
);


}

if (!opportunity) return null;

return ( <div className="min-h-screen bg-slate-50 px-4 py-8 sm:py-12"> <div className="max-w-3xl mx-auto"> <div className="text-center mb-8"> <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center mx-auto mb-4"> <Share2 size={24} /> </div>


      <p className="text-xs uppercase tracking-widest text-slate-400 mb-2">
        Shared with JTracker
      </p>

      <h1 className="text-2xl sm:text-4xl font-bold text-slate-900">
        Someone shared a job opportunity with you
      </h1>

      <p className="text-sm sm:text-base text-slate-500 mt-3 max-w-xl mx-auto">
        Review the opportunity, open the job posting, or save it to your JTracker account.
      </p>
    </div>

    {error && <AlertBox type="error" message={error} onClose={() => setError('')} />}
    {message && <AlertBox type="success" message={message} onClose={() => setMessage('')} />}

    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
      <div className="p-5 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
            <Briefcase size={22} className="text-slate-700" />
          </div>

          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-950 break-words">
              {opportunity.role_title || 'Untitled role'}
            </h2>

            <p className="text-slate-500 mt-1 break-words">
              {opportunity.company_name || 'Unknown company'}
              {opportunity.location ? ` · ${opportunity.location}` : ''}
            </p>

            <div className="flex flex-wrap items-center gap-2 mt-4">
              <Badge>Shared {formatDate(opportunity.created_at)}</Badge>

              {opportunity.include_status && (
                <Badge>Status: {formatStatus(opportunity.status_snapshot)}</Badge>
              )}
            </div>
          </div>
        </div>

        {(opportunity.note || opportunity.notes_snapshot) && (
          <div className="mt-6 bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
            {opportunity.note && (
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">
                  Shared note
                </p>
                <p>{opportunity.note}</p>
              </div>
            )}

            {opportunity.include_notes && opportunity.notes_snapshot && (
              <div className={opportunity.note ? 'mt-4 pt-4 border-t border-slate-200' : ''}>
                <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">
                  Shared application notes
                </p>
                <p>{opportunity.notes_snapshot}</p>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6">
          {opportunity.job_link && (
            <a
              href={opportunity.job_link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              <ExternalLink size={16} />
              Open job posting
            </a>
          )}

          {user ? (
            <button
              type="button"
              onClick={handleAddToTracker}
              disabled={adding}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-700 transition disabled:opacity-50"
            >
              <Plus size={16} />
              {adding ? 'Adding...' : 'Add to my tracker'}
            </button>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-700 transition"
            >
              <UserPlus size={16} />
              Track this with JTracker
            </Link>
          )}
        </div>
      </div>

      <div className="bg-slate-900 text-white p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <Lock size={19} />
          </div>

          <div>
            <h3 className="font-semibold">Track this opportunity properly</h3>
            <p className="text-sm text-slate-300 mt-1 leading-relaxed">
              JTracker helps you save job leads, track follow-ups, monitor responses,
              organise CV versions, and avoid losing opportunities in your inbox.
            </p>
          </div>
        </div>
      </div>
    </div>

    <p className="text-center text-xs text-slate-400 mt-6">
      Public share link powered by JTracker.
    </p>
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


<span className="text-sm flex-1 break-words">{message}</span>

<button type="button" onClick={onClose} className="opacity-70 hover:opacity-100">
  <X size={16} />
</button>


  </div>
);

const Badge = ({ children }: { children: React.ReactNode }) => ( <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-600 px-2.5 py-1 text-xs font-medium">
{children} </span>
);
