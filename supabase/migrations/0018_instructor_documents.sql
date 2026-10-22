-- ============================================================
-- Instructor documents.
--
-- Office staff upload each instructor's insurance, qualifications and
-- contracts, record when each one runs out, and the app warns a month
-- before an insurance policy lapses.
--
-- The staff who do this must not see revenue or member data, so a new
-- role manages documents and nothing else. Until now any row in
-- studio_users opened every report; reporting is now granted by role:
--
--   role               reports   instructor documents
--   owner              yes       yes
--   admin              yes       yes
--   viewer             yes       no   (the shared desk login)
--   instructor_admin   no        yes
--
-- Every reporting policy, view and dashboard function filters through
-- user_studio_ids(), so leaving instructor_admin out of it closes all of
-- them at once. The new tables and the file bucket use their own function,
-- user_doc_studio_ids().
-- ============================================================

-- Replace the role check, whatever name Postgres gave the inline one in 0001.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'studio_users'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table studio_users drop constraint %I', c);
  end loop;
end $$;

alter table studio_users add constraint studio_users_role_check
  check (role in ('owner', 'admin', 'viewer', 'instructor_admin'));

-- Studios whose reports the caller may read.
create or replace function user_studio_ids() returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select studio_id from studio_users
  where user_id = auth.uid()
    and role in ('owner', 'admin', 'viewer');
$$;

-- Studios whose instructor documents the caller may read and change.
create or replace function user_doc_studio_ids() returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select studio_id from studio_users
  where user_id = auth.uid()
    and role in ('owner', 'admin', 'instructor_admin');
$$;

revoke all on function user_doc_studio_ids() from public;
grant execute on function user_doc_studio_ids() to authenticated;

-- ------------------------------------------------------------
-- Instructors. Entered by hand: Momence's teacher list carries no
-- documents, and not everyone on it is a current instructor.
-- ------------------------------------------------------------
create table instructors (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references studios(id) on delete cascade,
  full_name   text not null check (length(trim(full_name)) > 0),
  email       text,
  phone       text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (studio_id, id)
);

create index instructors_studio_idx on instructors (studio_id, active, full_name);

create table instructor_documents (
  id             uuid primary key default gen_random_uuid(),
  studio_id      uuid not null,
  instructor_id  uuid not null,
  doc_type       text not null
                 check (doc_type in ('insurance', 'qualification', 'first_aid', 'contract', 'id', 'other')),
  title          text,
  file_path      text not null unique,
  file_name      text not null,
  file_size      integer,
  mime_type      text,
  valid_until    date,
  uploaded_by    uuid default auth.uid(),
  uploaded_at    timestamptz not null default now(),

  -- A document belongs to an instructor in the same studio.
  foreign key (studio_id, instructor_id)
    references instructors (studio_id, id) on delete cascade,

  -- The expiry warning is the reason insurance is uploaded at all.
  constraint insurance_has_expiry
    check (doc_type <> 'insurance' or valid_until is not null),

  -- Files sit under <studio>/<instructor>/, which is what the bucket
  -- policy below checks.
  constraint file_in_instructor_folder
    check (file_path like studio_id::text || '/' || instructor_id::text || '/%')
);

create index instructor_documents_lookup_idx
  on instructor_documents (studio_id, instructor_id, doc_type, valid_until desc);

alter table instructors          enable row level security;
alter table instructor_documents enable row level security;

create policy doc_admin_all on instructors
  for all to authenticated
  using (studio_id in (select user_doc_studio_ids()))
  with check (studio_id in (select user_doc_studio_ids()));

create policy doc_admin_all on instructor_documents
  for all to authenticated
  using (studio_id in (select user_doc_studio_ids()))
  with check (studio_id in (select user_doc_studio_ids()));

-- ------------------------------------------------------------
-- File storage. Private: files are opened through short-lived signed
-- links, never a public URL. The first folder of every path is the
-- studio id, so access follows the same role check as the tables.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'instructor-documents', 'instructor-documents', false, 15728640,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

create policy "instructor documents: read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'instructor-documents'
    and (storage.foldername(name))[1] in (select t.id::text from user_doc_studio_ids() as t(id))
  );

create policy "instructor documents: upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'instructor-documents'
    and (storage.foldername(name))[1] in (select t.id::text from user_doc_studio_ids() as t(id))
  );

create policy "instructor documents: delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'instructor-documents'
    and (storage.foldername(name))[1] in (select t.id::text from user_doc_studio_ids() as t(id))
  );
