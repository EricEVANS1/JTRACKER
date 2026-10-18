// Job offers: one record per offer in the offers table, linked to its
// application (which supplies the company and role). See
// supabase/sql/2026-10-18_offers.sql. No browser or Supabase imports.

export type OfferStatus = 'received' | 'under_review' | 'negotiating' | 'accepted' | 'declined' | 'expired' | 'withdrawn';

export const OFFER_STATUSES: { value: OfferStatus; label: string }[] = [
  { value: 'received', label: 'Received' },
  { value: 'under_review', label: 'Under review' },
  { value: 'negotiating', label: 'Negotiating' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
  { value: 'expired', label: 'Expired' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

// Still waiting on the user's answer.
export const OPEN_OFFER_STATUSES: OfferStatus[] = ['received', 'under_review', 'negotiating'];

export const offerStatusLabel = (status: string | null | undefined) =>
  OFFER_STATUSES.find((option) => option.value === status)?.label ?? 'Received';

export const PAY_PERIODS = [
  { value: 'hour', label: 'per hour' },
  { value: 'day', label: 'per day' },
  { value: 'week', label: 'per week' },
  { value: 'month', label: 'per month' },
  { value: 'year', label: 'per year' },
] as const;

export const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'b2b', label: 'B2B' },
  { value: 'internship', label: 'Internship' },
  { value: 'temporary', label: 'Temporary' },
  { value: 'other', label: 'Other' },
] as const;

export const WORK_ARRANGEMENTS = [
  { value: 'onsite', label: 'On-site' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' },
] as const;

export const COMMON_CURRENCIES = ['PLN', 'EUR', 'GBP', 'USD', 'CHF', 'SEK', 'NOK', 'DKK', 'CZK', 'CAD', 'AUD'];

const labelOf = (options: readonly { value: string; label: string }[], value: string | null | undefined) =>
  options.find((option) => option.value === value)?.label ?? null;

export const employmentTypeLabel = (value: string | null | undefined) => labelOf(EMPLOYMENT_TYPES, value);
export const workArrangementLabel = (value: string | null | undefined) => labelOf(WORK_ARRANGEMENTS, value);
export const payPeriodLabel = (value: string | null | undefined) => labelOf(PAY_PERIODS, value);

export interface OfferRecord {
  id: string;
  application_id: string;
  status: OfferStatus;
  offer_date: string | null;
  response_deadline: string | null;
  salary_amount: number | string | null;
  salary_min: number | string | null;
  salary_max: number | string | null;
  salary_currency: string | null;
  pay_period: string | null;
  bonus: string | null;
  benefits: string | null;
  employment_type: string | null;
  work_arrangement: string | null;
  probation_period: string | null;
  start_date: string | null;
  contract_duration: string | null;
  career_development: string | null;
  notes: string | null;
  decided_at: string | null;
  created_at?: string;
  updated_at?: string;
}

// The form keeps every field as text, as inputs do.
export interface OfferForm {
  applicationId: string;
  status: OfferStatus;
  offerDate: string;
  responseDeadline: string;
  salaryAmount: string;
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: string;
  payPeriod: string;
  bonus: string;
  benefits: string;
  employmentType: string;
  workArrangement: string;
  probationPeriod: string;
  startDate: string;
  contractDuration: string;
  careerDevelopment: string;
  notes: string;
}

export const emptyOfferForm = (applicationId = '', today = ''): OfferForm => ({
  applicationId,
  status: 'received',
  offerDate: today,
  responseDeadline: '',
  salaryAmount: '',
  salaryMin: '',
  salaryMax: '',
  salaryCurrency: 'PLN',
  payPeriod: 'month',
  bonus: '',
  benefits: '',
  employmentType: '',
  workArrangement: '',
  probationPeriod: '',
  startDate: '',
  contractDuration: '',
  careerDevelopment: '',
  notes: '',
});

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));

export const offerToForm = (offer: OfferRecord): OfferForm => ({
  applicationId: offer.application_id,
  status: offer.status,
  offerDate: text(offer.offer_date),
  responseDeadline: text(offer.response_deadline),
  salaryAmount: text(offer.salary_amount),
  salaryMin: text(offer.salary_min),
  salaryMax: text(offer.salary_max),
  salaryCurrency: text(offer.salary_currency) || 'PLN',
  payPeriod: text(offer.pay_period),
  bonus: text(offer.bonus),
  benefits: text(offer.benefits),
  employmentType: text(offer.employment_type),
  workArrangement: text(offer.work_arrangement),
  probationPeriod: text(offer.probation_period),
  startDate: text(offer.start_date),
  contractDuration: text(offer.contract_duration),
  careerDevelopment: text(offer.career_development),
  notes: text(offer.notes),
});

// "12 000", "12000.50", "12,5" → a number; blank → null; anything else → NaN.
export const parseAmount = (value: string): number | null => {
  const cleaned = value.replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!cleaned) return null;
  return /^\d+(\.\d{1,2})?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
};

// What's wrong with the form, field by field (empty when it can be saved).
export const validateOfferForm = (form: OfferForm) => {
  const problems: Partial<Record<keyof OfferForm, string>> = {};
  if (!form.applicationId) problems.applicationId = 'Choose the application this offer is for.';

  for (const key of ['salaryAmount', 'salaryMin', 'salaryMax'] as const) {
    if (Number.isNaN(parseAmount(form[key]))) problems[key] = 'Enter a number, e.g. 12000 or 12000.50.';
  }
  const min = parseAmount(form.salaryMin);
  const max = parseAmount(form.salaryMax);
  if (min !== null && max !== null && !Number.isNaN(min) && !Number.isNaN(max) && min > max) {
    problems.salaryMax = 'The top of the range must be at least the bottom.';
  }
  const hasPay = [form.salaryAmount, form.salaryMin, form.salaryMax].some((value) => value.trim());
  if (hasPay && !/^[A-Z]{3}$/.test(form.salaryCurrency.trim().toUpperCase())) {
    problems.salaryCurrency = 'Use a three-letter currency code, e.g. PLN.';
  }
  if (form.offerDate && form.responseDeadline && form.responseDeadline < form.offerDate) {
    problems.responseDeadline = 'The deadline is before the offer date.';
  }
  return problems;
};

const orNull = (value: string) => value.trim() || null;

// The columns to save. `now` stamps decided_at when the offer is accepted or declined.
export const formToOfferPayload = (form: OfferForm, previous: OfferRecord | null, now = new Date().toISOString()) => {
  const decided = form.status === 'accepted' || form.status === 'declined';
  const sameDecision = previous && previous.status === form.status;
  const hasPay = [form.salaryAmount, form.salaryMin, form.salaryMax].some((value) => value.trim());

  return {
    application_id: form.applicationId,
    status: form.status,
    offer_date: orNull(form.offerDate),
    response_deadline: orNull(form.responseDeadline),
    salary_amount: parseAmount(form.salaryAmount),
    salary_min: parseAmount(form.salaryMin),
    salary_max: parseAmount(form.salaryMax),
    salary_currency: hasPay ? form.salaryCurrency.trim().toUpperCase() : null,
    pay_period: hasPay ? orNull(form.payPeriod) : null,
    bonus: orNull(form.bonus),
    benefits: orNull(form.benefits),
    employment_type: orNull(form.employmentType),
    work_arrangement: orNull(form.workArrangement),
    probation_period: orNull(form.probationPeriod),
    start_date: orNull(form.startDate),
    contract_duration: orNull(form.contractDuration),
    career_development: orNull(form.careerDevelopment),
    notes: orNull(form.notes),
    decided_at: decided ? (sameDecision ? previous?.decided_at ?? now : now) : null,
    updated_at: now,
  };
};

// The application's existing outcome field follows the offer's decision, so
// the Applications page and the dashboard agree with the Offers page.
export const applicationOutcomeForOffer = (status: OfferStatus) =>
  status === 'accepted' ? 'offer_accepted' : status === 'declined' ? 'offer_declined' : 'offer_received';

// The offer status that matches an Accept / Decline on the Applications page.
export const offerStatusForDecision = (decision: 'accepted' | 'declined'): OfferStatus => decision;

// "12 000 PLN per month", "10 000–14 000 PLN per month", or null.
export const formatSalary = (offer: Pick<OfferRecord, 'salary_amount' | 'salary_min' | 'salary_max' | 'salary_currency' | 'pay_period'>) => {
  const currency = offer.salary_currency || '';
  const number = (value: number | string | null) => {
    if (value === null || value === '' || Number.isNaN(Number(value))) return null;
    return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(Number(value)).replace(/,/g, '\u00a0');
  };
  const period = payPeriodLabel(offer.pay_period);
  const suffix = [currency, period].filter(Boolean).join(' ');
  const amount = number(offer.salary_amount);
  const min = number(offer.salary_min);
  const max = number(offer.salary_max);
  const range = min && max ? `${min}–${max}` : min ? `from ${min}` : max ? `up to ${max}` : null;

  const withSuffix = (value: string) => (suffix ? `${value} ${suffix}` : value);
  if (amount && range) return `${withSuffix(amount)} (range ${range})`;
  if (amount) return withSuffix(amount);
  if (range) return withSuffix(range);
  return null;
};

export type DeadlineState = 'none' | 'upcoming' | 'today' | 'passed';

// How the response deadline stands, for an offer still awaiting an answer.
export const deadlineState = (offer: Pick<OfferRecord, 'response_deadline' | 'status'>, todayKey: string): { state: DeadlineState; days: number | null } => {
  if (!offer.response_deadline || !OPEN_OFFER_STATUSES.includes(offer.status)) return { state: 'none', days: null };
  const toUtc = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const days = Math.round((toUtc(offer.response_deadline) - toUtc(todayKey)) / 86_400_000);
  return { state: days < 0 ? 'passed' : days === 0 ? 'today' : 'upcoming', days };
};

// Postgres / PostgREST "table doesn't exist": the offers migration hasn't run.
export const isMissingOffersTable = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(
    error &&
      (error.code === '42P01' ||
        error.code === 'PGRST205' ||
        /relation .*offers.* does not exist|could not find the table .*offers/i.test(error.message || '')),
  );
