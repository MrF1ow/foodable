-- Phase 6 expand: fuller recipe fields. Nullable or defaulted columns only.
-- Does not store recipes as foods (nutrition_source = 'recipe' is deferred).

alter table public.recipes
    add column instructions text,
    add column source_url text,
    add column tags text[] not null default '{}',
    add column notes text,
    add column prep_minutes integer,
    add column cook_minutes integer;

alter table public.recipes
    add constraint recipes_prep_minutes_nonneg
        check (prep_minutes is null or prep_minutes >= 0),
    add constraint recipes_cook_minutes_nonneg
        check (cook_minutes is null or cook_minutes >= 0);

alter table public.recipe_ingredients
    add column note text;
