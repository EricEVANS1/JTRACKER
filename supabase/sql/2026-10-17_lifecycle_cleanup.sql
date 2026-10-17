-- One-off cleanup of application lifecycle data.
--
-- Before this change, status updates were saved differently depending on the
-- page (Applications, application details, Kanban, Email Sync). This script
-- brings existing rows in line with the shared rules in
-- src/lib/applicationLifecycle.ts. New changes already follow those rules.
--
-- How to run (Supabase dashboard -> SQL Editor):
--   1. Run STEP 1 on its own and check the counts.
--   2. Run STEP 2 to take a backup of every row this script can touch.
--   3. Run STEP 3. It runs in one transaction, so it applies all or nothing.
--   4. Run STEP 1 again: every count should now be 0.
-- To undo, see STEP 4.


-- STEP 1: preview -------------------------------------------------------------

select
  -- Ghosting used to stamp response_received_at at the same moment as
  -- ghosted_at, which made ghosted applications look like they got a reply.
  count(*) filter (
    where response_received_at is not null
      and response_received_at = ghosted_at
  ) as fake_ghosted_responses,

  -- Rejected applications are always archived; Kanban and the details page
  -- used to leave them active.
  count(*) filter (
    where status = 'rejected' and coalesce(archived, false) = false
  ) as rejected_not_archived,

  -- Archived status without the archived flag.
  count(*) filter (
    where status = 'archived' and coalesce(archived, false) = false
  ) as archived_status_without_flag,

  -- "Awaiting final response" left on after moving out of interview stages.
  count(*) filter (
    where final_response_pending = true
      and status not in ('interview', 'final_interview')
  ) as stale_awaiting_final_response
from public.applications;


-- STEP 2: backup --------------------------------------------------------------
-- Kept in a separate schema so it isn't exposed through the Supabase API.

create schema if not exists backup;

create table if not exists backup.applications_20261017 as
select *
from public.applications
where (response_received_at is not null and response_received_at = ghosted_at)
   or (status in ('rejected', 'archived') and coalesce(archived, false) = false)
   or (final_response_pending = true and status not in ('interview', 'final_interview'));

alter table backup.applications_20261017 enable row level security;


-- STEP 3: apply ---------------------------------------------------------------

begin;

update public.applications
set response_received_at = null
where response_received_at is not null
  and response_received_at = ghosted_at;

update public.applications
set archived = true,
    archived_at = coalesce(archived_at, rejected_at, last_status_changed_at, now())
where status in ('rejected', 'archived')
  and coalesce(archived, false) = false;

update public.applications
set final_response_pending = false
where final_response_pending = true
  and status not in ('interview', 'final_interview');

commit;


-- STEP 4: undo (only if needed) -----------------------------------------------
--
-- Restores the backed-up columns for the rows this script changed:
--
-- update public.applications a
-- set response_received_at = b.response_received_at,
--     archived = b.archived,
--     archived_at = b.archived_at,
--     final_response_pending = b.final_response_pending
-- from backup.applications_20261017 b
-- where a.id = b.id;
--
-- Once you're happy with the result, the backup can be removed:
-- drop table backup.applications_20261017;
