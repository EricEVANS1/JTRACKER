import { expect, test, USER_ID } from './support/mockSupabase';
import type { Page } from '@playwright/test';

test.use({ timezoneId: 'Europe/Warsaw' });

const application = (id: string, role_title: string, company: string, extra: Record<string, unknown> = {}) => ({
  id,
  user_id: USER_ID,
  role_title,
  status: 'final_interview',
  outcome_reason: null,
  archived: false,
  priority: 'medium',
  created_at: '2026-09-01T10:00:00.000Z',
  date_applied: '2026-09-01',
  company_id: `c-${id}`,
  companies: { id: `c-${id}`, name: company },
  ...extra,
});

const offerRow = (id: string, application_id: string, extra: Record<string, unknown> = {}) => ({
  id,
  user_id: USER_ID,
  application_id,
  status: 'received',
  offer_date: '2026-10-10',
  response_deadline: null,
  salary_amount: 12000,
  salary_min: null,
  salary_max: null,
  salary_currency: 'PLN',
  pay_period: 'month',
  bonus: null,
  benefits: null,
  employment_type: 'full_time',
  work_arrangement: 'hybrid',
  probation_period: null,
  start_date: null,
  contract_duration: null,
  career_development: null,
  notes: null,
  decided_at: null,
  created_at: '2026-10-10T10:00:00.000Z',
  ...extra,
});

test.beforeEach(({ supabase }) => {
  supabase.seed('applications', [
    application('a1', 'Support Engineer', 'Acme'),
    application('a2', 'Service Desk Analyst', 'Globex', { status: 'offer', outcome_reason: 'offer_received', offer_received_at: '2026-10-05T09:00:00.000Z' }),
    application('a3', 'IT Technician', 'Initech'),
  ]);
});

const closeCelebration = async (page: Page) => {
  const celebration = page.getByRole('dialog', { name: 'Congratulations!' });
  await expect(celebration).toBeVisible();
  await celebration.getByRole('button', { name: 'Close' }).first().click();
};

test('recording an offer saves its terms, moves the application to Offer and shows it', async ({ page, supabase }) => {
  await page.goto('/offers');
  await expect(page.locator('main')).toContainText('No offers yet');
  // Globex is already at Offer without details.
  await expect(page.locator('main')).toContainText('Service Desk Analyst — Globex');

  await page.getByRole('link', { name: 'Record offer' }).first().click();
  await expect(page).toHaveURL('/offers/new');
  await page.getByLabel('Company and role').selectOption('a1');
  await expect(page.locator('main')).toContainText('Saving moves this application to Offer.');
  await page.getByLabel('Status').selectOption('under_review');
  await page.getByLabel('Offer date').fill('2026-10-12');
  await page.getByLabel('Response deadline').fill('2026-10-19');
  await page.getByLabel('Salary', { exact: true }).fill('14 500');
  await page.getByLabel('Currency').fill('pln');
  await page.getByLabel('Pay period').selectOption('month');
  await page.getByLabel('Salary range from').fill('13000');
  await page.getByLabel('Salary range to').fill('16000');
  await page.getByLabel('Bonus').fill('10% annual');
  await page.getByLabel('Benefits').fill('Private healthcare');
  await page.getByLabel('Employment type').selectOption('b2b');
  await page.getByLabel('Work arrangement').selectOption('remote');
  await page.getByLabel('Probation period').fill('3 months');
  await page.getByLabel('Expected start date').fill('2026-11-02');
  await page.getByLabel('Contract duration').fill('Permanent');
  await page.getByLabel('Career development').fill('Training budget');
  await page.getByLabel('Notes').fill('Negotiate start date');
  await page.getByRole('button', { name: 'Record offer' }).click();

  await closeCelebration(page);
  await expect(page.locator('main')).toContainText('Offer recorded.');
  expect(supabase.writes('offers').at(-1)).toMatchObject({
    method: 'POST',
    body: {
      user_id: USER_ID,
      application_id: 'a1',
      status: 'under_review',
      offer_date: '2026-10-12',
      response_deadline: '2026-10-19',
      salary_amount: 14500,
      salary_min: 13000,
      salary_max: 16000,
      salary_currency: 'PLN',
      pay_period: 'month',
      bonus: '10% annual',
      benefits: 'Private healthcare',
      employment_type: 'b2b',
      work_arrangement: 'remote',
      probation_period: '3 months',
      start_date: '2026-11-02',
      contract_duration: 'Permanent',
      career_development: 'Training budget',
      notes: 'Negotiate start date',
      decided_at: null,
    },
  });
  // The application moved to Offer through the usual lifecycle rules.
  const appPatch = supabase.writes('applications').at(-1)!;
  expect(appPatch.query).toContain('id=eq.a1');
  expect(appPatch.body).toMatchObject({ status: 'offer', outcome_reason: 'offer_received' });
  expect((appPatch.body as Record<string, unknown>).offer_received_at).toBeTruthy();
  expect(supabase.writes('application_events').at(-1)!.body).toMatchObject({ application_id: 'a1', event_type: 'offer_recorded' });

  // The detail view.
  await expect(page).toHaveURL(/\/offers\/offers_\d+$/);
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Support Engineer' })).toBeVisible();
  await expect(main).toContainText('Acme');
  await expect(main).toContainText('Under review');
  await expect(main).toContainText('14 500 PLN per month');
  await expect(main).toContainText('13 000–16 000 PLN per month');
  await expect(main).toContainText('B2B');
  await expect(main).toContainText('Remote');
  await expect(main).toContainText('2 Nov 2026');
});

test('an offer can be edited, and accepting it marks it explicitly and updates the application', async ({ page, supabase }) => {
  supabase.seed('offers', [offerRow('o1', 'a2'), offerRow('o2', 'a3', { status: 'declined', salary_amount: 9000 })]);
  await page.goto('/offers/o1');

  await page.getByRole('button', { name: 'Edit offer' }).click();
  await expect(page.getByLabel('Company and role')).toBeDisabled();
  await page.getByLabel('Salary', { exact: true }).fill('13000');
  await page.getByLabel('Status').selectOption('negotiating');
  await page.getByRole('button', { name: 'Save offer' }).click();

  await expect(page.locator('main')).toContainText('Offer updated.');
  expect(supabase.writes('offers').at(-1)).toMatchObject({ method: 'PATCH', body: { salary_amount: 13000, status: 'negotiating' } });
  expect(supabase.writes('offers').at(-1)!.query).toContain('id=eq.o1');
  await expect(page.locator('main')).toContainText('13 000 PLN per month');

  await page.getByLabel('Update status').selectOption('accepted');
  await page.getByRole('button', { name: 'Save status' }).click();
  await expect(page.locator('main')).toContainText('This is your accepted offer');
  const accept = supabase.writes('offers').at(-1)!;
  expect(accept.body).toMatchObject({ status: 'accepted' });
  expect((accept.body as Record<string, unknown>).decided_at).toBeTruthy();
  expect(supabase.writes('applications').at(-1)!.body).toMatchObject({ outcome_reason: 'offer_accepted' });

  // The overview names the accepted offer.
  await page.getByRole('link', { name: 'All offers' }).click();
  const acceptedSection = page.locator('section', { has: page.getByRole('heading', { name: 'Accepted offer' }) });
  await expect(acceptedSection).toContainText('Service Desk Analyst');
  await expect(acceptedSection).toContainText('Globex');
  await expect(acceptedSection).not.toContainText('IT Technician');

  await page.getByRole('button', { name: /^Declined/ }).click();
  await expect(page.getByRole('link', { name: /IT Technician at Initech, Declined/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Service Desk Analyst at Globex/ })).toHaveCount(0);
});

test('invalid pay is caught before saving', async ({ page, supabase }) => {
  await page.goto('/offers/new?application=a1');
  await expect(page.getByLabel('Company and role')).toHaveValue('a1');
  await page.getByLabel('Salary range from').fill('16000');
  await page.getByLabel('Salary range to').fill('12000');
  await page.getByRole('button', { name: 'Record offer' }).click();

  await expect(page.locator('main')).toContainText('The top of the range must be at least the bottom.');
  expect(supabase.writes('offers')).toHaveLength(0);
});

test('deadlines that have passed are pointed out', async ({ page, supabase }) => {
  supabase.seed('offers', [offerRow('o1', 'a2', { response_deadline: '2026-01-05' })]);
  await page.goto('/offers');
  await expect(page.locator('main')).toContainText('Deadline passed (5 Jan 2026)');
  await page.getByRole('link', { name: /Service Desk Analyst at Globex/ }).click();
  await expect(page.locator('main')).toContainText('If the offer lapsed, mark it as Expired.');
});

test('accepting from the Applications page updates the offer record too', async ({ page, supabase }) => {
  supabase.seed('offers', [offerRow('o1', 'a2')]);
  await page.goto('/applications');
  await page.getByRole('button', { name: 'Accept offer' }).click();
  await expect(page.locator('main')).toContainText('Offer marked as accepted.');

  // The offer record is updated right after the application.
  await expect.poll(() => supabase.writes('offers').length).toBe(1);
  const offerPatch = supabase.writes('offers').at(-1)!;
  expect(offerPatch.method).toBe('PATCH');
  expect(offerPatch.query).toContain('application_id=eq.a2');
  expect(offerPatch.body).toMatchObject({ status: 'accepted' });
});

test('the application page links to its offer, or to recording one', async ({ page, supabase }) => {
  supabase.seed('offers', [offerRow('o1', 'a2')]);
  await page.goto('/applications/a2');
  await expect(page.locator('main')).toContainText('Offer · Received');
  await expect(page.locator('main')).toContainText('12 000 PLN per month');
  await page.getByRole('link', { name: 'View offer' }).click();
  await expect(page).toHaveURL('/offers/o1');

  supabase.tables.offers = [];
  await page.goto('/applications/a2');
  await page.getByRole('link', { name: 'Record offer details' }).click();
  await expect(page).toHaveURL('/offers/new?application=a2');
  await expect(page.getByLabel('Company and role')).toHaveValue('a2');
});

test('before the database update, the page says what is needed', async ({ page }) => {
  await page.route('**/rest/v1/offers?**', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.offers' in the schema cache" }) }),
  );
  await page.goto('/offers');
  await expect(page.locator('main')).toContainText('Offers need a one-off database update');
  await expect(page.getByRole('link', { name: 'Record offer' })).toHaveCount(0);

  // The application page still works.
  await page.goto('/applications/a2');
  await expect(page.locator('main')).toContainText('Record offer details');
});
