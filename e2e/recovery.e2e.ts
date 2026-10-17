import type { BrowserContext } from '@playwright/test';

import { expect, test } from './support/mockSupabase';

// Replaces one source module served by the Vite dev server with one whose
// component throws while rendering.
const crashModule = (context: BrowserContext, file: string, exportName: string) =>
  context.route(new RegExp(`/src/${file}(\\?.*)?$`), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: `export const ${exportName} = () => { throw new Error('Simulated crash in ${exportName}'); };`,
    }),
  );

test('a crashing page shows an error card, keeps the sidebar, and recovers on navigation', async ({ page, context }) => {
  await crashModule(context, 'pages/KanbanPage.tsx', 'KanbanPage');
  await page.goto('/kanban');

  const main = page.locator('main');
  await expect(main).toContainText('This page ran into a problem');
  await expect(page.getByRole('link', { name: /Dashboard/ }).first()).toBeVisible();

  await page.getByRole('link', { name: /Dashboard/ }).first().click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(main).not.toContainText('ran into a problem');
});

test('a crash outside a page shows the app-level recovery screen', async ({ page, context }) => {
  await crashModule(context, 'components/AppLayout.tsx', 'AppLayout');
  await page.goto('/dashboard');

  await expect(page.getByText('JTracker ran into a problem')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to dashboard' })).toBeVisible();
});

test('if the app code fails to load, a reload screen is shown', async ({ page, context }) => {
  await context.route(/\/src\/App\.tsx(\?.*)?$/, (route) => route.fulfill({ status: 500, body: 'unavailable' }));
  await page.goto('/dashboard');

  await expect(page.getByText('JTracker could not start')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
});

test('email sync connect buttons are enabled when both client IDs are set', async ({ page }) => {
  await page.goto('/email-sync');

  await expect(page.getByRole('button', { name: 'Connect Gmail' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Connect Outlook' })).toBeEnabled();
  await expect(page.locator('main')).not.toContainText('is not set up for this site');
});
