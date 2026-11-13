import { expect, test } from './support/mockSupabase';

test.use({ signedIn: false });

test('registration prompts for email confirmation when no session is returned', async ({ page, context, supabase }) => {
  await context.route('http://mock.supabase.test/auth/v1/signup?**', async (route) => {
    expect(new URL(route.request().url()).searchParams.get('redirect_to')).toBe('http://localhost:5199/auth');
    await route.fulfill({ json: supabase.user });
  });

  await page.goto('/auth');
  await page.getByRole('button', { name: /create one/i }).click();
  await page.getByPlaceholder('Your full name').fill('Alice Example');
  await page.getByPlaceholder('you@example.com').fill(supabase.user.email);
  await page.getByPlaceholder('Create a secure password').fill('test-password');
  await page.getByRole('button', { name: 'Create Account' }).click();

  await expect(page.getByRole('status')).toContainText('check your inbox');
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
});

test('registration with a session opens the dashboard immediately', async ({ page, context, supabase }) => {
  await context.route('http://mock.supabase.test/auth/v1/signup?**', (route) =>
    route.fulfill({ json: supabase.session }),
  );

  await page.goto('/auth');
  await page.getByRole('button', { name: /create one/i }).click();
  await page.getByPlaceholder('Your full name').fill('Alice Example');
  await page.getByPlaceholder('you@example.com').fill(supabase.user.email);
  await page.getByPlaceholder('Create a secure password').fill('test-password');
  await page.getByRole('button', { name: 'Create Account' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
});

test('sign-in restores the requested page, persists on refresh and ends at sign-out', async ({ page, context, supabase }) => {
  await context.route('http://mock.supabase.test/auth/v1/token?grant_type=password', (route) =>
    route.fulfill({ json: supabase.session }),
  );

  await page.goto('/applications?source=test#list');
  await expect(page).toHaveURL(/\/auth$/);
  await page.getByPlaceholder('you@example.com').fill(supabase.user.email);
  await page.getByPlaceholder('Enter your password').fill('test-password');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/applications\?source=test#list$/);

  await page.reload();
  await expect(page).toHaveURL(/\/applications\?source=test#list$/);
  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page).toHaveURL(/\/auth$/);
  await page.goto('/applications');
  await expect(page).toHaveURL(/\/auth$/);
});

test('a rejected refresh for an expired session returns to sign-in', async ({ page, context, supabase }) => {
  await context.addInitScript((session) => {
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(session));
  }, { ...supabase.session, expires_at: 1 });
  await context.route('http://mock.supabase.test/auth/v1/token?grant_type=refresh_token', (route) =>
    route.fulfill({ status: 400, json: { code: 'refresh_token_not_found', msg: 'Refresh token expired' } }),
  );

  await page.goto('/applications');
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
});
