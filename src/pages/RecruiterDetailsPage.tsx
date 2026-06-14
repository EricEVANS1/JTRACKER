import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
ArrowLeft,
Briefcase,
CalendarCheck,
CheckCircle2,
ExternalLink,
Mail,
MessageSquare,
Phone,
Plus,
RefreshCw,
Send,
UserRound,
X,
} from 'lucide-react';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useOnboarding } from '../hooks/useOnboarding';
import { OnboardingHint } from '../components/OnboardingHint';

interface Recruiter {
id: string;
name: string;
email: string | null;
linkedin_url: string | null;
phone: string | null;
role_title: string | null;
notes: string | null;
companies?: {
name: string;
} | null;
}

interface RecruiterInteraction {
id: string;
interaction_type: string;
title: string;
description: string | null;
interaction_date: string;
}

interface RecruiterApplication {
id: string;
role_title: string;
status: string;
date_applied: string | null;
application_link: string | null;
}

type QuickInteractionType =
| 'note'
| 'email'
| 'phone_call'
| 'linkedin'
| 'follow_up'
| 'interview';

const inputCls =
'w-full border border-slate-300 rounded-xl px-3 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition';

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

const formatDate = (date?: string | null) => {
if (!date) return 'Not set';

return new Date(date).toLocaleDateString('en-GB', {
day: 'numeric',
month: 'short',
year: 'numeric',
});
};

const formatStatus = (status?: string | null) => {
if (!status) return 'Not set';

return status
.replaceAll('_', ' ')
.replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatInteractionType = (type?: string | null) => {
if (!type) return 'Note';

return type
.replaceAll('_', ' ')
.replace(/\b\w/g, (char) => char.toUpperCase());
};

const getInitials = (name?: string | null) => {
if (!name) return 'R';

const parts = name.trim().split(/\s+/);

if (parts.length === 1) {
return parts[0].slice(0, 2).toUpperCase();
}

return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
};

const getInteractionIcon = (type: string) => {
if (type === 'email') return Mail;
if (type === 'phone_call') return Phone;
if (type === 'linkedin') return ExternalLink;
if (type === 'follow_up') return Send;
if (type === 'interview') return CalendarCheck;

return MessageSquare;
};

const quickActions: {
type: QuickInteractionType;
label: string;
title: string;
icon: React.ElementType;
}[] = [
{
type: 'phone_call',
label: 'Log Call',
title: 'Phone call with recruiter',
icon: Phone,
},
{
type: 'email',
label: 'Log Email',
title: 'Email exchange with recruiter',
icon: Mail,
},
{
type: 'linkedin',
label: 'Log LinkedIn',
title: 'LinkedIn message with recruiter',
icon: ExternalLink,
},
{
type: 'follow_up',
label: 'Log Follow-up',
title: 'Follow-up with recruiter',
icon: Send,
},
{
type: 'interview',
label: 'Log Interview',
title: 'Interview update from recruiter',
icon: CalendarCheck,
},
{
type: 'note',
label: 'Log Note',
title: 'Recruiter note',
icon: MessageSquare,
},
];

export const RecruiterDetailsPage: React.FC = () => {
const { id } = useParams();
const { user } = useAuth();
const { onboardingComplete, completedSteps, refreshOnboarding } = useOnboarding();

const [recruiter, setRecruiter] = useState<Recruiter | null>(null);
const [interactions, setInteractions] = useState<RecruiterInteraction[]>([]);
const [applications, setApplications] = useState<RecruiterApplication[]>([]);

const [loading, setLoading] = useState(true);
const [refreshing, setRefreshing] = useState(false);
const [saving, setSaving] = useState(false);
const [error, setError] = useState('');
const [message, setMessage] = useState('');

const [interactionType, setInteractionType] = useState<QuickInteractionType>('note');
const [title, setTitle] = useState('');
const [description, setDescription] = useState('');

const fetchRecruiter = async () => {
if (!user || !id) return;


setError('');

const { data: recruiterData, error: recruiterError } = await supabase
  .from('recruiters')
  .select(`
    *,
    companies (
      name
    )
  `)
  .eq('id', id)
  .eq('user_id', user.id)
  .single();

if (recruiterError) {
  setError(recruiterError.message);
  setLoading(false);
  return;
}

const { data: interactionData, error: interactionError } = await supabase
  .from('recruiter_interactions')
  .select('*')
  .eq('recruiter_id', id)
  .eq('user_id', user.id)
  .order('interaction_date', { ascending: false });

if (interactionError) {
  setError(interactionError.message);
}

const { data: applicationData, error: applicationError } = await supabase
  .from('applications')
  .select('id, role_title, status, date_applied, application_link')
  .eq('recruiter_id', id)
  .eq('user_id', user.id)
  .order('created_at', { ascending: false });

if (applicationError) {
  setError(applicationError.message);
}

setRecruiter(recruiterData);
setInteractions(interactionData || []);
setApplications(applicationData || []);


};

const loadRecruiter = async () => {
setLoading(true);
await fetchRecruiter();
setLoading(false);
};

const handleRefresh = async () => {
setRefreshing(true);
await fetchRecruiter();
setRefreshing(false);
};

useEffect(() => {
loadRecruiter();
}, [user?.id, id]);

const latestInteraction = useMemo(() => {
if (interactions.length === 0) return null;
return interactions[0];
}, [interactions]);

const interactionCounts = useMemo(() => {
return {
total: interactions.length,
emails: interactions.filter((item) => item.interaction_type === 'email').length,
calls: interactions.filter((item) => item.interaction_type === 'phone_call').length,
linkedIn: interactions.filter((item) => item.interaction_type === 'linkedin').length,
followUps: interactions.filter((item) => item.interaction_type === 'follow_up').length,
};
}, [interactions]);

const handleQuickAction = (type: QuickInteractionType, defaultTitle: string) => {
setInteractionType(type);
setTitle(defaultTitle);


window.setTimeout(() => {
  document.getElementById('interaction-description')?.focus();
}, 50);


};

const handleAddInteraction = async () => {
if (!user || !id || !title.trim()) return;


setSaving(true);
setError('');
setMessage('');

const { error } = await supabase.from('recruiter_interactions').insert({
  user_id: user.id,
  recruiter_id: id,
  interaction_type: interactionType,
  title: title.trim(),
  description: description.trim() || null,
});

if (error) {
  setError(error.message);
  setSaving(false);
  return;
}

setTitle('');
setDescription('');
setInteractionType('note');

await fetchRecruiter();
await refreshOnboarding();

setMessage('Interaction logged successfully.');
setSaving(false);


};

if (loading) {
return <RecruiterDetailsSkeleton />;
}

if (!recruiter) {
return ( <div className="w-full max-w-full overflow-hidden"> <Link
       to="/recruiters"
       className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-6"
     > <ArrowLeft size={16} />
Back to Recruiters </Link>


    <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
      <UserRound size={36} className="mx-auto text-slate-300 mb-3" />
      <h2 className="text-lg font-semibold">Recruiter not found</h2>
      <p className="text-sm text-slate-500 mt-2">
        This recruiter may have been deleted or you may not have access to it.
      </p>
    </div>
  </div>
);


}

return ( <div className="w-full max-w-full overflow-hidden"> <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6"> <Link
       to="/recruiters"
       className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
     > <ArrowLeft size={16} />
Back to Recruiters </Link>


    <button
      type="button"
      onClick={handleRefresh}
      disabled={refreshing}
      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
    >
      <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
      {refreshing ? 'Refreshing...' : 'Refresh'}
    </button>
  </div>

  {error && <AlertBox type="error" message={error} onClose={() => setError('')} />}
  {message && <AlertBox type="success" message={message} onClose={() => setMessage('')} />}

  {!onboardingComplete && !completedSteps.hasRecruiter && (
    <OnboardingHint
      title="Log your first recruiter interaction"
      description="Recruiter notes help you track conversations, follow-ups, LinkedIn messages, and interview progress."
    />
  )}

  <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-4 sm:p-8 mb-6 overflow-hidden">
    <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6">
      <div className="flex flex-col sm:flex-row sm:items-start gap-5 min-w-0">
        <div className="w-16 h-16 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-xl font-bold shrink-0">
          {getInitials(recruiter.name)}
        </div>

        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-slate-400 mb-2">
            Recruiter CRM
          </p>

          <h1 className="text-2xl sm:text-3xl font-bold break-words">
            {recruiter.name}
          </h1>

          <p className="text-slate-500 mt-1 break-words">
            {recruiter.role_title || 'Recruiter'}
            {recruiter.companies?.name ? ` · ${recruiter.companies.name}` : ''}
          </p>

          <div className="flex flex-wrap gap-2 mt-4">
            <StatBadge label="Applications" value={applications.length} />
            <StatBadge label="Interactions" value={interactionCounts.total} />
            <StatBadge
              label="Last contact"
              value={latestInteraction ? formatDate(latestInteraction.interaction_date) : 'None'}
            />
          </div>
        </div>
      </div>

      <div className="w-full xl:w-auto flex flex-col sm:flex-row xl:flex-col gap-2">
        {recruiter.email ? (
          <a
            href={`mailto:${recruiter.email}`}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white hover:bg-slate-700 transition"
          >
            <Mail size={16} />
            Email
          </a>
        ) : (
          <DisabledAction icon={Mail} label="No email" />
        )}

        {recruiter.phone ? (
          <a
            href={`tel:${recruiter.phone}`}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition"
          >
            <Phone size={16} />
            Call
          </a>
        ) : (
          <DisabledAction icon={Phone} label="No phone" />
        )}

        {recruiter.linkedin_url ? (
          <a
            href={recruiter.linkedin_url}
            target="_blank"
            rel="noreferrer"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition"
          >
            <ExternalLink size={16} />
            Open LinkedIn
          </a>
        ) : (
          <DisabledAction icon={ExternalLink} label="No LinkedIn" />
        )}
      </div>
    </div>

    {recruiter.notes && (
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mt-6 whitespace-pre-wrap break-words text-sm text-slate-700">
        {recruiter.notes}
      </div>
    )}
  </div>

  <div className="grid grid-cols-1 xl:grid-cols-[0.95fr_1.05fr] gap-6 mb-6">
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 overflow-hidden">
      <h2 className="text-xl font-semibold mb-1 break-words">
        Quick Actions
      </h2>

      <p className="text-sm text-slate-500 mb-5 break-words">
        Log recruiter activity quickly after a call, email, LinkedIn message, or follow-up.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        {quickActions.map((action) => {
          const Icon = action.icon;

          return (
            <button
              key={action.type}
              type="button"
              onClick={() => handleQuickAction(action.type, action.title)}
              className={`rounded-xl border px-4 py-3 text-sm font-medium transition flex items-center justify-center gap-2 ${
                interactionType === action.type
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Icon size={16} />
              {action.label}
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
            Interaction title
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Example: Followed up after interview"
            className={inputCls}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
            Interaction type
          </label>
          <select
            value={interactionType}
            onChange={(e) => setInteractionType(e.target.value as QuickInteractionType)}
            className={inputCls}
          >
            <option value="note">Note</option>
            <option value="email">Email</option>
            <option value="phone_call">Phone Call</option>
            <option value="linkedin">LinkedIn</option>
            <option value="follow_up">Follow-up</option>
            <option value="interview">Interview</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
            Details
          </label>
          <textarea
            id="interaction-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happened? What did the recruiter say? What is the next step?"
            className={`${inputCls} min-h-32 resize-y`}
          />
        </div>

        <button
          type="button"
          onClick={handleAddInteraction}
          disabled={saving || !title.trim()}
          className="w-full bg-slate-900 text-white px-4 py-3 rounded-xl text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2 hover:bg-slate-700 transition"
        >
          <Plus size={16} />
          {saving ? 'Saving...' : 'Log Interaction'}
        </button>
      </div>
    </div>

    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 overflow-hidden">
      <h2 className="text-xl font-semibold mb-1 break-words">
        CRM Summary
      </h2>

      <p className="text-sm text-slate-500 mb-5 break-words">
        Relationship activity connected to this recruiter.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SummaryCard label="Total Interactions" value={interactionCounts.total} icon={MessageSquare} />
        <SummaryCard label="Emails" value={interactionCounts.emails} icon={Mail} />
        <SummaryCard label="Calls" value={interactionCounts.calls} icon={Phone} />
        <SummaryCard label="LinkedIn Messages" value={interactionCounts.linkedIn} icon={ExternalLink} />
        <SummaryCard label="Follow-ups" value={interactionCounts.followUps} icon={Send} />
        <SummaryCard label="Linked Applications" value={applications.length} icon={Briefcase} />
      </div>

      <div className="mt-5 rounded-2xl bg-slate-50 border border-slate-200 p-4">
        <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">
          Relationship status
        </p>

        <p className="text-sm text-slate-700 leading-relaxed">
          {latestInteraction
            ? `Last interaction was ${formatInteractionType(latestInteraction.interaction_type)} on ${formatDateTime(latestInteraction.interaction_date)}.`
            : 'No recruiter interactions logged yet. Use the quick actions to start building your recruiter history.'}
        </p>
      </div>
    </div>
  </div>

  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-8 mb-6 overflow-hidden">
    <h2 className="text-xl font-semibold mb-2 break-words">Linked Applications</h2>
    <p className="text-slate-500 mb-6 break-words">
      Applications connected to this recruiter.
    </p>

    {applications.length === 0 ? (
      <EmptyState
        icon={Briefcase}
        title="No linked applications yet"
        description="When an application is linked to this recruiter, it will appear here."
      />
    ) : (
      <div className="space-y-4">
        {applications.map((application) => (
          <div
            key={application.id}
            className="border border-slate-200 rounded-2xl p-4 overflow-hidden hover:bg-slate-50 transition"
          >
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold break-words">
                  {application.role_title}
                </h3>

                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full text-xs break-words">
                    {formatStatus(application.status)}
                  </span>

                  {application.date_applied && (
                    <span className="bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full text-xs break-words">
                      Applied {formatDate(application.date_applied)}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
                <Link
                  to={`/applications/${application.id}`}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 text-white px-3 py-2 hover:bg-slate-700 transition"
                >
                  <ExternalLink size={15} />
                  View
                </Link>

                {application.application_link && (
                  <a
                    href={application.application_link}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 text-slate-700 px-3 py-2 hover:bg-white transition"
                  >
                    <ExternalLink size={15} />
                    Job
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>

  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-8 overflow-hidden">
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
      <div>
        <h2 className="text-xl font-semibold break-words">Recruiter Timeline</h2>
        <p className="text-sm text-slate-500 mt-1 break-words">
          Calls, emails, LinkedIn messages, follow-ups, interview updates, and notes.
        </p>
      </div>

      <span className="rounded-full bg-slate-100 text-slate-600 px-3 py-1 text-xs font-medium shrink-0">
        {interactions.length} total
      </span>
    </div>

    {interactions.length === 0 ? (
      <EmptyState
        icon={MessageSquare}
        title="No recruiter interactions yet"
        description="Use Quick Actions to log calls, emails, LinkedIn messages, and follow-ups."
      />
    ) : (
      <div className="relative">
        <div className="absolute left-5 top-0 bottom-0 w-px bg-slate-200 hidden sm:block" />

        <div className="space-y-4">
          {interactions.map((interaction) => {
            const Icon = getInteractionIcon(interaction.interaction_type);

            return (
              <div
                key={interaction.id}
                className="relative sm:pl-14"
              >
                <div className="hidden sm:flex absolute left-0 top-4 w-10 h-10 rounded-xl bg-slate-900 text-white items-center justify-center">
                  <Icon size={17} />
                </div>

                <div className="border border-slate-200 rounded-2xl p-4 overflow-hidden hover:bg-slate-50 transition">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Icon size={16} className="sm:hidden text-slate-500 shrink-0" />
                        <h3 className="font-semibold break-words">
                          {interaction.title}
                        </h3>
                      </div>

                      <p className="text-sm text-slate-500 break-words">
                        {formatInteractionType(interaction.interaction_type)}
                      </p>

                      {interaction.description && (
                        <p className="text-sm text-slate-600 mt-3 leading-relaxed whitespace-pre-wrap break-words">
                          {interaction.description}
                        </p>
                      )}
                    </div>

                    <span className="text-xs text-slate-500 whitespace-nowrap shrink-0">
                      {formatDateTime(interaction.interaction_date)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    )}
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
    {type === 'success' ? (
      <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
    ) : (
      <X size={16} className="shrink-0 mt-0.5" />
    )}


<span className="text-sm flex-1 break-words">{message}</span>

<button
  type="button"
  onClick={onClose}
  className="opacity-70 hover:opacity-100 shrink-0"
>
  <X size={16} />
</button>


  </div>
);

const StatBadge = ({
label,
value,
}: {
label: string;
value: string | number;
}) => ( <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-600 px-3 py-1 text-xs font-medium">
{label}: {value} </span>
);

const DisabledAction = ({
icon: Icon,
label,
}: {
icon: React.ElementType;
label: string;
}) => (

  <div className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-400 bg-slate-50">
    <Icon size={16} />
    {label}
  </div>
);

const SummaryCard = ({
label,
value,
icon: Icon,
}: {
label: string;
value: number;
icon: React.ElementType;
}) => (

  <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm text-slate-500">{label}</p>
        <p className="text-2xl font-bold text-slate-900 mt-2">{value}</p>
      </div>


  <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0">
    <Icon size={16} className="text-slate-500" />
  </div>
</div>


  </div>
);

const EmptyState = ({
icon: Icon,
title,
description,
}: {
icon: React.ElementType;
title: string;
description: string;
}) => (

  <div className="border border-dashed border-slate-200 rounded-2xl p-8 text-center bg-slate-50">
    <div className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center mx-auto mb-3">
      <Icon size={22} className="text-slate-400" />
    </div>


<h3 className="font-semibold text-slate-700">{title}</h3>
<p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{description}</p>


  </div>
);

const RecruiterDetailsSkeleton = () => (

  <div className="w-full max-w-full overflow-hidden">
    <div className="h-5 w-40 bg-slate-200 rounded animate-pulse mb-6" />


<div className="h-64 bg-white border border-slate-200 rounded-3xl animate-pulse mb-6" />

<div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
  <div className="h-96 bg-white border border-slate-200 rounded-2xl animate-pulse" />
  <div className="h-96 bg-white border border-slate-200 rounded-2xl animate-pulse" />
</div>

<div className="h-72 bg-white border border-slate-200 rounded-2xl animate-pulse mb-6" />
<div className="h-96 bg-white border border-slate-200 rounded-2xl animate-pulse" />


  </div>
);
