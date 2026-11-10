-- A sales login opens the lead list and nothing else, the marketing
-- calendar included. Every other role keeps the calendar.
create or replace function user_member_studio_ids() returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select studio_id from studio_users
  where user_id = auth.uid()
    and role <> 'sales';
$$;
