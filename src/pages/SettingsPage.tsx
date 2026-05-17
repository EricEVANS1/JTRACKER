import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Globe,
  Download,
  Link2,
  Loader2,
  LogOut,
  Mail,
  Save,
  Settings,
  Shield,
  Smartphone,
  Trash2,
  Upload,
  UserCircle,
  X,
  Zap,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FEATURES } from '../config/features';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

type TabId = 'profile' | 'notifications' | 'integrations' | 'account';

interface NotificationPrefs {
  followUpReminders: boolean;
  ghostingAlerts: boolean;
  offerDeadlines: boolean;
  sharedOpportunities: boolean;
  interviewCountdown: boolean;
  weeklyDigest: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AVATAR_BUCKET = 'avatars';

const inputCls =
  'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent ' +
  'disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed transition';

const TABS: { id: TabId; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'account', label: 'Account' },
];

const DEFAULT_NOTIF_PREFS: NotificationPrefs = {
  followUpReminders: true,
  ghostingAlerts: true,
  offerDeadlines: true,
  sharedOpportunities: true,
  interviewCountdown: false,
  weeklyDigest: false,
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const Toggle: React.FC<{
  enabled: boolean;
  onChange: (v: boolean) => void;
}> = ({ enabled, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!enabled)}
    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 ${
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

const ToggleRow: React.FC<{
  label: string;
  hint: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}> = ({ label, hint, enabled, onChange, last }) => (
  <div
    className={`flex items-center justify-between gap-6 py-4 ${
      !last ? 'border-b border-slate-100' : ''
    }`}
  >
    <div className="min-w-0">
      <p className="text-sm font-medium text-slate-900">{label}</p>
      <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
    </div>
    <Toggle enabled={enabled} onChange={onChange} />
  </div>
);

const IntegrationRow: React.FC<{
  icon: React.ReactNode;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'coming_soon';
  onAction?: () => void;
  last?: boolean;
}> = ({ icon, name, description, status, onAction, last }) => {
  const statusConfig = {
    active: { dot: 'bg-emerald-500', label: 'Active', labelCls: 'text-emerald-600' },
    paused: { dot: 'bg-amber-400', label: 'Paused', labelCls: 'text-amber-600' },
    coming_soon: { dot: 'bg-slate-300', label: 'Coming soon', labelCls: 'text-slate-400' },
  }[status];

  return (
    <div
      className={`flex items-center gap-4 py-4 ${!last ? 'border-b border-slate-100' : ''}`}
    >
      <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 text-slate-600">
        {icon}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900">{name}</p>
        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
      </div>

      <div className="flex flex-col items-end gap-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`} />
          <span className={`text-xs font-medium ${statusConfig.labelCls}`}>
            {statusConfig.label}
          </span>
        </div>
        {status !== 'coming_soon' && onAction && (
          <button
            onClick={onAction}
            disabled={status === 'paused'}
            className="text-xs text-slate-500 border border-slate-200 px-3 py-1 rounded-lg hover:bg-slate-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {status === 'active' ? 'Manage' : 'Connect'}
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export const SettingsPage: React.FC = () => {
  const { user, signOut } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>('profile');

  // ── Profile state ──────────────────────────────────────────────────────────
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [deletingAvatar, setDeletingAvatar] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // ── Notification prefs state ───────────────────────────────────────────────
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIF_PREFS);
  const [savingNotifs, setSavingNotifs] = useState(false);
  const [notifMessage, setNotifMessage] = useState('');

  // ── Account state ──────────────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  const email = profile?.email || user?.email || '';

  const hasChanges = useMemo(
    () =>
      fullName.trim() !== (profile?.full_name || '') ||
      avatarUrl.trim() !== (profile?.avatar_url || ''),
    [fullName, avatarUrl, profile]
  );

  const isAvatarValid = useMemo(() => {
    if (!avatarUrl.trim()) return true;
    try {
      const url = new URL(avatarUrl.trim());
      return ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  }, [avatarUrl]);

  const avatarInitials = useMemo(() => {
    const name = fullName.trim() || email;
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }, [fullName, email]);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchProfile = async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    setMessage('');

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, avatar_url')
      .eq('id', user.id)
      .single();

    if (error) {
      setError(error.message);
    } else {
      setProfile(data);
      setFullName(data.full_name || '');
      setAvatarUrl(data.avatar_url || '');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchProfile();
  }, [user]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSaveProfile = async () => {
    if (!user) return;
    if (!isAvatarValid) {
      setError('Avatar URL must be a valid http or https link.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');

    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim() || null, avatar_url: avatarUrl.trim() || null })
      .eq('id', user.id);

    if (error) {
      setError(error.message);
    } else {
      setMessage('Profile updated successfully.');
      await fetchProfile();
    }
    setSaving(false);
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!user) return;

    const file = event.target.files?.[0];
    if (!file) return;

    setError('');
    setMessage('');

    const maxFileSize = 2 * 1024 * 1024; // 2MB
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    if (!allowedTypes.includes(file.type)) {
      setError('Please upload a JPG, PNG, WEBP, or GIF image.');
      event.target.value = '';
      return;
    }

    if (file.size > maxFileSize) {
      setError('Profile picture must be smaller than 2MB.');
      event.target.value = '';
      return;
    }

    setUploadingAvatar(true);

    try {
      const fileExt = file.name.split('.').pop()?.toLowerCase() || 'png';
      const filePath = `${user.id}/avatar-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(filePath);
      const publicUrl = data.publicUrl;

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);

      if (profileError) {
        throw profileError;
      }

      setAvatarUrl(publicUrl);
      setProfile((prev) => (prev ? { ...prev, avatar_url: publicUrl } : prev));
      setMessage('Profile picture uploaded successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload profile picture.');
    } finally {
      setUploadingAvatar(false);
      event.target.value = '';
    }
  };

  const handleRemoveAvatar = async () => {
    if (!user) return;

    setDeletingAvatar(true);
    setError('');
    setMessage('');

    const { error } = await supabase
      .from('profiles')
      .update({ avatar_url: null })
      .eq('id', user.id);

    if (error) {
      setError(error.message);
      setDeletingAvatar(false);
      return;
    }

    setAvatarUrl('');
    setProfile((prev) => (prev ? { ...prev, avatar_url: null } : prev));
    setMessage('Profile picture removed.');
    setDeletingAvatar(false);
  };

  const handleReset = () => {
    setFullName(profile?.full_name || '');
    setAvatarUrl(profile?.avatar_url || '');
    setError('');
    setMessage('');
  };

  const handleSaveNotifications = async () => {
    setSavingNotifs(true);
    // Persist to user_preferences table when it exists; currently local only
    await new Promise((r) => setTimeout(r, 500));
    setNotifMessage('Notification preferences saved.');
    setSavingNotifs(false);
    setTimeout(() => setNotifMessage(''), 3000);
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
  };

  const handleExportData = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('applications')
      .select('role_title, status, date_applied, created_at')
      .eq('user_id', user.id);

    if (!data?.length) return;

    const csv = [
      ['Role', 'Status', 'Date Applied', 'Created At'].join(','),
      ...data.map((r) =>
        [r.role_title, r.status, r.date_applied, r.created_at].join(',')
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jtracker-applications.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Loading skeleton ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div>
        <div className="mb-8">
          <div className="h-8 w-40 bg-slate-200 rounded-lg animate-pulse mb-2" />
          <div className="h-4 w-80 bg-slate-100 rounded-lg animate-pulse" />
        </div>
        <div className="flex gap-2 mb-6">
          {TABS.map((t) => (
            <div key={t.id} className="h-9 w-28 bg-slate-100 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 max-w-3xl">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-16 h-16 rounded-full bg-slate-100 animate-pulse" />
            <div className="space-y-2">
              <div className="h-5 w-40 bg-slate-200 rounded animate-pulse" />
              <div className="h-4 w-56 bg-slate-100 rounded animate-pulse" />
            </div>
          </div>
          <div className="space-y-4">
            <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Page header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Settings size={24} className="text-slate-700" />
            <h2 className="text-2xl font-bold">Settings</h2>
          </div>
          <p className="text-slate-500 text-sm">
            Manage your profile, notifications, integrations, and account.
          </p>
        </div>

        {hasChanges && activeTab === 'profile' && (
          <div className="text-xs bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 rounded-lg flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
            Unsaved changes
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── PROFILE TAB ── */}
      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 max-w-5xl">
          <div className="space-y-5">
            {/* Feedback banners */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 flex items-start gap-3">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span className="text-sm flex-1">{error}</span>
                <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">
                  <X size={16} />
                </button>
              </div>
            )}
            {message && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-4 flex items-start gap-3">
                <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                <span className="text-sm flex-1">{message}</span>
                <button
                  onClick={() => setMessage('')}
                  className="text-emerald-400 hover:text-emerald-600"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Profile card */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
              {/* Avatar hero */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-5 p-6 border-b border-slate-100">
                <div className="shrink-0">
                  {avatarUrl && isAvatarValid ? (
                    <img
                      src={avatarUrl}
                      alt="Profile"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                      className="w-20 h-20 rounded-full object-cover border-2 border-slate-200"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center border-2 border-slate-200">
                      {avatarInitials ? (
                        <span className="text-white font-semibold text-xl tracking-tight">
                          {avatarInitials}
                        </span>
                      ) : (
                        <UserCircle size={40} className="text-slate-400" />
                      )}
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-semibold truncate">
                    {fullName.trim() || 'Your Profile'}
                  </h3>
                  <p className="text-slate-500 text-sm truncate">{email}</p>

                  <div className="flex flex-wrap gap-2 mt-4">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingAvatar}
                      className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-700 transition disabled:opacity-50 inline-flex items-center gap-2"
                    >
                      {uploadingAvatar ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Upload size={15} />
                      )}
                      {uploadingAvatar ? 'Uploading...' : 'Upload Picture'}
                    </button>

                    {avatarUrl && (
                      <button
                        type="button"
                        onClick={handleRemoveAvatar}
                        disabled={deletingAvatar || uploadingAvatar}
                        className="border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 transition disabled:opacity-50"
                      >
                        {deletingAvatar ? 'Removing...' : 'Remove'}
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-slate-400 mt-2">
                    JPG, PNG, WEBP, or GIF. Max size: 2MB.
                  </p>
                </div>
              </div>

              {/* Form fields */}
              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                    Full Name
                  </label>
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your full name"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                    Avatar URL
                  </label>
                  <div className="relative">
                    <Link2
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      placeholder="https://example.com/avatar.jpg"
                      className={`${inputCls} pl-9 ${
                        !isAvatarValid ? 'border-red-300 focus:ring-red-300' : ''
                      }`}
                    />
                  </div>
                  {!isAvatarValid && (
                    <p className="text-xs text-red-500 mt-1.5">
                      Enter a valid http or https image URL.
                    </p>
                  )}
                  <p className="text-xs text-slate-400 mt-1.5">
                    You can upload a picture above or paste an external image URL here.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                    Email
                  </label>
                  <div className="relative">
                    <Mail
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input value={email} disabled className={`${inputCls} pl-9`} />
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5">
                    Managed through your login provider.
                  </p>
                </div>
              </div>

              {/* Footer actions */}
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={!hasChanges || saving || uploadingAvatar}
                  className="border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-sm disabled:opacity-50 hover:bg-slate-100 transition"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={saving || !hasChanges || !isAvatarValid || uploadingAvatar}
                  className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 hover:bg-slate-700 transition inline-flex items-center gap-2"
                >
                  <Save size={14} />
                  {saving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <aside className="space-y-5">
            <div className="bg-slate-900 text-white rounded-2xl shadow-sm p-6">
              <p className="text-xs text-slate-400 uppercase tracking-widest mb-4">
                Account Summary
              </p>
              <div className="flex items-center gap-3 mb-5">
                {avatarUrl && isAvatarValid ? (
                  <img
                    src={avatarUrl}
                    alt="Preview"
                    className="w-11 h-11 rounded-full object-cover border border-white/10"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center">
                    {avatarInitials ? (
                      <span className="text-white font-semibold text-sm">
                        {avatarInitials}
                      </span>
                    ) : (
                      <UserCircle size={24} className="text-slate-300" />
                    )}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">
                    {fullName.trim() || 'Unnamed User'}
                  </p>
                  <p className="text-xs text-slate-400 truncate">{email}</p>
                </div>
              </div>
              <div className="space-y-3 text-sm border-t border-white/10 pt-4">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Plan</span>
                  <span className="text-blue-400 font-medium">Free</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Profile</span>
                  <span>{fullName.trim() ? 'Complete' : 'Incomplete'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Avatar</span>
                  <span>{avatarUrl.trim() ? 'Set' : 'Not set'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">User ID</span>
                  <span className="truncate max-w-[130px] text-xs font-mono text-slate-300">
                    {user?.id?.slice(0, 12)}…
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
              <h3 className="text-sm font-semibold mb-2 text-slate-900">Profile tips</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                Add a real name and photo — they appear when you share opportunities with
                your network, making your shares feel more personal and trusted.
              </p>
            </div>
          </aside>
        </div>
      )}

      {/* ── NOTIFICATIONS TAB ── */}
      {activeTab === 'notifications' && (
        <div className="max-w-2xl space-y-5">
          {notifMessage && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-4 flex items-center gap-3">
              <CheckCircle2 size={16} className="shrink-0" />
              <span className="text-sm">{notifMessage}</span>
            </div>
          )}

          {/* Smart alerts */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
            <div className="px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2 mb-0.5">
                <Zap size={15} className="text-slate-700" />
                <h3 className="text-base font-semibold">Smart Alerts</h3>
              </div>
              <p className="text-xs text-slate-500">
                Intelligent notifications generated from your application activity.
              </p>
            </div>
            <div className="px-6">
              <ToggleRow
                label="Follow-up reminders"
                hint="Alert when an application has had no activity for 7+ days."
                enabled={notifPrefs.followUpReminders}
                onChange={(v) => setNotifPrefs((p) => ({ ...p, followUpReminders: v }))}
              />
              <ToggleRow
                label="Ghosting alerts"
                hint="Flag applications with no response after 21 days."
                enabled={notifPrefs.ghostingAlerts}
                onChange={(v) => setNotifPrefs((p) => ({ ...p, ghostingAlerts: v }))}
              />
              <ToggleRow
                label="Offer deadline warnings"
                hint="Remind you when an offer decision is approaching."
                enabled={notifPrefs.offerDeadlines}
                onChange={(v) => setNotifPrefs((p) => ({ ...p, offerDeadlines: v }))}
              />
              <ToggleRow
                label="Shared opportunity alerts"
                hint="Notify when someone shares a job opportunity with you."
                enabled={notifPrefs.sharedOpportunities}
                onChange={(v) =>
                  setNotifPrefs((p) => ({ ...p, sharedOpportunities: v }))
                }
              />
              <ToggleRow
                label="Interview countdown"
                hint="24-hour reminder before a scheduled interview."
                enabled={notifPrefs.interviewCountdown}
                onChange={(v) =>
                  setNotifPrefs((p) => ({ ...p, interviewCountdown: v }))
                }
                last
              />
            </div>
          </div>

          {/* Email digest */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
            <div className="px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2 mb-0.5">
                <Bell size={15} className="text-slate-700" />
                <h3 className="text-base font-semibold">Email Digest</h3>
              </div>
              <p className="text-xs text-slate-500">
                Receive a summary of your job search activity to {email}.
              </p>
            </div>
            <div className="px-6">
              <ToggleRow
                label="Weekly digest"
                hint="Summary of applications, responses, and follow-ups every Monday."
                enabled={notifPrefs.weeklyDigest}
                onChange={(v) => setNotifPrefs((p) => ({ ...p, weeklyDigest: v }))}
                last
              />
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-between gap-4">
              <p className="text-xs text-slate-400">
                Email digests require the Pro plan to send automatically.
              </p>
              <button
                onClick={handleSaveNotifications}
                disabled={savingNotifs}
                className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 hover:bg-slate-700 transition inline-flex items-center gap-2"
              >
                <Save size={14} />
                {savingNotifs ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── INTEGRATIONS TAB ── */}
      {activeTab === 'integrations' && (
        <div className="max-w-2xl space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-base font-semibold mb-0.5">Connected Services</h3>
              <p className="text-xs text-slate-500">
                External services that power JTracker's intelligence features.
              </p>
            </div>
            <div className="px-6">
              <IntegrationRow
                icon={<Mail size={18} />}
                name="Gmail"
                description="Auto-classify job emails — confirmations, interviews, rejections, and offers."
                status={FEATURES.GMAIL_SYNC ? 'active' : 'paused'}
                onAction={() => {}}
              />
              <IntegrationRow
                icon={<Bell size={18} />}
                name="Push Notifications"
                description="Real-time alerts in the browser when your application status changes."
                status="active"
                onAction={() => {}}
              />
              <IntegrationRow
                icon={<Smartphone size={18} />}
                name="WhatsApp Sharing"
                description="Share job opportunities directly via WhatsApp with a pre-filled message."
                status="active"
                onAction={() => {}}
              />
              <IntegrationRow
                icon={<Globe size={18} />}
                name="Chrome Extension"
                description="Save job listings to JTracker in one click from any job board."
                status="coming_soon"
                last
              />
            </div>
          </div>

          {/* Public share link */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
            <div className="px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2 mb-0.5">
                <Link2 size={15} className="text-slate-700" />
                <h3 className="text-base font-semibold">Public Share Link</h3>
              </div>
              <p className="text-xs text-slate-500">
                Anyone with this link can view opportunities you choose to share publicly.
              </p>
            </div>
            <div className="p-6">
              <div className="flex gap-2">
                <input
                  readOnly
                  value={`https://jtracker.app/share/${user?.id?.slice(0, 8)}`}
                  className={`${inputCls} font-mono text-xs`}
                />
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(
                      `https://jtracker.app/share/${user?.id?.slice(0, 8)}`
                    )
                  }
                  className="border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 transition shrink-0"
                >
                  Copy
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Revoking generates a new link. The old link stops working immediately.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── ACCOUNT TAB ── */}
      {activeTab === 'account' && (
        <div className="max-w-2xl space-y-5">

          {/* Plan */}
          <div className="bg-slate-900 text-white rounded-2xl shadow-sm p-6">
            <p className="text-xs text-slate-400 uppercase tracking-widest mb-1">
              Current Plan
            </p>
            <div className="flex items-end justify-between gap-4 mb-4">
              <div>
                <p className="text-xl font-bold">Free</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Up to 20 applications · Manual sync only
                </p>
              </div>
              <button className="bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition shrink-0">
                Upgrade to Pro
              </button>
            </div>
            <div className="space-y-1.5 text-sm border-t border-white/10 pt-4">
              {[
                ['Applications', '4 / 20'],
                ['Gmail sync', 'Manual only'],
                ['Email classification', 'Keyword-based'],
                ['Recruiters', '5 max'],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between gap-4">
                  <span className="text-slate-400">{label}</span>
                  <span className="font-medium">{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Account info */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-base font-semibold">Account Information</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                  User ID
                </label>
                <input
                  value={user?.id || ''}
                  readOnly
                  className={`${inputCls} font-mono text-xs`}
                />
                <p className="text-xs text-slate-400 mt-1.5">
                  Use this when contacting support.
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                  Email
                </label>
                <input value={email} disabled className={inputCls} />
              </div>
            </div>
          </div>

          {/* Data & privacy */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
            <div className="px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2 mb-0.5">
                <Shield size={15} className="text-slate-700" />
                <h3 className="text-base font-semibold">Data & Privacy</h3>
              </div>
              <p className="text-xs text-slate-500">Export or manage your personal data.</p>
            </div>
            <div className="divide-y divide-slate-100">
              <div className="flex items-center justify-between gap-4 px-6 py-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">Export your data</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Download all applications, events, and recruiter data as CSV.
                  </p>
                </div>
                <button
                  onClick={handleExportData}
                  className="border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg text-sm hover:bg-slate-50 transition inline-flex items-center gap-1.5 shrink-0"
                >
                  <Download size={13} />
                  Export CSV
                </button>
              </div>
              <div className="flex items-center justify-between gap-4 px-6 py-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">Sign out all devices</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Invalidates all active sessions across every device.
                  </p>
                </div>
                <button
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg text-sm hover:bg-slate-50 transition inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                >
                  <LogOut size={13} />
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </button>
              </div>
            </div>
          </div>

          {/* Danger zone */}
          <div className="border border-red-200 rounded-2xl overflow-hidden">
            <div className="bg-red-50 px-6 py-3 border-b border-red-200 flex items-center gap-2">
              <AlertCircle size={14} className="text-red-500" />
              <span className="text-sm font-semibold text-red-700">Danger Zone</span>
            </div>
            <div className="bg-white px-6 py-4">
              {!showDeleteConfirm ? (
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Delete account</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Permanently removes all your data. This cannot be undone.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg text-sm hover:bg-red-100 transition inline-flex items-center gap-1.5 shrink-0"
                  >
                    <Trash2 size={13} />
                    Delete
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-red-700 font-medium">
                    Type <span className="font-mono bg-red-100 px-1.5 py-0.5 rounded">DELETE</span> to confirm.
                  </p>
                  <input
                    value={deleteInput}
                    onChange={(e) => setDeleteInput(e.target.value)}
                    placeholder="DELETE"
                    className={`${inputCls} border-red-200 focus:ring-red-300`}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setShowDeleteConfirm(false);
                        setDeleteInput('');
                      }}
                      className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-lg text-sm hover:bg-slate-50 transition"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={deleteInput !== 'DELETE'}
                      className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm disabled:opacity-40 hover:bg-red-700 transition"
                    >
                      Confirm Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};