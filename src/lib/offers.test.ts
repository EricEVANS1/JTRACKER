import { describe, expect, it } from 'vitest';

import {
  applicationOutcomeForOffer,
  deadlineState,
  emptyOfferForm,
  formatSalary,
  formToOfferPayload,
  isMissingOffersTable,
  offerToForm,
  parseAmount,
  validateOfferForm,
  type OfferRecord,
} from './offers';

const form = (overrides: Partial<ReturnType<typeof emptyOfferForm>> = {}) => ({ ...emptyOfferForm('a1', '2026-10-01'), ...overrides });

describe('parseAmount', () => {
  it('accepts plain, spaced and comma-decimal numbers', () => {
    expect(parseAmount('12000')).toBe(12000);
    expect(parseAmount('12 000')).toBe(12000);
    expect(parseAmount('12000,50')).toBe(12000.5);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('twelve')).toBeNaN();
    expect(parseAmount('-5')).toBeNaN();
  });
});

describe('validateOfferForm', () => {
  it('needs an application, numbers, a sane range, a currency and a deadline after the offer date', () => {
    expect(validateOfferForm(form())).toEqual({});
    expect(validateOfferForm(form({ applicationId: '' })).applicationId).toBeTruthy();
    expect(validateOfferForm(form({ salaryAmount: 'lots' })).salaryAmount).toBeTruthy();
    expect(validateOfferForm(form({ salaryMin: '15000', salaryMax: '12000' })).salaryMax).toBeTruthy();
    expect(validateOfferForm(form({ salaryAmount: '12000', salaryCurrency: 'zl' })).salaryCurrency).toBeTruthy();
    expect(validateOfferForm(form({ salaryCurrency: '' }))).toEqual({}); // no pay given, no currency needed
    expect(validateOfferForm(form({ responseDeadline: '2026-09-30' })).responseDeadline).toBeTruthy();
  });
});

describe('formToOfferPayload', () => {
  it('saves blanks as null, numbers as numbers, and stamps the decision', () => {
    const payload = formToOfferPayload(
      form({ salaryAmount: '12 500', salaryCurrency: 'eur', payPeriod: 'month', status: 'accepted', benefits: '  Private healthcare ' }),
      null,
      '2026-10-05T10:00:00.000Z',
    );
    expect(payload).toMatchObject({
      application_id: 'a1',
      status: 'accepted',
      offer_date: '2026-10-01',
      response_deadline: null,
      salary_amount: 12500,
      salary_min: null,
      salary_currency: 'EUR',
      pay_period: 'month',
      benefits: 'Private healthcare',
      bonus: null,
      decided_at: '2026-10-05T10:00:00.000Z',
    });

    // No pay: no currency or period stored.
    expect(formToOfferPayload(form(), null)).toMatchObject({ salary_currency: null, pay_period: null, decided_at: null });
  });

  it('keeps the original decision time when the decision is unchanged', () => {
    const previous = { status: 'accepted', decided_at: '2026-10-02T09:00:00.000Z' } as OfferRecord;
    expect(formToOfferPayload(form({ status: 'accepted' }), previous, '2026-10-09T00:00:00Z').decided_at).toBe('2026-10-02T09:00:00.000Z');
    expect(formToOfferPayload(form({ status: 'negotiating' }), previous).decided_at).toBeNull();
  });

  it('round-trips through the form', () => {
    const record = {
      id: 'o1', application_id: 'a1', status: 'negotiating', offer_date: '2026-10-01', response_deadline: '2026-10-08',
      salary_amount: '12000.00', salary_min: null, salary_max: null, salary_currency: 'PLN', pay_period: 'month',
      bonus: '10% annual', benefits: null, employment_type: 'b2b', work_arrangement: 'hybrid', probation_period: '3 months',
      start_date: '2026-11-01', contract_duration: 'Permanent', career_development: null, notes: null, decided_at: null,
    } as OfferRecord;
    expect(formToOfferPayload(offerToForm(record), record, 'now')).toMatchObject({ salary_amount: 12000, employment_type: 'b2b', start_date: '2026-11-01' });
  });
});

describe('formatSalary', () => {
  it('shows the amount, the range, or both', () => {
    expect(formatSalary({ salary_amount: 12000, salary_min: null, salary_max: null, salary_currency: 'PLN', pay_period: 'month' })).toBe('12\u00a0000 PLN per month');
    expect(formatSalary({ salary_amount: null, salary_min: '10000', salary_max: '14000', salary_currency: 'PLN', pay_period: 'month' })).toBe('10\u00a0000–14\u00a0000 PLN per month');
    expect(formatSalary({ salary_amount: 90000, salary_min: 85000, salary_max: 95000, salary_currency: 'EUR', pay_period: 'year' })).toBe('90\u00a0000 EUR per year (range 85\u00a0000–95\u00a0000)');
    expect(formatSalary({ salary_amount: null, salary_min: null, salary_max: null, salary_currency: null, pay_period: null })).toBeNull();
  });
});

describe('deadlineState', () => {
  it('only applies to offers still awaiting an answer', () => {
    expect(deadlineState({ response_deadline: '2026-10-20', status: 'received' }, '2026-10-18')).toEqual({ state: 'upcoming', days: 2 });
    expect(deadlineState({ response_deadline: '2026-10-18', status: 'negotiating' }, '2026-10-18')).toEqual({ state: 'today', days: 0 });
    expect(deadlineState({ response_deadline: '2026-10-15', status: 'under_review' }, '2026-10-18')).toEqual({ state: 'passed', days: -3 });
    expect(deadlineState({ response_deadline: '2026-10-15', status: 'accepted' }, '2026-10-18').state).toBe('none');
    expect(deadlineState({ response_deadline: null, status: 'received' }, '2026-10-18').state).toBe('none');
  });
});

describe('links to the application', () => {
  it('maps the offer decision onto the application outcome', () => {
    expect(applicationOutcomeForOffer('accepted')).toBe('offer_accepted');
    expect(applicationOutcomeForOffer('declined')).toBe('offer_declined');
    expect(applicationOutcomeForOffer('negotiating')).toBe('offer_received');
  });

  it('recognises a database without the offers table', () => {
    expect(isMissingOffersTable({ code: '42P01' })).toBe(true);
    expect(isMissingOffersTable({ code: 'PGRST205', message: "Could not find the table 'public.offers' in the schema cache" })).toBe(true);
    expect(isMissingOffersTable({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingOffersTable(null)).toBe(false);
  });
});
