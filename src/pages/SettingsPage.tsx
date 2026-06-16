import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
AlertCircle,
Bell,
Bot,
Briefcase,
CheckCircle2,
Download,
Inbox,
Loader2,
LogOut,
Mail,
Save,
Settings,
Shield,
Trash2,
Upload,
UserCircle,
X,
} from 'lucide-react';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FEATURES } from '../config/features';
import { SettingsEmailSyncPanel } from '../components/settings/SettingsEmailSyncPanel';

interface Profile {
id: string;
full_name: string | null;
email: string | null;
avatar_url: string | null;
linkedin_url: string | null;
github_url: string | null;
portfolio_url: string | null;
}

interface UserSettings {
target_role: string | null;
preferred_locations: string | null;
preferred_work_type: string | null;
salary_expectation: string | null;
currency: string | null;
ai_email_analysis_enabled: boolean;
ai_cv_analysis_enabled: boolean;
ai_confidence_threshold: number;
auto_save_ai_insights: boolean;
gmail_sync_enabled: boolean;
gmail_max_emails_per_sync: number;
gmail_recruitment_only: boolean;
}

type TabId =
| 'profile'
| 'jobSearch'
| 'ai'
| 'emailSync'
| 'emailEvents'
| 'notifications'
| 'privacy'
| 'account';

const AVATAR_BUCKET = 'avatars';

const DEFAULT_SETTINGS: UserSettings = {
target_role: '',
preferred_locations: '',
preferred_work_type: 'hybrid',
salary_expectation: '',
currency: 'PLN',
ai_email_analysis_enabled: true,
ai_cv_analysis_enabled: true,
ai_confidence_threshold: 80,
auto_save_ai_insights: true,
gmail_sync_enabled: true,
gmail_max_emails_per_sync: 50,
gmail_recruitment_only: true,
};

const TABS: { id: TabId; label: string }[] = [
{ id: 'profile', label: 'Profile' },
{ id: 'jobSearch', label: 'Job Search' },
{ id: 'ai', label: 'AI Assistant' },
{ id: 'emailSync', label: 'Email Sync' },
{ id: 'emailEvents', label: 'Email Events' },
{ id: 'notifications', label: 'Notifications' },
{ id: 'privacy', label: 'Privacy' },
{ id: 'account', label: 'Account' },
];

const isValidTab = (value: string | null): value is TabId =>
Boolean(value && TABS.some((tab) => tab.id === value));

const inputCls =
'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed transition';

const Toggle = ({
enabled,
onChange,
}: {
enabled: boolean;
onChange: (v: boolean) => void;
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

export const SettingsPage: React.FC = () => {
const { user, signOut } = useAuth();
const fileInputRef = useRef<HTMLInputElement | null>(null);
const [searchParams, setSearchParams] = useSearchParams();

const tabFromUrl = searchParams.get('tab');
const activeTab: TabId = isValidTab(tabFromUrl) ? tabFromUrl : 'profile';

const [profile, setProfile] = useState<Profile | null>(null);
const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

const [fullName, setFullName] = useState('');
const [avatarUrl, setAvatarUrl] = useState('');
const [linkedinUrl, setLinkedinUrl] = useState('');
const [githubUrl, setGithubUrl] = useState('');
const [portfolioUrl, setPortfolioUrl] = useState('');

const [loading, setLoading] = useState(true);
const [savingProfile, setSavingProfile] = useState(false);
const [savingSettings, setSavingSettings] = useState(false);
const [uploadingAvatar, setUploadingAvatar] = useState(false);
const [message, setMessage] = useState('');
const [error, setError] = useState('');

const email = profile?.email || user?.email || '';

const setActiveTab = (tab: TabId) => {
setSearchParams({ tab });
setMessage('');
setError('');
};

const avatarInitials = useMemo(() => {
const name = fullName.trim() || email;


return name
  .split(' ')
  .map((word) => word[0])
  .join('')
  .slice(0, 2)
  .toUpperCase();


}, [fullName, email]);

const fetchData = async () => {
if (!user) return;


setLoading(true);
setError('');

const { data: profileData, error: profileError } = await supabase
  .from('profiles')
  .select(
    'id, full_name, email, avatar_url, linkedin_url, github_url, portfolio_url',
  )
  .eq('id', user.id)
  .single();

if (profileError) {
  setError(profileError.message);
} else {
  setProfile(profileData);
  setFullName(profileData.full_name || '');
  setAvatarUrl(profileData.avatar_url || '');
  setLinkedinUrl(profileData.linkedin_url || '');
  setGithubUrl(profileData.github_url || '');
  setPortfolioUrl(profileData.portfolio_url || '');
}

const { data: settingsData, error: settingsError } = await supabase
  .from('user_settings')
  .select('*')
  .eq('user_id', user.id)
  .maybeSingle();

if (settingsError) {
  setError(settingsError.message);
} else if (settingsData) {
  setSettings({
    ...DEFAULT_SETTINGS,
    ...settingsData,
  });
} else {
  const { error: insertError } = await supabase.from('user_settings').insert({
    user_id: user.id,
    ...DEFAULT_SETTINGS,
  });

  if (insertError) {
    setError(insertError.message);
  } else {
    setSettings(DEFAULT_SETTINGS);
  }
}

setLoading(false);


};

useEffect(() => {
fetchData();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [user?.id]);

const updateSetting = <K extends keyof UserSettings>(
key: K,
value: UserSettings[K],
) => {
setSettings((prev) => ({ ...prev, [key]: value }));
};

const saveSettings = async () => {
if (!user) return;


setSavingSettings(true);
setError('');
setMessage('');

const { error } = await supabase.from('user_settings').upsert({
  user_id: user.id,
  ...settings,
  updated_at: new Date().toISOString(),
});

if (error) {
  setError(error.message);
} else {
  setMessage('Settings saved successfully.');
}

setSavingSettings(false);


};

const saveProfile = async () => {
if (!user) return;


setSavingProfile(true);
setError('');
setMessage('');

const { error } = await supabase
  .from('profiles')
  .update({
    full_name: fullName.trim() || null,
    linkedin_url: linkedinUrl.trim() || null,
    github_url: githubUrl.trim() || null,
    portfolio_url: portfolioUrl.trim() || null,
  })
  .eq('id', user.id);

if (error) {
  setError(error.message);
} else {
  setMessage('Profile updated successfully.');
  await fetchData();
}

setSavingProfile(false);


};

const uploadAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
if (!user) return;


const file = event.target.files?.[0];
if (!file) return;

setUploadingAvatar(true);
setError('');
setMessage('');

try {
  const fileExt = file.name.split('.').pop()?.toLowerCase() || 'png';
  const filePath = `${user.id}/avatar-${Date.now()}.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(filePath, file, { upsert: true });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(filePath);

  setAvatarUrl(data.publicUrl);

  const { error: profileUpdateError } = await supabase
    .from('profiles')
    .update({ avatar_url: data.publicUrl })
    .eq('id', user.id);

  if (profileUpdateError) throw profileUpdateError;

  setMessage('Profile picture uploaded successfully.');
} catch (err) {
  setError(err instanceof Error ? err.message : 'Failed to upload avatar.');
} finally {
  setUploadingAvatar(false);
  event.target.value = '';
}


};

const clearAIInsights = async () => {
if (!user) return;


const { error } = await supabase
  .from('email_events')
  .update({ ai_insight: null })
  .eq('user_id', user.id);

setMessage(error ? '' : 'AI insights cleared.');
setError(error?.message || '');


};

const clearEmailEvents = async () => {
if (!user) return;


const confirmed = window.confirm(
  'Delete all synced email events? This cannot be undone.',
);

if (!confirmed) return;

const { error } = await supabase.from('email_events').delete().eq('user_id', user.id);

setMessage(error ? '' : 'Email events deleted.');
setError(error?.message || '');


};

const exportApplications = async () => {
if (!user) return;


const { data, error } = await supabase
  .from('applications')
  .select(`
    role_title,
    status,
    date_applied,
    last_status_changed_at,
    application_link,
    cv_version_id,
    interview_possible,
    interview_started_at,
    final_interview_started_at,
    companies (
      name
    ),
    cv_versions (
      name
    ),
    interview_notes (
      interview_stage,
      interview_date
    )
  `)
  .eq('user_id', user.id)
  .order('date_applied', { ascending: false });

if (error) {
  setError(error.message);
  return;
}

const rows = data || [];

const csv = [
  [
    'Company',
    'Role',
    'Status',
    'Date Applied',
    'Status Updated At',
    'Interview Possible',
    'Interview Date',
    'Interview Stage',
    'CV Version Used',
    'Application Link',
  ].join(','),

  ...rows.map((row: any) => {
    const latestInterview = row.interview_notes?.[0];

    const interviewPossible =
      Boolean(row.interview_possible) ||
      ['interview', 'final_interview', 'offer'].includes(row.status) ||
      Boolean(row.interview_started_at) ||
      Boolean(row.final_interview_started_at) ||
      Boolean(latestInterview?.interview_date);

    return [
      row.companies?.name,
      row.role_title,
      row.status,
      row.date_applied,
      row.last_status_changed_at,
      interviewPossible ? 'Yes' : 'No',
      latestInterview?.interview_date ||
        row.interview_started_at ||
        row.final_interview_started_at,
      latestInterview?.interview_stage,
      row.cv_versions?.name,
      row.application_link,
    ]
      .map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`)
      .join(',');
  }),
].join('\n');

const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
const url = URL.createObjectURL(blob);
const anchor = document.createElement('a');

anchor.href = url;
anchor.download = 'jtracker-applications-detailed.csv';
anchor.click();

URL.revokeObjectURL(url);


};

if (loading) {
return ( <div className="bg-white border border-slate-200 rounded-2xl p-8">
Loading settings... </div>
);
}

return ( <div className="w-full max-w-6xl"> <div className="mb-6"> <div className="flex items-center gap-2 mb-1"> <Settings size={24} /> <h2 className="text-2xl font-bold">Settings</h2> </div>


    <p className="text-sm text-slate-500">
      Control how JTracker uses your profile, email sync, notifications, AI,
      and job-search data.
    </p>
  </div>

  <div className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur pb-4 mb-2">
    <div className="overflow-x-auto">
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-max">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  </div>

  {message && (
    <Feedback type="success" message={message} onClose={() => setMessage('')} />
  )}

  {error && <Feedback type="error" message={error} onClose={() => setError('')} />}

  {activeTab === 'profile' && (
    <Card title="Profile" icon={<UserCircle size={16} />}>
      <div className="flex flex-col sm:flex-row gap-5 mb-6">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            className="w-20 h-20 rounded-full object-cover border"
            alt="Profile avatar"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-slate-900 text-white flex items-center justify-center text-xl font-bold">
            {avatarInitials}
          </div>
        )}

        <div className="flex-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={uploadAvatar}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm inline-flex items-center gap-2 disabled:opacity-50"
          >
            {uploadingAvatar ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Upload size={15} />
            )}
            {uploadingAvatar ? 'Uploading...' : 'Upload Picture'}
          </button>

          <p className="text-xs text-slate-500 mt-2">
            Upload a profile picture. Manual avatar URL editing has been removed.
          </p>
        </div>
      </div>

      <Field label="Full Name">
        <input
          className={inputCls}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Your full name"
        />
      </Field>

      <Field label="Email">
        <input className={inputCls} value={email} disabled />
      </Field>

      <div className="mt-6 border-t border-slate-100 pt-5">
        <h4 className="text-sm font-semibold text-slate-900 mb-1">
          Professional Links
        </h4>

        <p className="text-xs text-slate-500 mb-4">
          These links can be reused later in CVs, recruiter messages, and
          applications.
        </p>

        <Field label="LinkedIn URL">
          <input
            className={inputCls}
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://www.linkedin.com/in/your-profile"
          />
        </Field>

        <Field label="GitHub URL">
          <input
            className={inputCls}
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            placeholder="https://github.com/your-username"
          />
        </Field>

        <Field label="Portfolio URL">
          <input
            className={inputCls}
            value={portfolioUrl}
            onChange={(e) => setPortfolioUrl(e.target.value)}
            placeholder="https://your-portfolio.com"
          />
        </Field>
      </div>

      <SaveBar saving={savingProfile} onSave={saveProfile} label="Save Profile" />
    </Card>
  )}

  {activeTab === 'jobSearch' && (
    <Card title="Job Search Preferences" icon={<Briefcase size={16} />}>
      <Field label="Target Role">
        <input
          className={inputCls}
          value={settings.target_role || ''}
          onChange={(e) => updateSetting('target_role', e.target.value)}
          placeholder="Junior Software Engineer, Technical Support Engineer..."
        />
      </Field>

      <Field label="Preferred Locations">
        <input
          className={inputCls}
          value={settings.preferred_locations || ''}
          onChange={(e) => updateSetting('preferred_locations', e.target.value)}
          placeholder="Poland, Germany, Remote, United States..."
        />
      </Field>

      <Field label="Work Type">
        <select
          className={inputCls}
          value={settings.preferred_work_type || 'hybrid'}
          onChange={(e) => updateSetting('preferred_work_type', e.target.value)}
        >
          <option value="remote">Remote</option>
          <option value="hybrid">Hybrid</option>
          <option value="onsite">On-site</option>
          <option value="any">Any</option>
        </select>
      </Field>

      <Field label="Salary Expectation">
        <input
          className={inputCls}
          value={settings.salary_expectation || ''}
          onChange={(e) => updateSetting('salary_expectation', e.target.value)}
          placeholder="Example: 10,000 gross monthly"
        />
      </Field>

      <Field label="Currency">
        <select
          className={inputCls}
          value={settings.currency || 'PLN'}
          onChange={(e) => updateSetting('currency', e.target.value)}
        >
          <option value="PLN">PLN</option>
          <option value="EUR">EUR</option>
          <option value="USD">USD</option>
          <option value="GBP">GBP</option>
        </select>
      </Field>

      <SaveBar saving={savingSettings} onSave={saveSettings} label="Save Preferences" />
    </Card>
  )}

  {activeTab === 'ai' && (
    <Card title="AI Assistant" icon={<Bot size={16} />}>
      <ToggleRow
        label="AI email analysis"
        hint="Analyze recruitment emails for urgency, next action, tone, and red flags."
        enabled={settings.ai_email_analysis_enabled}
        onChange={(v) => updateSetting('ai_email_analysis_enabled', v)}
      />

      <ToggleRow
        label="AI CV analysis"
        hint="Allow JTracker to analyze CVs and generate improvement suggestions."
        enabled={settings.ai_cv_analysis_enabled}
        onChange={(v) => updateSetting('ai_cv_analysis_enabled', v)}
      />

      <ToggleRow
        label="Auto-save AI insights"
        hint="Store AI results so analysis does not disappear after refresh."
        enabled={settings.auto_save_ai_insights}
        onChange={(v) => updateSetting('auto_save_ai_insights', v)}
      />

      <Field label={`Confidence Threshold: ${settings.ai_confidence_threshold}%`}>
        <input
          type="range"
          min={50}
          max={95}
          value={settings.ai_confidence_threshold}
          onChange={(e) =>
            updateSetting('ai_confidence_threshold', Number(e.target.value))
          }
          className="w-full"
        />
      </Field>

      <SaveBar saving={savingSettings} onSave={saveSettings} label="Save AI Settings" />
    </Card>
  )}

  {activeTab === 'emailSync' && (
    <Card title="Email Sync" icon={<Mail size={16} />}>
      <SettingsEmailSyncPanel
        settings={{
          gmail_sync_enabled: settings.gmail_sync_enabled,
          gmail_max_emails_per_sync: settings.gmail_max_emails_per_sync,
          gmail_recruitment_only: settings.gmail_recruitment_only,
          ai_email_analysis_enabled: settings.ai_email_analysis_enabled,
          ai_confidence_threshold: settings.ai_confidence_threshold,
        }}
        emailSyncFeatureEnabled={FEATURES.EMAIL_SYNC}
        saving={savingSettings}
        onUpdate={(key, value) => {
if (key === 'gmail_sync_enabled') {
updateSetting('gmail_sync_enabled', Boolean(value));
}

if (key === 'gmail_max_emails_per_sync') {
updateSetting('gmail_max_emails_per_sync', Number(value));
}

if (key === 'gmail_recruitment_only') {
updateSetting('gmail_recruitment_only', Boolean(value));
}

if (key === 'ai_email_analysis_enabled') {
updateSetting('ai_email_analysis_enabled', Boolean(value));
}

if (key === 'ai_confidence_threshold') {
updateSetting('ai_confidence_threshold', Number(value));
}
}}

        onSave={saveSettings}
        onOpenEmailEvents={() => setActiveTab('emailEvents')}
      />
    </Card>
  )}

  {activeTab === 'emailEvents' && (
    <Card title="Email Events" icon={<Inbox size={16} />}>
      <p className="text-sm text-slate-500 mb-4">
        Review and manage recruitment emails that JTracker has converted into
        application events.
      </p>

      <ActionRow
        title="Clear AI insights"
        description="Remove saved AI analysis from email events while keeping the email event records."
        label="Clear"
        icon={<Trash2 size={14} />}
        onClick={clearAIInsights}
      />

      <ActionRow
        title="Delete email events"
        description="Remove synced email event records from JTracker."
        label="Delete"
        danger
        icon={<Trash2 size={14} />}
        onClick={clearEmailEvents}
      />
    </Card>
  )}

  {activeTab === 'notifications' && (
    <Card title="Notifications" icon={<Bell size={16} />}>
      <p className="text-sm text-slate-500 mb-4">
        Manage your in-app alerts, unread notifications, and reminder behavior.
      </p>

      <ToggleRow
        label="Application reminders"
        hint="Show reminders for follow-ups, interviews, and important application dates."
        enabled={true}
        onChange={() => {}}
      />

      <ToggleRow
        label="Shared opportunity alerts"
        hint="Show alerts when another JTracker user shares an opportunity with you."
        enabled={true}
        onChange={() => {}}
      />

      <ToggleRow
        label="Email event alerts"
        hint="Show alerts when recruitment emails are linked to applications."
        enabled={true}
        onChange={() => {}}
      />
    </Card>
  )}

  {activeTab === 'privacy' && (
    <Card title="Privacy & Data" icon={<Shield size={16} />}>
      <p className="text-sm text-slate-500 mb-4">
        AI analysis sends selected email snippets and metadata to your configured AI
        provider. Full email body analysis should stay optional.
      </p>

      <ActionRow
        title="Export applications"
        description="Download your applications as a CSV file."
        label="Export"
        icon={<Download size={14} />}
        onClick={exportApplications}
      />

      <ActionRow
        title="Clear AI insights"
        description="Remove saved AI analysis from email events."
        label="Clear"
        icon={<Trash2 size={14} />}
        onClick={clearAIInsights}
      />

      <ActionRow
        title="Delete email events"
        description="Remove synced email event records from JTracker."
        label="Delete"
        danger
        icon={<Trash2 size={14} />}
        onClick={clearEmailEvents}
      />
    </Card>
  )}

  {activeTab === 'account' && (
    <Card title="Account" icon={<Shield size={16} />}>
      <Field label="User ID">
        <input
          className={`${inputCls} font-mono text-xs`}
          value={user?.id || ''}
          readOnly
        />
      </Field>

      <Field label="Email">
        <input className={inputCls} value={email} disabled />
      </Field>

      <button
        type="button"
        onClick={signOut}
        className="mt-4 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm inline-flex items-center gap-2"
      >
        <LogOut size={14} />
        Sign Out
      </button>
    </Card>
  )}
</div>


);
};

const Field = ({
label,
children,
}: {
label: string;
children: React.ReactNode;
}) => ( <label className="block mb-4"> <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
{label} </span>
{children} </label>
);

const Card = ({
title,
icon,
children,
}: {
title: string;
icon?: React.ReactNode;
children: React.ReactNode;
}) => (

  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
    <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
      {icon}
      <h3 className="font-semibold">{title}</h3>
    </div>


<div className="p-5">{children}</div>


  </div>
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
onChange: (v: boolean) => void;
}) => (

  <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-4">
    <div>
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
    </div>


<Toggle enabled={enabled} onChange={onChange} />


  </div>
);

const SaveBar = ({
saving,
onSave,
label,
}: {
saving: boolean;
onSave: () => void;
label: string;
}) => (

  <div className="flex justify-end pt-4 border-t border-slate-100">
    <button
      type="button"
      onClick={onSave}
      disabled={saving}
      className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm inline-flex items-center gap-2 disabled:opacity-50"
    >
      <Save size={14} />
      {saving ? 'Saving...' : label}
    </button>
  </div>
);

const Feedback = ({
type,
message,
onClose,
}: {
type: 'success' | 'error';
message: string;
onClose: () => void;
}) => (

  <div
    className={`mb-4 rounded-xl p-4 flex items-start gap-3 border ${
      type === 'success'
        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
        : 'bg-red-50 border-red-200 text-red-700'
    }`}
  >
    {type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}


<span className="text-sm flex-1">{message}</span>

<button type="button" onClick={onClose}>
  <X size={16} />
</button>


  </div>
);

const ActionRow = ({
title,
description,
label,
icon,
onClick,
danger,
}: {
title: string;
description: string;
label: string;
icon: React.ReactNode;
onClick: () => void;
danger?: boolean;
}) => (

  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-t border-slate-100 py-4">
    <div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-slate-500 mt-0.5">{description}</p>
    </div>


<button
  type="button"
  onClick={onClick}
  className={`px-3 py-2 rounded-lg text-sm inline-flex items-center gap-2 border ${
    danger
      ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
  }`}
>
  {icon}
  {label}
</button>


  </div>
);
