-- ============================================================
-- Owner insights: schedule heatmap, lapsing members, and
-- performance by teacher and class format.
--
-- All three aggregate in Postgres for the same reason 0005 did:
-- a year of sessions and 90k bookings cannot be summed client side
-- without hitting the 1000-row response cap.
-- ============================================================

-- Sessions carry a teacher id but no name, so a teacher breakdown would
-- read as a list of integers. Denormalised onto the session rather than
-- given its own table: it is written once by the backfill and only ever
-- read alongside the session.
alter table sessions add column if not exists teacher_name text;

create index if not exists sessions_teacher_idx
  on sessions (studio_id, teacher_id) where teacher_id is not null;

-- ------------------------------------------------------------
-- Schedule heatmap: fill rate by weekday and hour.
--
-- Weekday and hour are resolved in the studio's own timezone — an 08:00
-- class in Dublin is 07:00 UTC for half the year, and a heatmap that
-- shifts by an hour at the equinox is worse than none.
-- ------------------------------------------------------------
create or replace function dashboard_heatmap(
  p_from     date,
  p_to       date,
  p_location integer default null
) returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(h order by h.weekday, h.hour), '[]'::jsonb)
  from (
    select
      extract(isodow from o.starts_at at time zone st.timezone)::int as weekday,
      extract(hour   from o.starts_at at time zone st.timezone)::int as hour,
      count(*)                                       as classes,
      sum(o.capacity)                                as capacity,
      sum(o.booked)                                  as booked,
      sum(o.attended)                                as attended,
      case when sum(o.capacity) > 0
        then round(sum(o.booked)::numeric / sum(o.capacity) * 100, 1)
      end                                            as fill
    from kpi_session_occupancy o
    join studios st on st.id = o.studio_id
    where o.session_date >= p_from
      and o.session_date <= p_to
      and o.capacity > 0
      and (p_location is null or o.momence_location_id = p_location)
    group by 1, 2
  ) h;
$$;

-- ------------------------------------------------------------
-- Members who were regular and have gone quiet.
--
-- "Regular" is deliberately a floor on past visits rather than a rate:
-- someone who came twice and stopped was never really a member, and
-- putting them on a call list wastes the caller's time.
-- ------------------------------------------------------------
create or replace function dashboard_at_risk(
  p_quiet_days   integer default 21,
  p_max_days     integer default 120,
  p_min_visits   integer default 5,
  p_limit        integer default 50
) returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(r order by r.visits desc, r.last_visit), '[]'::jsonb)
  from (
    select
      m.momence_member_id            as member_id,
      trim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')) as name,
      m.email,
      a.visits,
      a.last_visit::date             as last_visit,
      (current_date - a.last_visit::date) as days_quiet,
      -- Visits per month while they were active, so the caller can see who
      -- was twice a week versus who was once a month.
      round(
        a.visits::numeric
        / greatest(1, (a.last_visit::date - a.first_visit::date) / 30.0),
        1
      )                              as visits_per_month
    from (
      select
        studio_id,
        member_id,
        count(*)        as visits,
        max(booked_at)  as last_visit,
        min(booked_at)  as first_visit
      from session_bookings
      where status in ('booked', 'checked-in', 'no-show')
      group by 1, 2
    ) a
    join members m
      on m.studio_id = a.studio_id
     and m.momence_member_id = a.member_id
    where a.visits >= p_min_visits
      and a.last_visit < now() - make_interval(days => p_quiet_days)
      and a.last_visit > now() - make_interval(days => p_max_days)
    limit p_limit
  ) r;
$$;

-- ------------------------------------------------------------
-- Performance by teacher and by class format.
--
-- Class format comes from the session name — Momence's `type` is
-- "fitness" for every reformer class, so it carries no signal here.
-- ------------------------------------------------------------
create or replace function dashboard_performance(
  p_from     date,
  p_to       date,
  p_location integer default null
) returns jsonb
language sql
stable
as $$
with scoped as (
  -- kpi_session_occupancy already exposes session_name; selecting s.name
  -- under the same alias alongside o.* made every reference ambiguous.
  select o.*, s.teacher_name
  from kpi_session_occupancy o
  join sessions s
    on s.studio_id = o.studio_id
   and s.momence_session_id = o.momence_session_id
  where o.session_date >= p_from
    and o.session_date <= p_to
    and o.capacity > 0
    and (p_location is null or o.momence_location_id = p_location)
),
teachers as (
  select jsonb_agg(t order by t.fill desc) as rows
  from (
    select
      coalesce(teacher_name, 'Unknown') as name,
      count(*)        as classes,
      sum(attended)   as attended,
      sum(no_shows)   as no_shows,
      round(sum(booked)::numeric / nullif(sum(capacity), 0) * 100, 1) as fill
    from scoped
    where teacher_id is not null
    group by 1
    having count(*) >= 10
  ) t
),
formats as (
  select jsonb_agg(f order by f.fill desc) as rows
  from (
    select
      session_name    as name,
      count(*)        as classes,
      sum(attended)   as attended,
      sum(no_shows)   as no_shows,
      round(sum(booked)::numeric / nullif(sum(capacity), 0) * 100, 1) as fill
    from scoped
    where session_name is not null
    group by 1
    having count(*) >= 10
  ) f
)
select jsonb_build_object(
  'teachers', coalesce((select rows from teachers), '[]'::jsonb),
  'formats',  coalesce((select rows from formats),  '[]'::jsonb)
);
$$;
