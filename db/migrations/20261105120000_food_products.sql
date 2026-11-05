-- Usual products: a product row points at the plain food it belongs to
-- (generic_food_id); a plain food points at its usual product
-- (usual_product_id). Cross-row rules (one level deep, same kind, same
-- household, not archived) live in src/domain/foods.ts.
alter table public.foods
    add column generic_food_id uuid references public.foods (id) on delete set null,
    add column usual_product_id uuid references public.foods (id) on delete set null;

alter table public.foods
    add constraint foods_generic_not_self check (generic_food_id is null or generic_food_id <> id),
    add constraint foods_usual_not_self check (usual_product_id is null or usual_product_id <> id);

create index foods_generic_idx
    on public.foods (household_id, generic_food_id)
    where generic_food_id is not null;
