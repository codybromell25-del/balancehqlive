-- ============================================================
-- Momence reporting platform — core schema
-- Multi-tenant from day one: every row is scoped to a studio.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Tenancy
-- ------------------------------------------------------------

create table studios (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text not null unique,
  momence_host_id integer not null,
  timezone        text not null default 'Europe/Dublin',
  currency        text not null default 'EUR',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (momence_host_id)
);

-- Which humans can see which studio. Drives RLS.
create table studio_users (
  studio_id  uuid not null references studios(id) on delete cascade,
  user_id    uuid not null,              -- auth.users.id
  role       text not null default 'viewer' check (role in ('owner','admin','viewer')),
  created_at timestamptz not null default now(),
  primary key (studio_id, user_id)
);

-- Momence locations, so KPIs can be sliced per site.
create table locations (
  studio_id           uuid not null references studios(id) on delete cascade,
  momence_location_id integer not null,
  name                text,
  primary key (studio_id, momence_location_id)
);

-- ------------------------------------------------------------
-- Credentials & tokens
--
-- Secrets are encrypted at rest with pgcrypto using a key held
-- outside the database (see lib/crypto.ts). Never store plaintext.
-- These tables have NO RLS policy: they are service-role only.
-- ------------------------------------------------------------

create table studio_credentials (
  studio_id         uuid primary key references studios(id) on delete cascade,
  client_id         text not null,
  client_secret_enc bytea not null,
  staff_username    text not null,
  staff_password_enc bytea not null,
  webhook_secret_enc bytea,
  updated_at        timestamptz not null default now()
);

create table studio_tokens (
  studio_id         uuid primary key references studios(id) on delete cascade,
  access_token_enc  bytea not null,
  refresh_token_enc bytea,
  expires_at        timestamptz not null,
  updated_at        timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Raw webhook event log
--
-- Append-only. Everything downstream is a projection of this,
-- so a projector bug is always replayable rather than fatal.
-- ------------------------------------------------------------

create table webhook_events (
  id           bigserial primary key,
  studio_id    uuid not null references studios(id) on delete cascade,
  event_name   text not null,
  dedupe_key   text not null,
  occurred_at  timestamptz not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  process_error text,
  payload      jsonb not null,
  unique (studio_id, dedupe_key)
);

create index on webhook_events (studio_id, event_name, occurred_at desc);
create index on webhook_events (processed_at) where processed_at is null;

-- ------------------------------------------------------------
-- Projected entities
-- ------------------------------------------------------------

create table members (
  studio_id         uuid not null references studios(id) on delete cascade,
  momence_member_id integer not null,
  email             text,
  first_name        text,
  last_name         text,
  first_seen_at     timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (studio_id, momence_member_id)
);

create index on members (studio_id, first_seen_at);

create table sessions (
  studio_id           uuid not null references studios(id) on delete cascade,
  momence_session_id  integer not null,
  name                text,
  session_type        text,
  momence_location_id integer,
  teacher_id          integer,
  room_id             integer,
  starts_at           timestamptz not null,
  ends_at             timestamptz,
  capacity            integer,
  duration_minutes    integer,
  cancelled           boolean not null default false,
  updated_at          timestamptz not null default now(),
  primary key (studio_id, momence_session_id)
);

create index on sessions (studio_id, starts_at desc);

create table session_bookings (
  studio_id          uuid not null references studios(id) on delete cascade,
  momence_booking_id integer not null,
  momence_session_id integer not null,
  member_id          integer not null,
  paying_member_id   integer,
  status             text not null default 'booked'
                     check (status in ('booked','cancelled','checked-in','no-show')),
  booked_at          timestamptz not null,
  cancelled_at       timestamptz,
  is_late_cancellation boolean not null default false,
  checked_in_at      timestamptz,
  updated_at         timestamptz not null default now(),
  primary key (studio_id, momence_booking_id)
);

create index on session_bookings (studio_id, booked_at desc);
create index on session_bookings (studio_id, momence_session_id);

create table bought_memberships (
  studio_id             uuid not null references studios(id) on delete cascade,
  bought_membership_id  integer not null,
  membership_id         integer,
  member_id             integer not null,
  membership_type       text,
  start_date            date,
  end_date              date,
  status                text not null default 'active'
                        check (status in ('active','frozen','renewal-cancelled','cancelled')),
  cancelled_at          timestamptz,
  renewal_failed_at     timestamptz,
  updated_at            timestamptz not null default now(),
  primary key (studio_id, bought_membership_id)
);

create index on bought_memberships (studio_id, status);

create table payment_transactions (
  studio_id      uuid not null references studios(id) on delete cascade,
  transaction_id integer not null,
  status         text not null check (status in ('succeeded','pending','failed')),
  amount         numeric(12,2),
  currency       text,
  member_id      integer,
  occurred_at    timestamptz not null,
  raw            jsonb,
  primary key (studio_id, transaction_id)
);

create index on payment_transactions (studio_id, occurred_at desc);

-- ------------------------------------------------------------
-- Report runs
--
-- Momence generates reports asynchronously: POST to start, then
-- either wait for the host-report-run-completed webhook or poll.
-- ------------------------------------------------------------

create table report_runs (
  id               uuid primary key default gen_random_uuid(),
  studio_id        uuid not null references studios(id) on delete cascade,
  report_type      text not null,
  date_from        timestamptz not null,
  date_to          timestamptz not null,
  momence_run_id   integer,
  status           text not null default 'requested'
                   check (status in ('requested','completed','failed','abandoned')),
  report_url_api   text,
  requested_at     timestamptz not null default now(),
  completed_at     timestamptz,
  row_count        integer,
  error            text
);

create index on report_runs (studio_id, report_type, requested_at desc);
create index on report_runs (status) where status = 'requested';
create unique index on report_runs (momence_run_id) where momence_run_id is not null;

create table report_rows (
  report_run_id uuid not null references report_runs(id) on delete cascade,
  row_index     integer not null,
  data          jsonb not null,
  primary key (report_run_id, row_index)
);

-- The rate limit ledger. Momence allows 100 report generations per
-- day, so we count them ourselves rather than discovering the ceiling
-- via a 429 halfway through a refresh cycle.
create table report_budget (
  studio_id   uuid not null references studios(id) on delete cascade,
  budget_date date not null,
  runs_used   integer not null default 0,
  primary key (studio_id, budget_date)
);

-- Atomically claim a slot. Returns true if the run may proceed.
create or replace function claim_report_slot(
  p_studio_id uuid,
  p_limit integer default 90   -- 90 not 100: leave headroom for retries
) returns boolean
language plpgsql
as $$
declare
  v_used integer;
begin
  insert into report_budget (studio_id, budget_date, runs_used)
  values (p_studio_id, (now() at time zone 'utc')::date, 1)
  on conflict (studio_id, budget_date) do update
    set runs_used = report_budget.runs_used + 1
    where report_budget.runs_used < p_limit
  returning runs_used into v_used;

  return v_used is not null;
end;
$$;

-- ------------------------------------------------------------
-- Row level security
--
-- Every tenant-facing table is readable only by users mapped to
-- that studio. Writes happen through the service role only.
-- ------------------------------------------------------------

create or replace function user_studio_ids() returns setof uuid
language sql stable security definer
as $$
  select studio_id from studio_users where user_id = auth.uid();
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'studios','locations','members','sessions','session_bookings',
    'bought_memberships','payment_transactions','report_runs','webhook_events'
  ]
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create policy studio_read on studios
  for select using (id in (select user_studio_ids()));

do $$
declare t text;
begin
  foreach t in array array[
    'locations','members','sessions','session_bookings',
    'bought_memberships','payment_transactions','report_runs','webhook_events'
  ]
  loop
    execute format(
      'create policy studio_read on %I for select using (studio_id in (select user_studio_ids()))', t);
  end loop;
end $$;

create policy studio_users_read on studio_users
  for select using (user_id = auth.uid());
alter table studio_users enable row level security;

-- ------------------------------------------------------------
-- RLS for the remaining tables.
--
-- Every table in the public schema is reachable through PostgREST
-- with the anon key. A table without RLS enabled is therefore world
-- readable, not "service-role only" — enabling it with no policy at
-- all is what makes it service-role only, because the service role
-- bypasses RLS while anon and authenticated match no policy.
-- ------------------------------------------------------------

-- Secrets. No policy, deliberately: nothing but the service role reads these.
alter table studio_credentials enable row level security;
alter table studio_tokens      enable row level security;

-- report_budget is surfaced to owners through kpi_data_freshness.
alter table report_budget enable row level security;
create policy studio_read on report_budget
  for select using (studio_id in (select user_studio_ids()));

-- report_rows carries no studio_id of its own, so the boundary is
-- inherited from the run that produced it.
alter table report_rows enable row level security;
create policy studio_read on report_rows
  for select using (
    report_run_id in (
      select id from report_runs where studio_id in (select user_studio_ids())
    )
  );
