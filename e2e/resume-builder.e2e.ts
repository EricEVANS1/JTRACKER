import type { Page } from '@playwright/test';

import { expect, test, USER_ID, type MockSupabase } from './support/mockSupabase';

const CV_TEXT = [
  'Alice Example',
  'Data Analyst',
  'alice@example.com',
  '',
  'PROFESSIONAL SUMMARY',
  'Analyst with 5 years of SQL and Python experience.',
  '',
  'EXPERIENCE',
  'Analyst | Acme | 2020 - Present',
  '- Built dashboards in Power BI',
  '',
  'SKILLS',
  'SQL, Python, Power BI',
].join('\n');

const EDITED_SUMMARY = 'Analyst with 5 years of SQL and Python. EDITED SUMMARY.';

const seed = (supabase: MockSupabase) => {
  supabase.seed('cv_versions', [
    {
      id: 'v1',
      user_id: USER_ID,
      name: 'Data Analyst — Builder',
      target_role: 'Data Analyst',
      cv_text: CV_TEXT,
      structured_cv: { source: 'resume_builder', source_analysis_id: 'an-orig', source_cv_version_id: 'up-orig', company_name: 'Acme' },
      last_score: 77,
      source_analysis_id: 'an-orig',
      parent_cv_version_id: 'up-orig',
    },
    { id: 'u1', user_id: USER_ID, name: 'My uploaded CV', target_role: 'Data Analyst', cv_text: CV_TEXT, structured_cv: null },
  ]);
  supabase.seed('cv_analyses', [
    {
      id: 'a1',
      user_id: USER_ID,
      cv_version_id: 'u1',
      job_title: 'Data Analyst',
      company_name: 'Globex',
      job_description: 'jd',
      generated_cv: CV_TEXT,
      score: 81,
      matched_keywords: ['SQL'],
      partial_keywords: [],
      missing_keywords: [],
    },
  ]);
};

test.beforeEach(({ supabase }) => seed(supabase));

const openBuilder = async (page: Page, path: string) => {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Resume Builder' })).toBeVisible();
};

const saveButton = (page: Page) => page.getByRole('button', { name: /^(Save changes|Save to CV Manager)$/ });

const editSummary = async (page: Page, text: string) => {
  const index = await page.evaluate(() =>
    [...document.querySelectorAll('textarea')].findIndex((t) => t.value.includes('years of SQL')),
  );
  await page.locator('textarea').nth(index).fill(text);
};

const pageHasText = (page: Page, text: string) =>
  page.evaluate((t) => [...document.querySelectorAll('input, textarea')].some((e) => (e as HTMLInputElement).value.includes(t)), text);

const draftKeys = (page: Page) =>
  page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('jtracker_resume_draft:')));

test.describe('saving', () => {
  test('Save updates the version being edited; "Save as new" makes a copy', async ({ page, supabase }) => {
    await openBuilder(page, '/resume-builder/saved/v1');
    await expect(page.getByText('Editing Data Analyst — Builder')).toBeVisible();
    await expect(saveButton(page)).toHaveText('Save changes');

    await saveButton(page).click();
    await expect(page.getByText('Saved changes to "Data Analyst — Builder".')).toBeVisible();

    const [update] = supabase.writes('cv_versions');
    expect(update.method).toBe('PATCH');
    expect(update.query).toContain('id=eq.v1');
    expect(update.query).toContain(`user_id=eq.${USER_ID}`);
    expect(update.body).toMatchObject({
      structured_cv: { source_analysis_id: 'an-orig', source_cv_version_id: 'up-orig', company_name: 'Acme' },
    });
    expect(update.body).not.toHaveProperty('last_score');
    expect(update.body).not.toHaveProperty('name');

    await page.getByRole('button', { name: 'Save as new' }).click();
    await expect(page.getByText('Saved as a new CV version in CV Manager.')).toBeVisible();
    const copy = supabase.tables.cv_versions.at(-1)!;
    expect(copy).toMatchObject({ parent_cv_version_id: 'up-orig', source_analysis_id: 'an-orig' });

    await saveButton(page).click();
    await expect.poll(() => supabase.writes('cv_versions').length).toBe(3);
    expect(supabase.writes('cv_versions')[2]).toMatchObject({ method: 'PATCH', query: expect.stringContaining(`id=eq.${copy.id}`) });
  });

  test('an uploaded CV is never overwritten: the first save makes a copy', async ({ page, supabase }) => {
    await openBuilder(page, '/resume-builder/saved/u1');
    await expect(saveButton(page)).toHaveText('Save to CV Manager');
    await expect(page.getByRole('button', { name: 'Save as new' })).toHaveCount(0);

    await saveButton(page).click();
    await expect(saveButton(page)).toHaveText('Save changes');
    await saveButton(page).click();
    await expect.poll(() => supabase.writes('cv_versions').map((w) => w.method)).toEqual(['POST', 'PATCH']);
    expect(supabase.writes('cv_versions').some((w) => w.query.includes('id=eq.u1'))).toBe(false);
  });

  test('a version deleted elsewhere is reported, not silently recreated', async ({ page, supabase }) => {
    await openBuilder(page, '/resume-builder/saved/v1');
    supabase.tables.cv_versions = supabase.tables.cv_versions.filter((row) => row.id !== 'v1');

    await saveButton(page).click();
    await expect(page.getByText('This CV version no longer exists in CV Manager.', { exact: false })).toBeVisible();
    expect(supabase.writes('cv_versions').map((w) => w.method)).toEqual(['PATCH']);
    // The error is shown inside the editor, which stays open with "Save as new".
    await expect(page.getByRole('button', { name: 'Save as new' })).toBeVisible();
    await expect(page.getByText('Resume Builder Error')).toHaveCount(0);
  });
});

test.describe('unsaved changes', () => {
  test('warns before leaving, keeps a tab draft, and restores it after reload', async ({ page, supabase }) => {
    const dialogs: string[] = [];
    let answer = false;
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.type());
      await (answer ? dialog.accept() : dialog.dismiss());
    });

    await openBuilder(page, '/resume-builder/saved/v1');
    await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0);

    await editSummary(page, EDITED_SUMMARY);
    await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
    expect(await draftKeys(page)).toEqual([`jtracker_resume_draft:${USER_ID}:saved:v1`]);
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('jtracker_resume_draft')))).toBe(false);

    await page.getByRole('link', { name: /Dashboard/ }).first().click();
    expect(dialogs).toEqual(['confirm']);
    await expect(page).toHaveURL(/\/resume-builder\/saved\/v1$/);

    answer = true;
    await page.reload();
    expect(dialogs).toContain('beforeunload');
    await expect(page.getByRole('button', { name: 'Restore changes' })).toBeVisible();
    expect(await pageHasText(page, 'EDITED SUMMARY')).toBe(false);

    await page.getByRole('button', { name: 'Restore changes' }).click();
    expect(await pageHasText(page, 'EDITED SUMMARY')).toBe(true);

    await saveButton(page).click();
    await expect(page.getByText(/Saved changes to/)).toBeVisible();
    const update = supabase.writes('cv_versions').at(-1)!;
    expect(JSON.stringify(update.body)).toContain('EDITED SUMMARY');
    await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
    expect(await draftKeys(page)).toEqual([]);
  });

  test('Discard drops the draft and keeps the saved content', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());

    await openBuilder(page, '/resume-builder/saved/v1');
    await editSummary(page, EDITED_SUMMARY);
    await openBuilder(page, '/resume-builder/saved/v1');

    await page.getByRole('button', { name: 'Discard' }).click();
    expect(await draftKeys(page)).toEqual([]);
    expect(await pageHasText(page, 'EDITED SUMMARY')).toBe(false);

    await openBuilder(page, '/resume-builder/saved/v1');
    await expect(page.getByRole('button', { name: 'Restore changes' })).toHaveCount(0);
  });
});

test.describe('hand-off from the Flow page', () => {
  const handoff = {
    source: 'resume_builder_flow',
    analysisId: null,
    cvVersionId: 'u1',
    jobTitle: 'BI Analyst',
    companyName: 'Globex',
    score: 74,
    generatedCv: CV_TEXT.replace('Data Analyst', 'BI Analyst'),
    matchedKeywords: ['SQL'],
    missingKeywords: ['Tableau'],
    recommendations: [],
    jobDescription: 'SECRET-JOB-DESCRIPTION Senior analyst role at Globex',
    importedAt: new Date().toISOString(),
  };

  test('is passed in memory, never written to browser storage, and not re-imported on reload', async ({ page, supabase }) => {
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('/dashboard');
    await expect(page.locator('main')).toBeVisible();

    // Same navigation state the Flow page's "Use in Resume Builder" sends.
    await page.evaluate((payload) => {
      window.history.pushState({ usr: { resumeBuilderImport: payload }, key: 'flow', idx: 1 }, '', '/resume-builder/editor');
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    }, handoff);

    await expect(page.getByText('Imported tailored CV draft').first()).toBeVisible();
    expect(await pageHasText(page, 'BI Analyst')).toBe(true);
    await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.history.state?.usr ?? null)).toBeNull();

    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain('SECRET-JOB-DESCRIPTION');
    expect(stored).not.toContain('jtracker_resume_builder_import');

    await page.reload();
    await expect(page.getByRole('button', { name: 'Restore changes' })).toBeVisible();
    await expect(page.getByText('Imported tailored CV draft')).toHaveCount(0);
    await page.getByRole('button', { name: 'Restore changes' }).click();

    await saveButton(page).click();
    await expect(page.getByText('Saved as a new CV version in CV Manager.')).toBeVisible();
    expect(supabase.writes('cv_versions').map((w) => w.method)).toEqual(['POST']);
  });

  test('copies left in browser storage by older versions are removed, not imported', async ({ page, context }) => {
    await context.addInitScript((payload) => {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('jtracker_resume_builder_import', JSON.stringify(payload));
      sessionStorage.setItem('jtracker_resume_builder_import', JSON.stringify(payload));
    }, handoff);

    await openBuilder(page, '/resume-builder/editor');
    expect(
      await page.evaluate(() => [localStorage, sessionStorage].map((s) => s.getItem('jtracker_resume_builder_import'))),
    ).toEqual([null, null]);
    expect(await pageHasText(page, 'BI Analyst')).toBe(false);
  });
});

test.describe('exports', () => {
  test('a failed PDF export shows an in-page error instead of a pop-up, and trying again works', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });

    await openBuilder(page, '/resume-builder/saved/v1');

    // Make saving the file fail once (the export tools themselves are already
    // loaded with the app, so this is how a failure can be produced here).
    await page.evaluate(() => {
      const original = URL.createObjectURL;
      URL.createObjectURL = () => {
        URL.createObjectURL = original;
        throw new Error('simulated failure');
      };
    });

    await page.getByRole('button', { name: 'PDF', exact: true }).click();
    await expect(page.getByText("The PDF file couldn't be created. Please try again.")).toBeVisible();
    expect(dialogs).toEqual([]);
    // The editor stays open.
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'PDF', exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
    await expect(page.getByText("The PDF file couldn't be created.")).toHaveCount(0);
  });

  test('DOCX export downloads a file', async ({ page }) => {
    await openBuilder(page, '/resume-builder/saved/v1');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'ATS DOCX' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.docx$/);
  });
});

test('a CV that cannot be loaded still shows the full-page error', async ({ page }) => {
  await page.goto('/resume-builder/saved/does-not-exist');
  await expect(page.getByText('Resume Builder Error')).toBeVisible();
  await expect(page.getByText('Saved builder CV was not found.')).toBeVisible();
});
