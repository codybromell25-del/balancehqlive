-- ============================================================
-- Make the headline revenue figure respect the location filter.
--
-- dashboard_summary took revenue from kpi_daily, which has no location
-- dimension, so the Revenue tile showed the studio-wide total whichever
-- site was selected.
--
-- The earlier claim that revenue could not be attributed to a location
-- was true of payment_transactions, whose webhook payload carries no
-- site. It is not true of sales: the total-sales report puts the
-- location on each transaction item.
--
-- sales stores the location as the name Momence recorded, so the numeric
-- id the rest of the dashboard filters on is resolved through locations.
-- ============================================================

create index if not exists locations_name_idx on locations (studio_id, name);

create or replace function dashboard_summary(
  p_from        date,
  p_to          date,
  p_location    integer default null
) returns jsonb
language sql
stable
as $$
with scoped as (
  select *
  from kpi_daily_location
  where day >= p_from
    and day <= p_to
    and (p_location is null or momence_location_id = p_location)
),
totals as (
  select
    coalesce(sum(classes_run), 0)      as classes_run,
    coalesce(sum(capacity_offered), 0) as capacity_offered,
    coalesce(sum(spots_taken), 0)      as spots_taken,
    coalesce(sum(attended), 0)         as attended,
    coalesce(sum(no_shows), 0)         as no_shows,
    coalesce(sum(bookings_made), 0)    as bookings_made
  from scoped
),
-- Revenue now honours the filter. Sales Momence never attributed to a
-- site — chiefly the MindBody import — are excluded when one is selected,
-- so per-location figures will not sum to the studio-wide total. That is
-- honest: those sales genuinely have no location.
revenue as (
  select
    coalesce(sum(s.payment_value) filter (where s.payment_status = 'succeeded'), 0) as revenue,
    coalesce(count(*) filter (where s.payment_status = 'succeeded'), 0)             as payments_succeeded,
    coalesce(count(*) filter (where s.payment_status = 'failed'), 0)                as payments_failed
  from sales s
  join studios st on st.id = s.studio_id
  left join locations l
    on l.studio_id = s.studio_id
   and l.name = s.location_name
  where (s.payment_date at time zone st.timezone)::date between p_from and p_to
    and (p_location is null or l.momence_location_id = p_location)
),
-- Membership movement still has no location dimension anywhere in the
-- data, so these stay studio-wide and are labelled as such in the UI.
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
    from kpi_daily_location
    where day >= p_from and day <= p_to
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
  'bookings_made',    t.bookings_made,
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
