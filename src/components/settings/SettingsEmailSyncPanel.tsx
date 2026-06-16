import React, { useEffect, useMemo, useState } from 'react';
import {
AlertTriangle,
CheckCircle2,
Clock3,
History,
Inbox,
Link2,
Mail,
RefreshCw,
Save,
Settings2,
ShieldCheck,
Trash2,
} from 'lucide-react';

import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

type EmailProvider = 'gmail' | 'outlook' | 'manual';

interface EmailSyncSettingsShape {
gmail_sync_enabled: boolean;
gmail_max_emails_per_sync: number;
gmail_recruitment_only: boolean;
ai_email_analysis_enabled: boolean;
ai_confidence_threshold: number;
}

interface EmailSyncSession {
id: string;
provider: EmailProvider;
scanned_count: number | null;
accepted_count: number | null;
review_count: number | null;
rejected_count: number | null;
processing_time_ms: number | null;
status: string | null;
error_message: string | null;
created_at: string;
}

interface IgnoredEmailEvent {
id: string;
provider: EmailProvider;
provider_message_id: string | null;
subject: string | null;
sender: string | null;
reason: string | null;
created_at: string;
}

interface SettingsEmailSyncPanelProps {
settings: EmailSyncSettingsShape;
emailSyncFeatureEnabled: boolean;
saving: boolean;
onUpdate: <K extends keyof EmailSyncSettingsShape>(
key: K,
value: EmailSyncSettingsShape[K],
) => void;
onSave: () => void;
onOpenEmailEvents: () => void;
}

const inputCls =
'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed transition';

const formatRelativeTime = (date?: string | null) => {
if (!date) return 'Never';

const diffMs = Date.now() - new Date(date).getTime();
const diffMinutes = Math.floor(diffMs / 60000);
const diffHours = Math.floor(diffMinutes / 60);
const diffDays = Math.floor(diffHours / 24);

if (diffMinutes < 1) return 'just now';
if (diffMinutes < 60) return `${diffMinutes} min ago`;
if (diffHours < 24) return `${diffHours}h ago`;
if (diffDays < 7) return `${diffDays}d ago`;

return new Date(date).toLocaleDateString('en-GB', {
day: 'numeric',
month: 'short',
});
};

const formatSessionDate = (date: string) => {
const value = new Date(date);
const today = new Date();

const yesterday = new Date();
yesterday.setDate(today.getDate() - 1);

const time = value.toLocaleTimeString('en-GB', {
hour: '2-digit',
minute: '2-digit',
});

if (value.toDateString() === today.toDateString()) return `Today, ${time}`;
if (value.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;

return value.toLocaleDateString('en-GB', {
day: 'numeric',
month: 'short',
});
};

const providerLabel = (provider?: string | null) => {
if (provider === 'gmail') return 'Gmail';
if (provider === 'outlook') return 'Outlook';
if (provider === 'manual') return 'Manual';
return 'Email';
};

const initialsFromSender = (sender?: string | null) => {
if (!sender) return '??';

const clean = sender
.replace(/<.*?>/g, '')
.replace(/["']/g, '')
.trim();

const parts = clean.split(/[ .@_-]+/).filter(Boolean);

if (parts.length === 0) return '??';

return parts
.slice(0, 2)
.map((part) => part[0]?.toUpperCase())
.join('');
};

export const SettingsEmailSyncPanel: React.FC<SettingsEmailSyncPanelProps> = ({
settings,
emailSyncFeatureEnabled,
saving,
onUpdate,
onSave,
onOpenEmailEvents,
}) => {
const { user } = useAuth();

const [sessions, setSessions] = useState<EmailSyncSession[]>([]);
const [ignoredEmails, setIgnoredEmails] = useState<IgnoredEmailEvent[]>([]);
const [emailEventsCount, setEmailEventsCount] = useState(0);
const [loading, setLoading] = useState(true);
const [dismissingId, setDismissingId] = useState('');
const [panelMessage, setPanelMessage] = useState('');
const [panelError, setPanelError] = useState('');

const latestSession = sessions[0];

const totals = useMemo(() => {
return sessions.reduce(
(acc, session) => {
acc.scanned += session.scanned_count || 0;
acc.accepted += session.accepted_count || 0;
acc.review += session.review_count || 0;
acc.skipped += session.rejected_count || 0;


    return acc;
  },
  {
    scanned: 0,
    accepted: 0,
    review: 0,
    skipped: 0,
  },
);


}, [sessions]);

const loadPanelData = async () => {
if (!user) return;


setLoading(true);
setPanelError('');

const [sessionsResult, ignoredResult, emailEventsResult] = await Promise.all([
  supabase
    .from('email_sync_sessions')
    .select(
      'id, provider, scanned_count, accepted_count, review_count, rejected_count, processing_time_ms, status, error_message, created_at',
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(6),

  supabase
    .from('ignored_email_events')
    .select('id, provider, provider_message_id, subject, sender, reason, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(8),

  supabase
    .from('email_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id),
]);

if (sessionsResult.error) {
  setPanelError(sessionsResult.error.message);
} else {
  setSessions((sessionsResult.data || []) as EmailSyncSession[]);
}

if (ignoredResult.error) {
  setPanelError(ignoredResult.error.message);
} else {
  setIgnoredEmails((ignoredResult.data || []) as IgnoredEmailEvent[]);
}

if (emailEventsResult.error) {
  setPanelError(emailEventsResult.error.message);
} else {
  setEmailEventsCount(emailEventsResult.count || 0);
}

setLoading(false);


};

useEffect(() => {
loadPanelData();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [user?.id]);

const handleDismissIgnoredEmail = async (ignoredEmailId: string) => {
if (!user) return;


setDismissingId(ignoredEmailId);
setPanelError('');
setPanelMessage('');

const { error } = await supabase
  .from('ignored_email_events')
  .delete()
  .eq('id', ignoredEmailId)
  .eq('user_id', user.id);

if (error) {
  setPanelError(error.message);
  setDismissingId('');
  return;
}

setIgnoredEmails((prev) => prev.filter((email) => email.id !== ignoredEmailId));
setPanelMessage('Ignored email dismissed.');
setDismissingId('');


};

const handleDismissAllIgnored = async () => {
if (!user || ignoredEmails.length === 0) return;


const confirmed = window.confirm(
  'Dismiss all ignored emails? This removes them from the recovery list.',
);

if (!confirmed) return;

setPanelError('');
setPanelMessage('');

const { error } = await supabase
  .from('ignored_email_events')
  .delete()
  .eq('user_id', user.id);

if (error) {
  setPanelError(error.message);
  return;
}

setIgnoredEmails([]);
setPanelMessage('All ignored emails dismissed.');


};

return ( <div className="space-y-5">
{panelError && (
<MiniFeedback
type="error"
message={panelError}
onClose={() => setPanelError('')}
/>
)}


  {panelMessage && (
    <MiniFeedback
      type="success"
      message={panelMessage}
      onClose={() => setPanelMessage('')}
    />
  )}

  <section>
    <div className="flex items-center gap-2 mb-2">
      <Mail size={17} className="text-slate-600" />
      <h4 className="text-sm font-semibold text-slate-900">
        Email Sync Control Centre
      </h4>
    </div>

    <p className="text-sm text-slate-500 mb-4">
      Manage how JTracker processes Gmail or Outlook recruitment emails and automatically updates application statuses.
    </p>

    {!emailSyncFeatureEnabled && (
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 flex items-start gap-3">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <span>
          Email Sync is disabled in the feature configuration. Enable `FEATURES.EMAIL_SYNC` before this can process emails.
        </span>
      </div>
    )}

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      <MetricBox
        value={latestSession ? formatRelativeTime(latestSession.created_at) : 'Never'}
        label="Last synced"
      />

      <MetricBox
        value={String(totals.scanned)}
        label="Total scanned"
      />

      <MetricBox
        value={String(emailEventsCount || totals.accepted)}
        label="Linked / saved"
        tone="green"
      />

      <MetricBox
        value={String(ignoredEmails.length)}
        label="Ignored emails"
        tone="red"
      />
    </div>
  </section>

  <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <div className="flex items-center gap-2 mb-4">
      <Settings2 size={17} className="text-slate-600" />
      <h4 className="text-sm font-semibold text-slate-900">
        Automation settings
      </h4>
    </div>

    <div className="divide-y divide-slate-200">
      <ToggleRow
        label="Email sync enabled"
        hint="Allow JTracker to process synced Gmail or Outlook recruitment emails."
        enabled={settings.gmail_sync_enabled && emailSyncFeatureEnabled}
        onChange={(value) => onUpdate('gmail_sync_enabled', value)}
      />

      <ToggleRow
        label="Recruitment-only mode"
        hint="Ignore newsletters, receipts, promotions, and non-job-search emails."
        enabled={settings.gmail_recruitment_only}
        onChange={(value) => onUpdate('gmail_recruitment_only', value)}
      />

      <ToggleRow
        label="AI email analysis"
        hint="Use email intelligence to detect application status from email content."
        enabled={settings.ai_email_analysis_enabled}
        onChange={(value) => onUpdate('ai_email_analysis_enabled', value)}
      />

      <div className="py-4">
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
          Max emails per sync
        </label>

        <input
          type="number"
          min={5}
          max={100}
          className={inputCls}
          value={settings.gmail_max_emails_per_sync}
          onChange={(event) =>
            onUpdate('gmail_max_emails_per_sync', Number(event.target.value))
          }
        />

        <p className="text-xs text-slate-500 mt-1">
          Recommended: 50 for normal use, 100 when catching up after a long period.
        </p>
      </div>

      <div className="py-4">
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
          Auto-update confidence threshold: {settings.ai_confidence_threshold}%
        </label>

        <input
          type="range"
          min={70}
          max={99}
          value={settings.ai_confidence_threshold}
          onChange={(event) =>
            onUpdate('ai_confidence_threshold', Number(event.target.value))
          }
          className="w-full"
        />

        <p className="text-xs text-slate-500 mt-1">
          Rejection emails below the safe threshold should stay in the review queue.
        </p>
      </div>
    </div>

    <div className="mt-4 flex justify-end">
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm inline-flex items-center gap-2 disabled:opacity-50"
      >
        <Save size={14} />
        {saving ? 'Saving...' : 'Save Email Settings'}
      </button>
    </div>
  </section>

  <section className="rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex items-center gap-2 mb-4">
      <History size={17} className="text-slate-600" />
      <h4 className="text-sm font-semibold text-slate-900 flex-1">
        Recent sync sessions
      </h4>

      <button
        type="button"
        onClick={loadPanelData}
        disabled={loading}
        className="text-xs font-medium text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"
      >
        <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        Refresh
      </button>
    </div>

    <div className="flex flex-wrap gap-3 mb-3">
      <LegendItem label="Scanned" className="bg-blue-200" />
      <LegendItem label="Linked" className="bg-emerald-200" />
      <LegendItem label="Needs review" className="bg-amber-200" />
      <LegendItem label="Skipped" className="bg-slate-300" />
    </div>

    {sessions.length === 0 ? (
      <EmptyState
        icon={<Clock3 size={24} />}
        title="No sync sessions yet"
        description="Run Email Sync to start collecting session history."
      />
    ) : (
      <div className="divide-y divide-slate-100">
        {sessions.map((session) => (
          <SessionRow key={session.id} session={session} />
        ))}
      </div>
    )}
  </section>

  <section className="rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex items-center gap-2 mb-4">
      <Inbox size={17} className="text-slate-600" />

      <h4 className="text-sm font-semibold text-slate-900 flex-1">
        Ignored emails recovery
      </h4>

      <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
        {ignoredEmails.length} skipped
      </span>
    </div>

    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-4 flex items-start gap-3">
      <AlertTriangle size={16} className="text-amber-700 shrink-0 mt-0.5" />

      <p className="text-xs leading-5 text-amber-800">
        These emails were skipped during sync. Review them occasionally to recover missed applications or false negatives.
      </p>
    </div>

    {ignoredEmails.length === 0 ? (
      <EmptyState
        icon={<CheckCircle2 size={26} />}
        title="No ignored emails"
        description="You are all caught up."
      />
    ) : (
      <div className="divide-y divide-slate-100">
        {ignoredEmails.map((email) => (
          <IgnoredEmailRow
            key={email.id}
            email={email}
            dismissing={dismissingId === email.id}
            onDismiss={() => handleDismissIgnoredEmail(email.id)}
            onReview={onOpenEmailEvents}
          />
        ))}
      </div>
    )}

    <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <button
        type="button"
        onClick={onOpenEmailEvents}
        className="inline-flex items-center gap-2 text-xs font-medium text-blue-600 hover:text-blue-700"
      >
        <Link2 size={13} />
        Open Email Events
      </button>

      <button
        type="button"
        onClick={handleDismissAllIgnored}
        disabled={ignoredEmails.length === 0}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        <Trash2 size={13} />
        Dismiss all
      </button>
    </div>
  </section>

  <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
    <ShieldCheck size={18} className="text-emerald-700 shrink-0 mt-0.5" />

    <div>
      <p className="text-sm font-semibold text-emerald-800">
        Auto-rejection safety rule
      </p>

      <p className="text-xs leading-5 text-emerald-700 mt-1">
        The automation should only auto-archive a rejection when the email is clearly a rejection, the email passes recruitment filtering, and the matched application score is high. Anything uncertain should remain in review.
      </p>
    </div>
  </section>
</div>


);
};

const Toggle = ({
enabled,
onChange,
}: {
enabled: boolean;
onChange: (value: boolean) => void;
}) => (
<button
type="button"
onClick={() => onChange(!enabled)}
className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
      enabled ? 'bg-slate-900' : 'bg-slate-200'
    }`}

>


<span



  className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
    enabled ? 'translate-x-6' : 'translate-x-1'
  }`}
/>


  </button>
);

const ToggleRow = ({
label,
hint,
enabled,
onChange,
}: {
label: string;
hint: string;
enabled: boolean;
onChange: (value: boolean) => void;
}) => (

  <div className="flex items-center justify-between gap-4 py-4">
    <div>
      <p className="text-sm font-medium text-slate-900">{label}</p>
      <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
    </div>


<Toggle enabled={enabled} onChange={onChange} />


  </div>
);

const MetricBox = ({
value,
label,
tone = 'default',
}: {
value: string;
label: string;
tone?: 'default' | 'green' | 'red';
}) => {
const valueClass =
tone === 'green'
? 'text-emerald-700'
: tone === 'red'
? 'text-red-700'
: 'text-slate-900';

return ( <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">
<p className={`text-lg font-semibold leading-none ${valueClass}`}>
{value} </p>


  <p className="text-[11px] text-slate-500 mt-1">
    {label}
  </p>
</div>


);
};

const LegendItem = ({
label,
className,
}: {
label: string;
className: string;
}) => (

  <div className="flex items-center gap-1.5 text-xs text-slate-500">
    <span className={`w-2.5 h-2.5 rounded ${className}`} />
    {label}
  </div>
);

const SessionRow = ({ session }: { session: EmailSyncSession }) => {
const scanned = session.scanned_count || 0;
const accepted = session.accepted_count || 0;
const review = session.review_count || 0;
const skipped = session.rejected_count || 0;
const timeSeconds = ((session.processing_time_ms || 0) / 1000).toFixed(1);

return ( <div className="py-3 flex flex-col lg:flex-row lg:items-center gap-3"> <div className="w-full lg:w-32 shrink-0"> <p className="text-xs font-medium text-slate-600">
{formatSessionDate(session.created_at)} </p>


    <p className="text-[11px] text-slate-400">
      {providerLabel(session.provider)}
    </p>
  </div>

  <div className="flex flex-wrap gap-1.5 flex-1">
    <SessionPill className="bg-blue-50 text-blue-700" label={`${scanned} scanned`} />
    <SessionPill className="bg-emerald-50 text-emerald-700" label={`${accepted} linked`} />

    {review > 0 && (
      <SessionPill className="bg-amber-50 text-amber-700" label={`${review} review`} />
    )}

    {skipped > 0 && (
      <SessionPill className="bg-slate-100 text-slate-600" label={`${skipped} skipped`} />
    )}

    {session.status === 'failed' && (
      <SessionPill className="bg-red-50 text-red-700" label="Failed" />
    )}
  </div>

  <p className="text-xs text-slate-400 lg:text-right lg:w-16">
    {timeSeconds}s
  </p>
</div>


);
};

const SessionPill = ({
className,
label,
}: {
className: string;
label: string;
}) => (
<span className={`inline-flex rounded-lg px-2.5 py-1 text-[11px] font-semibold ${className}`}>
{label} </span>
);

const IgnoredEmailRow = ({
email,
dismissing,
onDismiss,
onReview,
}: {
email: IgnoredEmailEvent;
dismissing: boolean;
onDismiss: () => void;
onReview: () => void;
}) => (

  <div className="py-3 flex items-start gap-3">
    <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-500 shrink-0">
      {initialsFromSender(email.sender)}
    </div>


<div className="flex-1 min-w-0">
  <p className="text-sm font-semibold text-slate-800 truncate">
    {email.sender || 'Unknown sender'}
  </p>

  <p className="text-sm text-slate-500 truncate mt-0.5">
    {email.subject || 'No subject'}
  </p>

  <div className="flex flex-wrap items-center gap-2 mt-1">
    <span className="text-xs text-slate-400">
      {formatRelativeTime(email.created_at)}
    </span>

    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
      {email.reason || 'Skipped'}
    </span>

    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
      {providerLabel(email.provider)}
    </span>
  </div>
</div>

<div className="flex items-center gap-2 shrink-0">
  <button
    type="button"
    onClick={onReview}
    className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
  >
    <Link2 size={13} />
    Review
  </button>

  <button
    type="button"
    onClick={onDismiss}
    disabled={dismissing}
    className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
  >
    {dismissing ? '...' : <Trash2 size={13} />}
  </button>
</div>


  </div>
);

const EmptyState = ({
icon,
title,
description,
}: {
icon: React.ReactNode;
title: string;
description: string;
}) => (

  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
    <div className="mx-auto text-slate-300 mb-2 flex justify-center">
      {icon}
    </div>


<p className="text-sm font-semibold text-slate-700">
  {title}
</p>

<p className="text-xs text-slate-500 mt-1">
  {description}
</p>


  </div>
);

const MiniFeedback = ({
type,
message,
onClose,
}: {
type: 'success' | 'error';
message: string;
onClose: () => void;
}) => (

  <div
    className={`rounded-xl p-4 flex items-start gap-3 border ${
      type === 'success'
        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
        : 'bg-red-50 border-red-200 text-red-700'
    }`}
  >
    {type === 'success' ? (
      <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
    ) : (
      <AlertTriangle size={16} className="shrink-0 mt-0.5" />
    )}


<span className="text-sm flex-1">{message}</span>

<button type="button" onClick={onClose}>
  ×
</button>


  </div>
);
