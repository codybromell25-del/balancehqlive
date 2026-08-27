-- ============================================================
-- Weekly digest.
--
-- One call returning a week against the week before, plus the handful
-- of things worth acting on. Deliberately narrow: a digest that lists
-- everything is a dashboard with extra steps, and gets ignored.
-- ============================================================

create or replace function dashboard_weekly_digest(
  p_week_ending date default current_date
) returns jsonb
language sql
stable
as $$
with bounds as (
  select
    (p_week_ending - 6)  as this_from, p_week_ending      as this_to,
    (p_week_ending - 13) as prev_from, (p_week_ending - 7) as prev_to
),
classes_this as (
  select
    coalesce(sum(classes_run), 0)      as classes,
    coalesce(sum(capacity_offered), 0) as capacity,
    coalesce(sum(spots_taken), 0)      as taken,
    coalesce(sum(attended), 0)         as attended,
    coalesce(sum(no_shows), 0)         as no_shows
  from kpi_daily_location, bounds
  where day between bounds.this_from and bounds.this_to
),
classes_prev as (
  select
    coalesce(sum(classes_run), 0)      as classes,
    coalesce(sum(capacity_offered), 0) as capacity,
    coalesce(sum(spots_taken), 0)      as taken,
    coalesce(sum(attended), 0)         as attended,
    coalesce(sum(no_shows), 0)         as no_shows
  from kpi_daily_location, bounds
  where day between bounds.prev_from and bounds.prev_to
),
rev as (
  select
    coalesce(sum(s.payment_value) filter (
      where (s.payment_date at time zone st.timezone)::date between b.this_from and b.this_to), 0) as this_rev,
    coalesce(sum(s.payment_value) filter (
      where (s.payment_date at time zone st.timezone)::date between b.prev_from and b.prev_to), 0) as prev_rev
  from sales s
  join studios st on st.id = s.studio_id
  cross join bounds b
  where s.payment_status = 'succeeded'
    and (s.payment_date at time zone st.timezone)::date between b.prev_from and b.this_to
),
-- Per location, this week against last, so a single site sliding is
-- visible rather than averaged away.
by_location as (
  select jsonb_agg(x order by x.fill desc) as rows
  from (
    select
      coalesce(l.location_name, 'Unassigned') as name,
      sum(l.classes_run) filter (where l.day between b.this_from and b.this_to) as classes,
      sum(l.attended)    filter (where l.day between b.this_from and b.this_to) as attended,
      round(
        sum(l.spots_taken)      filter (where l.day between b.this_from and b.this_to)::numeric
        / nullif(sum(l.capacity_offered) filter (where l.day between b.this_from and b.this_to), 0) * 100, 1
      ) as fill,
      round(
        sum(l.spots_taken)      filter (where l.day between b.prev_from and b.prev_to)::numeric
        / nullif(sum(l.capacity_offered) filter (where l.day between b.prev_from and b.prev_to), 0) * 100, 1
      ) as prev_fill
    from kpi_daily_location l
    cross join bounds b
    where l.day between b.prev_from and b.this_to
    group by 1
    having sum(l.classes_run) filter (where l.day between b.this_from and b.this_to) > 0
  ) x
),
-- The worst regularly-run slots this week: where seats are going unsold
-- often enough to be a schedule problem rather than a bad day.
weak_slots as (
  select jsonb_agg(x order by x.fill) as rows
  from (
    select
      to_char(o.starts_at at time zone st.timezone, 'Dy HH24:00') as slot,
      coalesce(l.name, 'Unassigned') as location,
      count(*) as classes,
      round(sum(o.booked)::numeric / nullif(sum(o.capacity), 0) * 100, 1) as fill
    from kpi_session_occupancy o
    join studios st on st.id = o.studio_id
    left join locations l on l.studio_id = o.studio_id and l.momence_location_id = o.momence_location_id
    cross join bounds b
    where o.session_date between b.this_from and b.this_to
      and o.capacity > 0
    group by 1, 2
    having count(*) >= 2
    order by 4
    limit 5
  ) x
),
quiet as (
  select count(*) as n
  from member_activity
  where visits >= 5
    and last_booking < now() - interval '21 days'
    and last_booking > now() - interval '120 days'
)
select jsonb_build_object(
  'week_from',     b.this_from,
  'week_to',       b.this_to,
  'revenue',       round(r.this_rev, 2),
  'revenue_prev',  round(r.prev_rev, 2),
  'classes',       c.classes,
  'attended',      c.attended,
  'attended_prev', p.attended,
  'no_shows',      c.no_shows,
  'no_shows_prev', p.no_shows,
  'fill',          case when c.capacity > 0
                     then round(c.taken::numeric / c.capacity * 100, 1) end,
  'fill_prev',     case when p.capacity > 0
                     then round(p.taken::numeric / p.capacity * 100, 1) end,
  'empty_seats',   greatest(c.capacity - c.taken, 0),
  'quiet_members', q.n,
  'by_location',   coalesce((select rows from by_location), '[]'::jsonb),
  'weak_slots',    coalesce((select rows from weak_slots), '[]'::jsonb)
)
from bounds b, classes_this c, classes_prev p, rev r, quiet q;
$$;
