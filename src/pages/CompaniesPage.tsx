import React, { useEffect, useMemo, useState } from 'react';
import {
AlertCircle,
Briefcase,
Building2,
CalendarDays,
ChevronDown,
ChevronUp,
ExternalLink,
RefreshCw,
Search,
X,
} from 'lucide-react';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface CompanyJoin {
id: string;
name: string;
website?: string | null;
location?: string | null;
industry?: string | null;
}

interface CVVersionJoin {
id: string;
name: string;
}

interface RawApplicationWithCompany {
id: string;
role_title: string;
status: string;
archived: boolean | null;
archived_at?: string | null;
application_link?: string | null;
date_applied: string | null;
created_at: string;
updated_at?: string | null;
last_status_changed_at?: string | null;
status_updated_at?: string | null;

reached_interview?: boolean | null;
rejected_after_interview?: boolean | null;
final_response_pending?: boolean | null;
interview_started_at?: string | null;
final_interview_started_at?: string | null;
offer_received_at?: string | null;
rejected_at?: string | null;

companies?: CompanyJoin | CompanyJoin[] | null;
cv_versions?: CVVersionJoin | CVVersionJoin[] | null;
}

interface ApplicationWithCompany
extends Omit<RawApplicationWithCompany, 'companies' | 'cv_versions'> {
companies: CompanyJoin | null;
cv_versions: CVVersionJoin | null;
}

interface CompanyApplicationHistory {
id: string;
role_title: string;
status: string;
archived: boolean | null;
application_link?: string | null;
date_applied: string | null;
created_at: string;
last_update: string | null;
cv_version_name?: string | null;
reached_interview?: boolean | null;
rejected_after_interview?: boolean | null;
final_response_pending?: boolean | null;
}

interface CompanyStats {
id: string;
name: string;
website?: string | null;
location?: string | null;
industry?: string | null;

applications: number;
interviews: number;
offers: number;
rejections: number;
lastUpdate: string | null;

history: CompanyApplicationHistory[];
}

type CompanyFilter =
| 'all'
| 'with_interviews'
| 'with_offers'
| 'with_rejections'
| 'active'
| 'archived';

type CompanySort =
| 'last_update'
| 'az'
| 'most_applications'
| 'most_interviews'
| 'most_offers'
| 'most_rejections';

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

const getTime = (date?: string | null) => {
if (!date) return 0;
return new Date(date).getTime();
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
archived: 'bg-zinc-100 text-zinc-600',
};

return styles[status] || 'bg-slate-100 text-slate-700';
};

const hasReachedInterview = (application: ApplicationWithCompany) =>
Boolean(
application.reached_interview ||
application.interview_started_at ||
application.final_interview_started_at ||
['interview', 'final_interview', 'offer'].includes(application.status)
);

const inputCls =
'w-full border border-slate-200 rounded-xl px-3 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition';

export const CompaniesPage: React.FC = () => {
const { user } = useAuth();

const [applications, setApplications] = useState<ApplicationWithCompany[]>([]);
const [loading, setLoading] = useState(true);
const [refreshing, setRefreshing] = useState(false);
const [error, setError] = useState('');
const [search, setSearch] = useState('');
const [filter, setFilter] = useState<CompanyFilter>('all');
const [sortBy, setSortBy] = useState<CompanySort>('last_update');
const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null);

const fetchApplications = async () => {
if (!user) return;


setError('');

const { data, error } = await supabase
  .from('applications')
  .select(`
    id,
    role_title,
    status,
    archived,
    archived_at,
    application_link,
    date_applied,
    created_at,
    updated_at,
    last_status_changed_at,
    status_updated_at,
    reached_interview,
    rejected_after_interview,
    final_response_pending,
    interview_started_at,
    final_interview_started_at,
    offer_received_at,
    rejected_at,
    companies (
      id,
      name,
      website,
      location,
      industry
    ),
    cv_versions (
      id,
      name
    )
  `)
  .eq('user_id', user.id)
  .order('created_at', { ascending: false });

if (error) {
  setError(error.message);
  return;
}

const normalised: ApplicationWithCompany[] = (
  (data || []) as RawApplicationWithCompany[]
).map((application) => ({
  ...application,
  companies: firstOrNull(application.companies),
  cv_versions: firstOrNull(application.cv_versions),
}));

setApplications(normalised);


};

const loadPage = async () => {
setLoading(true);
await fetchApplications();
setLoading(false);
};

const handleRefresh = async () => {
setRefreshing(true);
await fetchApplications();
setRefreshing(false);
};

useEffect(() => {
loadPage();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [user?.id]);

const companies = useMemo(() => {
const map = new Map<string, CompanyStats>();


applications.forEach((application) => {
  if (!application.companies?.id) return;

  const company = application.companies;

  const applicationLastUpdate =
    application.last_status_changed_at ||
    application.status_updated_at ||
    application.updated_at ||
    application.date_applied ||
    application.created_at;

  if (!map.has(company.id)) {
    map.set(company.id, {
      id: company.id,
      name: company.name,
      website: company.website,
      location: company.location,
      industry: company.industry,
      applications: 0,
      interviews: 0,
      offers: 0,
      rejections: 0,
      lastUpdate: null,
      history: [],
    });
  }

  const stats = map.get(company.id);
  if (!stats) return;

  stats.applications += 1;

  if (hasReachedInterview(application)) {
    stats.interviews += 1;
  }

  if (application.status === 'offer') {
    stats.offers += 1;
  }

  if (application.status === 'rejected') {
    stats.rejections += 1;
  }

  if (!stats.lastUpdate || getTime(applicationLastUpdate) > getTime(stats.lastUpdate)) {
    stats.lastUpdate = applicationLastUpdate;
  }

  stats.history.push({
    id: application.id,
    role_title: application.role_title,
    status: application.status,
    archived: Boolean(application.archived) || application.status === 'archived',
    application_link: application.application_link,
    date_applied: application.date_applied,
    created_at: application.created_at,
    last_update: applicationLastUpdate,
    cv_version_name: application.cv_versions?.name || null,
    reached_interview: hasReachedInterview(application),
    rejected_after_interview: application.rejected_after_interview,
    final_response_pending: application.final_response_pending,
  });
});

return Array.from(map.values()).map((company) => ({
  ...company,
  history: company.history.sort(
    (a, b) => getTime(b.last_update) - getTime(a.last_update)
  ),
}));


}, [applications]);

const visibleCompanies = useMemo(() => {
const term = search.toLowerCase().trim();


const filtered = companies.filter((company) => {
  const matchesSearch =
    !term ||
    company.name.toLowerCase().includes(term) ||
    Boolean(company.location?.toLowerCase().includes(term)) ||
    Boolean(company.industry?.toLowerCase().includes(term)) ||
    company.history.some((item) =>
      item.role_title.toLowerCase().includes(term)
    );

  if (!matchesSearch) return false;

  if (filter === 'with_interviews') return company.interviews > 0;
  if (filter === 'with_offers') return company.offers > 0;
  if (filter === 'with_rejections') return company.rejections > 0;
  if (filter === 'active') return company.history.some((item) => !item.archived);
  if (filter === 'archived') return company.history.some((item) => item.archived);

  return true;
});

return filtered.sort((a, b) => {
  if (sortBy === 'az') return a.name.localeCompare(b.name);
  if (sortBy === 'most_applications') return b.applications - a.applications;
  if (sortBy === 'most_interviews') return b.interviews - a.interviews;
  if (sortBy === 'most_offers') return b.offers - a.offers;
  if (sortBy === 'most_rejections') return b.rejections - a.rejections;

  return getTime(b.lastUpdate) - getTime(a.lastUpdate);
});


}, [companies, search, filter, sortBy]);

const summary = useMemo(() => {
return {
companiesTracked: companies.length,
companiesWithInterviews: companies.filter((company) => company.interviews > 0).length,
companiesWithOffers: companies.filter((company) => company.offers > 0).length,
companiesWithRejections: companies.filter((company) => company.rejections > 0).length,
};
}, [companies]);

if (loading) {
return <CompaniesSkeleton />;
}

return ( <div className="w-full max-w-full overflow-hidden"> <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6 mb-8"> <div className="min-w-0"> <div className="flex items-center gap-3 mb-2"> <Building2 size={28} className="text-slate-700 shrink-0" />


        <h2 className="text-2xl sm:text-3xl font-bold break-words">
          Companies
        </h2>
      </div>

      <p className="text-slate-500 max-w-3xl text-sm sm:text-base break-words">
        Track companies, positions applied for, interview history, offers, rejections,
        and the latest activity.
      </p>
    </div>

    <button
      type="button"
      onClick={handleRefresh}
      disabled={refreshing}
      className="w-full sm:w-auto border border-slate-200 bg-white rounded-xl px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
    >
      <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
      {refreshing ? 'Refreshing...' : 'Refresh'}
    </button>
  </div>

  {error && (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 flex items-start gap-3 break-words">
      <AlertCircle size={16} className="shrink-0 mt-0.5" />

      <span className="text-sm flex-1">{error}</span>

      <button
        onClick={() => setError('')}
        className="opacity-70 hover:opacity-100 shrink-0"
      >
        <X size={16} />
      </button>
    </div>
  )}

  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
    <SummaryCard label="Companies" value={summary.companiesTracked} />
    <SummaryCard label="With Interviews" value={summary.companiesWithInterviews} />
    <SummaryCard label="With Offers" value={summary.companiesWithOffers} />
    <SummaryCard label="With Rejections" value={summary.companiesWithRejections} />
  </div>

  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 mb-6 overflow-hidden">
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_210px_210px] gap-3">
      <div className="relative">
        <Search
          size={17}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, location, industry, or position..."
          className={`${inputCls} pl-10`}
        />
      </div>

      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value as CompanyFilter)}
        className={inputCls}
      >
        <option value="all">All companies</option>
        <option value="with_interviews">With interviews</option>
        <option value="with_offers">With offers</option>
        <option value="with_rejections">With rejections</option>
        <option value="active">With active applications</option>
        <option value="archived">With archived applications</option>
      </select>

      <select
        value={sortBy}
        onChange={(e) => setSortBy(e.target.value as CompanySort)}
        className={inputCls}
      >
        <option value="last_update">Last update</option>
        <option value="az">A–Z</option>
        <option value="most_applications">Most applications</option>
        <option value="most_interviews">Most interviews</option>
        <option value="most_offers">Most offers</option>
        <option value="most_rejections">Most rejections</option>
      </select>
    </div>
  </div>

  {visibleCompanies.length === 0 ? (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-10 text-center">
      <Building2 size={36} className="mx-auto text-slate-300 mb-3" />

      <h3 className="text-lg font-semibold">No companies found</h3>

      <p className="text-slate-500 mt-2 text-sm sm:text-base">
        Companies will appear when applications are created and linked to a company.
      </p>
    </div>
  ) : (
    <>
      <div className="hidden xl:block bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">
                Company
              </th>
              <th className="text-center px-4 py-3 font-semibold text-slate-600">
                Apps
              </th>
              <th className="text-center px-4 py-3 font-semibold text-slate-600">
                Interviews
              </th>
              <th className="text-center px-4 py-3 font-semibold text-slate-600">
                Offers
              </th>
              <th className="text-center px-4 py-3 font-semibold text-slate-600">
                Rejected
              </th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">
                Last Update
              </th>
              <th className="text-right px-4 py-3 font-semibold text-slate-600">
                Positions
              </th>
            </tr>
          </thead>

          <tbody>
            {visibleCompanies.map((company) => {
              const expanded = expandedCompanyId === company.id;

              return (
                <React.Fragment key={company.id}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50/60 transition">
                    <td className="px-4 py-4">
                      <CompanyTitle company={company} />
                    </td>

                    <NumberCell value={company.applications} />
                    <NumberCell value={company.interviews} />
                    <NumberCell value={company.offers} />
                    <NumberCell value={company.rejections} />

                    <td className="px-4 py-4 text-slate-600">
                      {formatDate(company.lastUpdate)}
                    </td>

                    <td className="px-4 py-4 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedCompanyId(expanded ? null : company.id)
                        }
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white transition"
                      >
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {expanded ? 'Hide' : 'View'}
                      </button>
                    </td>
                  </tr>

                  {expanded && (
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <td colSpan={7} className="px-4 py-4">
                        <ApplicationHistory company={company} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="xl:hidden space-y-3">
        {visibleCompanies.map((company) => {
          const expanded = expandedCompanyId === company.id;

          return (
            <div
              key={company.id}
              className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden"
            >
              <div className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <CompanyTitle company={company} />

                  <button
                    type="button"
                    onClick={() =>
                      setExpandedCompanyId(expanded ? null : company.id)
                    }
                    className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4">
                  <CompactMetric label="Apps" value={company.applications} />
                  <CompactMetric label="Interviews" value={company.interviews} />
                  <CompactMetric label="Offers" value={company.offers} />
                  <CompactMetric label="Rejected" value={company.rejections} />
                  <CompactMetric label="Last Update" value={formatDate(company.lastUpdate)} />
                </div>
              </div>

              {expanded && (
                <div className="border-t border-slate-200 bg-slate-50 p-4">
                  <ApplicationHistory company={company} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  )}
</div>


);
};

const CompanyTitle = ({ company }: { company: CompanyStats }) => (

  <div className="flex items-start gap-3 min-w-0">
    <div className="bg-slate-100 rounded-xl p-2.5 shrink-0">
      <Building2 size={18} className="text-slate-600" />
    </div>

<div className="min-w-0">
  <h3 className="font-semibold text-slate-950 break-words">
    {company.name}
  </h3>

  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-slate-500">
    {company.location && <span className="break-words">{company.location}</span>}
    {company.industry && <span className="break-words">{company.industry}</span>}

    {company.website && (
      <a
        href={company.website}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-slate-700 underline break-all"
      >
        Website
        <ExternalLink size={12} />
      </a>
    )}
  </div>
</div>


  </div>
);

const ApplicationHistory = ({ company }: { company: CompanyStats }) => (

  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
    <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
      <p className="text-sm font-semibold text-slate-700">
        Positions applied for at {company.name}
      </p>
    </div>


<div className="divide-y divide-slate-200">
  {company.history.map((item) => (
    <div key={item.id} className="p-4">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_150px_130px_130px] gap-3 lg:items-center">
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <Briefcase size={15} className="text-slate-400 shrink-0 mt-0.5" />

            <div className="min-w-0">
              <p className="font-medium text-slate-900 break-words">
                {item.role_title}
              </p>

              <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <CalendarDays size={13} />
                  Applied: {formatDate(item.date_applied || item.created_at)}
                </span>

                <span>
                  Updated: {formatDate(item.last_update)}
                </span>

                {item.cv_version_name && (
                  <span>CV: {item.cv_version_name}</span>
                )}

                {item.application_link && (
                  <a
                    href={item.application_link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-slate-700 underline"
                  >
                    Job link
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>

        <div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium w-fit inline-flex ${statusClass(
              item.status
            )}`}
          >
            {formatStatus(item.status)}
          </span>
        </div>

        <div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium w-fit inline-flex ${
              item.archived
                ? 'bg-zinc-100 text-zinc-600'
                : 'bg-blue-50 text-blue-700'
            }`}
          >
            {item.archived ? 'Archived' : 'Active'}
          </span>
        </div>

        <div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium w-fit inline-flex ${
              item.rejected_after_interview
                ? 'bg-red-50 text-red-700'
                : item.final_response_pending
                  ? 'bg-indigo-50 text-indigo-700'
                  : item.reached_interview
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-600'
            }`}
          >
            {item.rejected_after_interview
              ? 'After interview'
              : item.final_response_pending
                ? 'Awaiting response'
                : item.reached_interview
                  ? 'Interview reached'
                  : 'No interview'}
          </span>
        </div>
      </div>
    </div>
  ))}
</div>


  </div>
);

const SummaryCard = ({ label, value }: { label: string; value: number }) => (

  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
    <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold break-words">
      {label}
    </p>


<p className="text-2xl font-bold mt-2 text-slate-950">{value}</p>


  </div>
);

const NumberCell = ({ value }: { value: number }) => (

  <td className="px-4 py-4 text-center font-semibold text-slate-900">
    {value}
  </td>
);

const CompactMetric = ({
label,
value,
}: {
label: string;
value: number | string;
}) => (

  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 min-w-0">
    <p className="text-[11px] text-slate-400">{label}</p>
    <p className="text-sm font-semibold text-slate-800 break-words">{value}</p>
  </div>
);

const CompaniesSkeleton = () => (

  <div className="w-full max-w-full overflow-hidden">
    <div className="mb-8">
      <div className="h-8 w-56 bg-slate-200 rounded-lg animate-pulse mb-2" />
      <div className="h-4 w-full max-w-96 bg-slate-100 rounded-lg animate-pulse" />
    </div>


<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
  {Array.from({ length: 4 }).map((_, index) => (
    <div
      key={index}
      className="h-24 bg-white border border-slate-200 rounded-2xl animate-pulse"
    />
  ))}
</div>

<div className="h-16 bg-white border border-slate-200 rounded-2xl animate-pulse mb-6" />

<div className="h-96 bg-white border border-slate-200 rounded-2xl animate-pulse" />


  </div>
);
