-- ============================================================
-- Sales, from the total-sales report.
--
-- The payment webhook carries a transaction id and nothing else, and
-- the transaction record has no location. The total-sales report has
-- both, plus the item name, category and membership type — so it is
-- the only source that can answer "how much, from where, for what".
--
-- Momence gates report retrieval per host; this became reachable once
-- support enabled GET /api/v2/host/reports/{id}.
-- ============================================================

create table if not exists sales (
  studio_id              uuid not null references studios(id) on delete cascade,
  sale_item_id           bigint not null,
  payment_transaction_id bigint,
  member_id              integer,
  paying_member_id       integer,
  customer_name          text,
  customer_email         text,
  payment_date           timestamptz not null,
  service_date           timestamptz,
  -- Money actually taken. paid_in_money_credits is held separately and
  -- deliberately excluded from revenue: it was counted when the credit
  -- was bought, so adding it here would double-count.
  payment_value          numeric(12,2),
  payment_vat            numeric(12,2),
  paid_in_money_credits  numeric(12,2),
  refunded               numeric(12,2),
  payment_item           text,
  payment_category       text,
  membership_type        text,
  payment_method         text,
  payment_status         text,
  location_name          text,
  currency               text,
  raw                    jsonb,
  updated_at             timestamptz not null default now(),
  primary key (studio_id, sale_item_id)
);

create index if not exists sales_studio_date_idx on sales (studio_id, payment_date desc);
create index if not exists sales_location_idx    on sales (studio_id, location_name);
create index if not exists sales_item_idx        on sales (studio_id, payment_item);

alter table sales enable row level security;
create policy studio_read on sales
  for select using (studio_id in (select user_studio_ids()));

-- ------------------------------------------------------------
-- Revenue by day and location — the grain kpi_daily could not reach.
-- ------------------------------------------------------------
create or replace view kpi_revenue_daily
  with (security_invoker = on) as
select
  s.studio_id,
  (s.payment_date at time zone st.timezone)::date as day,
  s.location_name,
  sum(s.payment_value) filter (where s.payment_status = 'succeeded')  as revenue,
  sum(s.payment_vat)   filter (where s.payment_status = 'succeeded')  as vat,
  sum(s.refunded)                                                     as refunded,
  count(*) filter (where s.payment_status = 'succeeded')              as sales_count
from sales s
join studios st on st.id = s.studio_id
group by 1, 2, 3;

-- ------------------------------------------------------------
-- Revenue for a period, split by location and by what was sold.
-- ------------------------------------------------------------
create or replace function dashboard_revenue(
  p_from     date,
  p_to       date,
  p_location text default null
) returns jsonb
language sql
stable
as $$
with scoped as (
  select s.*, (s.payment_date at time zone st.timezone)::date as day
  from sales s
  join studios st on st.id = s.studio_id
  where (s.payment_date at time zone st.timezone)::date between p_from and p_to
    and (p_location is null or s.location_name = p_location)
),
succeeded as (select * from scoped where payment_status = 'succeeded'),
by_location as (
  select jsonb_agg(x order by x.revenue desc) as rows
  from (
    select
      coalesce(location_name, 'Unattributed') as name,
      round(sum(payment_value), 2)            as revenue,
      count(*)                                as sales
    from succeeded group by 1
  ) x
),
by_item as (
  select jsonb_agg(x order by x.revenue desc) as rows
  from (
    select
      coalesce(payment_item, 'Unknown')       as name,
      round(sum(payment_value), 2)            as revenue,
      count(*)                                as sales
    from succeeded group by 1
    order by 2 desc limit 12
  ) x
),
trend as (
  select jsonb_agg(x order by x.day) as rows
  from (
    select day, round(sum(payment_value), 2) as revenue
    from succeeded group by 1
  ) x
)
select jsonb_build_object(
  'revenue',      coalesce((select round(sum(payment_value), 2) from succeeded), 0),
  'vat',          coalesce((select round(sum(payment_vat), 2)   from succeeded), 0),
  'refunded',     coalesce((select round(sum(refunded), 2)      from scoped), 0),
  'sales',        (select count(*) from succeeded),
  'customers',    (select count(distinct member_id) from succeeded),
  'by_location',  coalesce((select rows from by_location), '[]'::jsonb),
  'by_item',      coalesce((select rows from by_item), '[]'::jsonb),
  'trend',        coalesce((select rows from trend), '[]'::jsonb)
);
$$;
