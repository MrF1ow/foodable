-- Copy households.fridge_locations names that are missing from fridge_locations.
-- Preserves list order after any rows already in the table. The households
-- column stays until Phase 8. A name repeated in the array is copied once, at
-- its first position, or the insert trips the (household_id, name) unique key.

insert into public.fridge_locations (household_id, name, sort_order)
select
    missing.household_id,
    missing.name,
    coalesce(
        (
            select max(fl.sort_order)
            from public.fridge_locations fl
            where fl.household_id = missing.household_id
        ),
        -1
    ) + row_number() over (
        partition by missing.household_id
        order by missing.first_ord
    )
from (
    select
        h.id as household_id,
        trim(loc.name) as name,
        min(loc.ord) as first_ord
    from public.households h
    cross join lateral unnest(coalesce(h.fridge_locations, '{}'::text[]))
        with ordinality as loc(name, ord)
    where trim(loc.name) <> ''
        and not exists (
            select 1
            from public.fridge_locations fl
            where fl.household_id = h.id
                and fl.name = trim(loc.name)
        )
    group by h.id, trim(loc.name)
) missing;
