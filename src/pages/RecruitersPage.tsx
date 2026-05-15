import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  Plus,
  Mail,
  ExternalLink,
  Phone,
  Building2,
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

export const RecruitersPage: React.FC = () => {
  const { user } = useAuth();

  const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [phone, setPhone] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [notes, setNotes] = useState('');

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

  const handleCreateRecruiter = async () => {
    if (!user || !name.trim()) return;

    let companyId: string | null = null;

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
          setError(companyError.message);
          return;
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
      setError(error.message);
      return;
    }

    setName('');
    setEmail('');
    setLinkedinUrl('');
    setPhone('');
    setRoleTitle('');
    setCompanyName('');
    setNotes('');
    setShowForm(false);

    await fetchRecruiters();
  };

  if (loading) {
    return <p className="text-slate-500">Loading recruiters...</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Users className="text-slate-700" size={30} />
            <h1 className="text-3xl font-bold">Recruiters</h1>
          </div>

          <p className="text-slate-500">
            Track recruiters, HR contacts, and talent acquisition teams.
          </p>
        </div>

        <button
          onClick={() => setShowForm((prev) => !prev)}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2"
        >
          <Plus size={16} />
          Add Recruiter
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6">
          {error}
        </div>
      )}

      {showForm && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Add Recruiter</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Recruiter name"
              className="border border-slate-300 rounded-lg px-3 py-2"
            />

            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Company"
              className="border border-slate-300 rounded-lg px-3 py-2"
            />

            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="border border-slate-300 rounded-lg px-3 py-2"
            />

            <input
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="LinkedIn URL"
              className="border border-slate-300 rounded-lg px-3 py-2"
            />

            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone"
              className="border border-slate-300 rounded-lg px-3 py-2"
            />

            <input
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder="Role title"
              className="border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes..."
            className="border border-slate-300 rounded-lg px-3 py-2 w-full min-h-24 mt-4"
          />

          <div className="flex justify-end mt-4">
            <button
              onClick={handleCreateRecruiter}
              className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm"
            >
              Save Recruiter
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {recruiters.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8">
            <p className="text-slate-500">No recruiters added yet.</p>
          </div>
        ) : (
          recruiters.map((recruiter) => (
            <div
              key={recruiter.id}
              className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm"
            >
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                <div>
                  <h2 className="text-xl font-semibold">{recruiter.name}</h2>

                  <p className="text-slate-500 mt-1">
                    {recruiter.role_title || 'Recruiter'}
                  </p>

                  {recruiter.companies?.name && (
                    <div className="flex items-center gap-2 text-slate-600 mt-3">
                      <Building2 size={16} />
                      <span>{recruiter.companies.name}</span>
                    </div>
                  )}

                  {recruiter.notes && (
                    <p className="text-slate-600 mt-4 whitespace-pre-wrap">
                      {recruiter.notes}
                    </p>
                  )}
                </div>

                <div className="space-y-3 min-w-[260px]">
                  {recruiter.email && (
                    <div className="flex items-center gap-2 text-sm">
                      <Mail size={16} className="text-slate-500" />
                      <span>{recruiter.email}</span>
                    </div>
                  )}

                  {recruiter.phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone size={16} className="text-slate-500" />
                      <span>{recruiter.phone}</span>
                    </div>
                  )}

                  {recruiter.linkedin_url && (
                    <a
                      href={recruiter.linkedin_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-slate-900 underline"
                    >
                      <ExternalLink size={16} />
                      LinkedIn
                    </a>
                  )}

                  <Link
                    to={`/recruiters/${recruiter.id}`}
                    className="inline-flex items-center gap-2 text-sm text-slate-900 underline"
                  >
                    <ExternalLink size={16} />
                    View Profile
                  </Link>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};