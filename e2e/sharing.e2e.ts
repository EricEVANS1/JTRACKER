import { daysFromNow, expect, test, USER_ID } from './support/mockSupabase';

const BOB = '00000000-0000-0000-0000-000000000002';

const share = {
  id: 'share-1',
  public_share_id: 'pub-123e4567',
  role_title: 'Engineer',
  company_name: 'Globex',
  location: 'Berlin',
  job_link: 'https://jobs.example/1',
  note: 'Great fit',
  include_status: true,
  status_snapshot: 'interview',
  created_at: daysFromNow(-1),
};

test.beforeEach(({ supabase }) => {
  supabase.rpcs.find_user_by_email = ({ lookup_email }) =>
    String(lookup_email).trim().toLowerCase() === 'bob@example.com'
      ? [{ id: BOB, full_name: 'Bob', email: 'bob@example.com' }]
      : [];
  supabase.rpcs.get_public_share = ({ share_id }) => (share_id === share.public_share_id ? share : null);
  supabase.seed('applications', [
    {
      id: 'app1',
      user_id: USER_ID,
      role_title: 'Data Analyst',
      status: 'applied',
      archived: false,
      priority: 'medium',
      notes: 'private notes',
      created_at: daysFromNow(-5),
      date_applied: daysFromNow(-5),
      companies: { id: 'c1', name: 'Acme', location: 'Remote' },
    },
  ]);
});

test.describe('public share page (signed out)', () => {
  test.use({ signedIn: false });

  test('reads one share by its link through get_public_share', async ({ page, supabase }) => {
    await page.goto('/share/pub-123e4567');

    await expect(page.getByText('Engineer').first()).toBeVisible();
    await expect(page.locator('body')).toContainText('Globex');
    await expect(page.locator('body')).toContainText('Great fit');
    // Development builds run effects twice (React StrictMode), so expect at
    // least one call, all for this link.
    const calls = supabase.rpcCalls('get_public_share');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((r) => JSON.stringify(r.body) === JSON.stringify({ share_id: 'pub-123e4567' }))).toBe(true);
    expect(supabase.requests.some((r) => r.table === 'shared_opportunities')).toBe(false);
  });

  test('says an unknown link could not be found', async ({ page }) => {
    await page.goto('/share/unknown-link');
    await expect(page.getByText('could not be found')).toBeVisible();
  });
});

test('Applications: shares with a user found by exact email and notifies them', async ({ page, supabase }) => {
  await page.goto('/applications');
  await page.getByRole('button', { name: 'Share', exact: true }).first().click();

  const email = page.getByPlaceholder('friend@example.com');
  await email.fill('nobody@example.com');
  await page.getByRole('button', { name: 'Share Internally' }).click();
  await expect(page.getByText('No JTracker user found with that email.')).toBeVisible();

  await email.fill('  Bob@Example.com ');
  await page.getByRole('button', { name: 'Share Internally' }).click();
  await expect(page.getByText('Opportunity shared successfully.')).toBeVisible();

  expect(supabase.rpcCalls('find_user_by_email').map((r) => r.body)).toEqual([
    { lookup_email: 'nobody@example.com' },
    { lookup_email: 'bob@example.com' },
  ]);
  expect(supabase.requests.some((r) => r.table === 'profiles' && r.query.includes('ilike'))).toBe(false);

  const [shareInsert] = supabase.writes('shared_opportunities');
  const created = supabase.tables.shared_opportunities[0];
  expect(shareInsert.body).toMatchObject({ sender_user_id: USER_ID, recipient_user_id: BOB });
  expect(String(created.public_share_id)).toMatch(/^[0-9a-f-]{36}$/);

  // The notification names the sender and the share, as the insert rule requires.
  const [notification] = supabase.writes('notifications');
  expect(notification.body).toMatchObject({ user_id: BOB, actor_user_id: USER_ID, related_shared_opportunity_id: created.id });
});

test('Application details: shares with a user found by exact email', async ({ page, supabase }) => {
  await page.goto('/applications/app1');
  await page.getByRole('button', { name: 'Share', exact: true }).click();

  const email = page.locator('input[type="email"]').last();
  await email.fill('nobody@example.com');
  await page.getByRole('button', { name: 'Share Opportunity' }).click();
  await expect(page.getByText('No JTracker user found with that email.')).toBeVisible();

  await email.fill('bob@example.com');
  await page.getByRole('button', { name: 'Share Opportunity' }).click();
  await expect(page.getByText('Opportunity shared successfully.')).toBeVisible();

  expect(supabase.writes('shared_opportunities')[0].body).toMatchObject({ recipient_user_id: BOB });
  expect(supabase.rpcCalls('find_user_by_email')).toHaveLength(2);
});
