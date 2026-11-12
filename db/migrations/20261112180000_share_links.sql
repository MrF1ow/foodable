-- Public read-only share links: a member shares one recipe, or the grocery
-- list, as a link anyone can open without signing in. A link grants that one
-- object and nothing else. Only the SHA-256 of the token is stored, so the
-- raw token is shown once, when the link is made.
--
-- `target_id` names the recipe for kind 'recipe' and is null for
-- 'grocery_list' (a household has one list). It is polymorphic, so it has no
-- foreign key: a recipe deleted after it was shared leaves the link in place,
-- and the public page finds no recipe and answers the same 404 as for an
-- unknown token. Revoking sets `revoked_at`; a null `expires_at` never expires.
--
-- Additive only. Members read, create and revoke their own household's links
-- through the household policies. The public page has no household and no
-- member, so it looks a link up by token hash as the system (owner
-- connection), which row level security does not bind. Deleting the household
-- takes its links; deleting the member who made one keeps the link.

create table public.share_links (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    kind text not null check (kind in ('recipe', 'grocery_list')),
    target_id uuid,
    token_hash text not null unique,
    created_by uuid references public.users (id) on delete set null,
    created_at timestamptz not null default now(),
    expires_at timestamptz,
    revoked_at timestamptz,
    constraint share_links_target_check check (
        (kind = 'recipe' and target_id is not null)
        or (kind = 'grocery_list' and target_id is null)
    )
);

alter table public.share_links enable row level security;

grant select, insert, update, delete on public.share_links to service_role;
revoke all on public.share_links from anon, authenticated;

-- Listing a household's links, and the cascade when a household goes. The
-- token_hash lookup the public page makes is served by its unique index.
create index if not exists share_links_household_id_idx
    on public.share_links (household_id, created_at desc);

create policy share_links_app_select
    on public.share_links
    for select
    to foodable_app
    using (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
    );

create policy share_links_app_insert
    on public.share_links
    for insert
    to foodable_app
    with check (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
    );

create policy share_links_app_update
    on public.share_links
    for update
    to foodable_app
    using (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
    )
    with check (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
    );

create policy share_links_app_delete
    on public.share_links
    for delete
    to foodable_app
    using (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
    );
