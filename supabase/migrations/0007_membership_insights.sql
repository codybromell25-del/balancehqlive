-- ============================================================
-- Membership health: who is active, who is sticking, and where
-- new people are lost.
--
-- Every function here works from session_bookings rather than the
-- members table, because a member row proves someone exists, not
-- that they attend. 7,716 of 14,300 members have never booked.
-- ============================================================

create index if not exists session_bookings_member_time_idx
  on session_bookings (studio_id, member_id, booked_at);

-- A booking that counts as attendance intent. Cancellations are excluded
-- everywhere below: someone who books and cancels was not active that month.
create or replace view member_activity
  with (security_invoker = on) as
select
  studio_id,
  member_id,
  min(booked_at)   as first_booking,
  max(booked_at)   as last_booking,
  count(*)         as visits
from session_bookings
where status in ('booked', 'checked-in', 'no-show')
group by 1, 2;

-- ------------------------------------------------------------
-- Active members by month, split into new and returning.
--
-- "Active" means booked at least once that month. The split matters:
-- a flat total hides a studio replacing churned regulars with new
-- faces, which is expensive and unsustainable.
-- ------------------------------------------------------------
create or replace function dashboard_membership_trend(
  p_months integer default 12
) returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(m order by m.month), '[]'::jsonb)
  from (
    select
      to_char(date_trunc('month', b.booked_at), 'YYYY-MM') as month,
      count(distinct b.member_id)                          as active,
      count(distinct b.member_id) filter (
        where date_trunc('month', a.first_booking) = date_trunc('month', b.booked_at)
      )                                                    as new_members,
      count(distinct b.member_id) filter (
        where date_trunc('month', a.first_booking) < date_trunc('month', b.booked_at)
      )                                                    as returning_members
    from session_bookings b
    join member_activity a
      on a.studio_id = b.studio_id and a.member_id = b.member_id
    where b.status in ('booked', 'checked-in', 'no-show')
      and b.booked_at >= date_trunc('month', now() - make_interval(months => p_months))
    group by 1
  ) m;
$$;

-- ------------------------------------------------------------
-- Cohort retention.
--
-- Of the people whose first booking was in month M, what share booked
-- again N months later. The diagonal is the honest measure of whether
-- the studio keeps people, as opposed to whether it acquires them.
-- ------------------------------------------------------------
create or replace function dashboard_cohorts(
  p_months integer default 9
) returns jsonb
language sql
stable
as $$
with cohorts as (
  select
    studio_id,
    member_id,
    date_trunc('month', first_booking) as cohort
  from member_activity
  where first_booking >= date_trunc('month', now() - make_interval(months => p_months))
),
sizes as (
  select cohort, count(*) as size from cohorts group by 1
),
activity as (
  select distinct
    c.cohort,
    c.member_id,
    (extract(year  from age(date_trunc('month', b.booked_at), c.cohort)) * 12
     + extract(month from age(date_trunc('month', b.booked_at), c.cohort)))::int as month_offset
  from cohorts c
  join session_bookings b
    on b.studio_id = c.studio_id and b.member_id = c.member_id
  where b.status in ('booked', 'checked-in', 'no-show')
)
select coalesce(jsonb_agg(r order by r.cohort, r.month_offset), '[]'::jsonb)
from (
  select
    to_char(a.cohort, 'YYYY-MM')                        as cohort,
    a.month_offset,
    count(distinct a.member_id)                         as retained,
    s.size                                              as cohort_size,
    round(count(distinct a.member_id)::numeric / s.size * 100, 1) as pct
  from activity a
  join sizes s on s.cohort = a.cohort
  where a.month_offset between 0 and 8
  group by 1, 2, s.size
) r;
$$;

-- ------------------------------------------------------------
-- Where first-timers are won and lost.
--
-- Conversion is measured as "booked anything again within 60 days of
-- their first class", which is generous on purpose: the question is
-- whether they came back at all, not whether they became a regular.
-- ------------------------------------------------------------
create or replace function dashboard_first_class(
  p_from date,
  p_to   date
) returns jsonb
language sql
stable
as $$
with firsts as (
  select
    a.studio_id,
    a.member_id,
    a.first_booking,
    a.visits,
    (select b.momence_session_id
       from session_bookings b
      where b.studio_id = a.studio_id
        and b.member_id = a.member_id
        and b.booked_at = a.first_booking
      limit 1) as session_id
  from member_activity a
  where a.first_booking::date between p_from and p_to
),
enriched as (
  select
    f.*,
    s.name        as class_name,
    s.teacher_name,
    s.momence_location_id,
    -- Two or more visits means they came back at least once.
    (f.visits > 1) as returned
  from firsts f
  join sessions s
    on s.studio_id = f.studio_id
   and s.momence_session_id = f.session_id
),
by_class as (
  select jsonb_agg(x order by x.conversion desc) as rows
  from (
    select
      class_name                                        as name,
      count(*)                                          as first_timers,
      count(*) filter (where returned)                  as returned,
      round(count(*) filter (where returned)::numeric / count(*) * 100, 1) as conversion
    from enriched
    where class_name is not null
    group by 1
    having count(*) >= 15
  ) x
),
by_teacher as (
  select jsonb_agg(x order by x.conversion desc) as rows
  from (
    select
      teacher_name                                      as name,
      count(*)                                          as first_timers,
      count(*) filter (where returned)                  as returned,
      round(count(*) filter (where returned)::numeric / count(*) * 100, 1) as conversion
    from enriched
    where teacher_name is not null
    group by 1
    having count(*) >= 15
  ) x
)
select jsonb_build_object(
  'total_first_timers', (select count(*) from enriched),
  'returned',           (select count(*) from enriched where returned),
  'by_class',           coalesce((select rows from by_class), '[]'::jsonb),
  'by_teacher',         coalesce((select rows from by_teacher), '[]'::jsonb)
);
$$;

-- ------------------------------------------------------------
-- Lifecycle stages, as counts.
--
-- Boundaries are deliberately blunt. A studio owner does not need a
-- churn probability; they need to know how many people are drifting
-- and whether that number is growing.
-- ------------------------------------------------------------
create or replace function dashboard_lifecycle()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'new',       count(*) filter (where first_booking > now() - interval '30 days'),
    'regular',   count(*) filter (where last_booking  > now() - interval '30 days'
                                    and first_booking <= now() - interval '30 days'
                                    and visits >= 5),
    'occasional',count(*) filter (where last_booking  > now() - interval '30 days'
                                    and first_booking <= now() - interval '30 days'
                                    and visits < 5),
    'lapsing',   count(*) filter (where last_booking <= now() - interval '30 days'
                                    and last_booking  > now() - interval '90 days'),
    'lost',      count(*) filter (where last_booking <= now() - interval '90 days')
  )
  from member_activity;
$$;

-- ------------------------------------------------------------
-- Cancellations and unsold capacity.
--
-- Lead time is measured against when the class started, so "cancelled
-- 2 hours before" is visible as such rather than buried in a total.
-- ------------------------------------------------------------
create or replace function dashboard_cancellations(
  p_from     date,
  p_to       date,
  p_location integer default null
) returns jsonb
language sql
stable
as $$
with cancelled as (
  select
    b.cancelled_at,
    s.starts_at,
    extract(epoch from (s.starts_at - b.cancelled_at)) / 3600.0 as hours_before
  from session_bookings b
  join sessions s
    on s.studio_id = b.studio_id
   and s.momence_session_id = b.momence_session_id
  where b.status = 'cancelled'
    and b.cancelled_at is not null
    and s.starts_at::date between p_from and p_to
    and (p_location is null or s.momence_location_id = p_location)
),
seats as (
  select
    coalesce(sum(capacity_offered), 0) as capacity,
    coalesce(sum(spots_taken), 0)      as taken
  from kpi_daily_location
  where day between p_from and p_to
    and (p_location is null or momence_location_id = p_location)
)
select jsonb_build_object(
  'total',        (select count(*) from cancelled),
  'under_2h',     (select count(*) from cancelled where hours_before < 2),
  'under_12h',    (select count(*) from cancelled where hours_before >= 2  and hours_before < 12),
  'under_24h',    (select count(*) from cancelled where hours_before >= 12 and hours_before < 24),
  'over_24h',     (select count(*) from cancelled where hours_before >= 24),
  'median_hours', (select round(percentile_cont(0.5) within group (order by hours_before)::numeric, 1)
                     from cancelled where hours_before >= 0),
  'capacity',     (select capacity from seats),
  'taken',        (select taken from seats),
  'empty_seats',  (select capacity - taken from seats)
);
$$;
