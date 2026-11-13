import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { supabase } from '../lib/supabase';

const inputClass = 'mt-1 w-full rounded-xl border border-slate-300 px-4 py-3';

export function PasswordRecoveryPage({ mode }: { mode: 'request' | 'reset' }) {
  const [params] = useSearchParams();
  const token = params.get('token_hash');
  const requesting = mode === 'request';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [verified, setVerified] = useState(false);
  const [invalid, setInvalid] = useState(!requesting && !token);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || invalid || message) return;
    setError('');
    if (!requesting && password !== confirmation) {
      setError('The passwords must match.');
      return;
    }
    setPending(true);

    try {
      if (requesting) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error && error.code !== 'user_not_found') {
          throw new Error('Could not request a reset email. Please try again later.');
        }
        setMessage('If an account exists for this email, a password reset link will arrive shortly.');
        return;
      }

      if (!verified) {
        if (!token) return;
        const { data, error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: token });
        if (error || !data.session) {
          setInvalid(true);
          return;
        }
        setVerified(true);
        window.history.replaceState(window.history.state, '', window.location.pathname);
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword('');
      setConfirmation('');

      const { error: signOutError } = await supabase.auth.signOut();
      setMessage(signOutError
        ? 'Password updated. Your current session could not be signed out automatically.'
        : 'Password updated. You can now sign in with your new password.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-5 text-slate-900">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="mb-4 text-lg font-bold">JTracker</p>
        <h1 className="mb-4 text-2xl font-bold">{requesting ? 'Reset your password' : 'Set a new password'}</h1>
        {error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="mb-4 text-sm text-slate-700">{message}</p>}
        {invalid && (
          <p role="alert" className="mb-4 text-sm text-red-700">
            This reset link is invalid or has expired. <Link to="/forgot-password" className="underline">Request a new link</Link>.
          </p>
        )}
        {!invalid && !message && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {requesting ? (
              <label className="block text-sm font-medium">
                Email address
                <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} />
              </label>
            ) : (
              <>
                <label className="block text-sm font-medium">
                  New password
                  <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required className={inputClass} />
                </label>
                <label className="block text-sm font-medium">
                  Confirm new password
                  <input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} minLength={6} required className={inputClass} />
                </label>
              </>
            )}
            <button disabled={pending} className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
              {requesting ? 'Send reset link' : 'Update password'}
            </button>
          </form>
        )}
        <Link to="/auth" className="mt-5 inline-block text-sm font-medium underline">Back to sign in</Link>
      </section>
    </main>
  );
}
