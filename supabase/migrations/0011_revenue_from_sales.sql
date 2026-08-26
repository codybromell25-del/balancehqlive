-- ============================================================
-- Point the headline revenue figure at the sales table.
--
-- kpi_daily took revenue from payment_transactions, which is fed only
-- by the payment webhook and therefore only holds events since the
-- integration was connected — 243 rows against 24,649 in sales. The
-- Revenue tile read EUR 2,074 for a 28-day window in which the studio
-- actually took EUR 160,243.
--
-- sales comes from the total-sales report and covers the full history,
-- carries the location and the item, and nets off refunds. It is the
-- authoritative source; payment_transactions remains useful only as a
-- near-real-time signal that money is moving.
-- ============================================================

drop view if exists kpi_daily;

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
  coalesce(c.bookings_made, 0)          as bookings_made,
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
