-- ============================================================
-- Speed: drop work nothing reads, and scan the view once.
--
-- dashboard_summary was the whole critical path at ~1.7s, and the page
-- calls it twice (current period and the comparison). Two causes:
--
-- 1. kpi_daily_location joined all 91,000 bookings to sessions to build
--    bookings_made, a column no part of the dashboard displays. Removing
--    it removes the join.
--
-- 2. dashboard_summary read kpi_daily_location twice — once filtered for
--    the totals, once unfiltered for the per-location comparison. It now
--    reads once and filters in memory.
-- ============================================================

drop view if exists kpi_daily;
drop view if exists kpi_daily_location;

create view kpi_daily_location
  with (security_invoker = on) as
select
  o.studio_id,
  o.momence_location_id,
  l.name                        as location_name,
  o.session_date                as day,
  count(*)                      as classes_run,
  -- Fill rate is measured only over classes that declare a capacity;
  -- appointments and one-to-ones have none and would push it past 100%.
  sum(o.capacity) filter (where o.capacity > 0) as capacity_offered,
  sum(o.booked)   filter (where o.capacity > 0) as spots_taken,
  sum(o.attended)               as attended,
  sum(o.no_shows)               as no_shows,
  sum(o.late_cancellations)     as late_cancellations
from kpi_session_occupancy o
left join locations l
  on l.studio_id = o.studio_id
 and l.momence_location_id = o.momence_location_id
group by 1, 2, 3, 4;

create view kpi_daily
  with (security_invoker = on) as
with days as (
  select
    st.id as studio_id,
    st.timezone,
    generate_series(
      date_trunc('day', now() - interval '400 days'),
      date_trunc('day', now()),
      interval '1 day'
    )::date as day
  from studios st
),
classes as (
  select studio_id, day,
    sum(classes_run)        as classes_run,
    sum(capacity_offered)   as capacity_offered,
    sum(spots_taken)        as spots_taken,
    sum(attended)           as attended,
    sum(no_shows)           as no_shows,
    sum(late_cancellations) as late_cancellations
  from kpi_daily_location
  group by 1, 2
),
revenue as (
  select
    s.studio_id,
    (s.payment_date at time zone st.timezone)::date as day,
    sum(s.payment_value) filter (where s.payment_status = 'succeeded') as revenue,
    count(*)             filter (where s.payment_status = 'succeeded') as payments_succeeded,
    count(*)             filter (where s.payment_status = 'failed')    as payments_failed
  from sales s
  join studios st on st.id = s.studio_id
  group by 1, 2
),
new_members as (
  select
    m.studio_id,
    (m.first_seen_at at time zone st.timezone)::date as day,
    count(*) as new_members
  from members m
  join studios st on st.id = m.studio_id
  group by 1, 2
),
churn as (
  select
    bm.studio_id,
    (bm.cancelled_at at time zone st.timezone)::date as day,
    count(*) as memberships_cancelled
  from bought_memberships bm
  join studios st on st.id = bm.studio_id
  where bm.cancelled_at is not null
  group by 1, 2
)
select
  d.studio_id,
  d.day,
  coalesce(c.classes_run, 0)            as classes_run,
  coalesce(c.capacity_offered, 0)       as capacity_offered,
  coalesce(c.spots_taken, 0)            as spots_taken,
  coalesce(c.attended, 0)               as attended,
  coalesce(c.no_shows, 0)               as no_shows,
  coalesce(c.late_cancellations, 0)     as late_cancellations,
  case when c.capacity_offered > 0
    then round(c.spots_taken::numeric / c.capacity_offered * 100, 1)
  end                                   as fill_rate_pct,
  coalesce(r.revenue, 0)                as revenue,
  coalesce(r.payments_succeeded, 0)     as payments_succeeded,
  coalesce(r.payments_failed, 0)        as payments_failed,
  coalesce(nm.new_members, 0)           as new_members,
  coalesce(ch.memberships_cancelled, 0) as memberships_cancelled
from days d
left join classes     c  on c.studio_id  = d.studio_id and c.day  = d.day
left join revenue     r  on r.studio_id  = d.studio_id and r.day  = d.day
left join new_members nm on nm.studio_id = d.studio_id and nm.day = d.day
left join churn       ch on ch.studio_id = d.studio_id and ch.day = d.day;

-- One scan of kpi_daily_location, filtered in memory for the scoped totals.
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
    coalesce(sum(new_members), 0)           as new_members,
    coalesce(sum(memberships_cancelled), 0) as memberships_cancelled
  from kpi_daily
  where day >= p_from and day <= p_to
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
