-- Job ads: make "one row per job link" apply per user, not across all users.
--
-- job_ads_job_url_key makes job_url unique across the whole table, so once
-- any user has saved a posting, no other user can save the same posting
-- (their search skips it). Every job ad belongs to one user (user_id, own-row
-- RLS), so the rule should be one row per user per link.
--
-- The job-pipeline function already copes with either rule; this only lets
-- every user keep the jobs their own searches find.
--
-- 1. PREVIEW (read only): the current unique rules on job_ads.
select conname as rule, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.job_ads'::regclass and contype = 'u'
union all
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'job_ads' and indexdef ilike '%unique%';

-- 2. APPLY. Works whether job_ads_job_url_key is a constraint or a plain
--    unique index. Existing rows already satisfy the new rule.
begin;

alter table public.job_ads drop constraint if exists job_ads_job_url_key;
drop index if exists public.job_ads_job_url_key;

create unique index if not exists job_ads_user_id_job_url_key
  on public.job_ads (user_id, job_url);

commit;

-- 3. UNDO (only if no two users have since saved the same link):
-- begin;
-- drop index if exists public.job_ads_user_id_job_url_key;
-- alter table public.job_ads add constraint job_ads_job_url_key unique (job_url);
-- commit;
