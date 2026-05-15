import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  UserRound,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';

export const AuthPage: React.FC = () => {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const isSignup = mode === 'signup';

  const resetForm = () => {
    setFullName('');
    setEmail('');
    setPassword('');
    setShowPassword(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (isSignup) {
        await signUp(email.trim(), password, fullName.trim());

        resetForm();
        setMode('signin');
        setMessage('Account created. Please sign in.');
      } else {
        await signIn(email.trim(), password);

        setMessage('Login successful. Redirecting...');
        navigate('/dashboard');
      }
    } catch (err: unknown) {
      console.error('Auth error:', err);

      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Authentication failed. Please check your details and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode((current) => (current === 'signin' ? 'signup' : 'signin'));
    setError('');
    setMessage('');
    resetForm();
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 grid lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden lg:flex flex-col justify-between p-10 bg-slate-950 text-white">
        <div>
          <div className="inline-flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center">
              <Briefcase size={22} />
            </div>

            <div>
              <h1 className="text-2xl font-bold">JTracker</h1>
              <p className="text-sm text-slate-300">Track every opportunity clearly.</p>
            </div>
          </div>
        </div>

        <div className="max-w-xl">
          <p className="text-sm uppercase tracking-[0.25em] text-slate-400 mb-4">
            Job Search Operating System
          </p>

          <h2 className="text-5xl font-bold leading-tight">
            Manage applications, CVs, follow-ups, and interviews in one place.
          </h2>

          <p className="text-slate-300 mt-5 text-lg leading-relaxed">
            Build a cleaner job search workflow with application tracking,
            lifecycle dates, reminders, analytics, and recruiter history.
          </p>

          <div className="grid grid-cols-3 gap-4 mt-10">
            <FeatureStat value="1" label="Pipeline" />
            <FeatureStat value="CV" label="Tracking" />
            <FeatureStat value="14d" label="Follow-ups" />
          </div>
        </div>

        <p className="text-xs text-slate-500">
          Built for focused job seekers who want structure and visibility.
        </p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center mx-auto mb-3">
              <Briefcase size={22} />
            </div>

            <h1 className="text-2xl font-bold">JTracker</h1>
            <p className="text-sm text-slate-500">Track every opportunity clearly.</p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="bg-white border border-slate-200 rounded-3xl shadow-sm p-8"
          >
            <div className="mb-7">
              <h2 className="text-2xl font-bold">
                {isSignup ? 'Create your account' : 'Welcome back'}
              </h2>

              <p className="text-sm text-slate-500 mt-2">
                {isSignup
                  ? 'Start organizing your job search workflow.'
                  : 'Sign in to continue tracking your opportunities.'}
              </p>
            </div>

            {error && <AlertBox type="error" message={error} />}
            {message && <AlertBox type="success" message={message} />}

            <div className="space-y-4">
              {isSignup && (
                <Field label="Full name">
                  <div className="relative">
                    <UserRound
                      size={17}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    />

                    <input
                      type="text"
                      placeholder="Your full name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                      className="w-full border border-slate-200 rounded-xl pl-10 pr-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                    />
                  </div>
                </Field>
              )}

              <Field label="Email">
                <div className="relative">
                  <Mail
                    size={17}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />

                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    autoComplete="email"
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full border border-slate-200 rounded-xl pl-10 pr-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  />
                </div>
              </Field>

              <Field label="Password">
                <div className="relative">
                  <Lock
                    size={17}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />

                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder={isSignup ? 'Create a secure password' : 'Enter your password'}
                    value={password}
                    autoComplete={isSignup ? 'new-password' : 'current-password'}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="w-full border border-slate-200 rounded-xl pl-10 pr-11 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </Field>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 text-white rounded-xl px-4 py-3 text-sm font-medium mt-6 hover:bg-slate-700 transition disabled:opacity-50"
            >
              {loading
                ? isSignup
                  ? 'Creating account...'
                  : 'Signing in...'
                : isSignup
                  ? 'Create Account'
                  : 'Sign In'}
            </button>

            <div className="mt-5 text-center">
              <button
                type="button"
                onClick={switchMode}
                className="text-sm text-slate-600 hover:text-slate-900"
              >
                {isSignup
                  ? 'Already have an account? Sign in'
                  : "Don't have an account? Create one"}
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
};

const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <label className="block">
    <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
      {label}
    </span>
    {children}
  </label>
);

const AlertBox = ({
  type,
  message,
}: {
  type: 'error' | 'success';
  message: string;
}) => (
  <div
    className={`rounded-xl border px-4 py-3 text-sm mb-4 flex items-start gap-2 ${
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

    <span>{message}</span>
  </div>
);

const FeatureStat = ({ value, label }: { value: string; label: string }) => (
  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
    <p className="text-2xl font-bold">{value}</p>
    <p className="text-sm text-slate-400 mt-1">{label}</p>
  </div>
);