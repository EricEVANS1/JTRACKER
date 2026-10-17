-- JTracker security audit — READ ONLY. Changes nothing.
--
-- Run in Supabase dashboard -> SQL Editor, then copy the result grid (or
-- "Export -> CSV") and share it for review. It returns one table of findings:
--   severity   CRITICAL / HIGH / CHECK / INFO
--   check_name what was checked
--   object     table, policy, bucket or function
--   detail     why it matters, with the current definition
--
-- Expected access per table (from how the app uses it):
--   own          each user reads and writes only rows where user_id = auth.uid()
--   cross_user   shared between users; needs narrower, hand-written policies
--   shared_read  read-only reference data for signed-in users
--   server_only  written by server functions; no direct client writes

with app_tables(table_name, access) as (
  values
    ('applications', 'own'),
    ('application_events', 'own'),
    ('companies', 'own'),
    ('cv_versions', 'own'),
    ('cv_analyses', 'own'),
    ('email_events', 'own'),
    ('email_sync_sessions', 'own'),
    ('ignored_email_events', 'own'),
    ('interview_notes', 'own'),
    ('job_ads', 'own'),
    ('job_match_results', 'own'),
    ('job_search_runs', 'own'),
    ('recruiters', 'own'),
    ('recruiter_interactions', 'own'),
    ('resume_improvement_feedback', 'own'),
    ('user_job_preferences', 'own'),
    ('user_settings', 'own'),
    ('profiles', 'cross_user'),
    ('notifications', 'cross_user'),
    ('shared_opportunities', 'cross_user'),
    ('job_sources', 'shared_read'),
    ('cv_scoring_patterns', 'server_only')
),
tables as (
  select
    c.oid,
    n.nspname as schema_name,
    c.relname as table_name,
    n.nspname || '.' || c.relname as qualified,
    c.relrowsecurity as rls_enabled,
    (select count(*) from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname) as policy_count,
    coalesce(a.access, case when n.nspname = 'backup' then 'backup' else 'unknown' end) as access
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join app_tables a on a.table_name = c.relname and n.nspname = 'public'
  where c.relkind in ('r', 'p')
    and n.nspname in ('public', 'backup')
),
findings(severity, check_name, object, detail) as (
  -- 1. Tables with Row Level Security switched off.
  select
    'CRITICAL',
    'RLS disabled',
    t.qualified,
    'Anyone with the public anon key can use this table through the API, limited only by grants. '
      || 'anon can select: ' || has_table_privilege('anon', t.oid, 'SELECT')
      || ', insert: ' || has_table_privilege('anon', t.oid, 'INSERT')
      || '; authenticated can select: ' || has_table_privilege('authenticated', t.oid, 'SELECT')
      || '. Expected access: ' || t.access
  from tables t
  where not t.rls_enabled

  union all

  -- 2. RLS on but no policies: clients are locked out (fine for server-only).
  select
    case when t.access in ('server_only', 'backup') then 'INFO' else 'CHECK' end,
    'RLS on, no policies',
    t.qualified,
    'All client access is denied. Expected access: ' || t.access
      || case when t.access in ('server_only', 'backup') then ' (this is correct)' else ' (the app reads or writes this table, so it may be broken)' end
  from tables t
  where t.rls_enabled and t.policy_count = 0

  union all

  -- 3. Policies that let everyone in (expected only for reading shared reference data).
  select
    case
      when p.cmd = 'SELECT' and p.schemaname = 'public'
        and exists (select 1 from app_tables a where a.table_name = p.tablename and a.access = 'shared_read')
        then 'INFO'
      when p.roles && array['anon', 'public']::name[] then 'CRITICAL'
      else 'HIGH'
    end,
    'Policy allows every row',
    p.schemaname || '.' || p.tablename || ' :: ' || p.policyname,
    p.cmd || ' for ' || array_to_string(p.roles, ', ')
      || ' using (' || coalesce(p.qual, 'none') || ') with check (' || coalesce(p.with_check, 'none') || ')'
  from pg_policies p
  where p.schemaname in ('public', 'backup', 'storage')
    and (
      lower(coalesce(p.qual, '')) in ('true', '(true)')
      or (p.cmd in ('INSERT', 'ALL') and lower(coalesce(p.with_check, p.qual, 'true')) in ('true', '(true)'))
    )

  union all

  -- 4. Every policy, for review against the expected access above.
  select
    'INFO',
    'Policy',
    p.schemaname || '.' || p.tablename || ' :: ' || p.policyname,
    coalesce((select access from app_tables a where a.table_name = p.tablename and p.schemaname = 'public'), 'n/a')
      || ' | ' || p.cmd || ' to ' || array_to_string(p.roles, ', ')
      || ' | ' || case when p.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end
      || ' | using (' || coalesce(p.qual, 'none') || ') with check (' || coalesce(p.with_check, 'none') || ')'
  from pg_policies p
  where p.schemaname in ('public', 'backup', 'storage')

  union all

  -- 5. Tables the app uses that don't exist.
  select
    'CHECK',
    'Table used by app is missing',
    'public.' || a.table_name,
    'The app queries this table but it was not found.'
  from app_tables a
  where not exists (select 1 from tables t where t.schema_name = 'public' and t.table_name = a.table_name)

  union all

  -- 6. Tables the app doesn't use (may be old or exposed by accident).
  select
    'CHECK',
    'Table not used by app',
    t.qualified,
    'RLS ' || case when t.rls_enabled then 'on' else 'OFF' end || ', ' || t.policy_count || ' policies. Confirm it is still needed.'
  from tables t
  where t.access = 'unknown'

  union all

  -- 7. Anonymous write access granted at the table level.
  select
    'HIGH',
    'anon has write grants',
    t.qualified,
    'anon can insert: ' || has_table_privilege('anon', t.oid, 'INSERT')
      || ', update: ' || has_table_privilege('anon', t.oid, 'UPDATE')
      || ', delete: ' || has_table_privilege('anon', t.oid, 'DELETE')
      || '. Only RLS policies stand between signed-out visitors and this table.'
  from tables t
  where (has_table_privilege('anon', t.oid, 'INSERT')
      or has_table_privilege('anon', t.oid, 'UPDATE')
      or has_table_privilege('anon', t.oid, 'DELETE'))
    and t.access <> 'backup'
    and exists (
      select 1 from pg_policies p
      where p.schemaname = t.schema_name and p.tablename = t.table_name
        and p.roles && array['anon', 'public']::name[]
        and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    )

  union all

  -- 8. Views run with their owner's rights, which skips RLS unless security_invoker is set.
  select
    'HIGH',
    'View bypasses RLS',
    n.nspname || '.' || c.relname,
    'Set security_invoker = true so the caller''s RLS applies, or revoke access from anon/authenticated. '
      || 'authenticated can select: ' || has_table_privilege('authenticated', c.oid, 'SELECT')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('v', 'm')
    and n.nspname = 'public'
    and not coalesce(c.reloptions::text[] && array['security_invoker=true', 'security_invoker=on'], false)

  union all

  -- 9. SECURITY DEFINER functions run with elevated rights.
  select
    case when p.proconfig is null or not exists (
      select 1 from unnest(p.proconfig) setting where setting like 'search_path=%'
    ) then 'HIGH' else 'CHECK' end,
    'SECURITY DEFINER function',
    n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    'Runs as its owner, bypassing RLS. search_path: '
      || coalesce((select setting from unnest(p.proconfig) setting where setting like 'search_path=%'), 'NOT SET')
      || '; anon can execute: ' || has_function_privilege('anon', p.oid, 'EXECUTE')
      || '; authenticated can execute: ' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
      || '. It must check auth.uid() itself.'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef

  union all

  -- 10. Storage buckets.
  select
    case when b.public and b.id = 'cv-files' then 'HIGH' when b.public then 'CHECK' else 'INFO' end,
    'Storage bucket',
    'storage.buckets :: ' || b.id,
    case when b.public
      then 'PUBLIC: anyone with a file''s link can download it without signing in.'
      else 'Private: access goes through storage policies.'
    end
      || ' Size limit: ' || coalesce(b.file_size_limit::text, 'none')
      || ', allowed types: ' || coalesce(array_to_string(b.allowed_mime_types, ', '), 'any')
  from storage.buckets b

  union all

  -- 11. The backup schema from the lifecycle cleanup.
  select
    case when has_schema_privilege('anon', n.oid, 'USAGE') or has_schema_privilege('authenticated', n.oid, 'USAGE')
      then 'HIGH' else 'INFO' end,
    'backup schema',
    n.nspname,
    'anon usage: ' || has_schema_privilege('anon', n.oid, 'USAGE')
      || ', authenticated usage: ' || has_schema_privilege('authenticated', n.oid, 'USAGE')
      || ', tables: ' || (select count(*) from pg_class c where c.relnamespace = n.oid and c.relkind = 'r')
      || '. Drop backup.applications_20261017 once the cleanup is confirmed.'
  from pg_namespace n
  where n.nspname = 'backup'
)
select severity, check_name, object, detail
from findings
order by
  case severity when 'CRITICAL' then 1 when 'HIGH' then 2 when 'CHECK' then 3 else 4 end,
  check_name,
  object;
