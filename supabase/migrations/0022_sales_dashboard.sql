-- ============================================================
-- Sales dashboard.
--
-- A lead list for the salesperson selling staff-discount classes to
-- employers near each studio: hotels, companies, primary and secondary
-- schools, universities and colleges. Each lead keeps where it stands
-- (to contact, follow up, interested, signed up...) and a log of every
-- call, email and note.
--
-- A new role opens it without anything else:
--
--   role               reports   instructor docs   calendar   sales
--   owner, admin       yes       yes               yes        yes
--   viewer             yes       no                yes        no
--   instructor_admin   no        yes               yes        no
--   sales              no        no                yes        yes
--
-- user_studio_ids() and user_doc_studio_ids() list their roles by name,
-- so sales is shut out of reports and documents without touching them.
-- The calendar's user_member_studio_ids() takes any role, sales included.
-- ============================================================

alter table studio_users drop constraint studio_users_role_check;
alter table studio_users add constraint studio_users_role_check
  check (role in ('owner', 'admin', 'viewer', 'instructor_admin', 'sales'));

-- Studios whose leads the caller may work.
create or replace function user_sales_studio_ids() returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select studio_id from studio_users
  where user_id = auth.uid()
    and role in ('owner', 'admin', 'sales');
$$;

revoke all on function user_sales_studio_ids() from public;
grant execute on function user_sales_studio_ids() to authenticated;

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------

create table sales_leads (
  id              uuid primary key default gen_random_uuid(),
  studio_id       uuid not null references studios(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 200),
  category        text not null
                  check (category in ('company', 'hotel', 'primary_school', 'secondary_school', 'university')),
  area            text not null
                  check (area in ('Limerick', 'Kildare Town', 'Clane', 'Bray', 'Enfield', 'Blessington')),
  town            text,
  address         text,
  eircode         text,
  phone           text,
  email           text,
  website         text,
  contact_name    text,
  contact_role    text,
  size            text,
  sector          text,
  distance_km     numeric(5, 1),
  -- Where the contact details came from: a dataset or the page they were on.
  source          text,
  status          text not null default 'new'
                  check (status in ('new', 'contacted', 'follow_up', 'interested', 'won', 'not_interested', 'do_not_contact')),
  follow_up_on    date,
  last_contact_at timestamptz,
  -- A stable key for imports (a school's roll number, say), so running an
  -- import again updates the lead instead of adding a second copy.
  ref             text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (studio_id, ref)
);

create index on sales_leads (studio_id, status);
create index on sales_leads (studio_id, area, category);

create table sales_activities (
  id           uuid primary key default gen_random_uuid(),
  studio_id    uuid not null references studios(id) on delete cascade,
  lead_id      uuid not null references sales_leads(id) on delete cascade,
  kind         text not null check (kind in ('call', 'email', 'meeting', 'note', 'status')),
  body         text check (char_length(body) <= 4000),
  author_id    uuid not null,
  author_email text not null,
  created_at   timestamptz not null default now()
);

create index on sales_activities (lead_id, created_at desc);

-- Who logged an activity comes from the session, and it always sits in
-- its lead's studio.
create or replace function sales_activity_stamp() returns trigger
language plpgsql
set search_path = public
as $$
declare
  lead_studio uuid;
begin
  select studio_id into lead_studio from sales_leads where id = new.lead_id;
  if not found then
    raise exception 'That lead no longer exists.';
  end if;
  new.studio_id := lead_studio;
  new.author_id := auth.uid();
  new.author_email := coalesce(auth.jwt() ->> 'email', '');
  new.created_at := now();
  return new;
end $$;

create trigger sales_activity_stamp before insert on sales_activities
  for each row execute function sales_activity_stamp();

create or replace function sales_lead_touch() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger sales_lead_touch before update on sales_leads
  for each row execute function sales_lead_touch();

-- ------------------------------------------------------------
-- Row level security
-- ------------------------------------------------------------

alter table sales_leads      enable row level security;
alter table sales_activities enable row level security;

revoke all on sales_leads, sales_activities from anon;

create policy sales_read on sales_leads
  for select to authenticated
  using (studio_id in (select user_sales_studio_ids()));

create policy sales_add on sales_leads
  for insert to authenticated
  with check (studio_id in (select user_sales_studio_ids()));

create policy sales_change on sales_leads
  for update to authenticated
  using (studio_id in (select user_sales_studio_ids()))
  with check (studio_id in (select user_sales_studio_ids()));

-- Salespeople mark a lead "not interested" or "do not contact" rather
-- than deleting it; only owners and admins remove leads outright.
create policy sales_remove on sales_leads
  for delete to authenticated
  using (studio_id in (select user_manager_studio_ids()));

create policy sales_read on sales_activities
  for select to authenticated
  using (studio_id in (select user_sales_studio_ids()));

create policy sales_add on sales_activities
  for insert to authenticated
  with check (studio_id in (select user_sales_studio_ids()) and author_id = auth.uid());

create policy sales_remove on sales_activities
  for delete to authenticated
  using (
    (author_id = auth.uid() and studio_id in (select user_sales_studio_ids()))
    or studio_id in (select user_manager_studio_ids())
  );
