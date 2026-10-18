import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Trophy,
  TriangleAlert,
  X,
} from 'lucide-react';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { CompanyLogo } from '../components/CompanyLogo';
import { buildStatusUpdate } from '../lib/applicationLifecycle';
import { celebrateOffer, isNewOffer } from '../lib/offerCelebration';
import { browserTimeZone, dayKeyInZone, formatDayKey } from '../lib/interviewSchedule';
import {
  applicationOutcomeForOffer,
  COMMON_CURRENCIES,
  deadlineState,
  emptyOfferForm,
  EMPLOYMENT_TYPES,
  employmentTypeLabel,
  formatSalary,
  formToOfferPayload,
  isMissingOffersTable,
  OFFER_STATUSES,
  offerStatusLabel,
  offerToForm,
  OPEN_OFFER_STATUSES,
  PAY_PERIODS,
  validateOfferForm,
  WORK_ARRANGEMENTS,
  workArrangementLabel,
  type OfferForm,
  type OfferRecord,
  type OfferStatus,
} from '../lib/offers';

// ─── data ────────────────────────────────────────────────────────────────────

interface OfferApplication {
  id: string;
  role_title: string | null;
  status: string;
  outcome_reason: string | null;
  archived: boolean | null;
  offer_received_at: string | null;
  companies: { name: string | null; website?: string | null } | { name: string | null; website?: string | null }[] | null;
  // Lifecycle fields buildStatusUpdate looks at.
  [key: string]: unknown;
}

const company = (app: OfferApplication | null | undefined) => {
  const value = Array.isArray(app?.companies) ? app?.companies[0] : app?.companies;
  return value ?? null;
};

const roleLabel = (app: OfferApplication | null | undefined) => app?.role_title || 'Untitled role';
const companyLabel = (app: OfferApplication | null | undefined) => company(app)?.name || 'Unknown company';

const STATUS_STYLES: Record<OfferStatus, string> = {
  received: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  under_review: 'bg-sky-50 text-sky-700 border-sky-200',
  negotiating: 'bg-amber-50 text-amber-800 border-amber-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  declined: 'bg-slate-100 text-slate-600 border-slate-200',
  expired: 'bg-slate-100 text-slate-500 border-slate-200',
  withdrawn: 'bg-red-50 text-red-700 border-red-200',
};

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2';
const BUTTON_PRIMARY = `inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${FOCUS_RING}`;
const BUTTON_SECONDARY = `inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${FOCUS_RING}`;
const INPUT = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-50 disabled:text-slate-500';

const formatDate = (key: string | null | undefined) =>
  key ? formatDayKey(key, { day: 'numeric', month: 'short', year: 'numeric' }) : null;

// Loads the user's offers and applications; shared by the overview and the detail page.
const useOffers = () => {
  const { user } = useAuth();
  const [offers, setOffers] = useState<OfferRecord[]>([]);
  const [applications, setApplications] = useState<OfferApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // False until supabase/sql/2026-10-18_offers.sql has run.
  const [tableReady, setTableReady] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    const [offersResult, applicationsResult] = await Promise.all([
      supabase.from('offers').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('applications').select('*, companies ( name, website )').eq('user_id', user.id).order('created_at', { ascending: false }),
    ]);

    if (offersResult.error) {
      if (isMissingOffersTable(offersResult.error)) setTableReady(false);
      else setError(offersResult.error.message);
    } else {
      setTableReady(true);
      setOffers((offersResult.data || []) as OfferRecord[]);
    }
    if (applicationsResult.error) setError(applicationsResult.error.message);
    else setApplications((applicationsResult.data || []) as OfferApplication[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  return { user, offers, applications, loading, error, setError, tableReady, load };
};

// Keeps the linked application in step with the offer: it moves to Offer if
// it isn't there yet, and its existing outcome field follows the decision.
const syncApplication = async (userId: string, application: OfferApplication, status: OfferStatus) => {
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {};

  if (application.status !== 'offer') {
    Object.assign(update, buildStatusUpdate('offer', application as never, now));
  }
  const outcome = applicationOutcomeForOffer(status);
  if (application.status !== 'offer' || application.outcome_reason !== outcome) {
    update.outcome_reason = outcome;
    update.last_status_changed_at = now;
    update.status_updated_at = now;
  }
  if (!Object.keys(update).length) return null;

  const { error } = await supabase.from('applications').update(update).eq('id', application.id).eq('user_id', userId);
  return error ? error.message : null;
};

const logEvent = async (userId: string, applicationId: string, eventType: string, title: string, description: string) => {
  await supabase.from('application_events').insert({
    user_id: userId,
    application_id: applicationId,
    event_type: eventType,
    title,
    description,
    event_date: new Date().toISOString(),
  });
};

// ─── shared bits ─────────────────────────────────────────────────────────────

const StatusBadge = ({ status }: { status: OfferStatus }) => (
  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
    {status === 'accepted' && <BadgeCheck size={12} />}
    {offerStatusLabel(status)}
  </span>
);

const DeadlineNote = ({ offer, todayKey }: { offer: OfferRecord; todayKey: string }) => {
  const { state, days } = deadlineState(offer, todayKey);
  if (state === 'none') return null;
  const text =
    state === 'passed'
      ? `Deadline passed (${formatDate(offer.response_deadline)})`
      : state === 'today'
        ? 'Answer due today'
        : `Answer due in ${days} ${days === 1 ? 'day' : 'days'} (${formatDate(offer.response_deadline)})`;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${state === 'upcoming' && (days ?? 99) > 3 ? 'text-slate-600' : 'text-amber-700'}`}>
      <CalendarClock size={13} />
      {text}
    </span>
  );
};

const SetupNotice = () => (
  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex gap-2">
    <TriangleAlert size={16} className="shrink-0 mt-0.5" />
    <span>
      Offers need a one-off database update: run <code className="text-xs">supabase/sql/2026-10-18_offers.sql</code> in the
      Supabase SQL editor, then reload this page.
    </span>
  </div>
);

const ErrorNotice = ({ error, onRetry }: { error: string; onRetry?: () => void }) => (
  <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
    <AlertCircle size={16} className="shrink-0 mt-0.5" />
    <span className="flex-1 break-words">{error}</span>
    {onRetry && (
      <button type="button" onClick={onRetry} className="shrink-0 font-medium underline">Try again</button>
    )}
  </div>
);

const LogoTile = ({ app, size = 40 }: { app: OfferApplication | null | undefined; size?: number }) => (
  <CompanyLogo
    website={company(app)?.website}
    size={size}
    fallback={
      <div className="flex items-center justify-center rounded-xl bg-slate-100" style={{ width: size, height: size }}>
        <Briefcase size={18} className="text-slate-600" />
      </div>
    }
  />
);

const ListSkeleton = () => (
  <div aria-busy="true" className="space-y-3">
    <span role="status" className="sr-only">Loading offers…</span>
    {Array.from({ length: 3 }).map((_, index) => (
      <div key={index} aria-hidden="true" className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="h-10 w-10 rounded-xl bg-slate-100 animate-pulse motion-reduce:animate-none" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-1/3 rounded bg-slate-100 animate-pulse motion-reduce:animate-none" />
          <div className="h-3 w-1/2 rounded bg-slate-100 animate-pulse motion-reduce:animate-none" />
        </div>
      </div>
    ))}
  </div>
);

// ─── overview: /offers ──────────────────────────────────────────────────────

type Filter = 'all' | 'open' | 'accepted' | 'declined' | 'closed';

const FILTERS: { value: Filter; label: string; matches: (status: OfferStatus) => boolean }[] = [
  { value: 'all', label: 'All', matches: () => true },
  { value: 'open', label: 'Awaiting your answer', matches: (status) => OPEN_OFFER_STATUSES.includes(status) },
  { value: 'accepted', label: 'Accepted', matches: (status) => status === 'accepted' },
  { value: 'declined', label: 'Declined', matches: (status) => status === 'declined' },
  { value: 'closed', label: 'Expired or withdrawn', matches: (status) => status === 'expired' || status === 'withdrawn' },
];

export const OffersPage: React.FC = () => {
  const { offers, applications, loading, error, tableReady, load } = useOffers();
  const [filter, setFilter] = useState<Filter>('all');
  const todayKey = dayKeyInZone(new Date(), browserTimeZone());

  const appById = useMemo(() => new Map(applications.map((app) => [app.id, app])), [applications]);
  const accepted = offers.filter((offer) => offer.status === 'accepted');
  const visible = offers.filter((offer) => FILTERS.find((item) => item.value === filter)!.matches(offer.status));
  // Applications already at Offer without offer details yet.
  const withoutDetails = applications.filter(
    (app) => app.status === 'offer' && !app.archived && !offers.some((offer) => offer.application_id === app.id),
  );

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">Offers</h2>
          <p className="mt-1 text-sm text-slate-500">Every job offer, linked to its application, with its terms and where it stands.</p>
        </div>
        {tableReady && (
          <Link to="/offers/new" className={BUTTON_PRIMARY}>
            <Plus size={16} />
            Record offer
          </Link>
        )}
      </div>

      {error && <ErrorNotice error={error} onRetry={() => void load()} />}

      {loading ? (
        <ListSkeleton />
      ) : !tableReady ? (
        <SetupNotice />
      ) : (
        <div className="space-y-5">
          {accepted.length > 0 && (
            <section aria-labelledby="accepted-heading" className="rounded-2xl border-2 border-emerald-500 bg-emerald-50/60 p-4 sm:p-5">
              <h3 id="accepted-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-emerald-800">
                <Trophy size={16} />
                {accepted.length === 1 ? 'Accepted offer' : 'Accepted offers'}
              </h3>
              <ul className="space-y-2">
                {accepted.map((offer) => {
                  const app = appById.get(offer.application_id);
                  return (
                    <li key={offer.id}>
                      <Link to={`/offers/${offer.id}`} className={`flex items-center gap-3 rounded-xl bg-white p-3 hover:shadow-sm ${FOCUS_RING}`}>
                        <LogoTile app={app} />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-slate-900 break-words">{roleLabel(app)}</p>
                          <p className="text-sm text-slate-600">{companyLabel(app)}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {[formatSalary(offer), offer.start_date ? `Starts ${formatDate(offer.start_date)}` : null].filter(Boolean).join(' · ') || 'No terms recorded yet'}
                          </p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {accepted.length > 1 && (
                <p className="mt-2 text-xs text-emerald-800">More than one offer is marked accepted. Update any you didn’t take.</p>
              )}
            </section>
          )}

          {withoutDetails.length > 0 && (
            <section aria-labelledby="missing-heading" className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 id="missing-heading" className="text-sm font-semibold text-slate-900">Offers without details</h3>
              <p className="mb-2 text-xs text-slate-500">These applications are at Offer but have no offer record yet.</p>
              <ul className="divide-y divide-slate-100">
                {withoutDetails.map((app) => (
                  <li key={app.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 break-words text-slate-700">{roleLabel(app)} — {companyLabel(app)}</span>
                    <Link to={`/offers/new?application=${app.id}`} className="shrink-0 text-sm font-medium text-slate-900 underline">Add details</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {offers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white">
                <Trophy size={18} className="text-slate-400" />
              </div>
              <p className="text-sm font-semibold text-slate-800">No offers yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                When an employer makes you an offer, record it here with its pay, terms and deadline.
              </p>
              <Link to="/offers/new" className={`${BUTTON_PRIMARY} mt-4`}>
                <Plus size={16} />
                Record offer
              </Link>
            </div>
          ) : (
            <section aria-labelledby="all-offers-heading">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h3 id="all-offers-heading" className="text-base font-semibold text-slate-900">All offers</h3>
                <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                  {FILTERS.map((item) => {
                    const count = offers.filter((offer) => item.matches(offer.status)).length;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        aria-pressed={filter === item.value}
                        onClick={() => setFilter(item.value)}
                        className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors ${FOCUS_RING} ${
                          filter === item.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {item.label}
                        <span className={`rounded-full px-1.5 text-[10px] font-semibold ${filter === item.value ? 'bg-white/20' : 'bg-slate-200'}`}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {visible.length === 0 ? (
                <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">No offers in this group.</p>
              ) : (
                <ul className="space-y-2">
                  {visible.map((offer) => {
                    const app = appById.get(offer.application_id);
                    const terms = [employmentTypeLabel(offer.employment_type), workArrangementLabel(offer.work_arrangement), offer.start_date ? `Starts ${formatDate(offer.start_date)}` : null]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <li key={offer.id}>
                        <Link
                          to={`/offers/${offer.id}`}
                          aria-label={`${roleLabel(app)} at ${companyLabel(app)}, ${offerStatusLabel(offer.status)}`}
                          className={`flex gap-3 rounded-2xl border bg-white p-4 shadow-sm hover:border-slate-300 hover:shadow transition ${FOCUS_RING} ${
                            offer.status === 'accepted' ? 'border-emerald-300' : 'border-slate-200'
                          }`}
                        >
                          <LogoTile app={app} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-semibold text-slate-900 break-words">{roleLabel(app)}</p>
                                <p className="text-sm text-slate-600">{companyLabel(app)}</p>
                              </div>
                              <StatusBadge status={offer.status} />
                            </div>
                            <p className="mt-1 text-sm text-slate-800">{formatSalary(offer) || <span className="text-slate-400">Pay not recorded</span>}</p>
                            {terms && <p className="text-xs text-slate-500">{terms}</p>}
                            <div className="mt-1">
                              <DeadlineNote offer={offer} todayKey={todayKey} />
                            </div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
};

// ─── one offer: /offers/:id, /offers/new ────────────────────────────────────

export const OfferDetailPage: React.FC = () => {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, offers, applications, loading, error, setError, tableReady, load } = useOffers();
  const todayKey = dayKeyInZone(new Date(), browserTimeZone());

  const offer = isNew ? null : offers.find((item) => item.id === id) ?? null;
  const app = applications.find((item) => item.id === (offer?.application_id ?? '')) ?? null;
  const [editing, setEditing] = useState(isNew);
  const [message, setMessage] = useState('');
  const [quickStatus, setQuickStatus] = useState<OfferStatus | ''>('');
  const [savingStatus, setSavingStatus] = useState(false);

  const save = async (form: OfferForm): Promise<string | null> => {
    if (!user) return 'You are signed out.';
    const application = applications.find((item) => item.id === form.applicationId);
    if (!application) return 'Choose the application this offer is for.';

    const payload = formToOfferPayload(form, offer);
    let savedId = offer?.id ?? null;

    if (offer) {
      const { error: updateError } = await supabase.from('offers').update(payload).eq('id', offer.id).eq('user_id', user.id);
      if (updateError) return updateError.message;
    } else {
      const { data, error: insertError } = await supabase.from('offers').insert({ user_id: user.id, ...payload }).select('id').single();
      if (insertError) {
        return insertError.code === '23505' ? 'This application already has an offer. Open it from the Offers list to update it.' : insertError.message;
      }
      savedId = (data as { id: string }).id;
    }

    // The offer is saved; now bring the application in line with it.
    const wasNewOffer = isNewOffer('offer', application as { status: string; offer_received_at?: string | null });
    const syncProblem = await syncApplication(user.id, application, form.status);

    const statusChanged = offer && offer.status !== form.status;
    await logEvent(
      user.id,
      application.id,
      offer ? 'offer_updated' : 'offer_recorded',
      offer ? (statusChanged ? `Offer ${offerStatusLabel(form.status).toLowerCase()}` : 'Offer details updated') : 'Offer recorded',
      offer
        ? statusChanged
          ? `Offer status changed from ${offerStatusLabel(offer.status)} to ${offerStatusLabel(form.status)}.`
          : 'Offer terms updated.'
        : `Offer recorded as ${offerStatusLabel(form.status)}.`,
    );

    if (!offer && wasNewOffer && !syncProblem) {
      celebrateOffer({ applicationId: application.id, roleTitle: application.role_title, companyName: company(application)?.name });
    }

    await load();
    setMessage(
      syncProblem
        ? `Offer saved, but the application couldn't be updated: ${syncProblem}`
        : offer
          ? 'Offer updated.'
          : 'Offer recorded.',
    );
    setEditing(false);
    if (!offer && savedId) navigate(`/offers/${savedId}`, { replace: true });
    return null;
  };

  const updateStatus = async () => {
    if (!offer || !quickStatus || quickStatus === offer.status) return;
    setSavingStatus(true);
    setError('');
    const problem = await save({ ...offerToForm(offer), status: quickStatus });
    setSavingStatus(false);
    if (problem) setError(problem);
    setQuickStatus('');
  };

  const header = (
    <Link to="/offers" className={`mb-4 inline-flex items-center gap-1.5 rounded text-sm text-slate-600 hover:text-slate-900 ${FOCUS_RING}`}>
      <ArrowLeft size={15} />
      All offers
    </Link>
  );

  if (loading) {
    return (
      <div className="w-full max-w-3xl mx-auto">
        {header}
        <ListSkeleton />
      </div>
    );
  }

  if (!tableReady) {
    return (
      <div className="w-full max-w-3xl mx-auto">
        {header}
        <SetupNotice />
      </div>
    );
  }

  if (!isNew && !offer) {
    return (
      <div className="w-full max-w-3xl mx-auto">
        {header}
        {error ? <ErrorNotice error={error} onRetry={() => void load()} /> : <p className="text-sm text-slate-600">That offer could not be found.</p>}
      </div>
    );
  }

  if (editing) {
    const initial = offer
      ? offerToForm(offer)
      : emptyOfferForm(searchParams.get('application') || '', todayKey);
    return (
      <div className="w-full max-w-3xl mx-auto">
        {header}
        <h2 className="mb-1 text-2xl font-semibold tracking-tight text-slate-900">{offer ? 'Edit offer' : 'Record an offer'}</h2>
        <p className="mb-5 text-sm text-slate-500">
          {offer ? `${roleLabel(app)} at ${companyLabel(app)}` : 'Fill in what you know; everything except the application is optional.'}
        </p>
        {error && <ErrorNotice error={error} />}
        <OfferEditor
          initial={initial}
          applications={applications}
          offers={offers}
          lockApplication={Boolean(offer)}
          onCancel={() => (offer ? setEditing(false) : navigate('/offers'))}
          onSave={save}
        />
      </div>
    );
  }

  // View
  const current = offer as OfferRecord;
  const deadline = deadlineState(current, todayKey);
  return (
    <div className="w-full max-w-3xl mx-auto">
      {header}
      {error && <ErrorNotice error={error} onRetry={() => void load()} />}
      {message && (
        <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 flex items-start gap-2">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
          <span className="flex-1">{message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setMessage('')} className="text-emerald-500 hover:text-emerald-800"><X size={16} /></button>
        </div>
      )}

      {current.status === 'accepted' && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border-2 border-emerald-500 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <Trophy size={18} />
          This is your accepted offer{current.decided_at ? ` (accepted ${formatDate(dayKeyInZone(current.decided_at, browserTimeZone()))})` : ''}.
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <LogoTile app={app} size={48} />
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-slate-900 break-words">{roleLabel(app)}</h2>
              <p className="text-sm text-slate-600">{companyLabel(app)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={current.status} />
                <DeadlineNote offer={current} todayKey={todayKey} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to={`/applications/${current.application_id}`} className={BUTTON_SECONDARY}>Application</Link>
            <button type="button" onClick={() => setEditing(true)} className={BUTTON_PRIMARY}>
              <Pencil size={15} />
              Edit offer
            </button>
          </div>
        </div>

        {deadline.state === 'passed' && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            The response deadline has passed. If the offer lapsed, mark it as Expired.
          </p>
        )}

        <div className="mt-5 flex flex-col gap-2 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-end">
          <label className="block flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-600">Update status</span>
            <select value={quickStatus || current.status} onChange={(event) => setQuickStatus(event.target.value as OfferStatus)} className={INPUT}>
              {OFFER_STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            disabled={savingStatus || !quickStatus || quickStatus === current.status}
            onClick={() => void updateStatus()}
            className={BUTTON_PRIMARY}
          >
            {savingStatus && <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />}
            Save status
          </button>
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <Detail label="Offer date" value={formatDate(current.offer_date)} />
          <Detail label="Response deadline" value={formatDate(current.response_deadline)} />
          <Detail label="Salary" value={formatSalary({ ...current, salary_min: null, salary_max: null })} />
          <Detail
            label="Salary range"
            value={current.salary_min || current.salary_max ? formatSalary({ ...current, salary_amount: null }) : null}
          />
          <Detail label="Bonus" value={current.bonus} />
          <Detail label="Employment type" value={employmentTypeLabel(current.employment_type)} />
          <Detail label="Work arrangement" value={workArrangementLabel(current.work_arrangement)} />
          <Detail label="Probation period" value={current.probation_period} />
          <Detail label="Expected start date" value={formatDate(current.start_date)} />
          <Detail label="Contract duration" value={current.contract_duration} />
          <Detail label="Benefits" value={current.benefits} wide />
          <Detail label="Career development" value={current.career_development} wide />
          <Detail label="Notes" value={current.notes} wide />
        </dl>
      </div>
    </div>
  );
};

const Detail = ({ label, value, wide }: { label: string; value: string | null | undefined; wide?: boolean }) => (
  <div className={wide ? 'sm:col-span-2' : ''}>
    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className={`mt-0.5 text-sm whitespace-pre-wrap break-words ${value ? 'text-slate-900' : 'text-slate-400'}`}>{value || 'Not recorded'}</dd>
  </div>
);

// ─── form ────────────────────────────────────────────────────────────────────

const OfferEditor = ({
  initial,
  applications,
  offers,
  lockApplication,
  onCancel,
  onSave,
}: {
  initial: OfferForm;
  applications: OfferApplication[];
  offers: OfferRecord[];
  lockApplication: boolean;
  onCancel: () => void;
  onSave: (form: OfferForm) => Promise<string | null>;
}) => {
  const [form, setForm] = useState<OfferForm>(initial);
  const [showProblems, setShowProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const problems = validateOfferForm(form);

  const set = <K extends keyof OfferForm>(key: K, value: OfferForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  // New offers go on applications that don't have one yet.
  const choices = applications.filter(
    (app) => app.id === form.applicationId || (!app.archived && !offers.some((offer) => offer.application_id === app.id)),
  );
  const selected = applications.find((app) => app.id === form.applicationId);
  const fieldError = (key: keyof OfferForm) =>
    showProblems && problems[key] ? <span className="mt-1 block text-xs font-medium text-red-700">{problems[key]}</span> : null;

  return (
    <form
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        setShowProblems(true);
        if (Object.keys(problems).length) {
          setProblem('Check the highlighted fields.');
          return;
        }
        setSaving(true);
        setProblem('');
        const failure = await onSave(form);
        setSaving(false);
        if (failure) setProblem(failure);
      }}
      className="space-y-5"
    >
      <FormSection title="Application">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Company and role</span>
          <select value={form.applicationId} onChange={(event) => set('applicationId', event.target.value)} className={INPUT} disabled={lockApplication}>
            <option value="">Choose an application…</option>
            {choices.map((app) => (
              <option key={app.id} value={app.id}>{roleLabel(app)} — {companyLabel(app)}</option>
            ))}
          </select>
          {fieldError('applicationId')}
          {!lockApplication && selected && selected.status !== 'offer' && (
            <span className="mt-1 block text-xs text-slate-500">Saving moves this application to Offer.</span>
          )}
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Status</span>
            <select value={form.status} onChange={(event) => set('status', event.target.value as OfferStatus)} className={INPUT}>
              {OFFER_STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Offer date</span>
            <input type="date" value={form.offerDate} onChange={(event) => set('offerDate', event.target.value)} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Response deadline</span>
            <input type="date" value={form.responseDeadline} onChange={(event) => set('responseDeadline', event.target.value)} className={INPUT} />
            {fieldError('responseDeadline')}
          </label>
        </div>
      </FormSection>

      <FormSection title="Pay">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Salary</span>
            <input inputMode="decimal" value={form.salaryAmount} onChange={(event) => set('salaryAmount', event.target.value)} placeholder="12000" className={INPUT} />
            {fieldError('salaryAmount')}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Currency</span>
            <input
              value={form.salaryCurrency}
              onChange={(event) => set('salaryCurrency', event.target.value.toUpperCase())}
              maxLength={3}
              list="offer-currencies"
              className={INPUT}
            />
            <datalist id="offer-currencies">
              {COMMON_CURRENCIES.map((currency) => <option key={currency} value={currency} />)}
            </datalist>
            {fieldError('salaryCurrency')}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Pay period</span>
            <select value={form.payPeriod} onChange={(event) => set('payPeriod', event.target.value)} className={INPUT}>
              <option value="">Not specified</option>
              {PAY_PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Salary range from</span>
            <input inputMode="decimal" value={form.salaryMin} onChange={(event) => set('salaryMin', event.target.value)} placeholder="If a range was offered" className={INPUT} />
            {fieldError('salaryMin')}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Salary range to</span>
            <input inputMode="decimal" value={form.salaryMax} onChange={(event) => set('salaryMax', event.target.value)} className={INPUT} />
            {fieldError('salaryMax')}
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Bonus</span>
          <input value={form.bonus} onChange={(event) => set('bonus', event.target.value)} placeholder="e.g. 10% annual, sign-on 5 000 PLN" className={INPUT} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Benefits</span>
          <textarea value={form.benefits} onChange={(event) => set('benefits', event.target.value)} rows={2} placeholder="Healthcare, sport card, training budget…" className={INPUT} />
        </label>
      </FormSection>

      <FormSection title="Role and contract">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Employment type</span>
            <select value={form.employmentType} onChange={(event) => set('employmentType', event.target.value)} className={INPUT}>
              <option value="">Not specified</option>
              {EMPLOYMENT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Work arrangement</span>
            <select value={form.workArrangement} onChange={(event) => set('workArrangement', event.target.value)} className={INPUT}>
              <option value="">Not specified</option>
              {WORK_ARRANGEMENTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Probation period</span>
            <input value={form.probationPeriod} onChange={(event) => set('probationPeriod', event.target.value)} placeholder="e.g. 3 months" className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Expected start date</span>
            <input type="date" value={form.startDate} onChange={(event) => set('startDate', event.target.value)} className={INPUT} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Contract duration</span>
            <input value={form.contractDuration} onChange={(event) => set('contractDuration', event.target.value)} placeholder="e.g. Permanent, 12 months" className={INPUT} />
          </label>
        </div>
      </FormSection>

      <FormSection title="Growth and notes">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Career development</span>
          <textarea value={form.careerDevelopment} onChange={(event) => set('careerDevelopment', event.target.value)} rows={2} placeholder="Training, mentoring, promotion path…" className={INPUT} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Notes</span>
          <textarea value={form.notes} onChange={(event) => set('notes', event.target.value)} rows={3} className={INPUT} />
        </label>
      </FormSection>

      {problem && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{problem}</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className={BUTTON_SECONDARY}>Cancel</button>
        <button type="submit" disabled={saving} className={BUTTON_PRIMARY}>
          {saving && <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />}
          {lockApplication ? 'Save offer' : 'Record offer'}
        </button>
      </div>
    </form>
  );
};

const FormSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
    {children}
  </section>
);
