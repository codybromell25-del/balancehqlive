-- ============================================================
-- A record of every verification run.
--
-- The checks were only visible in GitHub Actions, which is somewhere the
-- studio owner would have to think to look. Storing the result lets the
-- dashboard say so itself — a warning on the page beats an email that
-- might be filtered.
-- ============================================================

create table if not exists verification_runs (
  id          bigserial primary key,
  studio_id   uuid not null references studios(id) on delete cascade,
  ran_at      timestamptz not null default now(),
  passed      boolean not null,
  failed_count integer not null default 0,
  checks      jsonb not null
);

create index if not exists verification_runs_recent_idx
  on verification_runs (studio_id, ran_at desc);

alter table verification_runs enable row level security;
create policy studio_read on verification_runs
  for select using (studio_id in (select user_studio_ids()));

-- The latest result per studio, which is all the dashboard needs.
create or replace view kpi_verification
  with (security_invoker = on) as
select distinct on (studio_id)
  studio_id, ran_at, passed, failed_count, checks
from verification_runs
order by studio_id, ran_at desc;
