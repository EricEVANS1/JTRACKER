// Build-time settings (Vite env variables) the app depends on. Variable names
// are not secret: their values are compiled into the public bundle.

type Env = Record<string, string | boolean | undefined>;

const isSet = (value: unknown) => typeof value === 'string' && value.trim() !== '';

// Without these the app cannot talk to its database or sign anyone in.
export const REQUIRED_CONFIG = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const;

export const getMissingConfig = (env: Env = import.meta.env) =>
  REQUIRED_CONFIG.filter((key) => !isSet(env[key]));

// Optional: only Gmail and Outlook email sync need these.
export const isGmailConfigured = (env: Env = import.meta.env) => isSet(env.VITE_GOOGLE_CLIENT_ID);

export const isOutlookConfigured = (env: Env = import.meta.env) => isSet(env.VITE_AZURE_CLIENT_ID);
