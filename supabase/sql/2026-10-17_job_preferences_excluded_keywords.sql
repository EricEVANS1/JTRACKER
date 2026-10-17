-- Lets users edit the keywords Job Automation should avoid (Job Automation ->
-- Edit Profile -> "Exclude jobs mentioning"). The job-pipeline function already
-- reads this column: a job mentioning one of these words gets a lower match
-- score and is flagged.
--
-- Safe to run more than once, and before or after the app update: it only adds
-- the column if it is missing. Row Level Security on user_job_preferences is
-- unchanged (users read and write only their own row).

alter table public.user_job_preferences
  add column if not exists excluded_keywords text[] not null default '{}'::text[];
