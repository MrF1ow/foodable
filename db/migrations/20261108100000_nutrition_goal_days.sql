-- Per-day overrides of a member's daily nutrition goals (calendar project, CAL-1).
-- A null daily_* column means "use the default" from nutrition_goals, so no
-- backfill: a day with no row, or a null column, already means the default.
-- The daily_* set and types mirror nutrition_goals (target_weight_g is not a
-- daily target and stays there).

create table public.nutrition_goal_days (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    user_id uuid not null references public.users (id) on delete cascade,
    date date not null,
    daily_calories integer check (daily_calories >= 0),
    daily_protein_g numeric(6, 2) check (daily_protein_g >= 0),
    daily_carbs_g numeric(6, 2) check (daily_carbs_g >= 0),
    daily_fat_g numeric(6, 2) check (daily_fat_g >= 0),
    daily_water_ml integer check (daily_water_ml >= 0),
    daily_fiber_g numeric(6, 2) check (daily_fiber_g >= 0),
    daily_sugar_g numeric(6, 2) check (daily_sugar_g >= 0),
    daily_alcohol_g numeric(6, 2) check (daily_alcohol_g >= 0),
    daily_caffeine_mg numeric(7, 2) check (daily_caffeine_mg >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (household_id, user_id, date)
);

alter table public.nutrition_goal_days enable row level security;

create policy nutrition_goal_days_own_all
    on public.nutrition_goal_days
    for all
    to authenticated
    using (
        user_id = auth.uid()
        and household_id in (
            select household_id from public.household_members where user_id = auth.uid()
        )
    )
    with check (
        user_id = auth.uid()
        and household_id in (
            select household_id from public.household_members where user_id = auth.uid()
        )
    );

grant select, insert, update, delete on public.nutrition_goal_days to service_role;
