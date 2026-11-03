-- Household grocery list lines filed by store and section.
-- Checking a line is list state only; it does not insert fridge stock.

create table public.grocery_lines (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    store_id uuid not null references public.grocery_stores (id) on delete cascade,
    section_id uuid not null references public.grocery_sections (id) on delete cascade,
    kind text not null check (kind in ('food', 'supply')),
    display_name text not null,
    amount numeric not null check (amount > 0),
    unit text not null,
    identity jsonb not null,
    checked boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index grocery_lines_household_store_idx
    on public.grocery_lines (household_id, store_id, section_id);

alter table public.grocery_lines enable row level security;

create policy grocery_lines_member_all
    on public.grocery_lines
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

grant select, insert, update, delete on table public.grocery_lines to authenticated;
grant all on table public.grocery_lines to service_role;
