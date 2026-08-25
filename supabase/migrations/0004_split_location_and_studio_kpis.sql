-- ============================================================
-- Separate location-scoped metrics from studio-scoped ones.
--
-- kpi_daily previously joined attendance (per studio, per location,
-- per day) against revenue and member counts (per studio, per day).
-- The location join multiplied the day's rows, so every studio-level
-- figure repeated once per location: six locations turned €50 of
-- revenue into €300, and one new member into six.
--
-- The two grains cannot share a row honestly, so they no longer do.
-- Momence's payment webhook carries no location, so revenue genuinely
-- cannot be attributed to a site — pretending otherwise would be worse
-- than admitting it.
-- ============================================================

-- create or replace cannot reorder or rename a view's columns, and both
-- views change shape here. Drop them first — they hold no data, so this
-- costs nothing and the recreate below is the real definition.
--
-- Order matters: kpi_daily reads kpi_daily_location, so the dependent goes
-- first. No cascade, so an unexpected dependency fails loudly rather than
-- being silently dropped.
drop view if exists kpi_daily;
drop view if exists kpi_daily_location;

-- ------------------------------------------------------------
-- Per location, per day: everything a class produces.
-- ------------------------------------------------------------
create view kpi_daily_location
  with (security_invoker = on) as
with attendance as (
  select
    o.studio_id,
    o.momence_location_id,
    o.session_date                as day,
    count(*)                      as classes_run,
    -- Capacity and the seats measured against it are summed only over
    -- classes that declare a capacity. Roughly 1,500 sessions a year —
    -- appointments and one-to-ones — have none, and folding their bookings
    -- into spots_taken while contributing nothing to capacity_offered would
    -- push the fill rate above 100% and make it meaningless.
    sum(o.capacity) filter (where o.capacity > 0)  as capacity_offered,
    sum(o.booked)   filter (where o.capacity > 0)  as spots_taken,
    sum(o.attended)               as attended,
    sum(o.no_shows)               as no_shows,
    sum(o.late_cancellations)     as late_cancellations
  from kpi_session_occupancy o
  group by 1, 2, 3
),
bookings as (
  select
    b.studio_id,
    s.momence_location_id,
    (b.booked_at at time zone st.timezone)::date as day,
    count(*) as bookings_made
  from session_bookings b
  join studios st on st.id = b.studio_id
  join sessions s
    on s.studio_id = b.studio_id
   and s.momence_session_id = b.momence_session_id
  group by 1, 2, 3
)
select
  a.studio_id,
  a.momence_location_id,
  l.name                            as location_name,
  a.day,
  a.classes_run,
  a.capacity_offered,
  a.spots_taken,
  a.attended,
  a.no_shows,
  a.late_cancellations,
  coalesce(b.bookings_made, 0)      as bookings_made,
  case when a.capacity_offered > 0
    then round(a.spots_taken::numeric / a.capacity_offered * 100, 1)
  end                               as fill_rate_pct
from attendance a
left join locations l
  on l.studio_id = a.studio_id
 and l.momence_location_id = a.momence_location_id
left join bookings b
  on b.studio_id = a.studio_id
 and b.day = a.day
 and b.momence_location_id is not distinct from a.momence_location_id;

-- ------------------------------------------------------------
-- Per studio, per day. One row per day, so summing is safe.
--
-- Class metrics are the totals across every location; revenue and
-- membership movement have no location dimension at all.
-- ------------------------------------------------------------
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
    sum(late_cancellations) as late_cancellations,
    sum(bookings_made)      as bookings_made
  from kpi_daily_location
  group by 1, 2
),
revenue as (
  select
    p.studio_id,
    (p.occurred_at at time zone st.timezone)::date as day,
    sum(p.amount) filter (where p.status = 'succeeded') as revenue,
    count(*) filter (where p.status = 'succeeded')      as payments_succeeded,
    count(*) filter (where p.status = 'failed')         as payments_failed
  from payment_transactions p
  join studios st on st.id = p.studio_id
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
  coalesce(c.bookings_made, 0)         as bookings_made,
  coalesce(c.classes_run, 0)           as classes_run,
  coalesce(c.capacity_offered, 0)      as capacity_offered,
  coalesce(c.spots_taken, 0)           as spots_taken,
  coalesce(c.attended, 0)              as attended,
  coalesce(c.no_shows, 0)              as no_shows,
  coalesce(c.late_cancellations, 0)    as late_cancellations,
  case when c.capacity_offered > 0
    then round(c.spots_taken::numeric / c.capacity_offered * 100, 1)
  end                                  as fill_rate_pct,
  coalesce(r.revenue, 0)               as revenue,
  coalesce(r.payments_succeeded, 0)    as payments_succeeded,
  coalesce(r.payments_failed, 0)       as payments_failed,
  coalesce(nm.new_members, 0)          as new_members,
  coalesce(ch.memberships_cancelled, 0) as memberships_cancelled
from days d
left join classes     c  on c.studio_id  = d.studio_id and c.day  = d.day
left join revenue     r  on r.studio_id  = d.studio_id and r.day  = d.day
left join new_members nm on nm.studio_id = d.studio_id and nm.day = d.day
left join churn       ch on ch.studio_id = d.studio_id and ch.day = d.day;
