import { describe, expect, it } from 'vitest';

import { getMissingConfig, isGmailConfigured, isOutlookConfigured } from './config';

describe('getMissingConfig', () => {
  it('lists required settings that are absent or blank', () => {
    expect(getMissingConfig({})).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);
    expect(getMissingConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: '  ' })).toEqual([
      'VITE_SUPABASE_ANON_KEY',
    ]);
    expect(getMissingConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'key' })).toEqual([]);
  });

  it('does not require the optional email sync settings', () => {
    expect(getMissingConfig({ VITE_SUPABASE_URL: 'u', VITE_SUPABASE_ANON_KEY: 'k' })).toEqual([]);
  });
});

describe('email provider settings', () => {
  it('reports Gmail and Outlook as configured only with a client ID', () => {
    expect(isGmailConfigured({ VITE_GOOGLE_CLIENT_ID: 'abc.apps.googleusercontent.com' })).toBe(true);
    expect(isGmailConfigured({ VITE_GOOGLE_CLIENT_ID: '' })).toBe(false);
    expect(isGmailConfigured({})).toBe(false);
    expect(isOutlookConfigured({ VITE_AZURE_CLIENT_ID: 'guid' })).toBe(true);
    expect(isOutlookConfigured({ VITE_AZURE_CLIENT_ID: ' ' })).toBe(false);
  });
});
