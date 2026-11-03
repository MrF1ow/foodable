-- Grocery stores, per-store sections, store/person rules, allergens, dislikes.
-- Household location lives on households. Any member may read; writes go
-- through the service role, with owner-only add-member and token rotation
-- enforced in the app.

alter table public.households
    add column location text;

create table public.grocery_stores (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    name text not null,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    unique (household_id, name)
);

create table public.grocery_sections (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    store_id uuid not null references public.grocery_stores (id) on delete cascade,
    name text not null,
    sort_order integer not null default 0,
    hidden boolean not null default false,
    is_other boolean not null default false,
    created_at timestamptz not null default now(),
    unique (store_id, name)
);

create table public.store_rules (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    store_id uuid not null references public.grocery_stores (id) on delete cascade,
    body text not null,
    sort_order integer not null default 0,
    created_at timestamptz not null default now()
);

create table public.person_rules (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    body text not null,
    sort_order integer not null default 0,
    created_at timestamptz not null default now()
);

create table public.member_allergens (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    allergen text not null,
    other_label text,
    created_at timestamptz not null default now()
);

create unique index member_allergens_named_idx
    on public.member_allergens (household_id, user_id, allergen)
    where allergen <> 'other';

create unique index member_allergens_other_idx
    on public.member_allergens (household_id, user_id)
    where allergen = 'other';

create table public.member_dislikes (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    display_name text not null,
    identity jsonb,
    created_at timestamptz not null default now()
);

create index grocery_stores_household_sort_idx
    on public.grocery_stores (household_id, sort_order, name);

create index grocery_sections_store_sort_idx
    on public.grocery_sections (store_id, sort_order, name);

create index store_rules_store_sort_idx
    on public.store_rules (store_id, sort_order);

create index person_rules_member_sort_idx
    on public.person_rules (household_id, user_id, sort_order);

create index member_allergens_member_idx
    on public.member_allergens (household_id, user_id);

create index member_dislikes_member_idx
    on public.member_dislikes (household_id, user_id);

alter table public.grocery_stores enable row level security;
alter table public.grocery_sections enable row level security;
alter table public.store_rules enable row level security;
alter table public.person_rules enable row level security;
alter table public.member_allergens enable row level security;
alter table public.member_dislikes enable row level security;

create policy grocery_stores_member_all
    on public.grocery_stores
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

create policy grocery_sections_member_all
    on public.grocery_sections
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

create policy store_rules_member_all
    on public.store_rules
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

create policy person_rules_member_all
    on public.person_rules
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

create policy member_allergens_member_all
    on public.member_allergens
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

create policy member_dislikes_member_all
    on public.member_dislikes
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

grant select, insert, update, delete on table public.grocery_stores to authenticated;
grant select, insert, update, delete on table public.grocery_sections to authenticated;
grant select, insert, update, delete on table public.store_rules to authenticated;
grant select, insert, update, delete on table public.person_rules to authenticated;
grant select, insert, update, delete on table public.member_allergens to authenticated;
grant select, insert, update, delete on table public.member_dislikes to authenticated;
grant all on table public.grocery_stores to service_role;
grant all on table public.grocery_sections to service_role;
grant all on table public.store_rules to service_role;
grant all on table public.person_rules to service_role;
grant all on table public.member_allergens to service_role;
grant all on table public.member_dislikes to service_role;
