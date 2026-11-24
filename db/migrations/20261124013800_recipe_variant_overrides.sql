-- A person's own version of a recipe: the recipe stays one base, and each
-- member may override single ingredients of it (drop one, change an amount,
-- swap the food, add one). A version is the base with that person's rows
-- applied, so editing the base reaches every version except where it
-- overrides that ingredient.
--
-- user_id is the member the version belongs to, keyed like recipe_portions
-- and recipe_favourites. Deleting the recipe, one of its ingredients, the
-- household or the login takes the rows with it.
--
-- action says what a row does to the ingredient it names:
--   remove  the person leaves it out
--   amount  amount and unit replace the base's (a null amount is "to taste")
--   food    food_id and display_name replace the base's food; an amount, when
--           given, replaces the base's too
--   add     an ingredient only this person has: no ingredient_id, and the
--           food, name, amount and unit of its own (one per food)
--
-- Also adds member_ids to the week plan's rows, so a planned recipe can name
-- the people eating it and be totalled from their versions. Empty means
-- nobody is named and the servings count at the base recipe.
--
-- Expand only: no backfill, nothing dropped.

create table public.recipe_variant_overrides (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    recipe_id uuid not null references public.recipes (id) on delete cascade,
    user_id uuid not null references public.users (id) on delete cascade,
    ingredient_id uuid references public.recipe_ingredients (id) on delete cascade,
    action text not null,
    amount numeric,
    unit text,
    food_id uuid references public.foods (id),
    display_name text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint recipe_variant_overrides_action_check
        check (action in ('remove', 'amount', 'food', 'add')),
    constraint recipe_variant_overrides_amount_check
        check (amount is null or amount > 0),
    constraint recipe_variant_overrides_shape_check
        check (
            case action
                when 'remove' then ingredient_id is not null
                when 'amount' then ingredient_id is not null and unit is not null
                when 'food' then ingredient_id is not null and food_id is not null
                    and display_name is not null
                when 'add' then ingredient_id is null and food_id is not null
                    and display_name is not null
            end
        )
);

alter table public.recipe_variant_overrides enable row level security;

grant select, insert, update, delete on public.recipe_variant_overrides to service_role;
revoke all on public.recipe_variant_overrides from anon, authenticated;

-- One row per person and base ingredient: setting it again replaces it.
create unique index if not exists recipe_variant_overrides_ingredient_key
    on public.recipe_variant_overrides (recipe_id, user_id, ingredient_id)
    where ingredient_id is not null;

-- One added row per person, recipe and food: adding it again replaces it, so
-- a retried add does not double the food.
create unique index if not exists recipe_variant_overrides_added_food_key
    on public.recipe_variant_overrides (recipe_id, user_id, food_id)
    where action = 'add';

-- A recipe's versions are read by recipe, one person's by person.
create index if not exists recipe_variant_overrides_recipe_idx
    on public.recipe_variant_overrides (household_id, recipe_id, user_id);

create index if not exists recipe_variant_overrides_user_idx
    on public.recipe_variant_overrides (user_id);

create index if not exists recipe_variant_overrides_ingredient_idx
    on public.recipe_variant_overrides (ingredient_id)
    where ingredient_id is not null;

create index if not exists recipe_variant_overrides_food_idx
    on public.recipe_variant_overrides (food_id)
    where food_id is not null;

-- Household-wide, like recipe_plans: members and the household bot token both
-- act with app.household_id set.
create policy recipe_variant_overrides_app_household
    on public.recipe_variant_overrides
    for all
    to foodable_app
    using (household_id = nullif(current_setting('app.household_id', true), '')::uuid)
    with check (household_id = nullif(current_setting('app.household_id', true), '')::uuid);

alter table public.recipe_plans
    add column if not exists member_ids uuid[] not null default '{}';

alter table public.plan_rules
    add column if not exists member_ids uuid[] not null default '{}';
