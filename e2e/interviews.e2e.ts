import { expect, test, USER_ID } from './support/mockSupabase';
import type { Page } from '@playwright/test';

// The viewer is in Warsaw; "now" is Wednesday 14 October 2026, 09:00 there.
// (In the past, so the mock sign-in session hasn't expired.)
test.use({ timezoneId: 'Europe/Warsaw' });
const NOW = new Date('2026-10-14T07:00:00.000Z');

const application = (id: string, role_title: string, company: string, extra: Record<string, unknown> = {}) => ({
  id,
  user_id: USER_ID,
  role_title,
  status: 'interview',
  archived: false,
  priority: 'medium',
  created_at: '2026-10-01T10:00:00.000Z',
  date_applied: '2026-10-01',
  company_id: `c-${id}`,
  companies: { id: `c-${id}`, name: company },
  ...extra,
});

const interview = (id: string, application_id: string, interview_date: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  user_id: USER_ID,
  application_id,
  interview_stage: 'HR interview',
  interview_date,
  notes: null,
  questions: [],
  status: 'scheduled',
  timezone: 'Europe/Warsaw',
  ...extra,
});

test.beforeEach(async ({ page, supabase }) => {
  await page.clock.setFixedTime(NOW);
  supabase.seed('applications', [
    application('a1', 'Support Engineer', 'Acme'),
    application('a2', 'Service Desk Analyst', 'Globex'),
  ]);
});

const dialog = (page: Page) => page.getByRole('dialog');

test.describe('with interviews', () => {
  test.beforeEach(({ supabase }) => {
    supabase.seed('interview_notes', [
      // Thursday 15 Oct 10:00 Warsaw.
      interview('i1', 'a1', '2026-10-15T08:00:00.000Z', { interview_stage: 'Technical interview' }),
      // Thursday 15 Oct 23:30 in New York = Friday 16 Oct 05:30 in Warsaw.
      interview('i2', 'a2', '2026-10-16T03:30:00.000Z', { timezone: 'America/New_York', interview_stage: 'Hiring manager' }),
      // Monday 12 Oct, already past and still "scheduled".
      interview('i3', 'a2', '2026-10-12T12:00:00.000Z', { interview_stage: 'Recruiter screen' }),
    ]);
  });

  test('upcoming lists interviews by day in my time zone, with the original zone, and asks about past ones', async ({ page }) => {
    await page.goto('/interviews');
    const main = page.locator('main');

    await expect(main.getByRole('heading', { name: 'Tomorrow' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Friday 16 October' })).toBeVisible();
    // Arranged for 23:30 New York time; 05:30 the next morning here.
    await expect(main).toContainText('05:30 · 23:30');
    await expect(main).toContainText('(America/New_York)');

    const outcome = main.locator('section', { has: page.getByRole('heading', { name: 'How did these go?' }) });
    await expect(outcome).toContainText('Service Desk Analyst — Globex');
    await expect(outcome).toContainText('Recruiter screen');
  });

  test('week and month views place interviews on the right local day', async ({ page }) => {
    await page.goto('/interviews?view=week');
    await expect(page.getByRole('heading', { name: '12–18 Oct 2026' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Thursday 15 October' })).toContainText('10:00 Acme');
    await expect(page.getByRole('region', { name: 'Friday 16 October' })).toContainText('05:30 Globex');
    await expect(page.getByRole('region', { name: 'Thursday 15 October' })).not.toContainText('Globex');

    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(page.getByRole('heading', { name: '19–25 Oct 2026' })).toBeVisible();
    await expect(page.locator('main')).toContainText('No interviews this week.');

    await page.getByRole('tab', { name: 'Month' }).click();
    await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();
    await page.getByRole('button', { name: 'Friday 16 October: 1 interview' }).click();
    const day = page.locator('section', { has: page.getByRole('heading', { name: 'Friday 16 October' }) });
    await expect(day).toContainText('Service Desk Analyst — Globex');

    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible();
    await expect(page.locator('main')).toContainText('No interviews this month.');
  });

  test('editing and rescheduling saves the new moment and logs it on the application', async ({ page, supabase }) => {
    await page.goto('/interviews');
    await page.getByRole('button', { name: 'Edit Technical interview for Support Engineer — Acme' }).click();

    await expect(dialog(page).getByLabel('Date')).toHaveValue('2026-10-15');
    await expect(dialog(page).getByLabel('Time', { exact: true })).toHaveValue('10:00');
    await expect(dialog(page).getByLabel('Time zone')).toHaveValue('Europe/Warsaw');

    await dialog(page).getByLabel('Date').fill('2026-10-26'); // after the clocks go back
    await dialog(page).getByLabel('Time', { exact: true }).fill('11:15');
    await dialog(page).getByLabel('Notes').fill('Bring portfolio');
    await dialog(page).getByRole('button', { name: 'Save changes' }).click();

    await expect(page.locator('main')).toContainText('Interview rescheduled.');
    expect(supabase.writes('interview_notes').at(-1)).toMatchObject({
      method: 'PATCH',
      body: { interview_date: '2026-10-26T10:15:00.000Z', timezone: 'Europe/Warsaw', notes: 'Bring portfolio', application_id: 'a1' },
    });
    expect(supabase.writes('interview_notes').at(-1)!.query).toContain('id=eq.i1');
    expect(supabase.writes('application_events').at(-1)!.body).toMatchObject({
      application_id: 'a1',
      event_type: 'interview_rescheduled',
    });
    await expect(page.locator('main').getByRole('heading', { name: 'Monday 26 October' })).toBeVisible();
  });

  test('an interview can be cancelled, and completed from the past list', async ({ page, supabase }) => {
    await page.goto('/interviews');

    await page.getByRole('button', { name: 'Edit Technical interview for Support Engineer — Acme' }).click();
    await dialog(page).getByRole('button', { name: 'Cancel interview' }).click();
    await expect(page.locator('main')).toContainText('Interview cancelled.');
    expect(supabase.writes('interview_notes').at(-1)).toMatchObject({ method: 'PATCH', body: { status: 'cancelled' } });
    expect(supabase.writes('application_events').at(-1)!.body).toMatchObject({ event_type: 'interview_cancelled' });
    // Cancelled interviews leave the upcoming list but stay on the calendar, struck through.
    await expect(page.locator('main').getByRole('heading', { name: 'Tomorrow' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Week' }).click();
    await expect(page.getByRole('region', { name: 'Thursday 15 October' }).getByRole('button', { name: /Acme/ })).toHaveClass(/line-through/);

    await page.getByRole('tab', { name: 'Upcoming' }).click();
    const outcome = page.locator('section', { has: page.getByRole('heading', { name: 'How did these go?' }) });
    await outcome.getByRole('button', { name: 'Completed' }).click();
    await expect(page.locator('main')).toContainText('Interview marked as completed.');
    expect(supabase.writes('interview_notes').at(-1)).toMatchObject({ method: 'PATCH', body: { status: 'completed' } });
    expect(supabase.writes('interview_notes').at(-1)!.query).toContain('id=eq.i3');
    await expect(page.getByRole('heading', { name: 'How did these go?' })).toHaveCount(0);
  });

  test('a cancelled interview comes back when given a new date', async ({ page, supabase }) => {
    supabase.tables.interview_notes[0].status = 'cancelled';
    await page.goto('/interviews?view=week');
    await page.getByRole('region', { name: 'Thursday 15 October' }).getByRole('button', { name: /Acme/ }).click();
    await expect(dialog(page)).toContainText('Choose a new date and save to reschedule.');
    await dialog(page).getByLabel('Date').fill('2026-10-24');
    await dialog(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('main')).toContainText('Interview rescheduled.');
    expect(supabase.writes('interview_notes').at(-1)!.body).toMatchObject({ status: 'scheduled', cancelled_at: null });
  });

  test('an interview can be deleted after confirming', async ({ page, supabase }) => {
    await page.goto('/interviews');
    await page.getByRole('button', { name: 'Edit Technical interview for Support Engineer — Acme' }).click();
    await dialog(page).getByRole('button', { name: 'Delete' }).click();
    await dialog(page).getByRole('button', { name: 'Confirm delete' }).click();

    await expect(page.locator('main')).toContainText('Interview deleted.');
    expect(supabase.writes('interview_notes').at(-1)).toMatchObject({ method: 'DELETE' });
    expect(supabase.tables.interview_notes.map((row) => row.id)).toEqual(['i2', 'i3']);
  });

  test('the same application cannot be booked twice at the same moment', async ({ page, supabase }) => {
    await page.goto('/interviews');
    await page.getByRole('button', { name: 'Schedule interview' }).first().click();
    await dialog(page).getByLabel('Application').selectOption('a1');
    await dialog(page).getByLabel('Date').fill('2026-10-15');
    await dialog(page).getByLabel('Time', { exact: true }).fill('10:00');
    await dialog(page).getByRole('button', { name: 'Schedule', exact: true }).click();

    await expect(dialog(page).getByRole('alert')).toHaveText('This application already has an interview at that time.');
    expect(supabase.writes('interview_notes')).toHaveLength(0);
  });
});

test('scheduling an interview in another time zone stores the exact moment and the zone', async ({ page, supabase }) => {
  await page.goto('/interviews');
  await expect(page.locator('main')).toContainText('No upcoming interviews');

  await page.getByRole('button', { name: 'Schedule interview' }).first().click();
  await expect(dialog(page).getByLabel('Application')).toBeFocused();
  await dialog(page).getByLabel('Application').selectOption('a2');
  await dialog(page).getByLabel('Interview stage').fill('Final interview');
  await dialog(page).getByLabel('Date').fill('2026-10-23');
  await dialog(page).getByLabel('Time', { exact: true }).fill('14:30');
  await dialog(page).getByLabel('Time zone').selectOption('Europe/London');
  await expect(dialog(page)).toContainText('Fri, 23 Oct 15:30 in your time zone (Europe/Warsaw).');
  await dialog(page).getByLabel('Notes').fill('Panel of three');
  await dialog(page).getByRole('button', { name: 'Schedule', exact: true }).click();

  await expect(page.locator('main')).toContainText('Interview scheduled.');
  expect(supabase.writes('interview_notes').at(-1)).toMatchObject({
    method: 'POST',
    body: {
      user_id: USER_ID,
      application_id: 'a2',
      interview_stage: 'Final interview',
      interview_date: '2026-10-23T13:30:00.000Z',
      timezone: 'Europe/London',
      status: 'scheduled',
      notes: 'Panel of three',
    },
  });
  expect(supabase.writes('application_events').at(-1)!.body).toMatchObject({ application_id: 'a2', event_type: 'interview_scheduled' });

  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Friday 23 October' })).toBeVisible();
  await expect(main).toContainText('15:30 · 14:30');
  await expect(main).toContainText('Service Desk Analyst — Globex');
});

test('shows a skeleton while loading, and an empty state for weeks without interviews', async ({ page }) => {
  await page.route('**/rest/v1/interview_notes**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fallback();
  });
  await page.goto('/interviews?view=week');
  await expect(page.getByRole('status').filter({ hasText: 'Loading interviews…' })).toBeAttached();
  await expect(page.locator('main')).toContainText('No interviews this week.');
});

test('before the database update, scheduling works and status changes explain what is needed', async ({ page, supabase }) => {
  supabase.seed('interview_notes', [
    { id: 'old', user_id: USER_ID, application_id: 'a1', interview_stage: 'HR', interview_date: '2026-10-22T08:00:00.000Z', notes: null, questions: [] },
  ]);
  // The new columns don't exist yet.
  await page.route('**/rest/v1/interview_notes?**', (route) =>
    new URL(route.request().url()).searchParams.get('select') === 'id,status,timezone'
      ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '42703', message: 'column interview_notes.status does not exist' }) })
      : route.fallback(),
  );

  await page.goto('/interviews');
  await expect(page.locator('main')).toContainText('need a one-off database update');
  await expect(page.locator('main')).toContainText('Support Engineer — Acme');

  await page.getByRole('button', { name: 'Edit HR for Support Engineer — Acme' }).click();
  await expect(dialog(page).getByRole('button', { name: 'Cancel interview' })).toBeDisabled();
  await dialog(page).getByLabel('Time', { exact: true }).fill('12:00');
  await dialog(page).getByRole('button', { name: 'Save changes' }).click();

  await expect(page.locator('main')).toContainText('Interview rescheduled.');
  const body = supabase.writes('interview_notes').at(-1)!.body as Record<string, unknown>;
  expect(body).toMatchObject({ interview_date: '2026-10-22T10:00:00.000Z' });
  expect(body).not.toHaveProperty('timezone');
  expect(body).not.toHaveProperty('status');
});

test('the application page links to its interviews, and the calendar can be filtered to one application', async ({ page, supabase }) => {
  supabase.seed('interview_notes', [interview('i1', 'a1', '2026-10-22T08:00:00.000Z'), interview('i9', 'a2', '2026-10-22T12:00:00.000Z')]);
  await page.goto('/applications/a1');
  // The preparation date input shows local time (10:00 in Warsaw), not UTC.
  await expect(page.locator('input[type="datetime-local"]')).toHaveValue('2026-10-22T10:00');
  await page.getByRole('link', { name: 'View in interview calendar' }).click();

  await expect(page).toHaveURL('/interviews?application=a1');
  const main = page.locator('main');
  await expect(main).toContainText('Showing interviews for');
  await expect(main).toContainText('Support Engineer — Acme');
  await expect(main).not.toContainText('Service Desk Analyst — Globex');

  await page.getByRole('button', { name: 'Schedule interview' }).first().click();
  await expect(dialog(page).getByLabel('Application')).toHaveValue('a1');
});
