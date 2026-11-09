-- ============================================================
-- Marketing calendar.
--
-- A shared calendar for planning campaigns. Key dates are flagged on
-- their day: balance's own dates (studio birthdays, launches),
-- marketing moments, and bank holidays and school breaks. On any day
-- staff leave notes, reply under a note, and like notes and replies.
--
-- Every role opens it, the documents-only and reports-only logins
-- included: it holds plans, not revenue or member data. Anyone can add
-- notes and flags and delete their own; owners and admins can delete
-- anyone's.
-- ============================================================

-- Studios whose calendar the caller may read and write: any role.
create or replace function user_member_studio_ids() returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select studio_id from studio_users where user_id = auth.uid();
$$;

-- Studios where the caller may delete anyone's notes and flags.
create or replace function user_manager_studio_ids() returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select studio_id from studio_users
  where user_id = auth.uid()
    and role in ('owner', 'admin');
$$;

revoke all on function user_member_studio_ids() from public;
revoke all on function user_manager_studio_ids() from public;
grant execute on function user_member_studio_ids() to authenticated;
grant execute on function user_manager_studio_ids() to authenticated;

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------

create table marketing_flags (
  id         uuid primary key default gen_random_uuid(),
  studio_id  uuid not null references studios(id) on delete cascade,
  day        date not null,
  kind       text not null default 'balance'
             check (kind in ('balance', 'moment', 'holiday')),
  title      text not null check (char_length(title) between 1 and 80),
  detail     text check (char_length(detail) <= 200),
  created_by uuid default auth.uid(),   -- null on the dates flagged below
  created_at timestamptz not null default now(),
  unique (studio_id, day, title)
);

-- A note is a reply when parent_id is set. Replies sit one level deep.
create table marketing_notes (
  id           uuid primary key default gen_random_uuid(),
  studio_id    uuid not null references studios(id) on delete cascade,
  day          date not null,
  parent_id    uuid references marketing_notes(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 2000),
  author_id    uuid not null,
  author_email text not null,
  created_at   timestamptz not null default now()
);

create index on marketing_notes (studio_id, day);
create index on marketing_notes (parent_id);

create table marketing_note_likes (
  note_id    uuid not null references marketing_notes(id) on delete cascade,
  user_id    uuid not null,
  user_email text not null,
  created_at timestamptz not null default now(),
  primary key (note_id, user_id)
);

-- Who wrote a note, or liked one, comes from the session and never from
-- the request. A reply always lands under the top-level note it answers,
-- on that note's day: the parent is looked up as the caller, so a note
-- they can't see can't be replied to.
create or replace function marketing_note_stamp() returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent marketing_notes;
begin
  new.author_id := auth.uid();
  new.author_email := coalesce(auth.jwt() ->> 'email', '');
  new.created_at := now();

  if new.parent_id is not null then
    select * into parent from marketing_notes where id = new.parent_id;
    if not found then
      raise exception 'That note no longer exists.';
    end if;
    new.parent_id := coalesce(parent.parent_id, parent.id);
    new.studio_id := parent.studio_id;
    new.day := parent.day;
  end if;

  return new;
end $$;

create trigger marketing_note_stamp before insert on marketing_notes
  for each row execute function marketing_note_stamp();

create or replace function marketing_like_stamp() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.user_id := auth.uid();
  new.user_email := coalesce(auth.jwt() ->> 'email', '');
  new.created_at := now();
  return new;
end $$;

create trigger marketing_like_stamp before insert on marketing_note_likes
  for each row execute function marketing_like_stamp();

-- ------------------------------------------------------------
-- Row level security
-- ------------------------------------------------------------

alter table marketing_flags      enable row level security;
alter table marketing_notes      enable row level security;
alter table marketing_note_likes enable row level security;

revoke all on marketing_flags, marketing_notes, marketing_note_likes from anon;

create policy marketing_read on marketing_flags
  for select to authenticated
  using (studio_id in (select user_member_studio_ids()));

create policy marketing_add on marketing_flags
  for insert to authenticated
  with check (studio_id in (select user_member_studio_ids()) and created_by = auth.uid());

create policy marketing_remove on marketing_flags
  for delete to authenticated
  using (
    (created_by = auth.uid() and studio_id in (select user_member_studio_ids()))
    or studio_id in (select user_manager_studio_ids())
  );

create policy marketing_read on marketing_notes
  for select to authenticated
  using (studio_id in (select user_member_studio_ids()));

create policy marketing_add on marketing_notes
  for insert to authenticated
  with check (studio_id in (select user_member_studio_ids()) and author_id = auth.uid());

create policy marketing_remove on marketing_notes
  for delete to authenticated
  using (
    (author_id = auth.uid() and studio_id in (select user_member_studio_ids()))
    or studio_id in (select user_manager_studio_ids())
  );

-- A like can be seen, and given, wherever its note can be seen.
create policy marketing_read on marketing_note_likes
  for select to authenticated
  using (exists (select 1 from marketing_notes n where n.id = marketing_note_likes.note_id));

create policy marketing_add on marketing_note_likes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from marketing_notes n where n.id = marketing_note_likes.note_id)
  );

create policy marketing_remove on marketing_note_likes
  for delete to authenticated
  using (user_id = auth.uid());

-- ------------------------------------------------------------
-- The dates to plan around, November 2026 to New Year 2028.
--
-- Studio birthdays are each studio's first class in the booking data:
-- Clane 7 Jun 2021, Kildare Town 12 Sep 2023, Blessington 2 Dec 2024,
-- Enfield 9 Dec 2024, Bray 5 Aug 2025, Limerick 25 May 2026. School
-- breaks are the Department of Education's standardised 2026/27 dates.
-- ------------------------------------------------------------

insert into marketing_flags (studio_id, day, kind, title, detail, created_by)
select s.id, v.day::date, v.kind, v.title, v.detail, null
from studios s
cross join (values
  ('2026-11-27', 'moment',  'Black Friday',              'The biggest offer weekend of the year: gift cards and class packs.'),
  ('2026-11-30', 'moment',  'Cyber Monday',              'Last day of the Black Friday offers.'),
  ('2026-12-02', 'balance', 'Blessington turns 2',       'First class 2 Dec 2024. Thank the members, run a birthday offer.'),
  ('2026-12-09', 'balance', 'Enfield turns 2',           'First class 9 Dec 2024. Thank the members, run a birthday offer.'),
  ('2026-12-09', 'moment',  'Joseph Pilates'' birthday', 'Born 9 December 1883. An easy, fun post for social.'),
  ('2026-12-24', 'moment',  'Christmas Eve',             'Last-minute digital gift cards.'),
  ('2026-12-25', 'holiday', 'Christmas Day',             'Public holiday.'),
  ('2026-12-26', 'holiday', 'St Stephen''s Day',         'Public holiday.'),
  ('2026-12-31', 'moment',  'New Year''s Eve',           'Launch the January offer.'),
  ('2027-01-01', 'holiday', 'New Year''s Day',           'Public holiday. New year, new routine: January is sign-up season.'),
  ('2027-01-04', 'moment',  'First Monday back',         'Most people are back at work. Push the January intro offers.'),
  ('2027-01-18', 'moment',  'Blue Monday',               'Billed as the gloomiest day of the year. A feel-good class or offer.'),
  ('2027-02-01', 'holiday', 'St Brigid''s Day',          'Public holiday, and the first day of spring in Ireland.'),
  ('2027-02-14', 'moment',  'Valentine''s Day',          'Partner or bring-a-friend classes (Galentine''s is the 13th).'),
  ('2027-02-15', 'holiday', 'February mid-term',         'Secondary schools off 15-19 Feb, primary schools 18-19 Feb.'),
  ('2027-03-07', 'moment',  'Mother''s Day',             'Gift cards, and classes to bring Mum along to.'),
  ('2027-03-08', 'moment',  'International Women''s Day', 'Celebrate the members and the instructors.'),
  ('2027-03-17', 'holiday', 'St Patrick''s Day',         'Public holiday.'),
  ('2027-03-19', 'holiday', 'Schools break for Easter',  'Schools off from 19 March, back 5 April.'),
  ('2027-03-28', 'moment',  'Easter Sunday',             'Easter weekend timetable. The clocks go forward this morning.'),
  ('2027-03-29', 'holiday', 'Easter Monday',             'Public holiday.'),
  ('2027-04-07', 'moment',  'World Health Day',          'Health and wellbeing content.'),
  ('2027-05-01', 'moment',  'World Pilates Day',         'Pilates'' own day, the first Saturday in May: open classes and taster offers.'),
  ('2027-05-03', 'holiday', 'May bank holiday',          'Public holiday.'),
  ('2027-05-25', 'balance', 'Limerick turns 1',          'First class 25 May 2026. Its first birthday.'),
  ('2027-06-07', 'holiday', 'June bank holiday',         'Public holiday.'),
  ('2027-06-07', 'balance', 'Clane turns 6',             'Where balance started: first class 7 June 2021.'),
  ('2027-06-12', 'moment',  'Global Wellness Day',       'The second Saturday in June: a community class or open day.'),
  ('2027-06-20', 'moment',  'Father''s Day',             'Gift cards: get the dads on the reformer.'),
  ('2027-08-02', 'holiday', 'August bank holiday',       'Public holiday.'),
  ('2027-08-05', 'balance', 'Bray turns 2',              'First class 5 Aug 2025. Thank the members, run a birthday offer.'),
  ('2027-09-01', 'moment',  'September reset',           'Back-to-routine season, the year''s second January. Autumn intro offers.'),
  ('2027-09-12', 'balance', 'Kildare Town turns 4',      'First class 12 Sep 2023. Thank the members, run a birthday offer.'),
  ('2027-10-10', 'moment',  'World Mental Health Day',   'Movement and mental health.'),
  ('2027-10-18', 'moment',  'World Menopause Day',       'Pilates through perimenopause and menopause.'),
  ('2027-10-25', 'holiday', 'October bank holiday',      'Public holiday.'),
  ('2027-10-31', 'moment',  'Halloween',                 'Themed classes. The clocks go back this morning.'),
  ('2027-11-26', 'moment',  'Black Friday',              'The biggest offer weekend of the year: gift cards and class packs.'),
  ('2027-11-29', 'moment',  'Cyber Monday',              'Last day of the Black Friday offers.'),
  ('2027-12-02', 'balance', 'Blessington turns 3',       'First class 2 Dec 2024. Thank the members, run a birthday offer.'),
  ('2027-12-09', 'balance', 'Enfield turns 3',           'First class 9 Dec 2024. Thank the members, run a birthday offer.'),
  ('2027-12-09', 'moment',  'Joseph Pilates'' birthday', 'Born 9 December 1883. An easy, fun post for social.'),
  ('2027-12-24', 'moment',  'Christmas Eve',             'Last-minute digital gift cards.'),
  ('2027-12-25', 'holiday', 'Christmas Day',             'Public holiday.'),
  ('2027-12-26', 'holiday', 'St Stephen''s Day',         'Public holiday.'),
  ('2027-12-31', 'moment',  'New Year''s Eve',           'Launch the January offer.'),
  ('2028-01-01', 'holiday', 'New Year''s Day',           'Public holiday.')
) as v(day, kind, title, detail)
on conflict (studio_id, day, title) do nothing;
