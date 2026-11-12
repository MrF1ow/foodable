-- The household's week plan: one row per recipe planned on a day and a meal
-- slot. A plan belongs to the household, not to a person, so every member
-- and the household bot token read and write the same rows. Deleting a recipe
-- or the household takes its plans with it; deleting the login that made a
-- plan keeps the plan and forgets who made it.
--
-- Plans are never deleted for being in the past: reading by date range is
-- what hides them.

create table public.recipe_plans (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    recipe_id uuid not null references public.recipes (id) on delete cascade,
    date date not null,
    slot text not null,
    servings numeric not null default 1,
    created_by uuid references public.users (id) on delete set null,
    created_at timestamptz not null default now(),
    constraint recipe_plans_slot_check
        check (slot in ('breakfast', 'lunch', 'dinner', 'snack')),
    constraint recipe_plans_servings_check
        check (servings > 0)
);

alter table public.recipe_plans enable row level security;

grant select, insert, update, delete on public.recipe_plans to service_role;
revoke all on public.recipe_plans from anon, authenticated;

-- A week is read by household and date range; deleting a recipe finds the
-- plans on it by recipe.
create index if not exists recipe_plans_household_date_idx
    on public.recipe_plans (household_id, date);

create index if not exists recipe_plans_recipe_id_idx
    on public.recipe_plans (recipe_id);

-- Household-wide, like the rest of the household's data. The household bot
-- token acts with no user but sets app.household_id the same way a member
-- does, so this one condition covers members and the token alike.
create policy recipe_plans_app_household
    on public.recipe_plans
    for all
    to foodable_app
    using (household_id = nullif(current_setting('app.household_id', true), '')::uuid)
    with check (household_id = nullif(current_setting('app.household_id', true), '')::uuid);
