-- One plan per recipe, day and meal slot in a household. The previous
-- migration collapsed the existing duplicates; the app merges a move onto an
-- identical plan and treats planning the same recipe twice as one plan, so the
-- index only backs those rules up under concurrency.

create unique index if not exists recipe_plans_household_recipe_date_slot_key
    on public.recipe_plans (household_id, recipe_id, date, slot);
