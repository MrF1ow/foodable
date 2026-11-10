-- Per-100 g saturated fat and Open Food Facts nutrient level bands on foods.

alter table public.foods
    add column if not exists saturated_fat_g numeric,
    add column if not exists off_nutrient_levels jsonb;

alter table public.foods
    add constraint foods_saturated_fat_g_check
        check (saturated_fat_g is null or saturated_fat_g >= 0),
    add constraint foods_off_nutrient_levels_check
        check (
            off_nutrient_levels is null
            or jsonb_typeof(off_nutrient_levels) = 'object'
        );

comment on column public.foods.saturated_fat_g is
    'Saturated fat per 100 g; null = unknown (not reported per 100 g by OFF).';
comment on column public.foods.off_nutrient_levels is
    'OFF nutrient_levels (low / moderate / high per nutrient); null = unknown.';
