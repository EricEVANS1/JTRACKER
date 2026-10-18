import { daysFromNow, expect, test, USER_ID } from './support/mockSupabase';

const application = (id: string, role_title: string, extra: Record<string, unknown>) => ({
  id,
  user_id: USER_ID,
  role_title,
  status: 'applied',
  archived: false,
  priority: 'medium',
  created_at: daysFromNow(-30),
  updated_at: daysFromNow(-2),
  date_applied: daysFromNow(-30),
  follow_up_date: null,
  companies: { id: 'c1', name: 'Acme' },
  ...extra,
});

test.beforeEach(({ supabase }) => {
  supabase.seed('applications', [
    application('a1', 'Overdue Role', { follow_up_date: daysFromNow(-3) }),
    application('a2', 'Today Role', { follow_up_date: daysFromNow(0) }),
    application('a3', 'Upcoming Role', { status: 'assessment', follow_up_date: daysFromNow(3) }),
    application('a4', 'Final Pending Role', { status: 'final_interview', final_response_pending: true }),
    application('a5', 'Plain Applied Role', { date_applied: daysFromNow(-1) }),
  ]);
  supabase.seed('notifications', [
    { id: 'n1', user_id: USER_ID, title: 'Unread Alert', message: 'unread one', type: 'shared_opportunity', read: false, created_at: daysFromNow(-1) },
    { id: 'n2', user_id: USER_ID, title: 'Read Alert', message: 'read one', type: 'shared_opportunity', read: true, created_at: daysFromNow(-2) },
  ]);
});

const shortcuts = [
  { label: 'Overdue follow-ups', url: '/follow-ups?filter=overdue', shows: ['Overdue Role'], hides: ['Today Role', 'Upcoming Role'] },
  { label: 'Due today', url: '/follow-ups?filter=today', shows: ['Today Role'], hides: ['Overdue Role', 'Upcoming Role'] },
  { label: 'Upcoming follow-ups', url: '/follow-ups?filter=upcoming', shows: ['Upcoming Role'], hides: ['Overdue Role', 'Today Role'] },
  {
    label: 'Awaiting final response',
    url: '/applications?view=awaiting_final_response',
    shows: ['Final Pending Role'],
    hides: ['Overdue Role', 'Plain Applied Role'],
  },
  { label: 'Unread notifications', url: '/notifications?filter=unread', shows: ['Unread Alert'], hides: ['Read Alert'] },
];

for (const shortcut of shortcuts) {
  test(`"${shortcut.label}" opens the matching filtered view`, async ({ page }) => {
    await page.goto('/dashboard');

    const pill = page.locator('a', { hasText: shortcut.label }).first();
    await expect(pill).toContainText('1');
    await pill.click();

    await expect(page).toHaveURL(shortcut.url);
    const main = page.locator('main');
    for (const text of shortcut.shows) await expect(main).toContainText(text);
    for (const text of shortcut.hides) await expect(main).not.toContainText(text);
  });
}

test('a load error is shown as an alert that can be dismissed', async ({ page }) => {
  await page.route('**/rest/v1/recruiters**', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Could not load recruiters.' }) }));
  await page.goto('/dashboard');

  const alert = page.getByRole('alert').filter({ hasText: 'Could not load recruiters.' });
  await expect(alert).toBeVisible();
  await alert.getByRole('button', { name: 'Dismiss error' }).click();
  await expect(alert).toBeHidden();
});

test('Refresh says when the dashboard was last updated', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('status').filter({ hasText: /^Updated \d{2}:\d{2}$/ })).toBeVisible();

  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Updated \d{2}:\d{2}$/ })).toBeVisible();
});
