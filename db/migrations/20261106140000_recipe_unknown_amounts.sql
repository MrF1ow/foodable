alter table public.recipe_ingredients
    alter column amount drop not null,
    alter column unit drop not null;

alter table public.recipe_ingredients
    add constraint recipe_ingredients_amount_unit_together
    check ((amount is null) = (unit is null)) not valid;

alter table public.recipe_ingredients
    validate constraint recipe_ingredients_amount_unit_together;

alter table public.grocery_lines add column note text;
