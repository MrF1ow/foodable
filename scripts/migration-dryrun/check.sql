-- Expectations for seed.sql after every pending migration. Any miss raises.

do $$
declare
    f record;
begin
    if (select count(*) from public.foods) <> 6 then
        raise exception 'expected 6 foods, got %', (select count(*) from public.foods);
    end if;

    -- Per-serving cache payloads must not land in per-100 g columns.
    select * into f from public.foods where normalized_name = 'whole milk';
    if f.calories is not null then
        raise exception 'whole milk took per-serving calories %', f.calories;
    end if;
    select * into f from public.foods where normalized_name = 'granola';
    if f.calories is not null then
        raise exception 'granola took per-serving calories %', f.calories;
    end if;
    select * into f from public.foods where normalized_name = 'oats';
    if f.calories is distinct from 380 then
        raise exception 'oats should keep 380 kcal per 100 g, got %', f.calories;
    end if;
    select * into f from public.foods where normalized_name = 'butter';
    if f.calories is distinct from 717 then
        raise exception 'butter should fall back to recipe nutrition 717, got %', f.calories;
    end if;

    -- One food for every spelling of eggs, with a trimmed name.
    if (select count(*) from public.foods where normalized_name = 'eggs') <> 1 then
        raise exception 'eggs did not collapse to one food';
    end if;
    if exists (select 1 from public.foods where name <> trim(name)) then
        raise exception 'a food name kept surrounding whitespace';
    end if;
    if (
        select count(distinct food_id) from (
            select food_id from public.fridge_items where display_name = 'Eggs'
            union all
            select food_id from public.grocery_lines where display_name = 'EGGS'
            union all
            select food_id from public.recipe_ingredients where display_name = 'eggs  '
        ) e
    ) <> 1 then
        raise exception 'eggs rows point at different foods';
    end if;

    -- Manual "oats" joins the barcode food of the same name.
    if (select count(distinct food_id) from public.grocery_lines
        where lower(display_name) = 'oats') <> 1 then
        raise exception 'manual and barcode oats point at different foods';
    end if;

    if (select food_id from public.member_dislikes where display_name = 'Eggs') is null then
        raise exception 'dislike Eggs was not linked';
    end if;
    if (select food_id from public.member_dislikes where display_name = 'Cilantro') is not null then
        raise exception 'dislike Cilantro linked without a matching food';
    end if;

    -- Duplicate array entry copied once, order kept after the existing row.
    if (
        select string_agg(name || ':' || sort_order, ',' order by sort_order)
        from public.fridge_locations
    ) <> 'Fridge:0,Freezer:1,Pantry:2' then
        raise exception 'fridge_locations copy wrong: %', (
            select string_agg(name || ':' || sort_order, ',' order by sort_order)
            from public.fridge_locations
        );
    end if;

    -- Phase 8 contract: the legacy identity shape is gone and every item
    -- row names its food.
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and (
              (column_name = 'identity' and table_name in
                  ('fridge_items', 'grocery_lines', 'recipe_ingredients', 'member_dislikes'))
              or (table_name = 'recipe_ingredients' and column_name = 'nutrition')
              or (table_name = 'households' and column_name = 'fridge_locations')
              or (table_name = 'profiles' and column_name = 'accent_swatch')
          )
    ) then
        raise exception 'a column Phase 8 contracts is still present';
    end if;
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name in ('fridge_items', 'grocery_lines', 'recipe_ingredients')
          and column_name = 'food_id'
          and is_nullable = 'YES'
    ) then
        raise exception 'food_id is still nullable on an item table';
    end if;
    if to_regprocedure('public.bootstrap_household(text,text)') is not null then
        raise exception 'bootstrap_household still exists';
    end if;

    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'profiles'
          and column_name = 'nutrition_layout'
    ) then
        raise exception 'profiles.nutrition_layout still exists';
    end if;

    if (select count(*) from auth.users) <>
       (select count(*) from public.users) then
        raise exception 'auth.users and public.users counts differ: auth=% public=%',
            (select count(*) from auth.users),
            (select count(*) from public.users);
    end if;

    if exists (
        select 1
        from auth.users a
        left join public.users u on u.id = a.id
        where u.id is null
           or u.email is distinct from a.email
           or u.created_at is distinct from a.created_at
           or u.password_hash is distinct from a.encrypted_password
    ) then
        raise exception 'public.users does not mirror auth.users';
    end if;

    if exists (
        select 1
        from pg_trigger
        where tgname = 'sync_auth_users_to_public_users'
    ) then
        raise exception 'sync_auth_users_to_public_users trigger still exists';
    end if;

    if to_regprocedure('public.sync_auth_user_to_public_users()') is not null then
        raise exception 'sync_auth_user_to_public_users() still exists';
    end if;

    if has_function_privilege('anon', 'public.add_household_member(uuid,uuid,text)', 'execute')
       or has_function_privilege('authenticated', 'public.add_household_member(uuid,uuid,text)', 'execute') then
        raise exception 'household RPCs are still executable by client roles';
    end if;
    if exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and has_function_privilege('anon', p.oid, 'execute')
    ) then
        raise exception 'a security definer function in public is executable by anon';
    end if;

    -- Ownership transfer and promotion. Each case runs in a subtransaction that
    -- ends in a sentinel exception, so the fixture is left exactly as it was.
    begin
        perform public.transfer_household_ownership(
            '11111111-1111-1111-1111-111111111111',
            '00000000-0000-0000-0000-0000000000a1',
            '00000000-0000-0000-0000-0000000000b2');
        if (select string_agg(display_name || ':' || role, ',' order by display_name)
            from public.household_members) <> 'A:member,B:owner' then
            raise exception 'transfer did not swap owner and member';
        end if;
        raise exception 'dryrun-rollback';
    exception when raise_exception then
        if sqlerrm <> 'dryrun-rollback' then raise; end if;
    end;

    begin
        perform public.transfer_household_ownership(
            '11111111-1111-1111-1111-111111111111',
            '00000000-0000-0000-0000-0000000000b2',
            '00000000-0000-0000-0000-0000000000a1');
        raise exception 'a member was allowed to transfer ownership';
    exception when raise_exception then
        if sqlerrm <> 'only the household owner may transfer ownership' then raise; end if;
    end;

    begin
        -- C joined last but holds the oldest account (public.users.created_at), so C inherits.
        insert into public.users (id, email, created_at) values
            ('00000000-0000-0000-0000-0000000000c3', 'c@example.com', now() - interval '1 year');
        insert into public.household_members (household_id, user_id, role, display_name) values
            ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000c3', 'member', 'C');
        delete from public.users where id = '00000000-0000-0000-0000-0000000000a1';
        if (select display_name from public.household_members where role = 'owner') is distinct from 'C' then
            raise exception 'owner leaving did not promote the oldest account: %',
                (select display_name from public.household_members where role = 'owner');
        end if;
        raise exception 'dryrun-rollback';
    exception when raise_exception then
        if sqlerrm <> 'dryrun-rollback' then raise; end if;
    end;

    begin
        -- A member leaving never changes who owns the household.
        delete from public.household_members where user_id = '00000000-0000-0000-0000-0000000000b2';
        if (select display_name from public.household_members where role = 'owner') is distinct from 'A' then
            raise exception 'a member leaving changed the owner';
        end if;
        raise exception 'dryrun-rollback';
    exception when raise_exception then
        if sqlerrm <> 'dryrun-rollback' then raise; end if;
    end;

    -- Usual products: columns, index, and rule-1 shape (one level deep).
    if not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'foods'
          and column_name = 'generic_food_id'
    ) then
        raise exception 'foods.generic_food_id missing';
    end if;
    if not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'foods'
          and column_name = 'usual_product_id'
    ) then
        raise exception 'foods.usual_product_id missing';
    end if;
    if not exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'foods'
          and indexname = 'foods_generic_idx'
    ) then
        raise exception 'foods_generic_idx missing';
    end if;
    if exists (
        select 1
        from public.foods p
        join public.foods g on g.id = p.generic_food_id
        where p.generic_food_id is not null
          and g.generic_food_id is not null
    ) then
        raise exception 'a product points at another product (rule 1)';
    end if;
    if exists (
        select 1
        from public.foods p
        join public.foods g on g.id = p.generic_food_id
        where p.generic_food_id is not null
          and g.generic_food_id is not null
          and exists (
              select 1
              from public.foods c
              where c.generic_food_id = g.id
                and c.id <> p.id
          )
    ) then
        raise exception 'a plain food has products and is also a product (rule 1)';
    end if;
    if exists (
        select 1
        from public.foods plain_food
        join public.foods usual_p on usual_p.id = plain_food.usual_product_id
        where plain_food.usual_product_id is not null
          and usual_p.generic_food_id is distinct from plain_food.id
    ) then
        raise exception 'usual product is not a product of its food (rule 3)';
    end if;

    if (select count(*) from public.recipes) < 1 then
        raise exception 'expected at least one recipe in fixture';
    end if;
    if exists (
        select 1 from public.recipes where verification is distinct from 'verified'
    ) then
        raise exception 'every recipe in fixture should be verified after backfill';
    end if;
    if not exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = 'recipe_imports'
          and c.relrowsecurity
    ) then
        raise exception 'recipe_imports missing or RLS not enabled';
    end if;

    begin
        update public.foods
        set generic_food_id = id
        where id = (
            select id from public.foods where normalized_name = 'eggs' limit 1
        );
        raise exception 'foods_generic_not_self did not fire';
    exception
        when check_violation then
            null;
    end;

    begin
        update public.foods
        set usual_product_id = id
        where id = (
            select id from public.foods where normalized_name = 'eggs' limit 1
        );
        raise exception 'foods_usual_not_self did not fire';
    exception
        when check_violation then
            null;
    end;

    begin
        insert into public.foods (
            id, household_id, kind, name, normalized_name
        ) values (
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
            '11111111-1111-1111-1111-111111111111',
            'food',
            'Dry Plain Two Prods',
            'dry-plain-two-prods'
        );
        insert into public.foods (
            id, household_id, kind, name, normalized_name, generic_food_id
        ) values (
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
            '11111111-1111-1111-1111-111111111111',
            'food',
            'Dry Kirkland',
            'dry-kirkland',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'
        );
        insert into public.foods (
            id, household_id, kind, name, normalized_name, generic_food_id
        ) values (
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03',
            '11111111-1111-1111-1111-111111111111',
            'food',
            'Dry Great Value',
            'dry-great-value',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'
        );
        update public.foods
        set usual_product_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02'
        where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01';

        if exists (
            select 1
            from public.foods p
            join public.foods g on g.id = p.generic_food_id
            where p.generic_food_id is not null
              and g.generic_food_id is not null
        ) then
            raise exception 'a product points at another product (rule 1)';
        end if;
        if exists (
            select 1
            from public.foods p
            join public.foods g on g.id = p.generic_food_id
            where p.generic_food_id is not null
              and g.generic_food_id is not null
              and exists (
                  select 1
                  from public.foods c
                  where c.generic_food_id = g.id
                    and c.id <> p.id
              )
        ) then
            raise exception 'a plain food has products and is also a product (rule 1)';
        end if;
        if exists (
            select 1
            from public.foods plain_food
            join public.foods usual_p on usual_p.id = plain_food.usual_product_id
            where plain_food.usual_product_id is not null
              and usual_p.generic_food_id is distinct from plain_food.id
        ) then
            raise exception 'usual product is not a product of its food (rule 3)';
        end if;

        raise exception 'dryrun-rollback';
    exception when raise_exception then
        if sqlerrm <> 'dryrun-rollback' then raise; end if;
    end;

    -- Usual store and amount: columns, index, and both checks reject bad rows.
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'foods'
          and column_name = 'usual_store_id'
    ) or not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'foods'
          and column_name = 'usual_amount'
    ) or not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'foods'
          and column_name = 'usual_unit'
    ) then
        raise exception 'foods usual store and amount columns are missing';
    end if;
    if not exists (
        select 1 from pg_indexes
        where schemaname = 'public' and indexname = 'foods_usual_store_idx'
    ) then
        raise exception 'foods_usual_store_idx is missing';
    end if;

    begin
        -- A valid row saves: 24 each at the fixture store.
        insert into public.foods (
            id, household_id, kind, name, normalized_name,
            usual_store_id, usual_amount, usual_unit
        ) values (
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01',
            '11111111-1111-1111-1111-111111111111',
            'food', 'Dry Usual Eggs', 'dry-usual-eggs',
            '33333333-3333-3333-3333-333333333333', 24, 'each'
        );

        -- Each bad row must fail with check_violation. The inner block
        -- catches only check_violation, so a row that saves raises a
        -- raise_exception that escapes it and is not 'dryrun-rollback'.
        begin
            update public.foods set usual_unit = null
            where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01';
            raise exception 'usual amount saved without a unit';
        exception when check_violation then null;
        end;
        begin
            update public.foods set usual_amount = null
            where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01';
            raise exception 'usual unit saved without an amount';
        exception when check_violation then null;
        end;
        begin
            update public.foods set usual_amount = 0
            where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01';
            raise exception 'usual amount of zero saved';
        exception when check_violation then null;
        end;
        begin
            update public.foods set usual_amount = -1
            where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01';
            raise exception 'negative usual amount saved';
        exception when check_violation then null;
        end;

        -- Removing the store clears it on the food.
        delete from public.grocery_stores
        where id = '33333333-3333-3333-3333-333333333333';
        if (select usual_store_id from public.foods
            where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01') is not null then
            raise exception 'deleting a store did not clear usual_store_id';
        end if;

        raise exception 'dryrun-rollback';
    exception when raise_exception then
        if sqlerrm <> 'dryrun-rollback' then raise; end if;
    end;
end
$$;

do $$
declare
    hh uuid := '11111111-1111-1111-1111-111111111111';
    loc uuid := '22222222-2222-2222-2222-222222222222';
    store_id uuid := '33333333-3333-3333-3333-333333333333';
    section_id uuid := '44444444-4444-4444-4444-444444444444';
    line_count int;
    fridge_item_id uuid;
    grocery_line_id uuid;
    food_id uuid;
begin
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'grocery_lines'
          and column_name = 'source'
    ) or not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'grocery_lines'
          and column_name = 'source_fridge_item_id'
    ) then
        raise exception 'grocery_lines source columns are missing';
    end if;

    if (
        select is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'grocery_lines'
          and column_name = 'source'
    ) <> 'NO' then
        raise exception 'grocery_lines.source must be not null';
    end if;

    if (
        select column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'grocery_lines'
          and column_name = 'source'
    ) is distinct from '''manual''::text' then
        raise exception 'grocery_lines.source default must be manual';
    end if;

    if not exists (
        select 1 from pg_indexes
        where schemaname = 'public' and indexname = 'grocery_lines_source_fridge_item_idx'
    ) then
        raise exception 'grocery_lines_source_fridge_item_idx is missing';
    end if;

    if (
        select indexdef from pg_indexes
        where schemaname = 'public' and indexname = 'grocery_lines_source_fridge_item_idx'
    ) is distinct from
        'CREATE INDEX grocery_lines_source_fridge_item_idx ON public.grocery_lines USING btree (source_fridge_item_id) WHERE (source_fridge_item_id IS NOT NULL)'
    then
        raise exception 'grocery_lines_source_fridge_item_idx indexdef mismatch';
    end if;

    select count(*) into line_count from public.grocery_lines;
    if line_count < 1 then
        raise exception 'seed grocery_lines expected';
    end if;

    if exists (
        select 1 from public.grocery_lines
        where household_id = hh
          and (source <> 'manual' or source_fridge_item_id is not null)
    ) then
        raise exception 'seed grocery_lines must default to manual with no fridge item';
    end if;

    begin
        begin
            update public.grocery_lines
            set source = 'bogus'
            where id = (
                select id from public.grocery_lines
                where household_id = hh
                limit 1
            );
            raise exception 'bogus grocery source saved';
        exception when check_violation then null;
        end;

        select f.id into food_id
        from public.foods f
        where f.household_id = hh
        limit 1;

        if food_id is null then
            raise exception 'seed foods expected for grocery source fk check';
        end if;

        insert into public.fridge_items (
            household_id, location_id, kind, display_name, amount, unit, food_id
        )
        values (hh, loc, 'food', 'Dryrun restock item', 100, 'g', food_id)
        returning id into fridge_item_id;

        insert into public.grocery_lines (
            household_id, store_id, section_id, kind, display_name,
            amount, unit, food_id, source, source_fridge_item_id
        )
        values (
            hh, store_id, section_id, 'food', 'Restock probe',
            1, 'g', food_id, 'restock', fridge_item_id
        )
        returning id into grocery_line_id;

        delete from public.fridge_items where id = fridge_item_id;

        if not exists (
            select 1 from public.grocery_lines
            where id = grocery_line_id
              and source = 'restock'
              and source_fridge_item_id is null
        ) then
            raise exception 'deleting fridge item did not clear source_fridge_item_id';
        end if;

        raise exception 'dryrun-rollback';
    exception when raise_exception then
        if sqlerrm <> 'dryrun-rollback' then raise; end if;
    end;
    if not exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'notice_dismissals'
    ) then
        raise exception 'notice_dismissals table missing';
    end if;

    if not exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'notice_dismissals_key'
    ) then
        raise exception 'notice_dismissals_key index missing';
    end if;

    if not exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'notice_dismissals_subject_idx'
    ) then
        raise exception 'notice_dismissals_subject_idx index missing';
    end if;

    if not exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'notice_dismissals_related_key_idx'
    ) then
        raise exception 'notice_dismissals_related_key_idx index missing';
    end if;

    if not exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'notice_dismissals_household_created_idx'
    ) then
        raise exception 'notice_dismissals_household_created_idx index missing';
    end if;

    if not exists (
        select 1
        from pg_tables
        where schemaname = 'public'
          and tablename = 'notice_dismissals'
          and rowsecurity
    ) then
        raise exception 'notice_dismissals RLS not enabled';
    end if;

    begin
        insert into public.notice_dismissals (
            household_id, code, subject_kind, subject_id
        )
        values (
            '11111111-1111-1111-1111-111111111111',
            'fridge.expiring',
            'fridge_item',
            '22222222-2222-2222-2222-222222222222'
        );
        begin
            insert into public.notice_dismissals (
                household_id, code, subject_kind, subject_id
            )
            values (
                '11111111-1111-1111-1111-111111111111',
                'fridge.expiring',
                'fridge_item',
                '22222222-2222-2222-2222-222222222222'
            );
            raise exception 'duplicate dismissal accepted';
        exception when unique_violation then
            delete from public.notice_dismissals
            where household_id = '11111111-1111-1111-1111-111111111111'
              and code = 'fridge.expiring'
              and subject_kind = 'fridge_item'
              and subject_id = '22222222-2222-2222-2222-222222222222';
        end;
    end;

    -- Notifications: both tables, the unique open-row index and the three
    -- lookup indexes, row level security and the service_role grants.
    declare
        t text;
        p text;
        idx text;
    begin
        foreach t in array array['notifications', 'notification_prefs'] loop
            if to_regclass('public.' || t) is null then
                raise exception '% table missing', t;
            end if;
            if not exists (
                select 1 from pg_tables
                where schemaname = 'public' and tablename = t and rowsecurity
            ) then
                raise exception '% RLS not enabled', t;
            end if;
            foreach p in array array['select', 'insert', 'update', 'delete'] loop
                if not has_table_privilege('service_role', 'public.' || t, p) then
                    raise exception 'service_role lacks % on %', p, t;
                end if;
            end loop;
        end loop;

        foreach idx in array array[
            'notifications_open_key',
            'notifications_recipient_created_idx',
            'notifications_household_open_key_idx',
            'notifications_dismissed_idx',
            'notifications_resolved_idx'
        ] loop
            if not exists (
                select 1 from pg_indexes
                where schemaname = 'public'
                  and tablename = 'notifications'
                  and indexname = idx
            ) then
                raise exception '% index missing', idx;
            end if;
        end loop;

        if not exists (
            select 1 from pg_indexes
            where schemaname = 'public'
              and indexname = 'notifications_open_key'
              and indexdef ilike 'create unique index%'
              and indexdef ilike '%where (resolved_at is null)%'
        ) then
            raise exception 'notifications_open_key is not a unique partial index';
        end if;
    end;

    -- Plan repeats: the table, its checks, row level security, the
    -- service_role grants, the household policy and the lookup indexes.
    declare
        p text;
        idx text;
        col text;
    begin
        if to_regclass('public.plan_rules') is null then
            raise exception 'plan_rules table missing';
        end if;
        if not exists (
            select 1 from pg_tables
            where schemaname = 'public' and tablename = 'plan_rules' and rowsecurity
        ) then
            raise exception 'plan_rules RLS not enabled';
        end if;
        foreach p in array array['select', 'insert', 'update', 'delete'] loop
            if not has_table_privilege('service_role', 'public.plan_rules', p) then
                raise exception 'service_role lacks % on plan_rules', p;
            end if;
        end loop;
        foreach col in array array[
            'household_id', 'recipe_id', 'meal', 'servings', 'starts_on',
            'rule', 'days', 'ends_on', 'skipped_on', 'created_by',
            'created_at', 'updated_at'
        ] loop
            if not exists (
                select 1 from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'plan_rules'
                  and column_name = col
            ) then
                raise exception 'plan_rules.% missing', col;
            end if;
        end loop;
        foreach idx in array array[
            'plan_rules_household_starts_idx',
            'plan_rules_recipe_id_idx'
        ] loop
            if not exists (
                select 1 from pg_indexes
                where schemaname = 'public'
                  and tablename = 'plan_rules'
                  and indexname = idx
            ) then
                raise exception '% index missing', idx;
            end if;
        end loop;
        if not exists (
            select 1 from pg_policies
            where schemaname = 'public'
              and tablename = 'plan_rules'
              and 'foodable_app' = any (roles)
        ) then
            raise exception 'plan_rules has no foodable_app policy';
        end if;
    end;

    -- Recipe versions: the table, row level security, grants, the lookup
    -- indexes, the household policy, the shape checks, the cascades, and the
    -- member_ids the week plan's rows gained.
    declare
        p text;
        idx text;
        col text;
        tbl text;
        i record;
        u uuid;
        fid uuid;
        fid2 uuid;
        failed boolean;
    begin
        if to_regclass('public.recipe_variant_overrides') is null then
            raise exception 'recipe_variant_overrides table missing';
        end if;
        if not exists (
            select 1 from pg_tables
            where schemaname = 'public'
              and tablename = 'recipe_variant_overrides' and rowsecurity
        ) then
            raise exception 'recipe_variant_overrides RLS not enabled';
        end if;
        foreach p in array array['select', 'insert', 'update', 'delete'] loop
            if not has_table_privilege(
                'service_role', 'public.recipe_variant_overrides', p
            ) then
                raise exception 'service_role lacks % on recipe_variant_overrides', p;
            end if;
        end loop;
        foreach col in array array[
            'household_id', 'recipe_id', 'user_id', 'ingredient_id', 'action',
            'amount', 'unit', 'food_id', 'display_name', 'created_at',
            'updated_at'
        ] loop
            if not exists (
                select 1 from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'recipe_variant_overrides'
                  and column_name = col
            ) then
                raise exception 'recipe_variant_overrides.% missing', col;
            end if;
        end loop;
        foreach idx in array array[
            'recipe_variant_overrides_ingredient_key',
            'recipe_variant_overrides_added_food_key',
            'recipe_variant_overrides_recipe_idx',
            'recipe_variant_overrides_user_idx'
        ] loop
            if not exists (
                select 1 from pg_indexes
                where schemaname = 'public'
                  and tablename = 'recipe_variant_overrides'
                  and indexname = idx
            ) then
                raise exception '% index missing', idx;
            end if;
        end loop;
        if not exists (
            select 1 from pg_policies
            where schemaname = 'public'
              and tablename = 'recipe_variant_overrides'
              and 'foodable_app' = any (roles)
        ) then
            raise exception 'recipe_variant_overrides has no foodable_app policy';
        end if;

        foreach tbl in array array['recipe_plans', 'plan_rules'] loop
            if not exists (
                select 1 from information_schema.columns
                where table_schema = 'public'
                  and table_name = tbl
                  and column_name = 'member_ids'
                  and data_type = 'ARRAY'
                  and is_nullable = 'NO'
            ) then
                raise exception '%.member_ids missing or nullable', tbl;
            end if;
        end loop;

        begin
            -- Behaviour, on the seeded recipes; all of it rolled back.
            select i0.id as ingredient_id, i0.recipe_id, i0.household_id
            into i
            from public.recipe_ingredients i0
            order by i0.created_at, i0.id
            limit 1;
            select user_id into u from public.household_members
            where household_id = i.household_id limit 1;
            insert into public.foods (household_id, kind, name, normalized_name)
            values (i.household_id, 'food', 'Variant check', 'variant check')
            returning id into fid;
            if i.ingredient_id is null or u is null then
                raise exception 'no seeded recipe to check recipe versions on';
            end if;
            if true then
                -- An override that does not fit its action is refused.
                failed := false;
                begin
                    insert into public.recipe_variant_overrides
                        (household_id, recipe_id, user_id, action)
                    values (i.household_id, i.recipe_id, u, 'remove');
                exception when check_violation then
                    failed := true;
                end;
                if not failed then
                    raise exception 'a remove with no ingredient was accepted';
                end if;
                failed := false;
                begin
                    insert into public.recipe_variant_overrides
                        (household_id, recipe_id, user_id, action, ingredient_id,
                         food_id, display_name)
                    values (i.household_id, i.recipe_id, u, 'add', i.ingredient_id,
                            fid, 'x');
                exception when check_violation then
                    failed := true;
                end;
                if not failed then
                    raise exception 'an add that names a base ingredient was accepted';
                end if;
                -- One row per person and base ingredient.
                insert into public.recipe_variant_overrides
                    (household_id, recipe_id, user_id, action, ingredient_id)
                values (i.household_id, i.recipe_id, u, 'remove', i.ingredient_id);
                failed := false;
                begin
                    insert into public.recipe_variant_overrides
                        (household_id, recipe_id, user_id, action, ingredient_id,
                         amount, unit)
                    values (i.household_id, i.recipe_id, u, 'amount',
                            i.ingredient_id, 2, 'g');
                exception when unique_violation then
                    failed := true;
                end;
                if not failed then
                    raise exception 'a second override of one ingredient was accepted';
                end if;
                -- A person adds a food once; different foods are not limited.
                insert into public.foods (household_id, kind, name, normalized_name)
                values (i.household_id, 'food', 'Variant check two', 'variant check two')
                returning id into fid2;
                insert into public.recipe_variant_overrides
                    (household_id, recipe_id, user_id, action, food_id,
                     display_name, amount, unit)
                values (i.household_id, i.recipe_id, u, 'add', fid, 'a', 1, 'g'),
                       (i.household_id, i.recipe_id, u, 'add', fid2, 'b', 1, 'g');
                failed := false;
                begin
                    insert into public.recipe_variant_overrides
                        (household_id, recipe_id, user_id, action, food_id,
                         display_name, amount, unit)
                    values (i.household_id, i.recipe_id, u, 'add', fid, 'c', 2, 'g');
                exception when unique_violation then
                    failed := true;
                end;
                if not failed then
                    raise exception 'a second add of one food was accepted';
                end if;
                -- Deleting the base ingredient takes its overrides, not the added ones.
                delete from public.recipe_ingredients where id = i.ingredient_id;
                if exists (
                    select 1 from public.recipe_variant_overrides
                    where ingredient_id = i.ingredient_id
                ) then
                    raise exception 'an override outlived its ingredient';
                end if;
                if (select count(*) from public.recipe_variant_overrides
                    where recipe_id = i.recipe_id) <> 2 then
                    raise exception 'deleting an ingredient took the added ones too';
                end if;
                delete from public.recipes where id = i.recipe_id;
                if exists (
                    select 1 from public.recipe_variant_overrides
                    where recipe_id = i.recipe_id
                ) then
                    raise exception 'an override outlived its recipe';
                end if;
            end if;
            raise exception 'dryrun-rollback';
        exception when others then
            if sqlerrm <> 'dryrun-rollback' then raise; end if;
        end;
    end;

    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'profiles'
          and column_name = 'locale'
    ) then
        raise exception 'profiles.locale still exists';
    end if;

    if to_regclass('public.idx_meals_user_id') is not null then
        raise exception 'idx_meals_user_id still exists';
    end if;
    if to_regclass('public.idx_water_log_user_id') is not null then
        raise exception 'idx_water_log_user_id still exists';
    end if;
    if to_regclass('public.idx_weight_log_user_id') is not null then
        raise exception 'idx_weight_log_user_id still exists';
    end if;

    if to_regclass('public.meals_user_logged_idx') is null then
        raise exception 'meals_user_logged_idx missing';
    end if;
    if to_regclass('public.water_log_user_logged_idx') is null then
        raise exception 'water_log_user_logged_idx missing';
    end if;
    if to_regclass('public.weight_log_user_logged_idx') is null then
        raise exception 'weight_log_user_logged_idx missing';
    end if;

    if not exists (select 1 from pg_roles where rolname = 'foodable_app') then
        raise exception 'foodable_app role missing';
    end if;

    if exists (
        select 1
        from pg_roles
        where rolname = 'foodable_app'
          and (rolsuper or rolbypassrls)
    ) then
        raise exception 'foodable_app must not be superuser or bypass RLS';
    end if;

    if exists (
        select 1
        from pg_auth_members m
        join pg_roles member on member.oid = m.member
        join pg_roles granted on granted.oid = m.roleid
        where member.rolname = 'foodable_app'
          and granted.rolbypassrls
    ) then
        raise exception 'foodable_app is a member of a bypassrls role';
    end if;

    if not has_table_privilege(
        'foodable_app', 'public.profiles', 'SELECT, INSERT, UPDATE, DELETE'
    ) then
        raise exception 'foodable_app missing DML on profiles';
    end if;

    if exists (
        select 1
        from pg_namespace n
        where n.nspname = 'foodable_migrations'
          and has_schema_privilege('foodable_app', n.oid, 'USAGE')
    ) then
        raise exception 'foodable_app must not use foodable_migrations schema';
    end if;

    -- Security definer functions take a household id and act as their owner:
    -- the app calls them as the system, never as foodable_app.
    if exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosecdef
          and has_function_privilege('foodable_app', p.oid, 'execute')
    ) then
        raise exception 'foodable_app can execute a security definer function: %', (
            select string_agg(p.proname, ', ')
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.prosecdef
              and has_function_privilege('foodable_app', p.oid, 'execute')
        );
    end if;

    if exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'household_members'
          and 'foodable_app' = any (roles)
          and cmd <> 'SELECT'
    ) then
        raise exception 'foodable_app may only read household_members';
    end if;

    -- Every table with a household_id gives foodable_app a policy, except the
    -- system-only ones named here on purpose. A listed table that gains a
    -- policy must leave the list.
    declare
        missing text;
        stale text;
        exempt text[] := array[
            'flag_assignments',
            'household_mcp_tokens'
        ];
    begin
        select string_agg(c.relname, ', ' order by c.relname) into missing
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a
          on a.attrelid = c.oid and a.attname = 'household_id' and not a.attisdropped
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
          and c.relname <> all (exempt)
          and not exists (
              select 1 from pg_policies p
              where p.schemaname = 'public'
                and p.tablename = c.relname
                and 'foodable_app' = any (p.roles)
          );
        if missing is not null then
            raise exception 'tables with household_id but no foodable_app policy: %', missing;
        end if;

        select string_agg(p.tablename, ', ' order by p.tablename) into stale
        from (
            select distinct tablename from pg_policies
            where schemaname = 'public' and 'foodable_app' = any (roles)
        ) p
        where p.tablename = any (exempt);
        if stale is not null then
            raise exception 'exempt from the household policy check but has a foodable_app policy: %', stale;
        end if;
    end;

    -- The household's agent switch was off, so no member's agents gained a
    -- delete right from the per-person switch.
    if (select count(*) from public.household_members) <> 2 then
        raise exception 'expected 2 household members, got %',
            (select count(*) from public.household_members);
    end if;
    if exists (
        select 1 from public.household_members where agents_can_delete is not false
    ) then
        raise exception 'a member took agents_can_delete true from a household whose switch was off';
    end if;

    -- A person's own data: foodable_app reaches it through policies on the
    -- user and the household's members, never without one.
    declare
        missing text;
    begin
        select string_agg(t, ', ' order by t) into missing
        from unnest(array[
            'meal_items',
            'meals',
            'nutrition_goal_days',
            'nutrition_goals',
            'profiles',
            'water_log',
            'weight_log'
        ]) as t
        where not exists (
            select 1 from pg_policies p
            where p.schemaname = 'public'
              and p.tablename = t
              and 'foodable_app' = any (p.roles)
        );
        if missing is not null then
            raise exception 'personal tables with no foodable_app policy: %', missing;
        end if;
    end;

end;
$$;
