-- Row level security for foodable_app on tables that are not household data.
-- Each policy is as narrow as the paths that reach the table under a user or
-- household actor. Sign-in, OAuth, rate limiting, login sessions, flag
-- bookkeeping and the household bot token run as the system and get no
-- foodable_app policy, so only the owner connection reaches them.

-- users: a signed-in user's own row (password change, account deletion).
-- Sign-up runs as the system.
create policy users_app_own_select
    on public.users
    for select
    to foodable_app
    using (id = auth.uid());

create policy users_app_own_update
    on public.users
    for update
    to foodable_app
    using (id = auth.uid())
    with check (id = auth.uid());

create policy users_app_own_delete
    on public.users
    for delete
    to foodable_app
    using (id = auth.uid());

-- OAuth credentials: issued and consumed by the OAuth flow as the system;
-- account deletion removes the user's own.
create policy oauth_tokens_app_own_select
    on public.oauth_tokens
    for select
    to foodable_app
    using (user_id = auth.uid());

create policy oauth_tokens_app_own_delete
    on public.oauth_tokens
    for delete
    to foodable_app
    using (user_id = auth.uid());

create policy refresh_tokens_app_own_select
    on public.refresh_tokens
    for select
    to foodable_app
    using (user_id = auth.uid());

create policy refresh_tokens_app_own_delete
    on public.refresh_tokens
    for delete
    to foodable_app
    using (user_id = auth.uid());

create policy auth_codes_app_own_select
    on public.auth_codes
    for select
    to foodable_app
    using (user_id = auth.uid());

create policy auth_codes_app_own_delete
    on public.auth_codes
    for delete
    to foodable_app
    using (user_id = auth.uid());

-- export_archives: the user's own archive (export writes it, account deletion
-- removes it). The signed download link and the sweep run as the system.
create policy export_archives_app_own
    on public.export_archives
    for all
    to foodable_app
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

-- tool_analytics: every tool call writes one row under the caller's id: the
-- user, 'hh:<household>' for a household token, or '[deleted]' once an
-- account deletion has erased the user's own rows. Reading and deleting is
-- limited to the user's own rows.
create policy tool_analytics_app_insert
    on public.tool_analytics
    for insert
    to foodable_app
    with check (
        user_id = auth.uid()::text
        or user_id = 'hh:' || nullif(current_setting('app.household_id', true), '')
        or (user_id = '[deleted]' and auth.uid() is not null)
    );

create policy tool_analytics_app_own_select
    on public.tool_analytics
    for select
    to foodable_app
    using (user_id = auth.uid()::text);

create policy tool_analytics_app_own_delete
    on public.tool_analytics
    for delete
    to foodable_app
    using (user_id = auth.uid()::text);

-- food_cache: the shared Open Food Facts product cache. It holds public
-- product data only, keyed by barcode, so any actor reads and writes it.
create policy food_cache_app_all
    on public.food_cache
    for all
    to foodable_app
    using (true)
    with check (true);
