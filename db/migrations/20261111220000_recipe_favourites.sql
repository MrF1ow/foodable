-- A member's starred recipes: one row per (member, recipe). Favourites are
-- personal, so a member reads and writes only their own rows, inside the
-- household the transaction acts for. The recipe and the membership are both
-- foreign keys with on delete cascade: deleting a recipe, removing a member
-- from the household, or deleting their login takes their stars with it.

create table public.recipe_favourites (
    household_id uuid not null references public.households (id) on delete cascade,
    user_id uuid not null references public.users (id) on delete cascade,
    recipe_id uuid not null references public.recipes (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, recipe_id),
    constraint recipe_favourites_member_fkey
        foreign key (household_id, user_id)
        references public.household_members (household_id, user_id)
        on delete cascade
);

alter table public.recipe_favourites enable row level security;

grant select, insert, update, delete on public.recipe_favourites to service_role;
revoke all on public.recipe_favourites from anon, authenticated;

-- Listing a member's favourites reads by household and user; deleting a
-- recipe finds the stars on it by recipe.
create index if not exists recipe_favourites_household_user_idx
    on public.recipe_favourites (household_id, user_id);

create index if not exists recipe_favourites_recipe_id_idx
    on public.recipe_favourites (recipe_id);

create policy recipe_favourites_app_own
    on public.recipe_favourites
    for all
    to foodable_app
    using (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
        and user_id = auth.uid()
    )
    with check (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
        and user_id = auth.uid()
    );
