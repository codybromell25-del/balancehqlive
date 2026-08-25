-- ============================================================
-- One call, aggregated in Postgres.
--
-- The dashboard was fetching every daily row for the window and summing
-- them in JavaScript. Two problems: PostgREST caps a response at 1000
-- rows, so 12 months across 7 locations was silently truncated and the
-- totals were simply wrong; and every filter change shipped thousands of
-- rows over the wire before rendering.
--
-- Aggregating here returns a few hundred bytes instead, and cannot be
-- truncated. security invoker (the default) means RLS still decides which
-- studio the caller sees.
-- ============================================================

-- The occupancy view is recomputed on every call, so the joins under it
-- need to be cheap.
create index if not exists session_bookings_session_idx
  on session_bookings (studio_id, momence_session_id, status);

create index if not exists sessions_studio_starts_idx
  on sessions (studio_id, starts_at)
  where not cancelled;

create or replace function dashboard_summary(
  p_from        date,
  p_to          date,
  p_location    integer default null
) returns jsonb
language sql
stable
as $$
with scoped as (
  select *
  from kpi_daily_location
  where day >= p_from
    and day <= p_to
    and (p_location is null or momence_location_id = p_location)
),
totals as (
  select
    coalesce(sum(classes_run), 0)      as classes_run,
    coalesce(sum(capacity_offered), 0) as capacity_offered,
    coalesce(sum(spots_taken), 0)      as spots_taken,
    coalesce(sum(attended), 0)         as attended,
    coalesce(sum(no_shows), 0)         as no_shows,
    coalesce(sum(bookings_made), 0)    as bookings_made
  from scoped
),
-- Revenue and membership movement have no location dimension, so they are
-- always studio-wide regardless of the filter.
studio as (
  select
    coalesce(sum(revenue), 0)               as revenue,
    coalesce(sum(new_members), 0)           as new_members,
    coalesce(sum(memberships_cancelled), 0) as memberships_cancelled,
    coalesce(sum(payments_failed), 0)       as payments_failed
  from kpi_daily
  where day >= p_from and day <= p_to
),
trend as (
  select jsonb_agg(t order by t.day) as rows
  from (
    select
      day,
      sum(attended)         as attended,
      sum(capacity_offered) as capacity
    from scoped
    group by day
  ) t
),
by_location as (
  select jsonb_agg(l order by l.fill desc) as rows
  from (
    select
      momence_location_id as id,
      coalesce(location_name, 'Unassigned') as name,
      sum(classes_run)  as classes,
      sum(attended)     as attended,
      case when sum(capacity_offered) > 0
        then round(sum(spots_taken)::numeric / sum(capacity_offered) * 100, 1)
        else 0
      end as fill
    from kpi_daily_location
    where day >= p_from and day <= p_to
    group by 1, 2
    having sum(classes_run) > 0
  ) l
)
select jsonb_build_object(
  'classes_run',      t.classes_run,
  'capacity_offered', t.capacity_offered,
  'spots_taken',      t.spots_taken,
  'attended',         t.attended,
  'no_shows',         t.no_shows,
  'bookings_made',    t.bookings_made,
  'fill_rate_pct',    case when t.capacity_offered > 0
                        then round(t.spots_taken::numeric / t.capacity_offered * 100, 1)
                      end,
  'revenue',          s.revenue,
  'new_members',      s.new_members,
  'memberships_cancelled', s.memberships_cancelled,
  'payments_failed',  s.payments_failed,
  'trend',            coalesce(tr.rows, '[]'::jsonb),
  'locations',        coalesce(bl.rows, '[]'::jsonb)
)
from totals t, studio s, trend tr, by_location bl;
$$;
