import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: cors });
const normalized = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const validDomain = (s: string) => /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(s) && s.length <= 253;
const blocked = ['linkedin.com', 'indeed.com', 'greenhouse.io', 'lever.co', 'myworkdayjobs.com', 'workday.com', 'facebook.com', 'github.com'];
const isBlocked = (d: string) => blocked.some((b) => d === b || d.endsWith('.' + b));

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const jwt = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return reply({ error: 'Authentication required' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) return reply({ error: 'Service not configured' }, 503);
  const supabase = createClient(url, anon);
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) return reply({ error: 'Unauthorized' }, 401);

  let body: { companyName?: unknown };
  try { body = await request.json(); } catch { return reply({ error: 'Invalid JSON' }, 400); }
  const name = typeof body.companyName === 'string' ? body.companyName.trim() : '';
  if (name.length < 2 || name.length > 100) return reply({ error: 'Invalid company name' }, 400);
  const key = Deno.env.get('LOGO_DEV_SECRET_KEY');
  if (!key) return reply({ domain: null, reason: 'not_configured' }, 200);
  try {
    const target = new URL('https://api.logo.dev/v2/search');
    target.searchParams.set('q', name);
    target.searchParams.set('method', 'match');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    let response: Response;
    try {
      response = await fetch(target, { headers: { Authorization: 'Bearer ' + key }, signal: controller.signal });
    } finally { clearTimeout(timeout); }
    if (!response.ok) return reply({ domain: null, reason: 'provider_unavailable' });
    const payload = await response.json();
    const matches: unknown[] = Array.isArray(payload?.data) ? payload.data : [];
    const exact = matches.filter((m): m is { name: string; domain: string } => {
      if (!m || typeof m !== 'object') return false;
      const item = m as Record<string, unknown>;
      return typeof item.name === 'string' && typeof item.domain === 'string' &&
        normalized(item.name) === normalized(name) && validDomain(item.domain) && !isBlocked(item.domain);
    });
    // Do not guess when distinct domains have the same display name.
    const domains = [...new Set(exact.map((m) => m.domain.toLowerCase()))];
    return reply(domains.length === 1 ? { domain: domains[0], reason: 'exact_match' } : { domain: null, reason: 'ambiguous_or_missing' });
  } catch {
    return reply({ domain: null, reason: 'provider_unavailable' });
  }
});
