-- Household fridge inventory: named locations and items (food or supply).
-- Any household member may read and write. There is no per-item owner.

create table public.fridge_locations (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    name text not null,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    unique (household_id, name)
);

create table public.fridge_items (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    location_id uuid not null references public.fridge_locations (id) on delete cascade,
    kind text not null check (kind in ('food', 'supply')),
    display_name text not null,
    amount numeric not null check (amount > 0),
    unit text not null,
    identity jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index fridge_locations_household_sort_idx
    on public.fridge_locations (household_id, sort_order, name);

create index fridge_items_household_location_idx
    on public.fridge_items (household_id, location_id);

alter table public.fridge_locations enable row level security;
alter table public.fridge_items enable row level security;

create policy fridge_locations_member_all
    on public.fridge_locations
    for all
    to authenticated
    using (
        household_id in (
            select household_id
            from public.household_members
            where user_id = auth.uid()
        )
    )
    with check (
        household_id in (
            select household_id
            from public.household_members
            where user_id = auth.uid()
        )
    );

create policy fridge_items_member_all
    on public.fridge_items
    for all
    to authenticated
    using (
        household_id in (
            select household_id
            from public.household_members
            where user_id = auth.uid()
        )
    )
    with check (
        household_id in (
            select household_id
            from public.household_members
            where user_id = auth.uid()
        )
    );

grant select, insert, update, delete on table public.fridge_locations to authenticated;
grant select, insert, update, delete on table public.fridge_items to authenticated;
grant all on table public.fridge_locations to service_role;
grant all on table public.fridge_items to service_role;
