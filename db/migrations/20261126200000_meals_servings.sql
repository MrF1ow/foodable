-- A quick or free-text meal has no meal_items rows to remember how many
-- servings it was last saved at, so reopening its edit sheet showed 1 and a
-- second save scaled the already-scaled totals again. servings is that
-- multiplier: the totals stay the sum of record (every reader keeps reading
-- them), and the edit sheet works from totals / servings.
--
-- Expand only: one nullable column, nothing backfilled. Null reads as 1, so
-- every meal that exists today is unchanged.

alter table public.meals
    add column if not exists servings numeric(6, 2)
        check (servings is null or servings > 0);
