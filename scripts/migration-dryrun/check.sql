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

    if has_function_privilege('anon', 'public.add_household_member(uuid,uuid,text)', 'execute')
       or has_function_privilege('authenticated', 'public.add_household_member(uuid,uuid,text)', 'execute')
       or has_function_privilege('anon', 'public.bootstrap_household(text,text)', 'execute') then
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
end
$$;
