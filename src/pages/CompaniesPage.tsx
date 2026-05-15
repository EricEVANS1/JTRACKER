import React, { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Search,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface CompanyJoin {
  id: string;
  name: string;
  website?: string | null;
  location?: string | null;
}

interface RawApplicationWithCompany {
  id: string;
  role_title: string;
  status: string;
  archived: boolean;
  date_applied: string | null;
  created_at: string;
  companies?: CompanyJoin | CompanyJoin[] | null;
}

interface ApplicationWithCompany extends Omit<RawApplicationWithCompany, 'companies'> {
  companies: CompanyJoin | null;
}

interface CompanyApplicationHistory {
  id: string;
  role_title: string;
  status: string;
  date_applied: string | null;
  created_at: string;
}

interface CompanyStats {
  id: string;
  name: string;
  website?: string | null;
  location?: string | null;
  applications: number;
  interviews: number;
  offers: number;
  rejections: number;
  history: CompanyApplicationHistory[];
}

const firstOrNull = <T,>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const formatStatus = (status: string) =>
  status.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

const formatDate = (date?: string | null) => {
  if (!date) return 'Not set';

  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const statusClass = (status: string) => {
  const styles: Record<string, string> = {
    wishlist: 'bg-slate-100 text-slate-700',
    applied: 'bg-blue-50 text-blue-700',
    confirmation_received: 'bg-cyan-50 text-cyan-700',
    assessment: 'bg-violet-50 text-violet-700',
    interview: 'bg-indigo-50 text-indigo-700',
    final_interview: 'bg-purple-50 text-purple-700',
    offer: 'bg-emerald-50 text-emerald-700',
    rejected: 'bg-red-50 text-red-700',
    withdrawn: 'bg-slate-100 text-slate-600',
    ghosted: 'bg-amber-50 text-amber-700',
  };

  return styles[status] || styles.applied;
};

const inputCls =
  'w-full border border-slate-200 rounded-xl pl-10 pr-3 py-3 text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition';

export const CompaniesPage: React.FC = () => {
  const { user } = useAuth();

  const [applications, setApplications] = useState<ApplicationWithCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null);

  const fetchApplications = async () => {
    if (!user) return;

    setLoading(true);
    setError('');

    const { data, error } = await supabase
      .from('applications')
      .select(`
        id,
        role_title,
        status,
        archived,
        date_applied,
        created_at,
        companies (
          id,
          name,
          website,
          location
        )
      `)
      .eq('user_id', user.id)
      .order('date_applied', { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      const normalized: ApplicationWithCompany[] = (
        (data || []) as RawApplicationWithCompany[]
      ).map((application) => ({
        ...application,
        companies: firstOrNull(application.companies),
      }));

      setApplications(normalized);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchApplications();
  }, [user]);

  const visibleCompanies = useMemo(() => {
    const map = new Map<string, CompanyStats>();

    applications.forEach((application) => {
      if (!application.companies?.id) return;

      const company = application.companies;

      if (!map.has(company.id)) {
        map.set(company.id, {
          id: company.id,
          name: company.name,
          website: company.website,
          location: company.location,
          applications: 0,
          interviews: 0,
          offers: 0,
          rejections: 0,
          history: [],
        });
      }

      const stats = map.get(company.id);
      if (!stats) return;

      stats.applications += 1;

      if (['interview', 'final_interview'].includes(application.status)) {
        stats.interviews += 1;
      }

      if (application.status === 'offer') {
        stats.offers += 1;
      }

      if (application.status === 'rejected') {
        stats.rejections += 1;
      }

      stats.history.push({
        id: application.id,
        role_title: application.role_title,
        status: application.status,
        date_applied: application.date_applied,
        created_at: application.created_at,
      });
    });

    return Array.from(map.values())
      .filter((company) => {
        const term = search.toLowerCase();

        if (!term.trim()) return company.applications > 0;

        return (
          company.name.toLowerCase().includes(term) ||
          company.location?.toLowerCase().includes(term) ||
          company.history.some((item) =>
            item.role_title.toLowerCase().includes(term)
          )
        );
      })
      .map((company) => ({
        ...company,
        history: company.history.sort(
          (a, b) =>
            new Date(b.date_applied || b.created_at).getTime() -
            new Date(a.date_applied || a.created_at).getTime()
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [applications, search]);

  if (loading) {
    return <p className="text-slate-500">Loading companies...</p>;
  }

  return (
    <div>
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6 mb-8">
        <div>
          <h2 className="text-3xl font-bold mb-2">Companies</h2>
          <p className="text-slate-500 max-w-2xl">
            Track company history, response patterns, and previous positions you applied for.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 min-w-[260px]">
          <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
            Companies Tracked
          </p>
          <p className="text-3xl font-bold mt-2">{visibleCompanies.length}</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 mb-6">
        <div className="relative">
          <Search
            size={17}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company, location, or previous role..."
            className={inputCls}
          />
        </div>
      </div>

      {visibleCompanies.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <Building2 size={36} className="mx-auto text-slate-300 mb-3" />
          <h3 className="text-lg font-semibold">No companies found</h3>
          <p className="text-slate-500 mt-2">
            Companies will appear when applications are created.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {visibleCompanies.map((company) => {
            const expanded = expandedCompanyId === company.id;

            return (
              <div
                key={company.id}
                className="bg-white border border-slate-200 rounded-2xl shadow-sm p-7"
              >
                <div className="flex items-start gap-4 mb-6">
                  <div className="bg-slate-100 rounded-xl p-3">
                    <Building2 size={24} className="text-slate-600" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-semibold truncate">{company.name}</h3>

                    {company.location && (
                      <p className="text-sm text-slate-500 mt-1">
                        {company.location}
                      </p>
                    )}

                    {company.website && (
                      <a
                        href={company.website}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-slate-700 underline mt-1 inline-flex items-center gap-1"
                      >
                        Website
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard label="Applications" value={company.applications} />
                  <StatCard label="Interviews" value={company.interviews} />
                  <StatCard label="Offers" value={company.offers} />
                  <StatCard label="Rejections" value={company.rejections} />
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setExpandedCompanyId(expanded ? null : company.id)
                  }
                  className="mt-5 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition inline-flex items-center justify-center gap-2"
                >
                  {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  {expanded ? 'Hide application history' : 'View application history'}
                </button>

                {expanded && (
                  <div className="mt-5 border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                      <p className="text-sm font-semibold text-slate-700">
                        Previous positions applied for
                      </p>
                    </div>

                    <div className="divide-y divide-slate-200">
                      {company.history.map((item) => (
                        <div key={item.id} className="p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Briefcase
                                  size={15}
                                  className="text-slate-400 shrink-0"
                                />
                                <p className="font-medium text-slate-900 truncate">
                                  {item.role_title}
                                </p>
                              </div>

                              <div className="flex items-center gap-2 mt-2 text-sm text-slate-500">
                                <CalendarDays size={14} />
                                Applied: {formatDate(item.date_applied || item.created_at)}
                              </div>
                            </div>

                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-medium shrink-0 ${statusClass(
                                item.status
                              )}`}
                            >
                              {formatStatus(item.status)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const StatCard = ({ label, value }: { label: string; value: number }) => (
  <div className="border border-slate-200 rounded-xl p-4 bg-white">
    <p className="text-sm text-slate-500">{label}</p>
    <p className="text-2xl font-bold mt-2">{value}</p>
  </div>
);