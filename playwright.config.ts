import { defineConfig } from '@playwright/test';

// Browser tests run the real app (Vite dev server) against an in-memory mock
// of the Supabase API (e2e/support/mockSupabase.ts); no real project or keys.
// Three servers cover the normal app and two missing-configuration cases.

const SUPABASE = {
  VITE_SUPABASE_URL: 'http://mock.supabase.test',
  VITE_SUPABASE_ANON_KEY: 'e2e-anon-key',
};
const EMAIL_OAUTH = {
  VITE_GOOGLE_CLIENT_ID: 'e2e-google-client-id',
  VITE_AZURE_CLIENT_ID: 'e2e-azure-client-id',
};

const servers = {
  app: { port: 5199, env: { ...SUPABASE, ...EMAIL_OAUTH } },
  noEmailOauth: { port: 5198, env: { ...SUPABASE, VITE_GOOGLE_CLIENT_ID: '', VITE_AZURE_CLIENT_ID: '' } },
  notConfigured: { port: 5197, env: { ...EMAIL_OAUTH, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' } },
};

const url = (port: number) => `http://localhost:${port}`;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'app',
      testIgnore: ['**/email-setup.e2e.ts', '**/not-configured.e2e.ts'],
      use: { baseURL: url(servers.app.port) },
    },
    {
      name: 'no-email-oauth',
      testMatch: '**/email-setup.e2e.ts',
      use: { baseURL: url(servers.noEmailOauth.port) },
    },
    {
      name: 'not-configured',
      testMatch: '**/not-configured.e2e.ts',
      use: { baseURL: url(servers.notConfigured.port) },
    },
  ],
  webServer: Object.values(servers).map(({ port, env }) => ({
    command: `npx vite --port ${port} --strictPort`,
    url: url(port),
    env,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  })),
});
