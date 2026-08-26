-- ============================================================
-- Put member contact details behind the owner role.
--
-- dashboard_at_risk returns names and email addresses of 50 identified
-- people. dashboard_performance ranks named teachers. Both were readable
-- by anyone signed in, and balance@balance.ie is a shared login likely
-- to reach staff.
--
-- studio_users.role already distinguishes owner from viewer; nothing was
-- consulting it. These functions now do.
-- ============================================================

-- True when the caller owns or administers any studio they can see.
-- security definer so it can read studio_users regardless of the caller's
-- own policy, with search_path pinned so the function cannot be tricked
-- into resolving those names against another schema.
create or replace function is_studio_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from studio_users
    where user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

revoke all on function is_studio_owner() from public;
grant execute on function is_studio_owner() to authenticated;

-- ------------------------------------------------------------
-- At-risk members: identifiable people, owners only.
-- ------------------------------------------------------------
create or replace function dashboard_at_risk(
  p_quiet_days  integer default 21,
  p_max_days    integer default 120,
  p_min_visits  integer default 5,
  p_limit       integer default 50
) returns jsonb
language sql
stable
as $$
  select case when is_studio_owner() then (
    select coalesce(jsonb_agg(r order by r.visits desc, r.last_visit), '[]'::jsonb)
    from (
      select
        m.momence_member_id as member_id,
        trim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')) as name,
        m.email,
        a.visits,
        a.last_visit::date as last_visit,
        (current_date - a.last_visit::date) as days_quiet,
        round(
          a.visits::numeric
          / greatest(1, (a.last_visit::date - a.first_visit::date) / 30.0), 1
        ) as visits_per_month
      from member_activity a
      join members m
        on m.studio_id = a.studio_id
       and m.momence_member_id = a.member_id
      where a.visits >= p_min_visits
        and a.last_visit < now() - make_interval(days => p_quiet_days)
        and a.last_visit > now() - make_interval(days => p_max_days)
      limit p_limit
    ) r
  ) else '[]'::jsonb end;
$$;

-- ------------------------------------------------------------
-- Teacher performance: named individuals, owners only.
-- Class-format performance carries no personal data and stays open.
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
      count(*) as classes,
      sum(attended) as attended,
      sum(no_shows) as no_shows,
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
      session_name as name,
      count(*) as classes,
      sum(attended) as attended,
      sum(no_shows) as no_shows,
      round(sum(booked)::numeric / nullif(sum(capacity), 0) * 100, 1) as fill
    from scoped
    where session_name is not null
    group by 1
    having count(*) >= 10
  ) f
)
select jsonb_build_object(
  'teachers', case when is_studio_owner()
                then coalesce((select rows from teachers), '[]'::jsonb)
                else '[]'::jsonb end,
  'formats',  coalesce((select rows from formats), '[]'::jsonb),
  'restricted', not is_studio_owner()
);
$$;
