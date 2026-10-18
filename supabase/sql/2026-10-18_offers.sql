-- Offers: one record per job offer, linked to the application it came from.
--
-- What this changes (new objects only; no existing table or policy is touched):
--   * a new table public.offers
--   * Row Level Security on it, with the same "own rows" rule as the other
--     JTracker tables: each signed-in user can read and write only their own
--     offers (user_id = auth.uid()). Inserts and updates must also point at one
--     of the user's own applications.
--   * indexes for the Offers page
--
-- Company and role are not copied: they come from the linked application.
-- The application keeps its existing status (Offer) and outcome
-- (offer accepted / declined); the app keeps those in step with the offer.
--
-- Until this runs, the Offers page explains that the database update is
-- needed. Safe to run more than once.


-- ── Preview (read only) ──────────────────────────────────────────────────
-- Make sure nothing called "offers" exists yet:
-- select table_schema, table_name from information_schema.tables where table_name = 'offers';


-- ── Part 1: the table ────────────────────────────────────────────────────
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,

  status text not null default 'received'
    check (status in ('received', 'under_review', 'negotiating', 'accepted', 'declined', 'expired', 'withdrawn')),

  offer_date date,
  response_deadline date,

  -- The offered pay, and the range if one was given instead of (or as well as) a figure.
  salary_amount numeric(14, 2) check (salary_amount is null or salary_amount >= 0),
  salary_min numeric(14, 2) check (salary_min is null or salary_min >= 0),
  salary_max numeric(14, 2) check (salary_max is null or salary_max >= 0),
  salary_currency text check (salary_currency is null or salary_currency ~ '^[A-Z]{3}$'),
  pay_period text check (pay_period is null or pay_period in ('hour', 'day', 'week', 'month', 'year')),
  constraint offers_salary_range_check check (salary_min is null or salary_max is null or salary_min <= salary_max),

  bonus text,
  benefits text,
  employment_type text
    check (employment_type is null or employment_type in ('full_time', 'part_time', 'contract', 'b2b', 'internship', 'temporary', 'other')),
  work_arrangement text check (work_arrangement is null or work_arrangement in ('onsite', 'hybrid', 'remote')),
  probation_period text,
  start_date date,
  contract_duration text,
  career_development text,
  notes text,

  -- When the offer was accepted or declined.
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One offer record per application (a revised offer updates the same record).
create unique index if not exists offers_application_id_key on public.offers (application_id);
create index if not exists offers_user_status_idx on public.offers (user_id, status);


-- ── Part 2: Row Level Security ───────────────────────────────────────────
alter table public.offers enable row level security;

drop policy if exists "Users can read their own offers" on public.offers;
create policy "Users can read their own offers"
  on public.offers for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can add offers to their own applications" on public.offers;
create policy "Users can add offers to their own applications"
  on public.offers for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.applications a where a.id = application_id and a.user_id = auth.uid())
  );

drop policy if exists "Users can update their own offers" on public.offers;
create policy "Users can update their own offers"
  on public.offers for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.applications a where a.id = application_id and a.user_id = auth.uid())
  );

drop policy if exists "Users can delete their own offers" on public.offers;
create policy "Users can delete their own offers"
  on public.offers for delete to authenticated
  using (auth.uid() = user_id);

-- No access for signed-out visitors.
revoke all on public.offers from anon;


-- ── Check ────────────────────────────────────────────────────────────────
-- select policyname, cmd from pg_policies where tablename = 'offers';
-- select relrowsecurity from pg_class where oid = 'public.offers'::regclass;  -- true


-- ── Undo ─────────────────────────────────────────────────────────────────
-- drop table if exists public.offers;   -- deletes every offer record
