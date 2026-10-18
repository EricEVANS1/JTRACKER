import { daysFromNow, expect, test, USER_ID } from './support/mockSupabase';

const application = (id: string, role_title: string, company: string, extra: Record<string, unknown> = {}) => ({
  id,
  user_id: USER_ID,
  role_title,
  status: 'final_interview',
  archived: false,
  priority: 'medium',
  created_at: daysFromNow(-30),
  updated_at: daysFromNow(-2),
  date_applied: daysFromNow(-30),
  follow_up_date: null,
  company_id: `c-${id}`,
  companies: { id: `c-${id}`, name: company },
  ...extra,
});

test.beforeEach(({ supabase }) => {
  supabase.seed('applications', [
    application('a1', 'Support Engineer', 'Acme'),
    application('a2', 'Service Desk Analyst', 'Globex'),
    application('a3', 'IT Technician', 'Initech', { status: 'offer', offer_received_at: daysFromNow(-3) }),
  ]);
});

const dialog = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: 'Congratulations!' });

const markOfferOnDetailsPage = async (page: import('@playwright/test').Page, id: string) => {
  await page.goto(`/applications/${id}`);
  await page.locator('main select').first().selectOption('offer');
  await page.getByRole('button', { name: 'Update Status' }).click();
};

test('saving a new offer celebrates once, with the role, company and a link to the offer', async ({ page, supabase }) => {
  await markOfferOnDetailsPage(page, 'a1');

  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText('You have an offer for Support Engineer at Acme.');
  await expect(dialog(page).locator('[data-offer-confetti]')).toHaveCount(1);
  await expect(dialog(page).getByRole('link', { name: 'View offer' })).toHaveAttribute('href', '/applications/a1');
  await expect(dialog(page).getByRole('link', { name: 'View offer' })).toBeFocused();
  expect(supabase.writes('applications').at(-1)!.body).toMatchObject({ status: 'offer' });

  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();

  // Not again for the same offer: not on reload, not on the dashboard, not when set to Offer again.
  await page.reload();
  await page.goto('/dashboard');
  await page.locator('main').getByText('Dashboard').first().waitFor();
  await expect(dialog(page)).toBeHidden();

  await page.goto('/applications/a1');
  await page.locator('main select').first().selectOption('interview');
  await page.getByRole('button', { name: 'Update Status' }).click();
  // Wait for the page to reload the application (the button is disabled again).
  await expect(page.getByRole('button', { name: 'Update Status' })).toBeDisabled();
  await page.locator('main select').first().selectOption('offer');
  await page.getByRole('button', { name: 'Update Status' }).click();
  await expect(page.locator('main')).toContainText('Status updated.');
  await expect(dialog(page)).toBeHidden();
});

test('changing the status to Offer in the applications list celebrates, and View offer opens it', async ({ page }) => {
  await page.goto('/applications');
  // The innermost block holding both the role and a status select is that application's row.
  const row = page.locator('main div', { hasText: 'Service Desk Analyst' }).filter({ has: page.locator('select') }).last();
  await row.locator('select').selectOption('offer');

  await expect(dialog(page)).toContainText('Service Desk Analyst at Globex');
  await dialog(page).getByRole('link', { name: 'View offer' }).click();
  await expect(page).toHaveURL('/applications/a2');
  await expect(dialog(page)).toBeHidden();
});

test('an existing offer does not celebrate when pages load', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('main')).toContainText('Pipeline Funnel');
  await page.goto('/applications/a3');
  await expect(page.locator('main')).toContainText('IT Technician');
  await expect(dialog(page)).toBeHidden();
});

test('a failed save does not celebrate', async ({ page }) => {
  await page.route('**/rest/v1/applications?**', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Save failed.' }) })
      : route.fallback());

  await markOfferOnDetailsPage(page, 'a1');
  await expect(page.locator('main')).toContainText('Save failed.');
  await expect(dialog(page)).toBeHidden();
});

test('with reduced motion the celebration appears without confetti', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await markOfferOnDetailsPage(page, 'a1');

  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('[data-offer-confetti]')).toHaveCount(0);
  await expect(page.locator('.animate-offer-pop, .animate-offer-glow, .animate-offer-fade')).toHaveCount(0);
});

test('celebrations can be turned off from the celebration and back on in Settings', async ({ page }) => {
  await markOfferOnDetailsPage(page, 'a1');
  await dialog(page).getByRole('button', { name: 'Don’t show celebrations' }).click();
  await expect(dialog(page)).toContainText('Celebrations are off. Turn them back on in Settings → Notifications.');
  await dialog(page).getByRole('button', { name: 'Close' }).first().click();

  await markOfferOnDetailsPage(page, 'a2');
  await expect(page.locator('main')).toContainText('Status updated.');
  await expect(dialog(page)).toBeHidden();

  await page.goto('/settings?tab=notifications');
  const toggle = page.getByRole('switch', { name: 'Offer celebrations' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
});
