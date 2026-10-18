-- Interview calendar: lets interview_notes hold more than one interview per
-- application, and record each one's status and time zone.
--
-- The calendar uses the existing interview_notes table (one row per
-- interview, linked to its application by application_id), so nothing is
-- copied into a new table. It needs:
--   status       scheduled / completed / cancelled (existing rows: scheduled)
--   timezone     the IANA zone the interview was arranged in, e.g. Europe/London
--   completed_at, cancelled_at   when it was marked so
--
-- Row Level Security is unchanged: the existing "own rows" policies on
-- interview_notes already cover the new columns.
--
-- Until this runs, the calendar still shows, creates, edits and reschedules
-- interviews; completing, cancelling and storing the time zone wait for it.
-- Safe to run more than once.


-- ── Preview (read only) ──────────────────────────────────────────────────
-- Columns today:
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'interview_notes'
--  order by ordinal_position;
--
-- Unique constraints and indexes (Part 2 removes one that allows only one
-- interview per application, if there is one):
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid = 'public.interview_notes'::regclass and contype = 'u';
-- select indexname, indexdef from pg_indexes
--  where schemaname = 'public' and tablename = 'interview_notes';
--
-- Applications with more than one interview row today:
-- select application_id, count(*) from public.interview_notes group by 1 having count(*) > 1;


-- ── Part 1: new columns ──────────────────────────────────────────────────
alter table public.interview_notes
  add column if not exists status text not null default 'scheduled',
  add column if not exists timezone text,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.interview_notes'::regclass and conname = 'interview_notes_status_check'
  ) then
    alter table public.interview_notes
      add constraint interview_notes_status_check check (status in ('scheduled', 'completed', 'cancelled'));
  end if;
end $$;

-- The calendar reads a user's interviews by date.
create index if not exists interview_notes_user_date_idx
  on public.interview_notes (user_id, interview_date);


-- ── Part 2: allow several interviews per application ─────────────────────
-- Drops a unique constraint or unique index on application_id alone, if one
-- exists (an application usually has several rounds). Nothing else changes.
do $$
declare
  item record;
begin
  for item in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.interview_notes'::regclass
       and con.contype = 'u'
       and con.conkey = array[(
         select attnum from pg_attribute
          where attrelid = 'public.interview_notes'::regclass and attname = 'application_id'
       )]::smallint[]
  loop
    execute format('alter table public.interview_notes drop constraint %I', item.conname);
    raise notice 'Dropped unique constraint %', item.conname;
  end loop;

  for item in
    select i.relname as indexname
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
     where x.indrelid = 'public.interview_notes'::regclass
       and x.indisunique and not x.indisprimary
       and x.indkey::text = (
         select attnum::text from pg_attribute
          where attrelid = 'public.interview_notes'::regclass and attname = 'application_id'
       )
  loop
    execute format('drop index public.%I', item.indexname);
    raise notice 'Dropped unique index %', item.indexname;
  end loop;
end $$;


-- ── Check ────────────────────────────────────────────────────────────────
-- select status, count(*) from public.interview_notes group by 1;


-- ── Undo ─────────────────────────────────────────────────────────────────
-- alter table public.interview_notes
--   drop constraint if exists interview_notes_status_check,
--   drop column if exists status,
--   drop column if exists timezone,
--   drop column if exists completed_at,
--   drop column if exists cancelled_at;
-- drop index if exists public.interview_notes_user_date_idx;
-- (A dropped one-per-application unique constraint is not restored
-- automatically: re-adding it fails once an application has two interviews.)
