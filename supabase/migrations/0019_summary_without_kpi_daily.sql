-- ============================================================
-- Speed: dashboard_summary no longer reads kpi_daily.
--
-- It only wanted two numbers from it — new members and memberships
-- cancelled in the window — but kpi_daily builds 400 days of every
-- metric first: it re-aggregates every booking ever made through
-- kpi_daily_location, and every sale, before the window filter applies,
-- because a range filter cannot be pushed through its joins. That was
-- most of the summary's ~700ms, paid twice per page (current and prior
-- period).
--
-- The two counts now come straight from members and bought_memberships
-- for the window. Same definitions as kpi_daily: a new member is counted
-- on the studio-local day they were first seen, a cancellation on the
-- day it was cancelled.
-- ============================================================

create or replace function dashboard_summary(
  p_from     date,
  p_to       date,
  p_location integer default null
) returns jsonb
language sql
stable
as $$
with window_rows as (
  select *
  from kpi_daily_location
  where day >= p_from and day <= p_to
),
scoped as (
  select * from window_rows
  where p_location is null or momence_location_id = p_location
),
totals as (
  select
    coalesce(sum(classes_run), 0)      as classes_run,
    coalesce(sum(capacity_offered), 0) as capacity_offered,
    coalesce(sum(spots_taken), 0)      as spots_taken,
    coalesce(sum(attended), 0)         as attended,
    coalesce(sum(no_shows), 0)         as no_shows
  from scoped
),
revenue as (
  select
    coalesce(sum(s.payment_value) filter (where s.payment_status = 'succeeded'), 0) as revenue,
    coalesce(count(*) filter (where s.payment_status = 'succeeded'), 0)             as payments_succeeded,
    coalesce(count(*) filter (where s.payment_status = 'failed'), 0)                as payments_failed
  from sales s
  join studios st on st.id = s.studio_id
  left join locations l
    on l.studio_id = s.studio_id and l.name = s.location_name
  where (s.payment_date at time zone st.timezone)::date between p_from and p_to
    and (p_location is null or l.momence_location_id = p_location)
),
membership as (
  select
    (select count(*)
       from members m
       join studios st on st.id = m.studio_id
      where (m.first_seen_at at time zone st.timezone)::date between p_from and p_to
    ) as new_members,
    (select count(*)
       from bought_memberships bm
       join studios st on st.id = bm.studio_id
      where bm.cancelled_at is not null
        and (bm.cancelled_at at time zone st.timezone)::date between p_from and p_to
    ) as memberships_cancelled
),
trend as (
  select jsonb_agg(t order by t.day) as rows
  from (
    select day, sum(attended) as attended, sum(capacity_offered) as capacity
    from scoped group by day
  ) t
),
by_location as (
  select jsonb_agg(l order by l.fill desc) as rows
  from (
    select
      momence_location_id as id,
      coalesce(location_name, 'Unassigned') as name,
      sum(classes_run) as classes,
      sum(attended)    as attended,
      case when sum(capacity_offered) > 0
        then round(sum(spots_taken)::numeric / sum(capacity_offered) * 100, 1)
        else 0
      end as fill
    from window_rows
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
  'fill_rate_pct',    case when t.capacity_offered > 0
                        then round(t.spots_taken::numeric / t.capacity_offered * 100, 1)
                      end,
  'revenue',          r.revenue,
  'payments_succeeded', r.payments_succeeded,
  'payments_failed',  r.payments_failed,
  'new_members',      m.new_members,
  'memberships_cancelled', m.memberships_cancelled,
  'trend',            coalesce(tr.rows, '[]'::jsonb),
  'locations',        coalesce(bl.rows, '[]'::jsonb)
)
from totals t, revenue r, membership m, trend tr, by_location bl;
$$;
