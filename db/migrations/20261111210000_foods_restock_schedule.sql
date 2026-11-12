-- Restock schedule on a plain food's usual record: how often the household
-- buys it again (weekly, every N weeks, monthly, or never on a schedule), a
-- pause switch, "add it when it runs low" with the level it counts as low
-- below, and the date it was last restocked. The usual record lives on the
-- food row beside usual_store_id / usual_amount / usual_unit, so nothing new
-- needs its own RLS or grants. Every column is additive and nullable (or
-- defaulted), so existing rows keep working untouched. The default low level
-- (a quarter of the usual amount) is computed on read, never stored.
alter table public.foods
    add column if not exists restock_schedule text,
    add column if not exists restock_every_weeks integer,
    add column if not exists restock_paused boolean not null default false,
    add column if not exists restock_when_low boolean not null default false,
    add column if not exists restock_low_level numeric,
    add column if not exists last_restocked_on date;

alter table public.foods
    add constraint foods_restock_schedule_check
        check (
            restock_schedule is null
            or restock_schedule in ('weekly', 'every_n_weeks', 'monthly')
        ),
    add constraint foods_restock_every_weeks_check
        check (restock_every_weeks is null or restock_every_weeks > 0),
    -- "Every N weeks" needs its N, and no other schedule carries one.
    add constraint foods_restock_every_weeks_pair
        check (
            coalesce(restock_schedule = 'every_n_weeks', false)
            = (restock_every_weeks is not null)
        ),
    add constraint foods_restock_low_level_check
        check (restock_low_level is null or restock_low_level >= 0);

comment on column public.foods.restock_schedule is
    'weekly, every_n_weeks or monthly; null = no schedule.';
comment on column public.foods.restock_every_weeks is
    'N for every_n_weeks (required exactly then); null otherwise.';
comment on column public.foods.restock_paused is
    'A paused usual is never due by schedule or by running low.';
comment on column public.foods.restock_when_low is
    'Add the usual to the list when its stock is below restock_low_level.';
comment on column public.foods.restock_low_level is
    'In the usual amount''s unit; null = a quarter of the usual amount.';
comment on column public.foods.last_restocked_on is
    'The household-local date a line from this usual was last ticked off or put away.';
