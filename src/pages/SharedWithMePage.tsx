import React, { useEffect, useMemo, useState } from 'react';
import {
AlertCircle,
CheckCircle2,
Copy,
ExternalLink,
Inbox,
Link2,
Plus,
RefreshCw,
Send,
Share2,
Trash2,
X,
} from 'lucide-react';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

type ShareTab = 'with_me' | 'by_me' | 'public_links';

interface SharedOpportunity {
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

const inputCls =
'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition';

const formatDate = (date?: string | null) => {
if (!date) return 'Not set';

return new Date(date).toLocaleString('en-GB', {
day: 'numeric',
month: 'short',
year: 'numeric',
hour: '2-digit',
minute: '2-digit',
});
};

const formatStatus = (status?: string | null) => {
if (!status) return 'Not shared';

return status
.replaceAll('_', ' ')
.replace(/\b\w/g, (char) => char.toUpperCase());
};

const getPublicShareUrl = (publicShareId?: string | null) => {
if (!publicShareId) return '';
return `${window.location.origin}/share/${publicShareId}`;
};

export const SharedOpportunitiesPage: React.FC = () => {
const { user } = useAuth();

const [activeTab, setActiveTab] = useState<ShareTab>('with_me');
const [sharedWithMe, setSharedWithMe] = useState<SharedOpportunity[]>([]);
const [sharedByMe, setSharedByMe] = useState<SharedOpportunity[]>([]);
const [publicLinks, setPublicLinks] = useState<SharedOpportunity[]>([]);
const [loading, setLoading] = useState(true);
const [refreshing, setRefreshing] = useState(false);
const [addingId, setAddingId] = useState<string | null>(null);
const [deletingId, setDeletingId] = useState<string | null>(null);
const [copiedId, setCopiedId] = useState<string | null>(null);

const [error, setError] = useState('');
const [message, setMessage] = useState('');

const fetchSharedOpportunities = async () => {
if (!user) return;


setError('');

const [withMeResult, byMeResult, publicLinksResult] = await Promise.all([
  supabase
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
    .eq('recipient_user_id', user.id)
    .order('created_at', { ascending: false }),

  supabase
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
    .eq('sender_user_id', user.id)
    .not('recipient_user_id', 'is', null)
    .order('created_at', { ascending: false }),

  supabase
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
    .eq('sender_user_id', user.id)
    .is('recipient_user_id', null)
    .order('created_at', { ascending: false }),
]);

if (withMeResult.error) setError(withMeResult.error.message);
else setSharedWithMe((withMeResult.data || []) as SharedOpportunity[]);

if (byMeResult.error) setError(byMeResult.error.message);
else setSharedByMe((byMeResult.data || []) as SharedOpportunity[]);

if (publicLinksResult.error) setError(publicLinksResult.error.message);
else setPublicLinks((publicLinksResult.data || []) as SharedOpportunity[]);


};

const loadPage = async () => {
setLoading(true);
await fetchSharedOpportunities();
setLoading(false);
};

const handleRefresh = async () => {
setRefreshing(true);
await fetchSharedOpportunities();
setRefreshing(false);
};

useEffect(() => {
loadPage();
}, [user?.id]);

const activeItems = useMemo(() => {
if (activeTab === 'with_me') return sharedWithMe;
if (activeTab === 'by_me') return sharedByMe;
return publicLinks;
}, [activeTab, sharedWithMe, sharedByMe, publicLinks]);

const tabCounts = {
with_me: sharedWithMe.length,
by_me: sharedByMe.length,
public_links: publicLinks.length,
};

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

const handleAddToTracker = async (opportunity: SharedOpportunity) => {
if (!user) return;


setAddingId(opportunity.id);
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
        : 'Added from a shared opportunity.',
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
      event_type: 'shared_opportunity_added',
      title: 'Shared opportunity added',
      description: `Added ${opportunity.role_title || 'shared opportunity'} to tracker.`,
      event_date: now,
    });
  }

  setMessage('Shared opportunity added to your tracker.');
} catch (err) {
  setError(err instanceof Error ? err.message : 'Failed to add shared opportunity.');
}

setAddingId(null);


};

const handleCopyPublicLink = async (opportunity: SharedOpportunity) => {
const link = getPublicShareUrl(opportunity.public_share_id);


if (!link) {
  setError('This opportunity does not have a public share link.');
  return;
}

await navigator.clipboard.writeText(link);
setCopiedId(opportunity.id);
setMessage('Public share link copied.');

window.setTimeout(() => setCopiedId(null), 2000);


};

const handleCopySummary = async (opportunity: SharedOpportunity) => {
const text = [
'Opportunity shared via JTracker',
'',
opportunity.role_title || 'Untitled role',
opportunity.company_name || 'Unknown company',
opportunity.location ? `Location: ${opportunity.location}` : '',
opportunity.job_link ? `Job link: ${opportunity.job_link}` : '',
opportunity.note ? `Note: ${opportunity.note}` : '',
opportunity.public_share_id ? `Public share: ${getPublicShareUrl(opportunity.public_share_id)}` : '',
]
.filter(Boolean)
.join('\n');


await navigator.clipboard.writeText(text);
setCopiedId(opportunity.id);
setMessage('Share summary copied.');

window.setTimeout(() => setCopiedId(null), 2000);


};

const handleDeleteSharedOpportunity = async (opportunityId: string) => {
if (!user) return;


const confirmed = window.confirm('Delete this shared opportunity record? This will not delete the original application.');

if (!confirmed) return;

setDeletingId(opportunityId);
setError('');
setMessage('');

const { error } = await supabase
  .from('shared_opportunities')
  .delete()
  .eq('id', opportunityId)
  .eq('sender_user_id', user.id);

if (error) {
  setError(error.message);
  setDeletingId(null);
  return;
}

setSharedByMe((prev) => prev.filter((item) => item.id !== opportunityId));
setPublicLinks((prev) => prev.filter((item) => item.id !== opportunityId));
setMessage('Shared opportunity deleted.');
setDeletingId(null);


};

if (loading) {
return <SharedOpportunitiesSkeleton />;
}

return ( <div className="w-full max-w-full overflow-hidden"> <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8"> <div className="min-w-0"> <h2 className="text-2xl sm:text-3xl font-bold mb-1 break-words">
Shared Opportunities </h2> <p className="text-slate-500 text-sm sm:text-base break-words">
Receive job leads from friends, share opportunities, and add shared jobs to your tracker. </p> </div>


    <button
      type="button"
      onClick={handleRefresh}
      disabled={refreshing}
      className="w-full sm:w-auto bg-slate-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-700 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
    >
      <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
      {refreshing ? 'Refreshing...' : 'Refresh'}
    </button>
  </div>

  {error && <AlertBox type="error" message={error} onClose={() => setError('')} />}
  {message && <AlertBox type="success" message={message} onClose={() => setMessage('')} />}

  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
    <OverviewCard
      title="Shared with me"
      value={sharedWithMe.length}
      description="Opportunities other users sent to you."
      icon={Inbox}
    />
    <OverviewCard
      title="Shared by me"
      value={sharedByMe.length}
      description="Direct opportunities you sent to other JTracker users."
      icon={Send}
    />
    <OverviewCard
      title="Public links"
      value={publicLinks.length}
      description="Public links you can share outside JTracker."
      icon={Link2}
    />
  </div>

  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-3 mb-6 overflow-hidden">
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <TabButton
        active={activeTab === 'with_me'}
        label="Shared with me"
        count={tabCounts.with_me}
        onClick={() => setActiveTab('with_me')}
      />
      <TabButton
        active={activeTab === 'by_me'}
        label="Shared by me"
        count={tabCounts.by_me}
        onClick={() => setActiveTab('by_me')}
      />
      <TabButton
        active={activeTab === 'public_links'}
        label="Public links"
        count={tabCounts.public_links}
        onClick={() => setActiveTab('public_links')}
      />
    </div>
  </div>

  {activeItems.length === 0 ? (
    <EmptyState activeTab={activeTab} />
  ) : (
    <div className="space-y-4">
      {activeItems.map((opportunity) => (
        <SharedOpportunityCard
          key={opportunity.id}
          opportunity={opportunity}
          activeTab={activeTab}
          adding={addingId === opportunity.id}
          deleting={deletingId === opportunity.id}
          copied={copiedId === opportunity.id}
          onAddToTracker={handleAddToTracker}
          onCopyPublicLink={handleCopyPublicLink}
          onCopySummary={handleCopySummary}
          onDelete={handleDeleteSharedOpportunity}
        />
      ))}
    </div>
  )}
</div>


);
};

const SharedOpportunityCard = ({
opportunity,
activeTab,
adding,
deleting,
copied,
onAddToTracker,
onCopyPublicLink,
onCopySummary,
onDelete,
}: {
opportunity: SharedOpportunity;
activeTab: ShareTab;
adding: boolean;
deleting: boolean;
copied: boolean;
onAddToTracker: (opportunity: SharedOpportunity) => void;
onCopyPublicLink: (opportunity: SharedOpportunity) => void;
onCopySummary: (opportunity: SharedOpportunity) => void;
onDelete: (opportunityId: string) => void;
}) => {
const publicUrl = getPublicShareUrl(opportunity.public_share_id);

return ( <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-5 hover:shadow-md transition overflow-hidden"> <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4"> <div className="min-w-0 flex items-start gap-3"> <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center shrink-0"> <Share2 size={19} className="text-slate-700" /> </div>


      <div className="min-w-0">
        <h3 className="text-lg font-semibold text-slate-950 break-words">
          {opportunity.role_title || 'Untitled role'}
        </h3>

        <p className="text-sm text-slate-500 mt-1 break-words">
          {opportunity.company_name || 'Unknown company'}
          {opportunity.location ? ` · ${opportunity.location}` : ''}
        </p>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Badge>{activeTab === 'with_me' ? 'Shared with me' : activeTab === 'by_me' ? 'Shared by me' : 'Public link'}</Badge>

          {opportunity.include_status && (
            <Badge>Status: {formatStatus(opportunity.status_snapshot)}</Badge>
          )}

          <Badge>Shared {formatDate(opportunity.created_at)}</Badge>
        </div>
      </div>
    </div>

    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 w-full xl:w-auto xl:justify-end">
      {activeTab === 'with_me' && (
        <button
          type="button"
          onClick={() => onAddToTracker(opportunity)}
          disabled={adding}
          className="w-full sm:w-auto bg-slate-900 text-white rounded-lg px-3 py-2 text-sm hover:bg-slate-700 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          <Plus size={15} />
          {adding ? 'Adding...' : 'Add to my tracker'}
        </button>
      )}

      {opportunity.job_link && (
        <a
          href={opportunity.job_link}
          target="_blank"
          rel="noreferrer"
          className="w-full sm:w-auto border border-slate-200 text-slate-700 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 transition inline-flex items-center justify-center gap-2"
        >
          <ExternalLink size={15} />
          Open job
        </a>
      )}

      {publicUrl && (
        <button
          type="button"
          onClick={() => onCopyPublicLink(opportunity)}
          className="w-full sm:w-auto border border-slate-200 text-slate-700 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 transition inline-flex items-center justify-center gap-2"
        >
          <Link2 size={15} />
          {copied ? 'Copied' : 'Copy public link'}
        </button>
      )}

      <button
        type="button"
        onClick={() => onCopySummary(opportunity)}
        className="w-full sm:w-auto border border-slate-200 text-slate-700 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 transition inline-flex items-center justify-center gap-2"
      >
        <Copy size={15} />
        Copy summary
      </button>

      {activeTab !== 'with_me' && (
        <button
          type="button"
          onClick={() => onDelete(opportunity.id)}
          disabled={deleting}
          className="w-full sm:w-auto border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm hover:bg-red-50 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          <Trash2 size={15} />
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      )}
    </div>
  </div>

  {(opportunity.note || opportunity.notes_snapshot) && (
    <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-600 leading-relaxed break-words whitespace-pre-wrap">
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

  {publicUrl && activeTab === 'public_links' && (
    <div className="mt-4">
      <label className="block">
        <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
          Public share link
        </span>
        <input value={publicUrl} readOnly className={inputCls} />
      </label>
    </div>
  )}
</div>

);
};

const OverviewCard = ({
title,
value,
description,
icon: Icon,
}: {
title: string;
value: number;
description: string;
icon: React.ElementType;
}) => (

  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-5 overflow-hidden">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-slate-500">{title}</p>
        <p className="text-3xl font-bold mt-3">{value}</p>
      </div>


  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
    <Icon size={19} className="text-slate-700" />
  </div>
</div>

<p className="text-xs text-slate-400 mt-3 break-words">{description}</p>


  </div>
);

const TabButton = ({
active,
label,
count,
onClick,
}: {
active: boolean;
label: string;
count: number;
onClick: () => void;
}) => (
<button
type="button"
onClick={onClick}
className={`rounded-xl px-4 py-3 text-sm font-medium transition flex items-center justify-between gap-3 ${
      active
        ? 'bg-slate-900 text-white'
        : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
    }`}

>


<span>{label}</span>



<span
  className={`rounded-full px-2 py-0.5 text-xs ${
    active ? 'bg-white/15 text-white' : 'bg-white text-slate-500'
  }`}
>
  {count}
</span>


  </button>
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

const EmptyState = ({ activeTab }: { activeTab: ShareTab }) => {
const content = {
with_me: {
title: 'No shared opportunities yet',
description: 'When another JTracker user shares a role with you, it will appear here.',
icon: Inbox,
},
by_me: {
title: 'You have not shared directly yet',
description: 'Use the Share button on an application card to send a role to another JTracker user.',
icon: Send,
},
public_links: {
title: 'No public links yet',
description: 'Generate a public share link from an application card to share a job outside JTracker.',
icon: Link2,
},
}[activeTab];

const Icon = content.icon;

return ( <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 sm:p-12 text-center overflow-hidden"> <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4"> <Icon size={24} className="text-slate-500" /> </div>


  <h3 className="text-lg font-semibold text-slate-900">{content.title}</h3>
  <p className="text-sm text-slate-500 mt-2 max-w-lg mx-auto">{content.description}</p>
</div>


);
};

const SharedOpportunitiesSkeleton = () => (

  <div className="w-full max-w-full overflow-hidden">
    <div className="mb-8">
      <div className="h-8 w-72 bg-slate-200 rounded-lg animate-pulse mb-2" />
      <div className="h-4 w-full max-w-96 bg-slate-100 rounded-lg animate-pulse" />
    </div>


<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
  {Array.from({ length: 3 }).map((_, index) => (
    <div key={index} className="h-32 bg-white border border-slate-200 rounded-2xl animate-pulse" />
  ))}
</div>

<div className="h-20 bg-white border border-slate-200 rounded-2xl animate-pulse mb-6" />

<div className="space-y-4">
  {Array.from({ length: 3 }).map((_, index) => (
    <div key={index} className="h-44 bg-white border border-slate-200 rounded-2xl animate-pulse" />
  ))}
</div>


  </div>
);
