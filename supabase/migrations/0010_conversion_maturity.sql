-- ============================================================
-- Two corrections the first real data exposed.
--
-- 1. Conversion rate was being reported for intro offers bought days
--    ago alongside ones bought a year ago. Median time to convert is
--    23 days with a long tail, so a recent cohort always looks like a
--    failure. Limerick opened in May 2026 and read as 12% conversion
--    against Clane's 61% — an artifact of age, not performance.
--
-- 2. Momence categorises intro offers as `membership`, so the revenue
--    mix counted them twice and the buckets summed above the total.
-- ============================================================

create or replace function dashboard_intro_offers(
  p_from         date,
  p_to           date,
  p_mature_days  integer default 60
) returns jsonb
language sql
stable
as $$
with intros as (
  select
    studio_id,
    member_id,
    min(payment_date) as intro_date,
    min(location_name) filter (where location_name is not null) as location_name
  from sales
  where payment_status = 'succeeded'
    and payment_item ilike '%intro offer%'
    and member_id is not null
    and payment_date::date between p_from and p_to
  group by 1, 2
),
classified as (
  select
    i.member_id,
    i.intro_date,
    i.location_name,
    -- An intro bought last week cannot fairly be called unconverted.
    (i.intro_date < now() - make_interval(days => p_mature_days)) as mature,
    min(s.payment_date)  filter (where s.payment_date > i.intro_date) as first_next,
    sum(s.payment_value) filter (where s.payment_date > i.intro_date) as later_value
  from intros i
  left join sales s
    on s.studio_id = i.studio_id
   and s.member_id = i.member_id
   and s.payment_status = 'succeeded'
   and s.payment_value > 0
   and s.payment_item not ilike '%intro offer%'
  group by 1, 2, 3, 4
),
mature as (select * from classified where mature),
by_location as (
  select jsonb_agg(x order by x.conversion desc) as rows
  from (
    select
      coalesce(location_name, 'Unattributed') as name,
      count(*) as intros,
      count(*) filter (where first_next is not null) as converted,
      round(count(*) filter (where first_next is not null)::numeric
            / nullif(count(*), 0) * 100, 1) as conversion
    from mature
    group by 1
    having count(*) >= 10
  ) x
),
by_month as (
  select jsonb_agg(x order by x.month) as rows
  from (
    select
      to_char(date_trunc('month', intro_date), 'YYYY-MM') as month,
      count(*) as intros,
      count(*) filter (where first_next is not null) as converted,
      round(count(*) filter (where first_next is not null)::numeric
            / nullif(count(*), 0) * 100, 1) as conversion,
      bool_and(mature) as mature
    from classified
    group by 1
  ) x
)
select jsonb_build_object(
  'intros',        (select count(*) from mature),
  'converted',     (select count(*) from mature where first_next is not null),
  'conversion',    (select round(count(*) filter (where first_next is not null)::numeric
                                / nullif(count(*), 0) * 100, 1) from mature),
  'pending',       (select count(*) from classified where not mature),
  'mature_days',   p_mature_days,
  'median_days',   (select round(percentile_cont(0.5) within group (
                      order by extract(epoch from (first_next - intro_date)) / 86400.0
                    )::numeric, 1) from mature where first_next is not null),
  'value_after',   (select coalesce(round(sum(later_value), 2), 0) from mature),
  'by_location',   coalesce((select rows from by_location), '[]'::jsonb),
  'by_month',      coalesce((select rows from by_month), '[]'::jsonb)
);
$$;

-- Mutually exclusive buckets: an intro offer is an intro offer first,
-- even though Momence files it under membership.
create or replace function dashboard_revenue_mix(
  p_from date,
  p_to   date
) returns jsonb
language sql
stable
as $$
with scoped as (
  select
    payment_value,
    member_id,
    case
      when payment_item ilike '%intro offer%'     then 'intro'
      when payment_category = 'membership'        then 'membership'
      else 'other'
    end as bucket
  from sales
  where payment_status = 'succeeded'
    and payment_date::date between p_from and p_to
)
select jsonb_build_object(
  'total',        coalesce(round(sum(payment_value), 2), 0),
  'membership',   coalesce(round(sum(payment_value) filter (where bucket = 'membership'), 2), 0),
  'intro',        coalesce(round(sum(payment_value) filter (where bucket = 'intro'), 2), 0),
  'other',        coalesce(round(sum(payment_value) filter (where bucket = 'other'), 2), 0),
  'avg_sale',     coalesce(round(avg(payment_value), 2), 0),
  'customers',    count(distinct member_id),
  'per_customer', coalesce(round(sum(payment_value) / nullif(count(distinct member_id), 0), 2), 0)
)
from scoped;
$$;
