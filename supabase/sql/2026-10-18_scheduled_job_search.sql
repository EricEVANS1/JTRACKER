-- Scheduled job searches: calls the job-pipeline function a few times a day so
-- users with Job Automation turned on get new matches (and a notification)
-- without pressing "Run search".
--
-- How it works: pg_cron runs a job on a schedule; the job uses pg_net to POST
-- to job-pipeline with an x-cron-secret header. The function compares that
-- header with its JOB_SEARCH_CRON_SECRET secret and, if it matches, searches
-- for each opted-in user who hasn't had a search in the last 50 minutes.
--
-- This changes production configuration (two extensions, two Vault secrets and
-- one cron job). It does not change any table, policy or RLS rule.
--
-- Before running:
--   1. Make a random secret, e.g. `openssl rand -hex 32`.
--   2. Add it as the JOB_SEARCH_CRON_SECRET secret of the job-pipeline
--      function (Dashboard → Edge Functions → Secrets) and redeploy it.
--   3. Run the parts below in the SQL editor, in order, replacing the two
--      placeholders in Part 2. Never commit the real values.
--
-- Cost: each run searches every due user; by default at most 6 paid search
-- calls per user per run (JOB_SEARCH_SCHEDULED_MAX_CALLS). The schedule below
-- runs 5 times a day (06:05, 09:05, 12:05, 15:05 and 18:05 UTC).


-- ── Part 1: extensions ───────────────────────────────────────────────────
create extension if not exists pg_cron;
create extension if not exists pg_net;


-- ── Part 2: secrets in Vault ─────────────────────────────────────────────
-- The anon key is the public key the web app already uses (Project Settings →
-- API). It only gets the request past the Functions gateway; the cron secret
-- is what the function checks. Do not use the service role key here.
select vault.create_secret('<the same value as JOB_SEARCH_CRON_SECRET>', 'jtracker_job_search_cron_secret');
select vault.create_secret('<your project anon key>', 'jtracker_anon_key');

-- To change a value later:
-- select vault.update_secret(id, '<new value>') from vault.secrets where name = 'jtracker_job_search_cron_secret';


-- ── Part 3: the schedule ─────────────────────────────────────────────────
-- Re-running this replaces the existing job of the same name.
select cron.schedule(
  'jtracker-scheduled-job-search',
  '5 6-18/3 * * *',
  $$
  select net.http_post(
    url := 'https://xtwtvigtnonewpyfjjrz.supabase.co/functions/v1/job-pipeline',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'jtracker_anon_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'jtracker_job_search_cron_secret')
    ),
    body := '{"mode":"scheduled"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);


-- ── Check ────────────────────────────────────────────────────────────────
-- The job exists:
-- select jobid, jobname, schedule, active from cron.job where jobname = 'jtracker-scheduled-job-search';
--
-- Recent runs (status 'succeeded' means the request was sent):
-- select start_time, status, return_message from cron.job_run_details
--  where jobid = (select jobid from cron.job where jobname = 'jtracker-scheduled-job-search')
--  order by start_time desc limit 10;
--
-- The function's answers (status_code 200 and a body with "mode":"scheduled"):
-- select created, status_code, left(content::text, 300) from net._http_response order by created desc limit 10;
--
-- To test without waiting, run the select net.http_post(...) statement from
-- Part 3 on its own, then the query above.


-- ── Undo ─────────────────────────────────────────────────────────────────
-- select cron.unschedule('jtracker-scheduled-job-search');
-- delete from vault.secrets where name in ('jtracker_job_search_cron_secret', 'jtracker_anon_key');
-- The extensions can stay; drop them only if nothing else uses them.
