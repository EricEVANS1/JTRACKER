import { useEffect, useState } from 'react';
import { analyticsConfigured, preference, setPreference, startAnalytics } from '../lib/webAnalytics';

export function AnalyticsConsent() {
  const [choice, setChoice] = useState(preference);
  useEffect(() => {
    function sync() {
      setChoice(preference());
      startAnalytics();
    }
    sync();
    window.addEventListener('analytics-preference', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('analytics-preference', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  if (!analyticsConfigured || choice || navigator.doNotTrack === '1') return null;
  return <aside aria-label="Optional usage analytics" className="fixed bottom-4 left-4 right-4 z-50 max-w-md rounded-xl border border-slate-700 bg-slate-950 p-4 text-sm text-white shadow-lg">
    <strong>Share anonymous usage statistics?</strong>
    <p className="my-2">Help improve JTracker by sharing page visits and interactions with PostHog. You can change this in Privacy settings.</p>
    <div className="flex gap-4">
      <button className="rounded border px-3 py-1" onClick={() => setPreference('allow')}>Allow</button>
      <button className="rounded border px-3 py-1" onClick={() => setPreference('decline')}>Decline</button>
    </div>
  </aside>;
}

export function AnalyticsPreference() {
  const [choice, setChoice] = useState(preference);
  useEffect(() => {
    const sync = () => setChoice(preference());
    window.addEventListener('analytics-preference', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('analytics-preference', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  if (!analyticsConfigured || navigator.doNotTrack === '1') return null;
  return <label className="mb-4 flex items-center gap-2 text-sm">
    <input type="checkbox" checked={choice === 'allow'} onChange={e => setPreference(e.target.checked ? 'allow' : 'decline')} />
    Share usage statistics with PostHog on this browser
  </label>;
}
