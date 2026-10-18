-- Job Automation filters (Edit Profile): adds the experience levels a user
-- wants to see. Empty means any level. "Date posted" and "Work model" use the
-- existing max_job_age_days (1, 7, 30, or 0 for any time) and work_model
-- columns.
--
-- Safe to run more than once, and before or after the app update: it only adds
-- the column if it is missing. Row Level Security on user_job_preferences is
-- unchanged (users read and write only their own row).

alter table public.user_job_preferences
  add column if not exists experience_levels text[] not null default '{}'::text[];

-- Preview (read only): if max_job_age_days has a check constraint that rejects
-- 0, "Any time" can't be saved; this lists any such constraint.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.user_job_preferences'::regclass
  and contype = 'c'
  and pg_get_constraintdef(oid) ilike '%max_job_age_days%';
