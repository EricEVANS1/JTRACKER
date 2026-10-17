-- JTracker security fixes from the 2026-10-17 audit.
--
-- Run in Supabase dashboard -> SQL Editor, one section at a time:
--   0. PREVIEW  read only. Run first and check the results (see notes below).
--   1. PART 1   database only; the current app keeps working. Safe to run now.
--   2. PART 2   run only AFTER the matching app update is deployed, because it
--               removes the direct table reads the old app version still uses.
--   3. UNDO     puts policies, anon grants and function settings back as they
--               were before PART 1 (uses the snapshot PART 1 saves).
--
-- Not in this file (each needs its own app change first):
--   * making the cv-files bucket private with signed URLs;
--   * dropping unused tables and the backup schema.


-- ============================================================================
-- 0. PREVIEW (read only)
-- ============================================================================

-- 0a. ensure_user_job_preferences runs with owner rights. Check its body: if it
--     only inserts the caller's own user_job_preferences row (and reads
--     job_sources), the optional line at the end of PART 1 is safe to run.
select pg_get_functiondef('public.ensure_user_job_preferences(uuid)'::regprocedure);

-- 0b. Triggers on the tables whose policies change. A trigger that inserts
--     notifications must set actor_user_id and related_shared_opportunity_id,
--     or the new notifications insert rule will block it.
select c.relname as table_name, t.tgname, pg_get_triggerdef(t.oid) as definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal
  and c.relname in ('notifications', 'shared_opportunities', 'profiles');

-- 0c. Job ads with no owner. The job_ads read rule currently shows these to
--     every signed-in user; after PART 1 nobody can read them from the app.
--     The app only ever lists the user's own rows, so expect 0 or unused rows.
select count(*) as job_ads_without_owner from public.job_ads where user_id is null;

-- 0d. Notifications that the new insert rule would have refused (sent to
--     someone else without a matching share). Expect 0; anything else is spam
--     or a code path the rule must allow.
select count(*) as notifications_outside_new_rule
from public.notifications n
where n.actor_user_id is distinct from n.user_id
  and not exists (
    select 1 from public.shared_opportunities s
    where s.id = n.related_shared_opportunity_id
      and s.sender_user_id = n.actor_user_id
      and s.recipient_user_id = n.user_id
  );

-- 0e. CV and avatar files bigger than the new limits, or of other types.
--     Existing files stay; only new uploads are checked.
select bucket_id, count(*) as files,
  count(*) filter (where (metadata->>'size')::bigint > case bucket_id when 'cv-files' then 10485760 else 5242880 end) as over_limit,
  count(*) filter (where bucket_id = 'cv-files' and metadata->>'mimetype' not in (
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document')) as other_cv_types
from storage.objects
where bucket_id in ('cv-files', 'avatars')
group by bucket_id;


-- ============================================================================
-- 1. PART 1: database only, safe with the current app
-- ============================================================================

begin;

-- 1a. Snapshot for UNDO: every policy in public and storage, anon's write
--     grants, and the two storage buckets' limits.
create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;

create table backup.policies_20261017 as
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage');

create table backup.anon_grants_20261017 as
select c.relname as table_name, p.privilege
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(privilege)
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and has_table_privilege('anon', c.oid, p.privilege);

create table backup.buckets_20261017 as
select id, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('cv-files', 'avatars');

alter table backup.policies_20261017 enable row level security;
alter table backup.anon_grants_20261017 enable row level security;
alter table backup.buckets_20261017 enable row level security;

-- 1b. job_sources has RLS on and no policies, so the Job Automation page gets
--     an empty sources list. Signed-in users may read it; writes stay
--     server-only.
create policy "Signed-in users can read job sources"
  on public.job_sources
  for select
  to authenticated
  using (true);

-- 1c. Policies written "to public" also apply to signed-out visitors (anon).
--     Every such policy that checks auth.uid() can never match for anon, so
--     switching it to authenticated changes nothing for the app and removes
--     anon from the picture.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and roles = array['public']::name[]
      and (coalesce(qual, '') like '%auth.uid()%' or coalesce(with_check, '') like '%auth.uid()%')
  loop
    execute format('alter policy %I on %I.%I to authenticated', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- 1d. Signed-out visitors never write to any table. Remove anon's write
--     grants (reads stay: the public share page still needs one until PART 2),
--     including for tables created later by this role.
do $$
declare
  t record;
begin
  for t in select distinct table_name from backup.anon_grants_20261017 loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon', t.table_name);
  end loop;
end $$;

alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon;

-- 1e. job_ads: the read rule also shows rows with no owner to every user. The
--     app only lists the user's own job ads (server functions use the
--     service role and are unaffected).
do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'job_ads'
      and cmd = 'SELECT' and qual ilike '%user_id IS NULL%'
  loop
    execute format('alter policy %I on public.job_ads using (auth.uid() = user_id)', p.policyname);
  end loop;
end $$;

-- 1f. notifications: the insert rule lets any user put a notification in
--     anyone's inbox by naming themselves as the actor. Allow a user to notify
--     themselves, or the recipient of a share they actually sent.
do $$
declare
  p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'notifications' and cmd = 'INSERT'
  loop
    execute format('drop policy %I on public.notifications', p.policyname);
  end loop;
end $$;

create policy "Users can notify themselves or their share recipients"
  on public.notifications
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    or (
      auth.uid() = actor_user_id
      and exists (
        select 1
        from public.shared_opportunities s
        where s.id = related_shared_opportunity_id
          and s.sender_user_id = auth.uid()
          and s.recipient_user_id = notifications.user_id
      )
    )
  );

-- 1g. shared_opportunities: recipients may currently edit a share sent to them
--     (its role, notes or sender). The app never updates shares, so remove the
--     update rule; senders keep insert/delete, both sides keep read.
do $$
declare
  p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'shared_opportunities' and cmd = 'UPDATE'
  loop
    execute format('drop policy %I on public.shared_opportunities', p.policyname);
  end loop;
end $$;

-- 1h. Lookup functions for PART 2, so the app update can switch to them
--     before the broad read rules are removed.

-- Find one user by exact email, for internal sharing. Returns only id, name
-- and email, and needs a signed-in caller. No wildcards, so the user list
-- can't be browsed.
create or replace function public.find_user_by_email(lookup_email text)
returns table (id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.email
  from public.profiles p
  where auth.uid() is not null
    and lower(p.email) = lower(trim(lookup_email))
  limit 1
$$;

revoke all on function public.find_user_by_email(text) from public, anon;
grant execute on function public.find_user_by_email(text) to authenticated;

-- Read one public share by its link id, returning only what the public share
-- page shows (no sender, recipient or application ids). Shares can no longer
-- be listed.
create or replace function public.get_public_share(share_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'public_share_id', s.public_share_id,
    'role_title', s.role_title,
    'company_name', s.company_name,
    'location', s.location,
    'job_link', s.job_link,
    'note', s.note,
    'include_status', s.include_status,
    'include_notes', s.include_notes,
    'include_experience', s.include_experience,
    'status_snapshot', s.status_snapshot,
    'notes_snapshot', s.notes_snapshot,
    'experience_snapshot', s.experience_snapshot,
    'created_at', s.created_at
  )
  from public.shared_opportunities s
  where share_id is not null
    and length(share_id) >= 8
    and s.public_share_id::text = share_id
  limit 1
$$;

revoke all on function public.get_public_share(text) from public;
grant execute on function public.get_public_share(text) to anon, authenticated;

-- 1i. Functions that run with owner rights: signed-out visitors don't need
--     them, and handle_new_user only ever runs as the sign-up trigger
--     (triggers don't need EXECUTE).
revoke execute on function public.ensure_user_job_preferences(uuid) from public, anon;
grant execute on function public.ensure_user_job_preferences(uuid) to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Optional, only if 0a shows the body touches nothing but the caller's
-- user_job_preferences row (and reads job_sources): run it with the caller's
-- rights, so RLS stops a user creating preferences for someone else.
-- alter function public.ensure_user_job_preferences(uuid) security invoker;

-- 1j. Storage. The cv-files upload rule only checks the bucket, so a user can
--     upload into another user's folder. Require the caller's own folder (the
--     app already uploads to <user id>/...), and match the app's limits:
--     10 MB PDF/DOC/DOCX for CVs, 5 MB images for avatars.
do $$
declare
  p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd = 'INSERT'
      and with_check like '%cv-files%'
      and with_check not like '%auth.uid()%'
  loop
    execute format(
      'alter policy %I on storage.objects with check (bucket_id = %L and (storage.foldername(name))[1] = (auth.uid())::text)',
      p.policyname, 'cv-files'
    );
  end loop;
end $$;

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
where id = 'cv-files';

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/*']
where id = 'avatars';

commit;


-- ============================================================================
-- 2. PART 2: only after the app update is live
-- ============================================================================
-- The app update makes sharing use find_user_by_email and the public share
-- page use get_public_share. Before it is deployed, these drops would break
-- "share with a JTracker user" and public share links.

-- begin;
--
-- -- Any signed-in user can currently read every user's name and email.
-- -- Users keep reading and editing their own profile.
-- drop policy "Profiles are viewable by authenticated users" on public.profiles;
--
-- -- Anyone, signed in or not, can currently list every public share with its
-- -- notes and status. Links keep working through get_public_share.
-- drop policy "Anyone can view public shared opportunities" on public.shared_opportunities;
-- revoke select on public.shared_opportunities from anon;
--
-- commit;


-- ============================================================================
-- 3. UNDO (run only if PART 1 or PART 2 must be rolled back)
-- ============================================================================

-- begin;
--
-- -- Put every public and storage policy back exactly as snapshotted.
-- do $$
-- declare
--   p record;
-- begin
--   for p in
--     select schemaname, tablename, policyname from pg_policies
--     where schemaname in ('public', 'storage')
--   loop
--     execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
--   end loop;
--
--   for p in select * from backup.policies_20261017 loop
--     execute format(
--       'create policy %I on %I.%I as %s for %s to %s%s%s',
--       p.policyname, p.schemaname, p.tablename, p.permissive, p.cmd,
--       (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ')
--        from unnest(p.roles) as r),
--       case when p.qual is not null then ' using (' || p.qual || ')' else '' end,
--       case when p.with_check is not null then ' with check (' || p.with_check || ')' else '' end
--     );
--   end loop;
--
--   for p in select * from backup.anon_grants_20261017 loop
--     execute format('grant %s on public.%I to anon', p.privilege, p.table_name);
--   end loop;
-- end $$;
--
-- grant select on public.shared_opportunities to anon;
-- alter default privileges in schema public grant insert, update, delete, truncate on tables to anon;
--
-- update storage.buckets b
-- set file_size_limit = s.file_size_limit, allowed_mime_types = s.allowed_mime_types
-- from backup.buckets_20261017 s
-- where b.id = s.id;
--
-- grant execute on function public.ensure_user_job_preferences(uuid) to public, anon;
-- grant execute on function public.handle_new_user() to public, anon, authenticated;
-- alter function public.ensure_user_job_preferences(uuid) security definer;
--
-- -- Only once the app no longer calls them (i.e. after rolling the app back too).
-- -- drop function public.find_user_by_email(text);
-- -- drop function public.get_public_share(text);
--
-- commit;
