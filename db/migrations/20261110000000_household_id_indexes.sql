-- Row level security and adapters filter shared rows by household_id; personal
-- rows and membership lookups filter by user_id. Each such column needs a btree
-- index with that column first so scans stay cheap as households grow.
--
-- Plain create index (not concurrent): the migration runner applies each file in
-- one transaction, and a household deploy still holds modest table sizes.

create index if not exists grocery_sections_household_id_idx
    on public.grocery_sections (household_id);

create index if not exists store_rules_household_id_idx
    on public.store_rules (household_id);

create index if not exists meal_items_household_id_idx
    on public.meal_items (household_id);

create index if not exists household_members_user_id_idx
    on public.household_members (user_id);

create index if not exists nutrition_goal_days_user_id_idx
    on public.nutrition_goal_days (user_id, date);
