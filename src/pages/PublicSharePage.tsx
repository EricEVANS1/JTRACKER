import React, { useEffect, useState } from 'react';
import { AlertCircle, Briefcase, Copy, ExternalLink, MapPin, Share2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { supabase } from '../lib/supabase';
import type { SharedOpportunity } from '../types/sharedOpportunity';

const formatDate = (date?: string | null) => {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

export const PublicSharePage: React.FC = () => {
  const { publicShareId } = useParams();
  const [item, setItem] = useState<SharedOpportunity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const fetchShare = async () => {
      if (!publicShareId) return;

      setLoading(true);
      setError('');

      const { data, error } = await supabase
        .from('shared_opportunities')
        .select('*')
        .eq('public_share_id', publicShareId)
        .maybeSingle();

      if (error) setError(error.message);
      else if (!data) setError('This shared opportunity does not exist or is no longer public.');
      else setItem(data);

      setLoading(false);
    };

    fetchShare();
  }, [publicShareId]);

  const handleCopy = async () => {
    if (!item) return;
    const summary = `${item.role_title}\n${item.company_name || 'Unknown Company'}${item.location ? ` — ${item.location}` : ''}\n${item.job_link || ''}`;
    await navigator.clipboard.writeText(summary.trim());
    setMessage('Summary copied.');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Share2 size={24} /> JTracker
          </Link>
          <p className="text-slate-500 mt-2">Shared job opportunity</p>
        </div>

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 animate-pulse">
            <div className="h-7 w-2/3 bg-slate-200 rounded mb-4" />
            <div className="h-4 w-1/2 bg-slate-100 rounded mb-8" />
            <div className="h-24 bg-slate-100 rounded" />
          </div>
        ) : error ? (
          <div className="bg-white border border-red-200 rounded-2xl shadow-sm p-8 text-center">
            <AlertCircle size={36} className="mx-auto text-red-500 mb-3" />
            <h1 className="text-xl font-bold mb-2">Share unavailable</h1>
            <p className="text-slate-600">{error}</p>
          </div>
        ) : item ? (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
            <div className="mb-6">
              <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Opportunity</p>
              <h1 className="text-3xl font-bold text-slate-900 mb-3">{item.role_title}</h1>
              <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                <span className="inline-flex items-center gap-1.5"><Briefcase size={16} />{item.company_name || 'Unknown Company'}</span>
                {item.location && <span className="inline-flex items-center gap-1.5"><MapPin size={16} />{item.location}</span>}
              </div>
            </div>

            {item.note && <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-700 whitespace-pre-wrap mb-5">{item.note}</div>}
            {item.include_status && item.status_snapshot && <p className="text-sm text-slate-600 mb-3"><strong>Status shared by sender:</strong> {item.status_snapshot.replaceAll('_', ' ')}</p>}
            {item.include_notes && item.notes_snapshot && <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-slate-700 whitespace-pre-wrap mb-5"><strong>Sender notes:</strong><br />{item.notes_snapshot}</div>}

            <p className="text-xs text-slate-500 mb-6">Shared on {formatDate(item.created_at)}</p>

            {message && <p className="text-sm text-emerald-700 mb-4">{message}</p>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button onClick={handleCopy} className="border border-slate-300 rounded-lg px-4 py-3 text-sm inline-flex items-center justify-center gap-2 hover:bg-slate-50">
                <Copy size={16} /> Copy Summary
              </button>
              {item.job_link && (
                <a href={item.job_link} target="_blank" rel="noreferrer" className="bg-slate-900 text-white rounded-lg px-4 py-3 text-sm inline-flex items-center justify-center gap-2">
                  Open Role <ExternalLink size={16} />
                </a>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
