import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  ExternalLink,
  Mail,
  Phone,
  Plus,
  Search,
  Users,
  X,
} from 'lucide-react';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

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

const inputCls =
  'w-full border border-slate-300 rounded-xl px-3 py-3 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition';

export const RecruitersPage: React.FC = () => {
  const { user } = useAuth();

  const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [phone, setPhone] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);

  const fetchRecruiters = async () => {
    if (!user) return;

    setLoading(true);

    const { data, error } = await supabase
      .from('recruiters')
      .select(`
        *,
        companies (
          name
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setRecruiters(data || []);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchRecruiters();
  }, [user]);

  const filteredRecruiters = useMemo(() => {
    const term = search.toLowerCase();

    return recruiters.filter((recruiter) => {
      if (!term.trim()) return true;

      return (
        recruiter.name.toLowerCase().includes(term) ||
        recruiter.email?.toLowerCase().includes(term) ||
        recruiter.role_title?.toLowerCase().includes(term) ||
        recruiter.companies?.name?.toLowerCase().includes(term)
      );
    });
  }, [recruiters, search]);

  const resetForm = () => {
    setName('');
    setEmail('');
    setLinkedinUrl('');
    setPhone('');
    setRoleTitle('');
    setCompanyName('');
    setNotes('');
  };

  const handleCreateRecruiter = async () => {
    if (!user || !name.trim()) return;

    setSaving(true);
    setError('');
    setMessage('');

    let companyId: string | null = null;

    try {
      if (companyName.trim()) {
        const { data: existingCompany } = await supabase
          .from('companies')
          .select('id')
          .eq('user_id', user.id)
          .ilike('name', companyName.trim())
          .maybeSingle();

        if (existingCompany) {
          companyId = existingCompany.id;
        } else {
          const { data: newCompany, error: companyError } = await supabase
            .from('companies')
            .insert({
              user_id: user.id,
              name: companyName.trim(),
            })
            .select('id')
            .single();

          if (companyError) {
            throw new Error(companyError.message);
          }

          companyId = newCompany?.id || null;
        }
      }

      const { error } = await supabase.from('recruiters').insert({
        user_id: user.id,
        company_id: companyId,
        name: name.trim(),
        email: email || null,
        linkedin_url: linkedinUrl || null,
        phone: phone || null,
        role_title: roleTitle || null,
        notes: notes || null,
      });

      if (error) {
        throw new Error(error.message);
      }

      resetForm();
      setShowForm(false);
      setMessage('Recruiter added successfully.');

      await fetchRecruiters();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create recruiter.');
    }

    setSaving(false);
  };

  if (loading) {
    return <RecruitersSkeleton />;
  }

  return (
    <div className="w-full max-w-full overflow-hidden">
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6 mb-8">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <Users className="text-slate-700 shrink-0" size={30} />

            <h1 className="text-2xl sm:text-3xl font-bold break-words">
              Recruiters
            </h1>
          </div>

          <p className="text-slate-500 text-sm sm:text-base max-w-2xl break-words">
            Track recruiters, HR contacts, hiring managers, and talent acquisition
            teams involved in your applications.
          </p>
        </div>

        <button
          onClick={() => setShowForm((prev) => !prev)}
          className="w-full sm:w-auto bg-slate-900 text-white px-4 py-3 rounded-xl text-sm inline-flex items-center justify-center gap-2 hover:bg-slate-700 transition"
        >
          {showForm ? <X size={16} /> : <Plus size={16} />}

          {showForm ? 'Close Form' : 'Add Recruiter'}
        </button>
      </div>

      {error && (
        <AlertBox
          type="error"
          message={error}
          onClose={() => setError('')}
        />
      )}

      {message && (
        <AlertBox
          type="success"
          message={message}
          onClose={() => setMessage('')}
        />
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 mb-6 overflow-hidden">
        <div className="relative">
          <Search
            size={17}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recruiter, company, email, or role..."
            className={`${inputCls} pl-10`}
          />
        </div>
      </div>

      {showForm && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 mb-8 overflow-hidden">
          <h2 className="text-xl font-semibold mb-5">Add Recruiter</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Recruiter name"
              className={inputCls}
            />

            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Company"
              className={inputCls}
            />

            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className={inputCls}
            />

            <input
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="LinkedIn URL"
              className={inputCls}
            />

            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone"
              className={inputCls}
            />

            <input
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder="Role title"
              className={inputCls}
            />
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes..."
            className={`${inputCls} w-full min-h-[120px] mt-4 resize-none`}
          />

          <div className="flex flex-col sm:flex-row sm:justify-end gap-3 mt-5">
            <button
              type="button"
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
              className="w-full sm:w-auto border border-slate-300 text-slate-700 px-4 py-3 rounded-xl text-sm hover:bg-slate-50 transition"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleCreateRecruiter}
              disabled={saving || !name.trim()}
              className="w-full sm:w-auto bg-slate-900 text-white px-4 py-3 rounded-xl text-sm hover:bg-slate-700 transition disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Recruiter'}
            </button>
          </div>
        </div>
      )}

      {filteredRecruiters.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-10 text-center">
          <Users size={36} className="mx-auto text-slate-300 mb-3" />

          <h3 className="text-lg font-semibold">No recruiters added yet</h3>

          <p className="text-slate-500 mt-2 text-sm sm:text-base">
            Add recruiters and HR contacts to track conversations and opportunities.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {filteredRecruiters.map((recruiter) => (
            <div
              key={recruiter.id}
              className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-sm overflow-hidden"
            >
              <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg sm:text-xl font-semibold break-words">
                    {recruiter.name}
                  </h2>

                  <p className="text-slate-500 mt-1 break-words">
                    {recruiter.role_title || 'Recruiter'}
                  </p>

                  {recruiter.companies?.name && (
                    <div className="flex items-start gap-2 text-slate-600 mt-4 break-words">
                      <Building2 size={16} className="shrink-0 mt-0.5" />

                      <span className="break-words">
                        {recruiter.companies.name}
                      </span>
                    </div>
                  )}

                  {recruiter.notes && (
                    <div className="mt-5 bg-slate-50 border border-slate-200 rounded-xl p-4">
                      <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
                        {recruiter.notes}
                      </p>
                    </div>
                  )}
                </div>

                <div className="w-full xl:w-[320px] shrink-0">
                  <div className="space-y-3">
                    {recruiter.email && (
                      <div className="flex items-start gap-2 text-sm break-all">
                        <Mail
                          size={16}
                          className="text-slate-500 shrink-0 mt-0.5"
                        />

                        <span>{recruiter.email}</span>
                      </div>
                    )}

                    {recruiter.phone && (
                      <div className="flex items-start gap-2 text-sm break-words">
                        <Phone
                          size={16}
                          className="text-slate-500 shrink-0 mt-0.5"
                        />

                        <span>{recruiter.phone}</span>
                      </div>
                    )}

                    {recruiter.linkedin_url && (
                      <a
                        href={recruiter.linkedin_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 text-sm text-slate-900 underline break-all"
                      >
                        <ExternalLink size={16} className="shrink-0" />
                        LinkedIn
                      </a>
                    )}
                  </div>

                  <div className="mt-5">
                    <Link
                      to={`/recruiters/${recruiter.id}`}
                      className="w-full bg-slate-900 text-white px-4 py-3 rounded-xl text-sm inline-flex items-center justify-center gap-2 hover:bg-slate-700 transition"
                    >
                      <ExternalLink size={16} />
                      View Profile
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const AlertBox = ({
  type,
  message,
  onClose,
}: {
  type: 'error' | 'success';
  message: string;
  onClose: () => void;
}) => (
  <div
    className={`rounded-xl p-4 mb-6 flex items-start gap-3 border ${
      type === 'error'
        ? 'bg-red-50 border-red-200 text-red-700'
        : 'bg-emerald-50 border-emerald-200 text-emerald-700'
    }`}
  >
    <span className="text-sm flex-1 break-words">{message}</span>

    <button
      onClick={onClose}
      className="opacity-70 hover:opacity-100 shrink-0"
    >
      <X size={16} />
    </button>
  </div>
);

const RecruitersSkeleton = () => (
  <div className="w-full max-w-full overflow-hidden">
    <div className="mb-8">
      <div className="h-8 w-56 bg-slate-200 rounded-lg animate-pulse mb-2" />
      <div className="h-4 w-full max-w-96 bg-slate-100 rounded-lg animate-pulse" />
    </div>

    <div className="h-16 bg-white border border-slate-200 rounded-2xl animate-pulse mb-6" />

    <div className="space-y-5">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="h-56 bg-white border border-slate-200 rounded-2xl animate-pulse"
        />
      ))}
    </div>
  </div>
);