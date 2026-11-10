-- Row level security for foodable_app on household data: a row is reachable
-- only when its household_id is the household the transaction acts for
-- (app.household_id, set per transaction by the app; empty for none). The
-- existing service_role policies stay.
--
-- Tables with a household_id that get no policy here, on purpose:
--   household_mcp_tokens  read and rotated only through security definer functions
--   flag_assignments      the flag pin cache, which runs as the system
--   meal_items, nutrition_goal_days  a person's own rows, with their own policies

do $$
declare
    t text;
begin
    foreach t in array array[
        'dead_links',
        'fetch_host_refusals',
        'food_aliases',
        'food_barcodes',
        'foods',
        'fridge_items',
        'fridge_locations',
        'grocery_lines',
        'grocery_sections',
        'grocery_stores',
        'member_allergens',
        'member_dislikes',
        'notice_dismissals',
        'person_rules',
        'recipe_imports',
        'recipe_ingredients',
        'recipe_portions',
        'recipes',
        'social_reader_status',
        'stock_movements',
        'store_rules'
    ]
    loop
        execute format(
            $policy$
            create policy %I on public.%I
                for all
                to foodable_app
                using (household_id = nullif(current_setting('app.household_id', true), '')::uuid)
                with check (household_id = nullif(current_setting('app.household_id', true), '')::uuid)
            $policy$,
            t || '_app_household',
            t
        );
    end loop;
end
$$;

-- Members of the household read its memberships; nothing in foodable_app
-- writes them. Adding, removing, renaming and role changes run as the system
-- after the app checks the caller may (owner, manager or the member
-- themselves), or through the security definer functions, which the app also
-- calls as the system. A for-all policy here let a member promote
-- themselves to owner.
create policy household_members_app_household
    on public.household_members
    for select
    to foodable_app
    using (household_id = nullif(current_setting('app.household_id', true), '')::uuid);

-- A signed-in user resolves their own membership before the household is
-- known to the transaction.
create policy household_members_app_own
    on public.household_members
    for select
    to foodable_app
    using (user_id = auth.uid());

-- The household's own row: settings and restock bookkeeping read and update
-- it. Creating a household goes through public.create_household.
create policy households_app_select
    on public.households
    for select
    to foodable_app
    using (id = nullif(current_setting('app.household_id', true), '')::uuid);

create policy households_app_update
    on public.households
    for update
    to foodable_app
    using (id = nullif(current_setting('app.household_id', true), '')::uuid)
    with check (id = nullif(current_setting('app.household_id', true), '')::uuid);
