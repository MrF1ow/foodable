-- Repeating week-plan entries: a recipe planned on a meal from a start day,
-- once, every week, every day, on weekdays or on picked days. A repeat is one
-- row here; the days it covers are worked out when the plan is read, so the
-- week plan's own rows (recipe_plans) stay one-offs and are not touched.
--
-- days holds the picked weekdays of a "days" repeat, numbered like the
-- restock day (0 = Sunday .. 6 = Saturday). skipped_on holds the days taken
-- off the series; ends_on is its last day, null while it goes on. Deleting a
-- recipe or the household takes its repeats with it; deleting the login that
-- made one keeps it and forgets who made it.
--
-- Expand only: no backfill, nothing dropped.

create table public.plan_rules (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    recipe_id uuid not null references public.recipes (id) on delete cascade,
    meal text not null,
    servings numeric not null default 1,
    starts_on date not null,
    rule text not null,
    days smallint[] not null default '{}',
    ends_on date,
    skipped_on date[] not null default '{}',
    created_by uuid references public.users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint plan_rules_meal_check
        check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
    constraint plan_rules_servings_check
        check (servings > 0),
    constraint plan_rules_rule_check
        check (rule in ('once', 'weekly', 'daily', 'weekdays', 'days')),
    -- Picked days are real weekdays, and only a "days" repeat has any.
    constraint plan_rules_days_check
        check (
            days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
            and ((rule = 'days') = (cardinality(days) > 0))
        )
);

alter table public.plan_rules enable row level security;

grant select, insert, update, delete on public.plan_rules to service_role;
revoke all on public.plan_rules from anon, authenticated;

-- A week is read by household and the repeats that start before its last day;
-- deleting a recipe finds its repeats by recipe.
create index if not exists plan_rules_household_starts_idx
    on public.plan_rules (household_id, starts_on);

create index if not exists plan_rules_recipe_id_idx
    on public.plan_rules (recipe_id);

-- Household-wide, like recipe_plans: members and the household bot token
-- both act with app.household_id set.
create policy plan_rules_app_household
    on public.plan_rules
    for all
    to foodable_app
    using (household_id = nullif(current_setting('app.household_id', true), '')::uuid)
    with check (household_id = nullif(current_setting('app.household_id', true), '')::uuid);
