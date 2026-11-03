-- Household cookbook: recipes, batch ingredients, and per-person portions.
-- Any member may create and edit. Delete is the creator or household owner.

create table public.recipes (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    creator_id uuid not null,
    name text not null,
    yield_portions numeric not null check (yield_portions > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.recipe_ingredients (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    recipe_id uuid not null references public.recipes (id) on delete cascade,
    kind text not null check (kind in ('food')),
    display_name text not null,
    amount numeric not null check (amount > 0),
    unit text not null,
    identity jsonb not null,
    nutrition jsonb,
    sort_order integer not null default 0,
    created_at timestamptz not null default now()
);

create table public.recipe_portions (
    recipe_id uuid not null references public.recipes (id) on delete cascade,
    household_id uuid not null references public.households (id) on delete cascade,
    user_id uuid not null,
    portion_count numeric not null check (portion_count > 0),
    primary key (recipe_id, user_id)
);

create index recipes_household_idx on public.recipes (household_id, name);
create index recipe_ingredients_recipe_idx
    on public.recipe_ingredients (household_id, recipe_id, sort_order);
create index recipe_portions_household_idx
    on public.recipe_portions (household_id, user_id);

alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_portions enable row level security;

create policy recipes_member_select
    on public.recipes
    for select
    to authenticated
    using (
        household_id in (
            select household_id
            from public.household_members
            where user_id = auth.uid()
        )
    );

create policy recipes_member_insert
    on public.recipes
    for insert
    to authenticated
    with check (
        household_id in (
            select household_id
            from public.household_members
            where user_id = auth.uid()
        )
        and creator_id = auth.uid()
    );

create policy recipes_member_update
    on public.recipes
    for update
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

create policy recipes_delete_creator_or_owner
    on public.recipes
    for delete
    to authenticated
    using (
        household_id in (
            select household_id
            from public.household_members
            where user_id = auth.uid()
        )
        and (
            creator_id = auth.uid()
            or exists (
                select 1
                from public.household_members
                where household_id = recipes.household_id
                  and user_id = auth.uid()
                  and role = 'owner'
            )
        )
    );

create policy recipe_ingredients_member_all
    on public.recipe_ingredients
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

create policy recipe_portions_member_all
    on public.recipe_portions
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

grant select, insert, update, delete on table public.recipes to authenticated;
grant select, insert, update, delete on table public.recipe_ingredients to authenticated;
grant select, insert, update, delete on table public.recipe_portions to authenticated;
grant all on table public.recipes to service_role;
grant all on table public.recipe_ingredients to service_role;
grant all on table public.recipe_portions to service_role;
