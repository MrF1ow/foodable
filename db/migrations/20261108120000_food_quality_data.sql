-- Open Food Facts product-quality facts on the household foods row (SCORE-1).
-- Null column = unknown; additive risk tiers are derived on read from
-- src/domain/additive-risk.ts, not stored per row.

alter table public.foods
    add column if not exists nutriscore_grade text,
    add column if not exists nova_group smallint,
    add column if not exists ecoscore_grade text,
    add column if not exists additives_tags text[],
    add column if not exists allergens_tags text[],
    add column if not exists traces_tags text[],
    add column if not exists ingredients_analysis_tags text[],
    add column if not exists labels_tags text[],
    add column if not exists off_quality_fetched_at timestamptz;

alter table public.foods
    add constraint foods_nutriscore_grade_check
        check (nutriscore_grade is null or nutriscore_grade in ('a', 'b', 'c', 'd', 'e')),
    add constraint foods_nova_group_check
        check (nova_group is null or nova_group between 1 and 4),
    add constraint foods_ecoscore_grade_check
        check (
            ecoscore_grade is null
            or ecoscore_grade in ('a-plus', 'a', 'b', 'c', 'd', 'e', 'f')
        );

comment on column public.foods.nutriscore_grade is
    'Nutri-Score A–E from Open Food Facts; null = unknown or not computed.';
comment on column public.foods.nova_group is
    'NOVA processing group 1–4 from Open Food Facts; null = unknown.';
comment on column public.foods.ecoscore_grade is
    'Green-Score (ecoscore) A+–F from Open Food Facts; null = unknown.';
comment on column public.foods.additives_tags is
    'OFF additive tags; EFSA risk tier is derived on read via additive-risk.ts; null = unknown list.';
comment on column public.foods.allergens_tags is
    'OFF allergen tags; null = unknown (empty array = none declared).';
comment on column public.foods.traces_tags is
    'OFF may-contain traces tags; null = unknown.';
comment on column public.foods.ingredients_analysis_tags is
    'OFF ingredients analysis (vegan, palm oil, etc.); null = unknown.';
comment on column public.foods.labels_tags is
    'OFF label tags (e.g. organic); null = unknown.';
comment on column public.foods.off_quality_fetched_at is
    'When OFF quality fields were last fetched; null = never stored on this row.';
