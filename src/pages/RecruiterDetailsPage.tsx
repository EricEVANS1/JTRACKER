import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Mail,
  Phone,
  ExternalLink,
  Plus,
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

const inputCls =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 transition';

export const RecruiterDetailsPage: React.FC = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const { onboardingComplete, completedSteps, refreshOnboarding } = useOnboarding();

  const [recruiter, setRecruiter] = useState<Recruiter | null>(null);
  const [interactions, setInteractions] = useState<RecruiterInteraction[]>([]);
  const [applications, setApplications] = useState<RecruiterApplication[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [interactionType, setInteractionType] = useState('note');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const fetchRecruiter = async () => {
    if (!user || !id) return;

    setLoading(true);
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
    setLoading(false);
  };

  useEffect(() => {
    fetchRecruiter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, id]);

  const handleAddInteraction = async () => {
    if (!user || !id || !title.trim()) return;

    setSaving(true);
    setError('');

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

    setSaving(false);
  };

  if (loading) {
    return (
      <div className="w-full max-w-full overflow-hidden">
        <p className="text-slate-500">Loading recruiter...</p>
      </div>
    );
  }

  if (!recruiter) {
    return (
      <div className="w-full max-w-full overflow-hidden">
        <p className="text-slate-500">Recruiter not found.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-full overflow-hidden">
      <Link
        to="/recruiters"
        className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-6"
      >
        <ArrowLeft size={16} />
        Back to Recruiters
      </Link>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 break-words">
          {error}
        </div>
      )}

      {!onboardingComplete && !completedSteps.hasRecruiter && (
        <OnboardingHint
          title="Log your first recruiter interaction"
          description="Recruiter notes help you track conversations, follow-ups, LinkedIn messages, and interview progress."
        />
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-8 mb-6 overflow-hidden">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2 break-words">
          {recruiter.name}
        </h1>

        <p className="text-slate-500 mb-6 break-words">
          {recruiter.role_title || 'Recruiter'}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <InfoCard
            icon={<Building2 size={16} />}
            label="Company"
            value={recruiter.companies?.name || 'Not specified'}
          />

          <InfoCard
            icon={<Mail size={16} />}
            label="Email"
            value={recruiter.email || 'Not specified'}
          />

          <InfoCard
            icon={<Phone size={16} />}
            label="Phone"
            value={recruiter.phone || 'Not specified'}
          />

          <div className="border border-slate-200 rounded-xl p-4 overflow-hidden">
            <div className="flex items-center gap-2 text-slate-500 mb-2">
              <ExternalLink size={16} />
              <span className="text-sm">LinkedIn</span>
            </div>

            {recruiter.linkedin_url ? (
              <a
                href={recruiter.linkedin_url}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline break-all"
              >
                Open profile
              </a>
            ) : (
              <p className="font-medium break-words">Not specified</p>
            )}
          </div>
        </div>

        {recruiter.notes && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mt-6 whitespace-pre-wrap break-words">
            {recruiter.notes}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-8 mb-6 overflow-hidden">
        <h2 className="text-xl font-semibold mb-2 break-words">Linked Applications</h2>
        <p className="text-slate-500 mb-6 break-words">
          Applications connected to this recruiter.
        </p>

        {applications.length === 0 ? (
          <p className="text-slate-500 break-words">
            No applications linked to this recruiter yet.
          </p>
        ) : (
          <div className="space-y-4">
            {applications.map((application) => (
              <div
                key={application.id}
                className="border border-slate-200 rounded-xl p-4 overflow-hidden"
              >
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold break-words">
                      {application.role_title}
                    </h3>

                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded-full text-xs break-words">
                        {application.status.replaceAll('_', ' ')}
                      </span>

                      {application.date_applied && (
                        <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded-full text-xs break-words">
                          Applied {application.date_applied}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 text-sm">
                    <Link
                      to={`/applications/${application.id}`}
                      className="w-full sm:w-auto text-center sm:text-left text-slate-900 underline"
                    >
                      View
                    </Link>

                    {application.application_link && (
                      <a
                        href={application.application_link}
                        target="_blank"
                        rel="noreferrer"
                        className="w-full sm:w-auto text-center sm:text-left text-slate-500 hover:text-slate-900 underline"
                      >
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

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-8 mb-6 overflow-hidden">
        <h2 className="text-xl font-semibold mb-2 break-words">Add Interaction</h2>
        <p className="text-slate-500 mb-6 break-words">
          Log recruiter calls, emails, LinkedIn messages, or follow-ups.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Interaction title"
            className={inputCls}
          />

          <select
            value={interactionType}
            onChange={(e) => setInteractionType(e.target.value)}
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

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Details..."
          className={`${inputCls} min-h-24 resize-y`}
        />

        <div className="flex flex-col sm:flex-row sm:justify-end mt-4">
          <button
            onClick={handleAddInteraction}
            disabled={saving || !title.trim()}
            className="w-full sm:w-auto bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            {saving ? 'Saving...' : 'Add Interaction'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-8 overflow-hidden">
        <h2 className="text-xl font-semibold mb-6 break-words">Recruiter Timeline</h2>

        {interactions.length === 0 ? (
          <p className="text-slate-500 break-words">No recruiter interactions yet.</p>
        ) : (
          <div className="space-y-4">
            {interactions.map((interaction) => (
              <div
                key={interaction.id}
                className="border border-slate-200 rounded-xl p-4 overflow-hidden"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-semibold break-words">{interaction.title}</h3>

                    <p className="text-sm text-slate-500 mt-1 break-words">
                      {interaction.interaction_type.replaceAll('_', ' ')}
                    </p>

                    {interaction.description && (
                      <p className="text-sm text-slate-600 mt-3 break-words">
                        {interaction.description}
                      </p>
                    )}
                  </div>

                  <span className="text-xs text-slate-500 whitespace-nowrap shrink-0">
                    {new Date(interaction.interaction_date).toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const InfoCard = ({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) => (
  <div className="border border-slate-200 rounded-xl p-4 overflow-hidden">
    <div className="flex items-center gap-2 text-slate-500 mb-2">
      {icon}
      <span className="text-sm">{label}</span>
    </div>
    <p className="font-medium break-words">{value}</p>
  </div>
);