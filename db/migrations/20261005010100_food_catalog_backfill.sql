-- Phase 2 backfill: one foods row per barcode / catalog source / manual name,
-- then set food_id on every item. Re-running is a no-op.

create or replace function public.foodable_normalize_food_name(raw text)
returns text
language sql
immutable
as $$
    select lower(regexp_replace(trim(coalesce(raw, '')), '\s+', ' ', 'g'));
$$;

do $$
begin
    -- 1. Barcode identities. Most recent display_name wins. Nutrition from
    -- food_cache (OFF) else recipe_ingredients.nutrition at 100 g.
    -- food_cache payloads are per serving whenever OFF lists a serving size,
    -- so only a "100 g" payload may fill foods' per-100 g columns. This
    -- mirrors catalogNutritionFromOff; anything else stays null (unknown).
    insert into public.foods (
        household_id,
        kind,
        name,
        normalized_name,
        default_unit,
        calories,
        protein_g,
        carbs_g,
        fat_g,
        fiber_g,
        sugar_g,
        alcohol_g,
        nutrition_source,
        off_source_id
    )
    select distinct on (src.household_id, src.kind, src.barcode)
        src.household_id,
        src.kind,
        regexp_replace(trim(src.display_name), '\s+', ' ', 'g'),
        public.foodable_normalize_food_name(src.display_name),
        'g',
        coalesce(
            (fc.payload->>'calories')::numeric,
            case
                when (src.nutrition->>'basisUnit') = 'g'
                    and (src.nutrition->>'basisAmount')::numeric = 100
                then (src.nutrition->>'calories')::numeric
            end
        ),
        coalesce(
            (fc.payload->>'protein_g')::numeric,
            case
                when (src.nutrition->>'basisUnit') = 'g'
                    and (src.nutrition->>'basisAmount')::numeric = 100
                then (src.nutrition->>'protein_g')::numeric
            end
        ),
        coalesce(
            (fc.payload->>'carbs_g')::numeric,
            case
                when (src.nutrition->>'basisUnit') = 'g'
                    and (src.nutrition->>'basisAmount')::numeric = 100
                then (src.nutrition->>'carbs_g')::numeric
            end
        ),
        coalesce(
            (fc.payload->>'fat_g')::numeric,
            case
                when (src.nutrition->>'basisUnit') = 'g'
                    and (src.nutrition->>'basisAmount')::numeric = 100
                then (src.nutrition->>'fat_g')::numeric
            end
        ),
        coalesce(
            (fc.payload->>'fiber_g')::numeric,
            case
                when (src.nutrition->>'basisUnit') = 'g'
                    and (src.nutrition->>'basisAmount')::numeric = 100
                then (src.nutrition->>'fiber_g')::numeric
            end
        ),
        coalesce(
            (fc.payload->>'sugar_g')::numeric,
            case
                when (src.nutrition->>'basisUnit') = 'g'
                    and (src.nutrition->>'basisAmount')::numeric = 100
                then (src.nutrition->>'sugar_g')::numeric
            end
        ),
        coalesce(
            (fc.payload->>'alcohol_g')::numeric,
            case
                when (src.nutrition->>'basisUnit') = 'g'
                    and (src.nutrition->>'basisAmount')::numeric = 100
                then (src.nutrition->>'alcohol_g')::numeric
            end
        ),
        'openfoodfacts',
        src.barcode
    from (
        select
            household_id,
            kind,
            display_name,
            identity->>'barcode' as barcode,
            null::jsonb as nutrition,
            updated_at as recency
        from public.fridge_items
        where identity->>'via' = 'barcode'
            and coalesce(identity->>'barcode', '') <> ''
        union all
        select
            household_id,
            kind,
            display_name,
            identity->>'barcode',
            null::jsonb,
            updated_at
        from public.grocery_lines
        where identity->>'via' = 'barcode'
            and coalesce(identity->>'barcode', '') <> ''
        union all
        select
            household_id,
            kind,
            display_name,
            identity->>'barcode',
            nutrition,
            created_at
        from public.recipe_ingredients
        where identity->>'via' = 'barcode'
            and coalesce(identity->>'barcode', '') <> ''
    ) src
    left join public.food_cache fc
        on fc.source = 'openfoodfacts'
        and fc.source_id = src.barcode
        and replace(lower(fc.payload->>'serving'), ' ', '') = '100g'
    order by src.household_id, src.kind, src.barcode, src.recency desc
    on conflict (household_id, kind, normalized_name, (coalesce(brand, '')))
        where archived_at is null
        do nothing;

    insert into public.food_barcodes (household_id, barcode, food_id)
    select distinct on (src.household_id, src.barcode)
        src.household_id,
        src.barcode,
        f.id
    from (
        select household_id, kind, identity->>'barcode' as barcode, display_name
        from public.fridge_items
        where identity->>'via' = 'barcode'
            and coalesce(identity->>'barcode', '') <> ''
        union
        select household_id, kind, identity->>'barcode', display_name
        from public.grocery_lines
        where identity->>'via' = 'barcode'
            and coalesce(identity->>'barcode', '') <> ''
        union
        select household_id, kind, identity->>'barcode', display_name
        from public.recipe_ingredients
        where identity->>'via' = 'barcode'
            and coalesce(identity->>'barcode', '') <> ''
    ) src
    join public.foods f
        on f.household_id = src.household_id
        and f.kind = src.kind
        and f.archived_at is null
        and (
            f.off_source_id = src.barcode
            or f.normalized_name = public.foodable_normalize_food_name(src.display_name)
        )
    order by src.household_id, src.barcode, (f.off_source_id = src.barcode) desc
    on conflict (household_id, barcode) do nothing;

    -- 2. Catalog identities keyed on (source, sourceId) into off_source_id.
    insert into public.foods (
        household_id,
        kind,
        name,
        normalized_name,
        default_unit,
        calories,
        protein_g,
        carbs_g,
        fat_g,
        fiber_g,
        sugar_g,
        alcohol_g,
        nutrition_source,
        off_source_id
    )
    select distinct on (src.household_id, src.kind, src.source, src.source_id)
        src.household_id,
        src.kind,
        regexp_replace(trim(src.display_name), '\s+', ' ', 'g'),
        public.foodable_normalize_food_name(src.display_name),
        'g',
        coalesce(
            (fc.payload->>'calories')::numeric,
            case
                when (src.nutrition->>'basisUnit') = 'g'
                    and (src.nutrition->>'basisAmount')::numeric = 100
                then (src.nutrition->>'calories')::numeric
            end
        ),
        coalesce(
            (fc.payload->>'protein_g')::numeric,
            case
                when (src.nutrition->>'basisUnit') = 'g'
                    and (src.nutrition->>'basisAmount')::numeric = 100
                then (src.nutrition->>'protein_g')::numeric
            end
        ),
        coalesce(
            (fc.payload->>'carbs_g')::numeric,
            case
                when (src.nutrition->>'basisUnit') = 'g'
                    and (src.nutrition->>'basisAmount')::numeric = 100
                then (src.nutrition->>'carbs_g')::numeric
            end
        ),
        coalesce(
            (fc.payload->>'fat_g')::numeric,
            case
                when (src.nutrition->>'basisUnit') = 'g'
                    and (src.nutrition->>'basisAmount')::numeric = 100
                then (src.nutrition->>'fat_g')::numeric
            end
        ),
        coalesce(
            (fc.payload->>'fiber_g')::numeric,
            case
                when (src.nutrition->>'basisUnit') = 'g'
                    and (src.nutrition->>'basisAmount')::numeric = 100
                then (src.nutrition->>'fiber_g')::numeric
            end
        ),
        coalesce(
            (fc.payload->>'sugar_g')::numeric,
            case
                when (src.nutrition->>'basisUnit') = 'g'
                    and (src.nutrition->>'basisAmount')::numeric = 100
                then (src.nutrition->>'sugar_g')::numeric
            end
        ),
        coalesce(
            (fc.payload->>'alcohol_g')::numeric,
            case
                when (src.nutrition->>'basisUnit') = 'g'
                    and (src.nutrition->>'basisAmount')::numeric = 100
                then (src.nutrition->>'alcohol_g')::numeric
            end
        ),
        'openfoodfacts',
        src.source_id
    from (
        select
            household_id,
            kind,
            display_name,
            identity->>'source' as source,
            identity->>'sourceId' as source_id,
            null::jsonb as nutrition,
            updated_at as recency
        from public.fridge_items
        where identity->>'via' = 'catalog'
            and coalesce(identity->>'sourceId', '') <> ''
        union all
        select
            household_id,
            kind,
            display_name,
            identity->>'source',
            identity->>'sourceId',
            null::jsonb,
            updated_at
        from public.grocery_lines
        where identity->>'via' = 'catalog'
            and coalesce(identity->>'sourceId', '') <> ''
        union all
        select
            household_id,
            kind,
            display_name,
            identity->>'source',
            identity->>'sourceId',
            nutrition,
            created_at
        from public.recipe_ingredients
        where identity->>'via' = 'catalog'
            and coalesce(identity->>'sourceId', '') <> ''
    ) src
    left join public.food_cache fc
        on fc.source = src.source
        and fc.source_id = src.source_id
        and replace(lower(fc.payload->>'serving'), ' ', '') = '100g'
    where src.source is distinct from 'foodable'
    order by src.household_id, src.kind, src.source, src.source_id, src.recency desc
    on conflict (household_id, kind, normalized_name, (coalesce(brand, '')))
        where archived_at is null
        do nothing;

    -- 3. Manual identities. One foods row per (household, kind, normalized name).
    insert into public.foods (
        household_id,
        kind,
        name,
        normalized_name,
        default_unit,
        nutrition_source
    )
    select distinct on (src.household_id, src.kind, src.normalized_name)
        src.household_id,
        src.kind,
        regexp_replace(trim(src.display_name), '\s+', ' ', 'g'),
        src.normalized_name,
        'g',
        null
    from (
        select
            household_id,
            kind,
            display_name,
            public.foodable_normalize_food_name(display_name) as normalized_name,
            updated_at as recency
        from public.fridge_items
        where identity->>'via' = 'manual'
        union all
        select
            household_id,
            kind,
            display_name,
            public.foodable_normalize_food_name(display_name),
            updated_at
        from public.grocery_lines
        where identity->>'via' = 'manual'
        union all
        select
            household_id,
            kind,
            display_name,
            public.foodable_normalize_food_name(display_name),
            created_at
        from public.recipe_ingredients
        where identity->>'via' = 'manual'
    ) src
    where src.normalized_name <> ''
    order by src.household_id, src.kind, src.normalized_name, src.recency desc
    on conflict (household_id, kind, normalized_name, (coalesce(brand, '')))
        where archived_at is null
        do nothing;

    -- 4. Link rows by barcode, catalog source id, or normalized name.
    update public.fridge_items item
    set food_id = f.id
    from public.foods f
    where item.food_id is null
        and f.household_id = item.household_id
        and f.kind = item.kind
        and f.archived_at is null
        and (
            (
                item.identity->>'via' = 'barcode'
                and exists (
                    select 1
                    from public.food_barcodes b
                    where b.household_id = item.household_id
                        and b.barcode = item.identity->>'barcode'
                        and b.food_id = f.id
                )
            )
            or (
                item.identity->>'via' = 'catalog'
                and f.off_source_id = item.identity->>'sourceId'
            )
            or (
                f.normalized_name = public.foodable_normalize_food_name(item.display_name)
            )
        );

    update public.grocery_lines item
    set food_id = f.id
    from public.foods f
    where item.food_id is null
        and f.household_id = item.household_id
        and f.kind = item.kind
        and f.archived_at is null
        and (
            (
                item.identity->>'via' = 'barcode'
                and exists (
                    select 1
                    from public.food_barcodes b
                    where b.household_id = item.household_id
                        and b.barcode = item.identity->>'barcode'
                        and b.food_id = f.id
                )
            )
            or (
                item.identity->>'via' = 'catalog'
                and f.off_source_id = item.identity->>'sourceId'
            )
            or (
                f.normalized_name = public.foodable_normalize_food_name(item.display_name)
            )
        );

    update public.recipe_ingredients item
    set food_id = f.id
    from public.foods f
    where item.food_id is null
        and f.household_id = item.household_id
        and f.kind = item.kind
        and f.archived_at is null
        and (
            (
                item.identity->>'via' = 'barcode'
                and exists (
                    select 1
                    from public.food_barcodes b
                    where b.household_id = item.household_id
                        and b.barcode = item.identity->>'barcode'
                        and b.food_id = f.id
                )
            )
            or (
                item.identity->>'via' = 'catalog'
                and f.off_source_id = item.identity->>'sourceId'
            )
            or (
                f.normalized_name = public.foodable_normalize_food_name(item.display_name)
            )
        );

    -- 5. Dislikes: exact normalized name match only.
    update public.member_dislikes d
    set food_id = f.id
    from public.foods f
    where d.food_id is null
        and f.household_id = d.household_id
        and f.kind = 'food'
        and f.archived_at is null
        and f.normalized_name = public.foodable_normalize_food_name(d.display_name);

    -- 6. Assert: every item row has a food_id.
    if exists (
        select 1 from public.fridge_items where food_id is null
        union all
        select 1 from public.grocery_lines where food_id is null
        union all
        select 1 from public.recipe_ingredients where food_id is null
    ) then
        raise exception 'food catalog backfill left null food_id rows';
    end if;
end
$$;

drop function public.foodable_normalize_food_name(text);
