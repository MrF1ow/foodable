-- The serving a packaged food lists, and what its stored nutrition is per.
-- serving_label is the text as on the pack ("1 portion (30 ml)"),
-- serving_amount and serving_unit its size in g or ml. nutrition_basis says
-- whether the per-100 columns (calories, protein_g, ...) are per 100 g or per
-- 100 ml. It is a label only: meals and recipes still read those columns per
-- 100 g, so a liquid's per-100 ml figures are read as per 100 g, as before.
-- Null reads as per 100 g, today's meaning. All null = unknown.
-- Additive only: no backfill here and no Open Food Facts call. Existing barcode
-- foods fill in on the next barcode scan or Open Food Facts lookup.
alter table public.foods
    add column serving_label text,
    add column serving_amount numeric,
    add column serving_unit text,
    add column nutrition_basis text;

alter table public.foods
    add constraint foods_serving_amount_positive check (serving_amount is null or serving_amount > 0),
    add constraint foods_serving_unit_known check (serving_unit is null or serving_unit in ('g', 'ml')),
    add constraint foods_serving_amount_unit_pair check ((serving_amount is null) = (serving_unit is null)),
    add constraint foods_nutrition_basis_known check (nutrition_basis is null or nutrition_basis in ('100g', '100ml'));
