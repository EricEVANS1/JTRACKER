# Automatic company logo matching

When a user creates an application with a company name, JTracker can resolve the employer's domain in the background. The Quick Add form remains company, role and status.

## Deployment (required)

1. In Supabase Edge Functions, deploy `resolve-company-logo` from `supabase/functions/resolve-company-logo/index.ts`.
2. In Supabase project Edge Function secrets, set `LOGO_DEV_SECRET_KEY` to the **secret** Logo.dev API key (not the publishable key). Never use a `VITE_` prefix.
3. Keep `VITE_LOGO_DEV_PUBLISHABLE_KEY` in Vercel for CDN images.
4. Confirm Supabase's normal JWT verification is enabled for the Edge Function. Do not make the function publicly callable without authentication.
5. Create an application with an unambiguous employer name, then verify the Companies record gains the correct website and its logo loads. Test ambiguous names and provider failures too.

The function only accepts authenticated calls, validates input, and returns a domain for a unique, exact company-name match. Ambiguous results retain the JTracker fallback; users can correct a website from the Companies page. Lookup failure never blocks application creation.

**Important:** This feature will not become operational until the Supabase function and secret are deployed. The frontend can safely run before deployment; the logo enrichment simply fails open.

**Operational follow-up:** Add per-user rate limiting, server-side result caching, and monitoring before scaling public use. Do not assume Logo.dev search results are authoritative verification of corporate ownership.
