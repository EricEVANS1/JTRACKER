import { daysFromNow, expect, test, USER_ID } from './support/mockSupabase';

const icon = (size: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#2563eb"/></svg>`;

const application = (id: string, role_title: string, company: { name: string; website?: string | null }) => ({
  id,
  user_id: USER_ID,
  role_title,
  status: 'applied',
  archived: false,
  priority: 'medium',
  created_at: daysFromNow(-Number(id.slice(1))),
  date_applied: daysFromNow(-10),
  company_id: `c-${id}`,
  companies: { id: `c-${id}`, ...company },
});

test.beforeEach(async ({ supabase, page }) => {
  supabase.seed('applications', [
    application('a1', 'Support Engineer', { name: 'Acme', website: 'https://www.acme.test/careers' }),
    application('a2', 'Service Desk Analyst', { name: 'Globex', website: 'globex.test' }),
    application('a3', 'IT Technician', { name: 'Initech', website: 'https://www.linkedin.com/company/initech' }),
    application('a4', 'Helpdesk Agent', { name: 'Umbrella', website: null }),
    application('a5', 'Desktop Support', { name: 'Hooli', website: 'hooli.test' }),
  ]);

  // Acme publishes a proper touch icon; Globex has none; Hooli's is 16px. The
  // .test domains never resolve, so nothing reaches the internet. (Chromium
  // doesn't let Playwright see /favicon.ico requests; those simply fail here.)
  const logoRequests: string[] = [];
  page.on('request', (request) => {
    if (/linkedin\.com|^https:\/\/(acme|globex|hooli)\.test\//.test(request.url())) logoRequests.push(request.url());
  });
  await page.route(/^https:\/\/(acme|globex|hooli)\.test\//, (route) => {
    const url = route.request().url();
    if (url === 'https://acme.test/apple-touch-icon.png') {
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: icon(180) });
    }
    if (url === 'https://hooli.test/apple-touch-icon.png') {
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: icon(16) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  (page as unknown as { logoRequests: string[] }).logoRequests = logoRequests;
});

const requests = (page: import('@playwright/test').Page) => (page as unknown as { logoRequests: string[] }).logoRequests;

test("application cards show the company's own logo, and the usual tile otherwise", async ({ page }) => {
  await page.goto('/applications');
  await expect(page.locator('main')).toContainText('Support Engineer');

  // Acme: the logo appears once it has loaded.
  const acme = page.locator('img[data-company-logo="acme.test"]');
  await expect(acme).toHaveAttribute('src', 'https://acme.test/apple-touch-icon.png');
  await expect(acme).toHaveCSS('opacity', '1');
  await expect(acme).toHaveAttribute('referrerpolicy', 'no-referrer');

  // Globex (no icons) and Hooli (icon too small to be sharp) keep the tile.
  await expect(page.locator('img[data-company-logo="globex.test"]')).toHaveCount(0);
  await expect(page.locator('img[data-company-logo="hooli.test"]')).toHaveCount(0);

  expect(requests(page).filter((url) => url.startsWith('https://globex.test/'))).toEqual([
    'https://globex.test/apple-touch-icon.png',
  ]);

  // A LinkedIn page or no website says nothing reliable about the logo: nothing is requested.
  expect(requests(page).some((url) => url.includes('linkedin.com'))).toBe(false);

  // Every card still has its tile; only Acme's is covered by a logo.
  await expect(page.locator('main img[data-company-logo]')).toHaveCount(1);
});

test('Kanban cards show the logo too', async ({ page }) => {
  await page.goto('/kanban');
  await expect(page.locator('img[data-company-logo="acme.test"]')).toHaveCSS('opacity', '1');
  await expect(page.locator('main img[data-company-logo]')).toHaveCount(1);
});
