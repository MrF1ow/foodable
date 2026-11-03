-- Indexes for the reads and checks that grow with use. Additive only; the
-- single-column user_id / logged_at indexes they supersede are dropped in a
-- later contract migration.
--
-- Measured on a bench copy (220k meals, 200k stock movements):
--   stock ledger list, newest first        18 ms  -> 0.24 ms
--   foreign-key check when a fridge item goes 11 ms -> 0.35 ms

-- Per-user, time-ordered reads (a day, a range, the export pages, latest
-- weight). The id tie-breaker matches the export's order by logged_at, id.
create index if not exists meals_user_logged_idx
    on public.meals (user_id, logged_at, id);
create index if not exists water_log_user_logged_idx
    on public.water_log (user_id, logged_at, id);
create index if not exists weight_log_user_logged_idx
    on public.weight_log (user_id, logged_at, id);

-- The stock ledger only grows. Listing it newest first, and the foreign-key
-- check each time eating or discarding empties a fridge item, both scanned
-- the whole table.
create index if not exists stock_movements_household_created_idx
    on public.stock_movements (household_id, created_at desc);
create index if not exists stock_movements_fridge_item_idx
    on public.stock_movements (fridge_item_id);

-- Deleting or merging a food, or deleting a recipe, sets these to null on
-- every meal item that points at it.
create index if not exists meal_items_food_idx
    on public.meal_items (food_id);
create index if not exists meal_items_recipe_idx
    on public.meal_items (recipe_id);
