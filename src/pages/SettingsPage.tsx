import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Link2,
  Mail,
  Save,
  Settings,
  UserCircle,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

const inputCls =
  'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent ' +
  'disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed transition';

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const email = profile?.email || user?.email || '';

  const hasChanges = useMemo(() => {
    return (
      fullName.trim() !== (profile?.full_name || '') ||
      avatarUrl.trim() !== (profile?.avatar_url || '')
    );
  }, [fullName, avatarUrl, profile]);

  const isAvatarValid = useMemo(() => {
    if (!avatarUrl.trim()) return true;

    try {
      const url = new URL(avatarUrl.trim());
      return ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  }, [avatarUrl]);

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

  const handleSaveProfile = async () => {
    if (!user) return;

    if (!isAvatarValid) {
      setError('Avatar URL must be a valid http or https link.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    const payload = {
      full_name: fullName.trim() || null,
      avatar_url: avatarUrl.trim() || null,
    };

    const { error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', user.id);

    if (error) {
      setError(error.message);
    } else {
      setMessage('Profile updated successfully.');
      await fetchProfile();
    }

    setSaving(false);
  };

  const handleReset = () => {
    setFullName(profile?.full_name || '');
    setAvatarUrl(profile?.avatar_url || '');
    setError('');
    setMessage('');
  };

  if (loading) {
    return (
      <div>
        <div className="mb-8">
          <div className="h-8 w-40 bg-slate-200 rounded-lg animate-pulse mb-2" />
          <div className="h-4 w-80 bg-slate-100 rounded-lg animate-pulse" />
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

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Settings size={26} className="text-slate-700" />
            <h2 className="text-3xl font-bold">Settings</h2>
          </div>
          <p className="text-slate-500 text-sm">
            Manage your profile, account details, and app integrations.
          </p>
        </div>

        {hasChanges && (
          <div className="text-xs bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 rounded-lg">
            You have unsaved changes
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 flex items-start gap-3">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span className="text-sm flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">
            <X size={16} />
          </button>
        </div>
      )}

      {message && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-4 mb-6 flex items-start gap-3">
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

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 max-w-6xl">
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
            <div className="flex items-center gap-4 mb-8">
              {avatarUrl && isAvatarValid ? (
                <img
                  src={avatarUrl}
                  alt="Profile"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                  className="w-16 h-16 rounded-full object-cover border border-slate-200 bg-slate-100"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
                  <UserCircle size={38} className="text-slate-500" />
                </div>
              )}

              <div className="min-w-0">
                <h3 className="text-xl font-semibold truncate">
                  {fullName.trim() || 'Your Profile'}
                </h3>
                <p className="text-slate-500 text-sm truncate">{email}</p>
              </div>
            </div>

            <div className="space-y-5">
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
                    size={15}
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
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                  Email
                </label>
                <div className="relative">
                  <Mail
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input value={email} disabled className={`${inputCls} pl-9`} />
                </div>
                <p className="text-xs text-slate-400 mt-1.5">
                  Email is managed through your login provider.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-8">
              <button
                type="button"
                onClick={handleReset}
                disabled={!hasChanges || saving}
                className="border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-sm disabled:opacity-50 hover:bg-slate-50 transition"
              >
                Reset
              </button>

              <button
                type="button"
                onClick={handleSaveProfile}
                disabled={saving || !hasChanges || !isAvatarValid}
                className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 hover:bg-slate-700 transition inline-flex items-center gap-2"
              >
                <Save size={15} />
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
            <h3 className="text-xl font-semibold mb-2">Integrations</h3>
            <p className="text-slate-500 text-sm mb-6">
              Connect external services to automate job application tracking.
            </p>

            <div className="border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                  <Mail size={18} className="text-slate-600" />
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Gmail Sync</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Automatically detect application confirmations, rejections, and interview emails.
                  </p>
                </div>
              </div>

              <button
                disabled
                className="bg-slate-200 text-slate-500 px-4 py-2 rounded-lg text-sm cursor-not-allowed shrink-0"
              >
                Coming Soon
              </button>
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="bg-slate-900 text-white rounded-2xl shadow-sm p-6">
            <p className="text-xs text-slate-400 uppercase tracking-widest mb-3">
              Account Summary
            </p>

            <div className="flex items-center gap-3 mb-5">
              {avatarUrl && isAvatarValid ? (
                <img
                  src={avatarUrl}
                  alt="Profile preview"
                  className="w-12 h-12 rounded-full object-cover border border-white/10"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                  <UserCircle size={28} className="text-slate-300" />
                </div>
              )}

              <div className="min-w-0">
                <p className="font-semibold truncate">
                  {fullName.trim() || 'Unnamed User'}
                </p>
                <p className="text-xs text-slate-400 truncate">{email}</p>
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-slate-400">Profile status</span>
                <span>{fullName.trim() ? 'Complete' : 'Incomplete'}</span>
              </div>

              <div className="flex justify-between gap-4">
                <span className="text-slate-400">Avatar</span>
                <span>{avatarUrl.trim() ? 'Added' : 'Not added'}</span>
              </div>

              <div className="flex justify-between gap-4">
                <span className="text-slate-400">User ID</span>
                <span className="truncate max-w-[150px]">{user?.id}</span>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
            <h3 className="text-sm font-semibold mb-2">Profile Tips</h3>
            <p className="text-sm text-slate-500 leading-relaxed">
              Use your real name and a professional image. This will make your job tracking
              workspace feel more polished when screenshots or exports are added later.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
};