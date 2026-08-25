-- ============================================================
-- KPI layer
--
-- These are plain views, not materialised ones. Webhook data lands
-- continuously, so a materialised view would need refreshing on a
-- timer and would reintroduce exactly the staleness we removed.
-- If any of these get slow at scale, materialise that one view and
-- refresh it from the webhook handler.
--
-- Every view is security_invoker. A view otherwise runs with the
-- privileges of its owner, reading straight past the row level security
-- on the tables underneath it, and one studio would see every studio's
-- numbers. Requires Postgres 15 or newer.
-- ============================================================

-- ------------------------------------------------------------
-- Class occupancy
--
-- Capacity comes from session-created / session-updated webhooks,
-- attendance from booking and check-in events. No report run needed.
-- ------------------------------------------------------------

create or replace view kpi_session_occupancy
  with (security_invoker = on) as
select
  s.studio_id,
  s.momence_session_id,
  s.momence_location_id,
  s.name                                        as session_name,
  s.teacher_id,
  s.starts_at,
  (s.starts_at at time zone st.timezone)::date  as session_date,
  s.capacity,
  count(b.momence_booking_id) filter (
    where b.status in ('booked','checked-in','no-show')
  )                                             as booked,
  count(b.momence_booking_id) filter (
    where b.status = 'checked-in'
  )                                             as attended,
  count(b.momence_booking_id) filter (
    where b.status = 'no-show'
  )                                             as no_shows,
  count(b.momence_booking_id) filter (
    where b.status = 'cancelled' and b.is_late_cancellation
  )                                             as late_cancellations,
  case when s.capacity > 0 then
    round(
      count(b.momence_booking_id) filter (
        where b.status in ('booked','checked-in','no-show')
      )::numeric / s.capacity * 100, 1)
  end                                           as fill_rate_pct
from sessions s
join studios st on st.id = s.studio_id
left join session_bookings b
  on b.studio_id = s.studio_id
 and b.momence_session_id = s.momence_session_id
where not s.cancelled
group by s.studio_id, s.momence_session_id, s.momence_location_id,
         s.name, s.teacher_id, s.starts_at, s.capacity, st.timezone;

-- ------------------------------------------------------------
-- Daily rollup, per studio per location
-- ------------------------------------------------------------

create or replace view kpi_daily
  with (security_invoker = on) as
with days as (
  select
    st.id as studio_id,
    st.timezone,
    generate_series(
      date_trunc('day', now() - interval '365 days'),
      date_trunc('day', now()),
      interval '1 day'
    )::date as day
  from studios st
),
bookings as (
  select
    b.studio_id,
    s.momence_location_id,
    (b.booked_at at time zone st.timezone)::date as day,
    count(*) as bookings_made
  from session_bookings b
  join studios st on st.id = b.studio_id
  left join sessions s
    on s.studio_id = b.studio_id and s.momence_session_id = b.momence_session_id
  group by 1, 2, 3
),
attendance as (
  select
    o.studio_id,
    o.momence_location_id,
    o.session_date as day,
    sum(o.attended)          as attended,
    sum(o.no_shows)          as no_shows,
    sum(o.late_cancellations) as late_cancellations,
    sum(o.capacity)          as capacity_offered,
    sum(o.booked)            as spots_taken,
    count(*)                 as classes_run
  from kpi_session_occupancy o
  group by 1, 2, 3
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
  a.momence_location_id,
  coalesce(b.bookings_made, 0)          as bookings_made,
  coalesce(a.classes_run, 0)            as classes_run,
  coalesce(a.capacity_offered, 0)       as capacity_offered,
  coalesce(a.spots_taken, 0)            as spots_taken,
  coalesce(a.attended, 0)               as attended,
  coalesce(a.no_shows, 0)               as no_shows,
  coalesce(a.late_cancellations, 0)     as late_cancellations,
  case when a.capacity_offered > 0
    then round(a.spots_taken::numeric / a.capacity_offered * 100, 1)
  end                                   as fill_rate_pct,
  coalesce(r.revenue, 0)                as revenue,
  coalesce(r.payments_failed, 0)        as payments_failed,
  coalesce(nm.new_members, 0)           as new_members,
  coalesce(c.memberships_cancelled, 0)  as memberships_cancelled
from days d
left join attendance  a  on a.studio_id  = d.studio_id and a.day  = d.day
left join bookings    b  on b.studio_id  = d.studio_id and b.day  = d.day
                        and b.momence_location_id is not distinct from a.momence_location_id
left join revenue     r  on r.studio_id  = d.studio_id and r.day  = d.day
left join new_members nm on nm.studio_id = d.studio_id and nm.day = d.day
left join churn       c  on c.studio_id  = d.studio_id and c.day  = d.day;

-- ------------------------------------------------------------
-- Active membership base and churn rate, month by month
-- ------------------------------------------------------------

create or replace view kpi_membership_health
  with (security_invoker = on) as
select
  studio_id,
  date_trunc('month', coalesce(cancelled_at, now()))::date as month,
  count(*) filter (where status = 'active')             as active,
  count(*) filter (where status = 'frozen')             as frozen,
  count(*) filter (where status = 'renewal-cancelled')  as pending_cancellation,
  count(*) filter (where cancelled_at is not null)      as cancelled,
  count(*) filter (where renewal_failed_at is not null) as failed_renewals
from bought_memberships
group by 1, 2;

-- ------------------------------------------------------------
-- Freshness, so the dashboard can be honest about its own lag
-- ------------------------------------------------------------

create or replace view kpi_data_freshness
  with (security_invoker = on) as
select
  s.id as studio_id,
  (select max(received_at) from webhook_events w where w.studio_id = s.id) as last_webhook_at,
  (select count(*) from webhook_events w
     where w.studio_id = s.id and w.processed_at is null)                  as unprocessed_events,
  (select max(completed_at) from report_runs r
     where r.studio_id = s.id and r.status = 'completed')                  as last_report_at,
  (select coalesce(runs_used, 0) from report_budget rb
     where rb.studio_id = s.id
       and rb.budget_date = (now() at time zone 'utc')::date)              as report_runs_today
from studios s;
