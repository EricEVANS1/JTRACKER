import { expect, test, USER_ID } from './support/mockSupabase';
import type { Page } from '@playwright/test';

test.use({ timezoneId: 'Europe/Warsaw' });

const application = (extra: Record<string, unknown> = {}) => ({
  id: 'a1',
  user_id: USER_ID,
  role_title: 'Support Engineer',
  status: 'interview',
  archived: false,
  priority: 'medium',
  created_at: '2026-09-02T10:00:00.000Z',
  company_id: 'c1',
  companies: { id: 'c1', name: 'Acme' },
  date_applied: '2026-09-01',
  response_received_at: '2026-09-04T09:00:00.000Z',
  assessment_received_at: null,
  interview_started_at: '2026-09-15T08:00:00.000Z',
  reached_interview: true,
  ...extra,
});

test.beforeEach(({ supabase }) => {
  supabase.seed('applications', [application()]);
  supabase.seed('application_events', [
    // Status moved to Assessment, but the assessment date was never stamped.
    { id: 'e1', user_id: USER_ID, application_id: 'a1', event_type: 'application_update', title: 'Status changed to Assessment', description: 'Application moved from Confirmed to Assessment.', event_date: '2026-09-08T12:00:00.000Z' },
  ]);
  supabase.seed('interview_notes', [
    { id: 'i1', user_id: USER_ID, application_id: 'a1', interview_stage: 'Technical interview', interview_date: '2026-09-15T08:00:00.000Z', notes: null, questions: [], status: 'completed' },
    { id: 'i2', user_id: USER_ID, application_id: 'a1', interview_stage: 'Final interview', interview_date: '2026-09-25T08:00:00.000Z', notes: null, questions: [], status: 'scheduled' },
  ]);
});

const timeline = (page: Page) => page.locator('section', { has: page.getByRole('heading', { name: 'Recruitment timeline' }) });
const milestone = (page: Page, label: string) => timeline(page).getByRole('listitem', { name: new RegExp(`^${label}:`) });

test('shows recorded stages in order with the time between them, and missing dates as missing', async ({ page }) => {
  await page.goto('/applications/a1');

  await expect(milestone(page, 'Applied')).toContainText('1 Sept 2026');
  await expect(milestone(page, 'First response')).toContainText('4 Sept 2026, 11:00 · 3 days after Applied');
  await expect(milestone(page, 'First interview')).toContainText('15 Sept 2026, 10:00 · 11 days after First response');
  await expect(timeline(page)).toContainText('Applied → First interview: 14 days');

  // Assessment: no date stored, so none is shown; the activity log offers one.
  const assessment = milestone(page, 'Assessment');
  await expect(assessment).toContainText('Not reached, or not recorded');
  await expect(assessment).toContainText('Status changed to Assessment on 8 Sept 2026, 14:00');
  await expect(milestone(page, 'Decision')).toContainText('Awaiting a decision');

  // Each interview round, from the interview records.
  const interview = milestone(page, 'First interview');
  await expect(interview).toContainText('Technical interview · 15 Sept 2026, 10:00');
  await expect(interview).toContainText('Final interview · 25 Sept 2026, 10:00');
  await expect(interview.getByRole('link', { name: 'Manage interviews in the calendar' })).toHaveAttribute('href', '/interviews?application=a1');
});

test('using a suggested date saves it on the application and logs the change', async ({ page, supabase }) => {
  await page.goto('/applications/a1');
  await milestone(page, 'Assessment').getByRole('button', { name: 'Use this date' }).click();

  await expect(page.locator('main')).toContainText('Assessment date saved.');
  const patch = supabase.writes('applications').at(-1)!;
  expect(patch.method).toBe('PATCH');
  expect(patch.body).toEqual({ assessment_received_at: '2026-09-08T12:00:00.000Z' });
  expect(patch.query).toContain('id=eq.a1');
  expect(supabase.writes('application_events').at(-1)!.body).toMatchObject({
    application_id: 'a1',
    event_type: 'timeline_updated',
    title: 'Assessment date added',
  });

  await expect(milestone(page, 'Assessment')).toContainText('8 Sept 2026, 14:00 · 4 days after First response');
});

test('a date can be corrected, and one earlier than the stage before it is flagged', async ({ page, supabase }) => {
  await page.goto('/applications/a1');
  await milestone(page, 'First response').getByRole('button', { name: 'Edit First response date' }).click();

  const input = timeline(page).getByLabel('First response date and time');
  await expect(input).toHaveValue('2026-09-04T11:00');
  await input.fill('2026-08-30T09:30');
  await timeline(page).getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.locator('main')).toContainText('First response date saved.');
  // 09:30 in Warsaw (summer time) is 07:30 UTC.
  expect(supabase.writes('applications').at(-1)!.body).toEqual({ response_received_at: '2026-08-30T07:30:00.000Z' });
  expect(supabase.writes('application_events').at(-1)!.body).toMatchObject({ title: 'First response date corrected' });
  await expect(milestone(page, 'First response')).toContainText('Earlier than the stage before it. Check this date.');
});

test('the applied date is a calendar date, and dates can be removed', async ({ page, supabase }) => {
  supabase.tables.applications[0].date_applied = null;
  supabase.seed('application_events', [
    { id: 'e0', user_id: USER_ID, application_id: 'a1', event_type: 'created', title: 'Application created', description: 'Application added with status Applied.', event_date: '2026-09-02T10:00:00.000Z' },
  ]);
  await page.goto('/applications/a1');

  // Not filled in from when it was added to JTracker; only suggested.
  const applied = milestone(page, 'Applied');
  await expect(applied).toContainText('Reached, but the date wasn’t recorded');
  await expect(applied).toContainText('Added to JTracker as Applied on 2 Sept 2026, 12:00');

  await applied.getByRole('button', { name: 'Add Applied date' }).click();
  await timeline(page).getByLabel('Applied date').fill('2026-08-28');
  await timeline(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('main')).toContainText('Applied date saved.');
  expect(supabase.writes('applications').at(-1)!.body).toEqual({ date_applied: '2026-08-28' });

  await milestone(page, 'First interview').getByRole('button', { name: 'Edit First interview date' }).click();
  await timeline(page).getByRole('button', { name: 'Remove date' }).click();
  await expect(page.locator('main')).toContainText('First interview date removed.');
  expect(supabase.writes('applications').at(-1)!.body).toEqual({ interview_started_at: null });
  // Still reached (the interview flag is set), so now it's a missing date.
  await expect(milestone(page, 'First interview')).toContainText('Reached, but the date wasn’t recorded');
  await expect(milestone(page, 'First interview')).toContainText('Interview record: Technical interview on 15 Sept 2026, 10:00');
});

test('a failed save shows the error and keeps the old date', async ({ page }) => {
  await page.route('**/rest/v1/applications?**', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Could not save.' }) })
      : route.fallback(),
  );
  await page.goto('/applications/a1');
  await milestone(page, 'Assessment').getByRole('button', { name: 'Use this date' }).click();
  await expect(timeline(page).getByRole('alert')).toHaveText('Could not save.');
  await expect(milestone(page, 'Assessment')).toContainText('Not reached, or not recorded');
});
