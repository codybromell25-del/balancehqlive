-- ============================================================
-- Authorization code flow
--
-- The password grant cannot complete a 2FA challenge, and Momence
-- enforces 2FA on host accounts. Under the authorization code flow the
-- owner signs in on Momence's own screen — 2FA included — and we only
-- ever hold the resulting tokens. Staff credentials stop being needed,
-- and stop being stored.
-- ============================================================

-- Existing rows were onboarded under the password grant; keep them
-- valid while making both columns optional going forward.
alter table studio_credentials alter column staff_username    drop not null;
alter table studio_credentials alter column staff_password_enc drop not null;

-- Where the authorization code is sent back. Registered on the Momence
-- OAuth client, and echoed on the token exchange, so it has to match
-- exactly on both legs.
alter table studio_credentials add column if not exists redirect_uri text;

-- refresh_token_enc already exists on studio_tokens but was never
-- populated by the password grant. Under this flow it is the only way
-- back to a live access token, so a row without one is unusable.
alter table studio_tokens add column if not exists obtained_via text
  not null default 'password'
  check (obtained_via in ('password', 'authorization_code', 'refresh_token'));

-- Short-lived CSRF state for in-flight authorizations. Rows are consumed
-- on callback and swept after an hour; anything older never completed.
create table if not exists oauth_states (
  state       text primary key,
  studio_id   uuid not null references studios(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists oauth_states_created_at_idx on oauth_states (created_at);

-- Service role only: this table gates who may complete an authorization.
alter table oauth_states enable row level security;
