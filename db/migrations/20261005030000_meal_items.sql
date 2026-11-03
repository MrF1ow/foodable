-- Phase 4 expand: food-backed meal line items. meals totals stay the
-- read source; this table is the write-time snapshot. No meals columns
-- are dropped.

create table public.meal_items (
    id uuid primary key default gen_random_uuid(),
    meal_id uuid not null references public.meals (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    household_id uuid references public.households (id) on delete set null,
    food_id uuid references public.foods (id) on delete set null,
    recipe_id uuid references public.recipes (id) on delete set null,
    label text not null,
    amount numeric check (amount > 0),
    unit text,
    grams numeric check (grams >= 0),
    portions numeric check (portions > 0),
    calories numeric,
    protein_g numeric,
    carbs_g numeric,
    fat_g numeric,
    fiber_g numeric,
    sugar_g numeric,
    alcohol_g numeric,
    caffeine_mg numeric,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    check (food_id is not null or recipe_id is not null or label <> '')
);

create index meal_items_meal_idx on public.meal_items (meal_id, sort_order);
create index meal_items_user_food_idx on public.meal_items (user_id, food_id);

alter table public.meal_items enable row level security;

create policy meal_items_owner_all
    on public.meal_items
    for all
    to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy meal_items_peer_select
    on public.meal_items
    for select
    to authenticated
    using (
        household_id in (
            select household_id
            from public.household_members
            where user_id = auth.uid()
        )
    );

create policy "Allow all for service role"
    on public.meal_items
    for all
    to service_role
    using (true)
    with check (true);

grant select, insert, update, delete on table public.meal_items to authenticated;
grant all on table public.meal_items to service_role;
