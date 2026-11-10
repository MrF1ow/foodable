-- Single-use invite codes for sign-up into an existing household. Codes are
-- stored hashed; redemption runs as the system on login.

create table public.household_invites (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    code_hash text not null unique,
    created_by uuid references public.users (id) on delete set null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    used_at timestamptz,
    used_by uuid references public.users (id) on delete set null
);

alter table public.household_invites enable row level security;

grant select, insert, update, delete on public.household_invites to service_role;
revoke all on public.household_invites from anon, authenticated;

create index if not exists household_invites_household_id_idx
    on public.household_invites (household_id);

-- Owners manage their household's invites; members never see them.
create policy household_invites_app_select
    on public.household_invites
    for select
    to foodable_app
    using (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
        and exists (
            select 1
            from public.household_members m
            where m.household_id = household_invites.household_id
              and m.user_id = auth.uid()
              and m.role = 'owner'
        )
    );

create policy household_invites_app_insert
    on public.household_invites
    for insert
    to foodable_app
    with check (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
        and exists (
            select 1
            from public.household_members m
            where m.household_id = household_invites.household_id
              and m.user_id = auth.uid()
              and m.role = 'owner'
        )
    );

create policy household_invites_app_update
    on public.household_invites
    for update
    to foodable_app
    using (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
        and exists (
            select 1
            from public.household_members m
            where m.household_id = household_invites.household_id
              and m.user_id = auth.uid()
              and m.role = 'owner'
        )
    )
    with check (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
        and exists (
            select 1
            from public.household_members m
            where m.household_id = household_invites.household_id
              and m.user_id = auth.uid()
              and m.role = 'owner'
        )
    );

create policy household_invites_app_delete
    on public.household_invites
    for delete
    to foodable_app
    using (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
        and exists (
            select 1
            from public.household_members m
            where m.household_id = household_invites.household_id
              and m.user_id = auth.uid()
              and m.role = 'owner'
        )
    );
