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

    if not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'profiles'
          and column_name = 'nutrition_layout'
          and udt_name = '_text'
          and is_nullable = 'YES'
    ) then
        raise exception 'profiles.nutrition_layout missing or not nullable text[]';
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
        -- C joined last but holds the oldest Auth account, so C inherits.
        insert into auth.users (id, email, created_at) values
            ('00000000-0000-0000-0000-0000000000c3', 'c@example.com', now() - interval '1 year');
        insert into public.household_members (household_id, user_id, role, display_name) values
            ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000c3', 'member', 'C');
        delete from auth.users where id = '00000000-0000-0000-0000-0000000000a1';
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
end;
$$;
