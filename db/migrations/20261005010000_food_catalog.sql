-- Phase 2 expand: household food catalog and food_id on item tables.
-- grams_per_each / grams_per_ml are stored here; Phase 3 owns unit behavior.
-- households.fridge_locations is not dropped (Phase 8).

create table public.foods (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    kind text not null check (kind in ('food', 'supply')),
    name text not null,
    normalized_name text not null,
    brand text,
    default_unit text not null default 'g',
    grams_per_each numeric check (grams_per_each > 0),
    grams_per_ml numeric check (grams_per_ml > 0),
    calories numeric check (calories >= 0),
    protein_g numeric check (protein_g >= 0),
    carbs_g numeric check (carbs_g >= 0),
    fat_g numeric check (fat_g >= 0),
    fiber_g numeric check (fiber_g >= 0),
    sugar_g numeric check (sugar_g >= 0),
    alcohol_g numeric check (alcohol_g >= 0),
    caffeine_mg numeric check (caffeine_mg >= 0),
    nutrition_source text check (nutrition_source in
        ('openfoodfacts', 'manual', 'estimate', 'recipe')),
    allergens text[] not null default '{}',
    off_source_id text,
    created_by uuid references auth.users (id) on delete set null,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index foods_household_name_uniq
    on public.foods (household_id, kind, normalized_name, (coalesce(brand, '')))
    where archived_at is null;

create index foods_household_idx
    on public.foods (household_id, kind, normalized_name)
    where archived_at is null;

create table public.food_barcodes (
    household_id uuid not null references public.households (id) on delete cascade,
    barcode text not null,
    food_id uuid not null references public.foods (id) on delete cascade,
    primary key (household_id, barcode)
);

create table public.food_aliases (
    household_id uuid not null references public.households (id) on delete cascade,
    alias text not null,
    food_id uuid not null references public.foods (id) on delete cascade,
    primary key (household_id, alias)
);

alter table public.fridge_items
    add column food_id uuid references public.foods (id);
alter table public.grocery_lines
    add column food_id uuid references public.foods (id);
alter table public.recipe_ingredients
    add column food_id uuid references public.foods (id);
alter table public.member_dislikes
    add column food_id uuid references public.foods (id);

create index fridge_items_food_idx
    on public.fridge_items (household_id, food_id);
create index grocery_lines_food_idx
    on public.grocery_lines (household_id, food_id);
create index recipe_ingredients_food_idx
    on public.recipe_ingredients (household_id, food_id);
create index member_dislikes_food_idx
    on public.member_dislikes (household_id, food_id);

alter table public.foods enable row level security;
alter table public.food_barcodes enable row level security;
alter table public.food_aliases enable row level security;

create policy foods_member_all
    on public.foods
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

create policy food_barcodes_member_all
    on public.food_barcodes
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

create policy food_aliases_member_all
    on public.food_aliases
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

grant select, insert, update, delete on table public.foods to authenticated;
grant select, insert, update, delete on table public.food_barcodes to authenticated;
grant select, insert, update, delete on table public.food_aliases to authenticated;
grant all on table public.foods to service_role;
grant all on table public.food_barcodes to service_role;
grant all on table public.food_aliases to service_role;
