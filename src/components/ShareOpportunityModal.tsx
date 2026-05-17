import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  Mail,
  MessageCircle,
  Send,
  Share2,
  X,
} from 'lucide-react';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { ShareableApplicationSnapshot } from '../types/sharedOpportunity';

type ShareTab = 'internal' | 'public' | 'whatsapp';

interface ProfileResult {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface Props {
  application: ShareableApplicationSnapshot;
  open: boolean;
  onClose: () => void;
}

const inputCls =
  'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition';

const makePublicId = () => {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${randomPart}`;
};

export const ShareOpportunityModal: React.FC<Props> = ({ application, open, onClose }) => {
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<ShareTab>('internal');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipient, setRecipient] = useState<ProfileResult | null>(null);
  const [note, setNote] = useState('');
  const [includeStatus, setIncludeStatus] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [includeExperience, setIncludeExperience] = useState(false);

  const [publicLink, setPublicLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const companyName = application.companies?.name || 'Unknown Company';
  const baseUrl = window.location.origin;

  const shareText = useMemo(() => {
    return `🚀 Opportunity Shared via JTracker\n\n${application.role_title}\n${companyName}${application.location ? ` — ${application.location}` : ''}\n\nApplication Link:\n${application.application_link || 'No link provided'}\n\n${note || 'Thought this role might interest you.'}`;
  }, [application, companyName, note]);

  if (!open) return null;

  const buildPayload = (extra: Record<string, unknown>) => ({
    sender_user_id: user?.id,
    application_id: application.id,
    role_title: application.role_title,
    company_name: companyName,
    location: application.location || null,
    job_link: application.application_link || null,
    note: note.trim() || null,
    include_status: includeStatus,
    include_notes: includeNotes,
    include_experience: includeExperience,
    status_snapshot: includeStatus ? application.status : null,
    notes_snapshot: includeNotes ? application.notes : null,
    ...extra,
  });

  const handleFindRecipient = async () => {
    if (!recipientEmail.trim()) {
      setError('Enter the recipient email first.');
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');
    setRecipient(null);

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .ilike('email', recipientEmail.trim())
      .limit(1)
      .maybeSingle();

    if (error) {
      setError(error.message);
    } else if (!data) {
      setError('No JTracker user found with that email. Use Public Link or WhatsApp instead.');
    } else if (data.id === user?.id) {
      setError('You cannot internally share an opportunity with yourself.');
    } else {
      setRecipient(data);
      setMessage(`Recipient found: ${data.full_name || data.email}`);
    }

    setLoading(false);
  };

  const handleSendInternal = async () => {
    if (!user || !recipient) return;

    setLoading(true);
    setError('');
    setMessage('');

    const { error } = await supabase.from('shared_opportunities').insert(
      buildPayload({
        recipient_user_id: recipient.id,
        public_share_id: null,
      })
    );

    if (error) {
      setError(error.message);
    } else {
      setMessage('Opportunity shared inside JTracker.');
      setRecipientEmail('');
      setRecipient(null);
      setNote('');
    }

    setLoading(false);
  };

  const handleGeneratePublicLink = async () => {
    if (!user) return;

    setLoading(true);
    setError('');
    setMessage('');

    const publicShareId = makePublicId();

    const { data, error } = await supabase
      .from('shared_opportunities')
      .insert(
        buildPayload({
          recipient_user_id: null,
          public_share_id: publicShareId,
        })
      )
      .select('public_share_id')
      .single();

    if (error) {
      setError(error.message);
    } else {
      const link = `${baseUrl}/share/${data.public_share_id}`;
      setPublicLink(link);
      setMessage('Public share link generated.');
      await navigator.clipboard.writeText(link);
    }

    setLoading(false);
  };

  const handleCopy = async (value: string, successMessage: string) => {
    await navigator.clipboard.writeText(value);
    setMessage(successMessage);
  };

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Share2 size={20} className="text-slate-700" />
              <h2 className="text-xl font-bold">Share Opportunity</h2>
            </div>
            <p className="text-sm text-slate-500">
              Share a safe snapshot of this role, not your full application record.
            </p>
          </div>

          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pt-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
            <p className="font-semibold text-slate-900">{application.role_title}</p>
            <p className="text-sm text-slate-600">{companyName}{application.location ? ` — ${application.location}` : ''}</p>
          </div>

          {error && <InlineAlert type="error" message={error} />}
          {message && <InlineAlert type="success" message={message} />}

          <div className="grid grid-cols-3 gap-2 bg-slate-100 rounded-xl p-1 mb-5">
            <TabButton active={activeTab === 'internal'} onClick={() => setActiveTab('internal')} icon={<Mail size={15} />} label="Internal" />
            <TabButton active={activeTab === 'public'} onClick={() => setActiveTab('public')} icon={<Link2 size={15} />} label="Public Link" />
            <TabButton active={activeTab === 'whatsapp'} onClick={() => setActiveTab('whatsapp')} icon={<MessageCircle size={15} />} label="WhatsApp" />
          </div>
        </div>

        <div className="px-5 pb-5">
          {activeTab === 'internal' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Recipient email</label>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_130px] gap-2">
                  <input value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="friend@email.com" className={inputCls} />
                  <button onClick={handleFindRecipient} disabled={loading} className="border border-slate-300 rounded-lg px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
                    Find User
                  </button>
                </div>
              </div>

              <ShareOptions note={note} setNote={setNote} includeStatus={includeStatus} setIncludeStatus={setIncludeStatus} includeNotes={includeNotes} setIncludeNotes={setIncludeNotes} includeExperience={includeExperience} setIncludeExperience={setIncludeExperience} />

              <button onClick={handleSendInternal} disabled={loading || !recipient} className="w-full bg-slate-900 text-white rounded-lg px-4 py-3 text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50">
                <Send size={16} />
                {loading ? 'Sending...' : 'Send Internal Share'}
              </button>
            </div>
          )}

          {activeTab === 'public' && (
            <div className="space-y-4">
              <ShareOptions note={note} setNote={setNote} includeStatus={includeStatus} setIncludeStatus={setIncludeStatus} includeNotes={includeNotes} setIncludeNotes={setIncludeNotes} includeExperience={includeExperience} setIncludeExperience={setIncludeExperience} />

              <button onClick={handleGeneratePublicLink} disabled={loading} className="w-full bg-slate-900 text-white rounded-lg px-4 py-3 text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50">
                <Link2 size={16} />
                {loading ? 'Generating...' : 'Generate Public Link'}
              </button>

              {publicLink && (
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                  <p className="text-xs text-slate-500 mb-2">Public link</p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input readOnly value={publicLink} className={inputCls} />
                    <button onClick={() => handleCopy(publicLink, 'Public link copied.')} className="border border-slate-300 rounded-lg px-4 py-2 text-sm inline-flex items-center justify-center gap-2">
                      <Copy size={15} /> Copy
                    </button>
                    <a href={publicLink} target="_blank" rel="noreferrer" className="bg-white border border-slate-300 rounded-lg px-4 py-2 text-sm inline-flex items-center justify-center gap-2">
                      <ExternalLink size={15} /> Preview
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'whatsapp' && (
            <div className="space-y-4">
              <ShareOptions note={note} setNote={setNote} includeStatus={includeStatus} setIncludeStatus={setIncludeStatus} includeNotes={includeNotes} setIncludeNotes={setIncludeNotes} includeExperience={includeExperience} setIncludeExperience={setIncludeExperience} />

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 whitespace-pre-wrap text-sm text-slate-700">
                {shareText}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button onClick={() => handleCopy(shareText, 'WhatsApp summary copied.')} className="border border-slate-300 rounded-lg px-4 py-3 text-sm inline-flex items-center justify-center gap-2">
                  <Copy size={15} /> Copy Summary
                </button>
                <a href={whatsappUrl} target="_blank" rel="noreferrer" className="bg-slate-900 text-white rounded-lg px-4 py-3 text-sm inline-flex items-center justify-center gap-2">
                  <MessageCircle size={16} /> Open WhatsApp
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ShareOptions = ({
  note,
  setNote,
  includeStatus,
  setIncludeStatus,
  includeNotes,
  setIncludeNotes,
  includeExperience,
  setIncludeExperience,
}: {
  note: string;
  setNote: (value: string) => void;
  includeStatus: boolean;
  setIncludeStatus: (value: boolean) => void;
  includeNotes: boolean;
  setIncludeNotes: (value: boolean) => void;
  includeExperience: boolean;
  setIncludeExperience: (value: boolean) => void;
}) => (
  <div className="space-y-4">
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">Optional message</label>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Thought this role might interest you." className={inputCls} />
    </div>

    <div className="border border-slate-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-slate-800 mb-3">Privacy toggles</p>
      <div className="space-y-3">
        <Toggle label="Include my application status" checked={includeStatus} onChange={setIncludeStatus} />
        <Toggle label="Include my private notes" checked={includeNotes} onChange={setIncludeNotes} />
        <Toggle label="Include experience later" checked={includeExperience} onChange={setIncludeExperience} />
      </div>
    </div>
  </div>
);

const Toggle = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) => (
  <label className="flex items-center justify-between gap-4 text-sm text-slate-700 cursor-pointer">
    <span>{label}</span>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
  </label>
);

const TabButton = ({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) => (
  <button onClick={onClick} className={`rounded-lg px-3 py-2 text-sm font-medium inline-flex items-center justify-center gap-2 transition ${active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>
    {icon}
    {label}
  </button>
);

const InlineAlert = ({ type, message }: { type: 'error' | 'success'; message: string }) => (
  <div className={`mb-4 rounded-xl p-3 border flex items-start gap-2 text-sm ${type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
    {type === 'error' ? <AlertCircle size={16} className="mt-0.5" /> : <CheckCircle2 size={16} className="mt-0.5" />}
    <span>{message}</span>
  </div>
);
