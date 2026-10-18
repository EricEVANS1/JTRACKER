-- Adds Adzuna to the job sources users can choose in Job Automation.
-- Adzuna is an official job search API with exact posting times. It needs the
-- owner's free API keys as job-pipeline function secrets: ADZUNA_APP_ID,
-- ADZUNA_APP_KEY and ADZUNA_COUNTRY (e.g. pl). Safe to run more than once.

insert into public.job_sources (name, slug, fetch_method, is_active)
select 'Adzuna', 'adzuna', 'api', true
where not exists (select 1 from public.job_sources where slug = 'adzuna');
