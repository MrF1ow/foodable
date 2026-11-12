-- Which AI app a token belongs to, when it was last used, and when a member
-- was last seen in the app. Additive only: every column is nullable, nothing
-- is backfilled, and a token issued before this has no client and reads as an
-- unknown app.
--
-- client_id follows the token through the whole OAuth exchange: the auth code
-- carries it, the access and refresh tokens take it from the code, and a
-- refresh hands it on to the tokens it mints.
alter table public.auth_codes
    add column if not exists client_id text;

alter table public.oauth_tokens
    add column if not exists client_id text,
    add column if not exists last_used_at timestamptz;

alter table public.refresh_tokens
    add column if not exists client_id text;

alter table public.users
    add column if not exists last_seen_at timestamptz;

-- No new index: listing a member's connections and revoking one client both
-- filter on user_id, which idx_oauth_tokens_user_id already serves, and one
-- member holds a handful of tokens.
