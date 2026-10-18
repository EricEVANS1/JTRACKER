import { expect, SUPABASE_URL, test, USER_ID } from './support/mockSupabase';

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();

const job = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  user_id: USER_ID,
  title,
  company: 'Acme',
  location: 'Warsaw',
  job_url: `https://www.linkedin.com/jobs/view/${id}/`,
  source: 'LinkedIn',
  source_slug: 'linkedin',
  discovered_at: hoursAgo(2),
  description: 'Help customers with our product.',
  ignored: false,
  ...extra,
});

test.beforeEach(({ supabase }) => {
  supabase.seed('job_sources', [{ name: 'LinkedIn', slug: 'linkedin', fetch_method: 'serpapi', is_active: true }]);
  supabase.seed('user_job_preferences', [
    {
      id: 'prefs-1',
      user_id: USER_ID,
      target_titles: ['Support Specialist'],
      preferred_locations: ['Warsaw'],
      work_model: 'onsite',
      max_job_age_days: 1,
      min_match_score: 60,
      enabled_sources: ['linkedin'],
      automation_enabled: false,
      experience_levels: ['entry', 'associate'],
    },
  ]);
  supabase.seed('job_ads', [
    job('1001', 'Support Specialist', { source_posted_at: hoursAgo(5) }), // shown
    job('1002', 'Junior Support Specialist', { source_posted_at: hoursAgo(20) }), // shown
    job('1003', 'Undated Support Specialist', { source_posted_at: null }), // no date
    job('1004', 'Old Support Specialist', { source_posted_at: hoursAgo(24 * 180) }), // six months
    job('1005', 'Closed Support Specialist', { source_posted_at: hoursAgo(3), description: 'No longer accepting applications' }),
    job('1006', 'Support Specialist (Remote)', { source_posted_at: hoursAgo(3) }), // remote
    job('1007', 'Senior Support Specialist', { source_posted_at: hoursAgo(3) }), // level
    job('1008', 'Week Old Support Specialist', { source_posted_at: hoursAgo(24 * 5) }), // older than 24h
  ]);
});

test('the job list shows only jobs that match Date posted, work model and experience level', async ({ page }) => {
  await page.goto('/job-automation');

  const main = page.locator('main');
  await expect(main).toContainText('Support Specialist');
  await expect(main).toContainText('Junior Support Specialist');
  for (const hidden of ['Undated', 'Old Support', 'Closed', '(Remote)', 'Senior', 'Week Old']) {
    await expect(main).not.toContainText(hidden);
  }
  await expect(main).toContainText('2 results · posted past 24 hours · 3 hidden by your filters');

  // Summary shows the filters in LinkedIn's terms.
  await expect(main).toContainText('Past 24 hours');
  await expect(main).toContainText('On-site');
  await expect(main).toContainText('Entry level, Associate');

  // Never "Posted …" from the date JTracker found it.
  await expect(main).not.toContainText('Date unknown');
});

test('widening Date posted and choosing levels saves them', async ({ page, supabase }) => {
  await page.goto('/job-automation');
  await page.getByRole('button', { name: 'Edit Profile' }).first().click();

  const datePosted = page.getByRole('combobox').filter({ has: page.getByRole('option', { name: 'Past 24 hours' }) });
  await expect(datePosted).toHaveValue('past_24_hours');
  await expect(datePosted.locator('option')).toHaveText(['Past 24 hours', 'Past week', 'Past month', 'Any time']);
  await datePosted.selectOption('past_week');

  await page.getByRole('button', { name: 'Mid-Senior level' }).click();
  await page.getByRole('button', { name: 'Entry level' }).click(); // turn off

  await page.getByRole('button', { name: 'Save Profile' }).first().click();
  await expect(page.locator('main')).toContainText('Search profile saved.');

  expect(supabase.writes('user_job_preferences').at(-1)!.body).toMatchObject({
    max_job_age_days: 7,
    work_model: 'onsite',
    experience_levels: ['associate', 'mid_senior'],
  });
});

test('experience levels explain what is needed before the database column exists', async ({ page, supabase }) => {
  delete supabase.tables.user_job_preferences[0].experience_levels;
  await page.goto('/job-automation');
  await page.getByRole('button', { name: 'Edit Profile' }).first().click();

  await expect(page.getByRole('button', { name: 'Associate' })).toBeDisabled();
  await expect(page.locator('main')).toContainText('the database needs the experience_levels column');

  await page.getByRole('button', { name: 'Save Profile' }).first().click();
  await expect(page.locator('main')).toContainText('Search profile saved.');
  expect(supabase.writes('user_job_preferences').at(-1)!.body).not.toHaveProperty('experience_levels');
});

test('a run reports how many jobs each filter removed', async ({ page }) => {
  await page.route(`${SUPABASE_URL}/functions/v1/job-pipeline`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        success: true,
        scanned_count: 20,
        saved_count: 3,
        scored_count: 3,
        duplicate_count: 0,
        combinations_searched: [{ title: 'Support Specialist', location: 'Warsaw' }],
        combinations_skipped: [],
        filtered_out: { date: 12, closed: 1, work_model: 2, experience_level: 2 },
      }),
    }),
  );

  await page.goto('/job-automation');
  await page.getByRole('button', { name: 'Run Search Now' }).click();

  await expect(page.locator('main')).toContainText(
    'Filtered out: 12 older than past 24 hours or undated, 1 no longer accepting applications, 2 other work model, 2 other experience level.',
  );
});

test('a run with nothing found says why', async ({ page }) => {
  await page.route(`${SUPABASE_URL}/functions/v1/job-pipeline`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        success: true,
        scanned_count: 0,
        saved_count: 0,
        scored_count: 0,
        duplicate_count: 0,
        combinations_searched: [{ title: 'Software engineer', location: 'Warsaw' }],
        combinations_skipped: [],
        filtered_out: { date: 0, closed: 0, work_model: 0, experience_level: 0 },
        search_reports: [
          { source: 'linkedin', title: 'Software engineer', location: 'Warsaw', listings: 10, viaLinkedIn: 0, matched: 0, error: null },
          { source: 'indeed', title: 'Software engineer', location: 'Warsaw', listings: 0, viaLinkedIn: 0, matched: 0, error: 'Unsupported `indeed` search engine.' },
        ],
        source_summaries: [
          { source: 'linkedin', found: 0, kept: 0, undated: 0, tooOld: 0, otherFilters: 0 },
          { source: 'justjoinit', found: 6, kept: 0, undated: 6, tooOld: 0, otherFilters: 0 },
          { source: 'indeed', found: 0, kept: 0, undated: 0, tooOld: 0, otherFilters: 0 },
        ],
      }),
    }),
  );

  await page.goto('/job-automation');
  await page.getByRole('button', { name: 'Run Search Now' }).click();
  await expect(page.locator('main')).toContainText(
    'LinkedIn search for "Software engineer" in Warsaw: Google Jobs had 10 listings, none posted on LinkedIn.',
  );
  await expect(page.locator('main')).toContainText(
    'By source: LinkedIn 0 found; JustJoinIT 6 found, 0 kept (6 undated); Indeed 0 found.',
  );
  await expect(page.locator('main')).toContainText(
    'Indeed search for "Software engineer" in Warsaw failed: Unsupported `indeed` search engine.',
  );
});

test('"Search LinkedIn directly" opens LinkedIn with the same filters', async ({ page }) => {
  await page.goto('/job-automation');

  const link = page.getByRole('link', { name: 'Support Specialist · Warsaw' });
  await expect(link).toHaveAttribute('target', '_blank');
  const url = new URL((await link.getAttribute('href'))!);
  expect(url.origin + url.pathname).toBe('https://www.linkedin.com/jobs/search/');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    keywords: 'Support Specialist',
    location: 'Warsaw',
    f_TPR: 'r86400',
    f_WT: '1',
    f_E: '2,3',
    sortBy: 'DD',
  });
  await expect(page.locator('main')).toContainText('Opens LinkedIn with your Date posted (past 24 hours)');
});
