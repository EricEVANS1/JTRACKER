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

test('forgot password sends an email request with the reset route', async ({ page, context, supabase }) => {
  await context.route('http://mock.supabase.test/auth/v1/recover?**', async (route) => {
    expect(new URL(route.request().url()).searchParams.get('redirect_to')).toBe('http://localhost:5199/reset-password');
    expect(route.request().postDataJSON()).toMatchObject({ email: supabase.user.email });
    await route.fulfill({ json: {} });
  });
  await page.goto('/auth');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email address').fill(supabase.user.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('If an account exists');
});

test('reset verifies the recovery token before changing the password', async ({ page, context, supabase }) => {
  await context.route('http://mock.supabase.test/auth/v1/verify', async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ type: 'recovery', token_hash: 'mock-recovery' });
    await route.fulfill({ json: supabase.session });
  });
  await context.route('http://mock.supabase.test/auth/v1/user', async (route) => {
    expect(route.request().method()).toBe('PUT');
    expect(route.request().postDataJSON()).toMatchObject({ password: 'new-test-password' });
    await route.fulfill({ json: supabase.user });
  });
  await page.goto('/reset-password?token_hash=mock-recovery');
  await page.getByLabel('New password', { exact: true }).fill('new-test-password');
  await page.getByLabel('Confirm new password').fill('different-password');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('alert')).toHaveText('The passwords must match.');
  await page.getByLabel('Confirm new password').fill('new-test-password');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('status')).toContainText('You can now sign in');
  await expect(page).toHaveURL(/\/reset-password$/);
});

test('an expired reset link offers a fresh link', async ({ page, context }) => {
  await context.route('http://mock.supabase.test/auth/v1/verify', (route) =>
    route.fulfill({ status: 403, json: { code: 'otp_expired', msg: 'Expired' } }),
  );
  await page.goto('/reset-password?token_hash=expired');
  await page.getByLabel('New password', { exact: true }).fill('new-test-password');
  await page.getByLabel('Confirm new password').fill('new-test-password');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible();
});
