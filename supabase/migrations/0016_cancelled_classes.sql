-- ============================================================
-- Cancelled classes.
--
-- The studio reviews numbers daily and pulls classes with two or fewer
-- booked. This makes that visible: how often it happens, at which sites,
-- and how many members were turned away each time.
--
-- Momence zeroes bookingCount on a cancelled session, so the count has to
-- come from the booking rows themselves, which survive.
-- ============================================================

create index if not exists sessions_cancelled_idx
  on sessions (studio_id, starts_at) where cancelled;

create or replace view kpi_cancelled_classes
  with (security_invoker = on) as
select
  s.studio_id,
  s.momence_session_id,
  s.name                                        as class_name,
  s.teacher_name,
  s.momence_location_id,
  l.name                                        as location_name,
  s.starts_at,
  (s.starts_at at time zone st.timezone)::date  as class_date,
  s.capacity,
  count(b.momence_booking_id)                   as were_booked,
  -- When the studio pulled it. Every booking on a cancelled class is
  -- cancelled at once, so the latest stamp is the cancellation moment.
  max(b.cancelled_at)                           as cancelled_at
from sessions s
join studios st on st.id = s.studio_id
left join locations l
  on l.studio_id = s.studio_id and l.momence_location_id = s.momence_location_id
left join session_bookings b
  on b.studio_id = s.studio_id and b.momence_session_id = s.momence_session_id
where s.cancelled
group by 1,2,3,4,5,6,7,8,9;

create or replace function dashboard_cancelled_classes(
  p_from     date,
  p_to       date,
  p_location integer default null
) returns jsonb
language sql
stable
as $$
with scoped as (
  select *
  from kpi_cancelled_classes
  where class_date between p_from and p_to
    and (p_location is null or momence_location_id = p_location)
),
-- How full the class was when it was pulled. The studio's own rule is two
-- or fewer, so anything above that is a cancellation for another reason —
-- illness, holidays, a room problem — and is worth separating out.
buckets as (
  select
    count(*) filter (where were_booked = 0)              as empty,
    count(*) filter (where were_booked between 1 and 2)  as low,
    count(*) filter (where were_booked >= 3)             as other,
    count(*)                                             as total,
    coalesce(sum(were_booked), 0)                        as members_affected
  from scoped
),
by_location as (
  select jsonb_agg(x order by x.cancelled desc) as rows
  from (
    select
      coalesce(location_name, 'Unassigned') as name,
      count(*)                              as cancelled,
      coalesce(sum(were_booked), 0)         as members_affected,
      count(*) filter (where were_booked >= 3) as against_policy
    from scoped group by 1
  ) x
),
by_month as (
  select jsonb_agg(x order by x.month) as rows
  from (
    select
      to_char(date_trunc('month', class_date), 'YYYY-MM') as month,
      count(*) as cancelled
    from scoped group by 1
  ) x
),
-- Cancellations that do not fit the two-or-fewer rule, most-booked first.
notable as (
  select jsonb_agg(x order by x.were_booked desc, x.class_date desc) as rows
  from (
    select
      class_date, class_name, teacher_name,
      coalesce(location_name, 'Unassigned') as location_name,
      capacity, were_booked
    from scoped
    where were_booked >= 3
    order by were_booked desc, class_date desc
    limit 15
  ) x
)
select jsonb_build_object(
  'total',            b.total,
  'empty',            b.empty,
  'low',              b.low,
  'other',            b.other,
  'members_affected', b.members_affected,
  'by_location',      coalesce((select rows from by_location), '[]'::jsonb),
  'by_month',         coalesce((select rows from by_month), '[]'::jsonb),
  'against_policy',   coalesce((select rows from notable), '[]'::jsonb)
)
from buckets b;
$$;
