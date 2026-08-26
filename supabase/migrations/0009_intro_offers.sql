-- ============================================================
-- Intro-offer conversion, and what the revenue is made of.
--
-- The original design expected these from the intro-offers-conversions
-- report, which the API does not expose. They are reconstructable from
-- total-sales instead: an intro offer is a sale, and a conversion is
-- the same member buying something else afterwards.
-- ============================================================

create index if not exists sales_member_date_idx
  on sales (studio_id, member_id, payment_date);

-- ------------------------------------------------------------
-- Did people who bought an intro offer buy anything afterwards?
--
-- Conversion is "bought something else, at a positive price, after the
-- intro". Deliberately not restricted to memberships: a returning
-- customer buying a class pack has converted in every sense that matters.
-- ------------------------------------------------------------
create or replace function dashboard_intro_offers(
  p_from date,
  p_to   date
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
converted as (
  select
    i.member_id,
    i.intro_date,
    i.location_name,
    min(s.payment_date)  filter (where s.payment_date > i.intro_date) as first_next,
    sum(s.payment_value) filter (where s.payment_date > i.intro_date) as later_value
  from intros i
  left join sales s
    on s.studio_id = i.studio_id
   and s.member_id = i.member_id
   and s.payment_status = 'succeeded'
   and s.payment_value > 0
   and s.payment_item not ilike '%intro offer%'
  group by 1, 2, 3
),
by_location as (
  select jsonb_agg(x order by x.conversion desc) as rows
  from (
    select
      coalesce(location_name, 'Unattributed') as name,
      count(*) as intros,
      count(*) filter (where first_next is not null) as converted,
      round(count(*) filter (where first_next is not null)::numeric
            / nullif(count(*), 0) * 100, 1) as conversion
    from converted
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
            / nullif(count(*), 0) * 100, 1) as conversion
    from converted
    group by 1
  ) x
)
select jsonb_build_object(
  'intros',      (select count(*) from converted),
  'converted',   (select count(*) from converted where first_next is not null),
  'conversion',  (select round(count(*) filter (where first_next is not null)::numeric
                              / nullif(count(*), 0) * 100, 1) from converted),
  'median_days', (select round(percentile_cont(0.5) within group (
                    order by extract(epoch from (first_next - intro_date)) / 86400.0
                  )::numeric, 1) from converted where first_next is not null),
  'value_after', (select coalesce(round(sum(later_value), 2), 0) from converted),
  'by_location', coalesce((select rows from by_location), '[]'::jsonb),
  'by_month',    coalesce((select rows from by_month), '[]'::jsonb)
);
$$;

-- ------------------------------------------------------------
-- What the revenue is actually made of.
--
-- Recurring income is worth more than the same amount taken once, so
-- the membership share is what tells an owner how predictable next
-- month is.
-- ------------------------------------------------------------
create or replace function dashboard_revenue_mix(
  p_from date,
  p_to   date
) returns jsonb
language sql
stable
as $$
with scoped as (
  select *
  from sales
  where payment_status = 'succeeded'
    and payment_date::date between p_from and p_to
)
select jsonb_build_object(
  'total',        coalesce(round(sum(payment_value), 2), 0),
  'membership',   coalesce(round(sum(payment_value) filter (
                    where payment_category = 'membership'), 2), 0),
  'intro',        coalesce(round(sum(payment_value) filter (
                    where payment_item ilike '%intro offer%'), 2), 0),
  'other',        coalesce(round(sum(payment_value) filter (
                    where coalesce(payment_category, '') <> 'membership'
                      and payment_item not ilike '%intro offer%'), 2), 0),
  'avg_sale',     coalesce(round(avg(payment_value), 2), 0),
  'customers',    count(distinct member_id),
  'per_customer', coalesce(round(sum(payment_value) / nullif(count(distinct member_id), 0), 2), 0)
)
from scoped;
$$;
