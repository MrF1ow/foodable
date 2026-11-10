-- Row level security for foodable_app on a person's own data: meals and their
-- items, water, weight, nutrition goals and per-day goal overrides, and the
-- profile. The existing authenticated and service_role policies stay.
--
-- Who reaches whose rows, as the app does it today:
--   a signed-in user        their own rows; reads of another member of their
--                           household (dashboards, user_id on read tools);
--                           nutrition writes for another member (target_member)
--   the household bot token any member of its household, read and write
--                           (user_id names the member), and the owner's
--                           profile for restock
--   nobody else             a user of another household, or a user with no
--                           household, sees nothing
--
-- "Member of the household" means the row's user_id has a household_members
-- row in the household the transaction acts for (app.household_id). That
-- lookup runs as foodable_app under household_members' own policy, which
-- shows exactly the rows of that household, so no security definer helper is
-- needed.

do $$
declare
    t text;
    member_of_household constant text :=
        $cond$exists (
            select 1
            from public.household_members m
            where m.user_id = %1$I.user_id
              and m.household_id = nullif(current_setting('app.household_id', true), '')::uuid
        )$cond$;
begin
    -- Meals, water, weight and goals: read and written for oneself and for
    -- any member of the household the transaction acts for.
    foreach t in array array[
        'meal_items',
        'meals',
        'nutrition_goals',
        'water_log',
        'weight_log'
    ]
    loop
        execute format(
            $policy$
            create policy %1$I on public.%2$I
                for all
                to foodable_app
                using (user_id = auth.uid() or %3$s)
                with check (user_id = auth.uid() or %3$s)
            $policy$,
            t || '_app_member',
            t,
            format(member_of_household, t)
        );
    end loop;

    -- Per-day goal overrides and profiles are read the same way. Nothing in
    -- the app writes goal overrides, so they get no write policy.
    foreach t in array array['nutrition_goal_days', 'profiles']
    loop
        execute format(
            $policy$
            create policy %1$I on public.%2$I
                for select
                to foodable_app
                using (user_id = auth.uid() or %3$s)
            $policy$,
            t || '_app_member_select',
            t,
            format(member_of_household, t)
        );
    end loop;

end
$$;

-- A profile is written by its own user, or by the household bot token for a
-- member (the token has no user of its own, so auth.uid() is null). One member
-- never edits another's profile.
create policy profiles_app_insert
    on public.profiles
    for insert
    to foodable_app
    with check (
        user_id = auth.uid()
        or (auth.uid() is null and exists (
            select 1
            from public.household_members m
            where m.user_id = profiles.user_id
              and m.household_id = nullif(current_setting('app.household_id', true), '')::uuid
        ))
    );

create policy profiles_app_update
    on public.profiles
    for update
    to foodable_app
    using (
        user_id = auth.uid()
        or (auth.uid() is null and exists (
            select 1
            from public.household_members m
            where m.user_id = profiles.user_id
              and m.household_id = nullif(current_setting('app.household_id', true), '')::uuid
        ))
    )
    with check (
        user_id = auth.uid()
        or (auth.uid() is null and exists (
            select 1
            from public.household_members m
            where m.user_id = profiles.user_id
              and m.household_id = nullif(current_setting('app.household_id', true), '')::uuid
        ))
    );

create policy profiles_app_delete
    on public.profiles
    for delete
    to foodable_app
    using (
        user_id = auth.uid()
        or (auth.uid() is null and exists (
            select 1
            from public.household_members m
            where m.user_id = profiles.user_id
              and m.household_id = nullif(current_setting('app.household_id', true), '')::uuid
        ))
    );
