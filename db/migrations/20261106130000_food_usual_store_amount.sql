-- Usual store and usual amount: where a household usually buys a food and
-- how much (Kirkland Large Eggs, 24 each, at Costco). Set on a product or a
-- standalone food; a plain food reads them through its usual product
-- (effectiveFood in src/domain/foods.ts). The unit is checked against the
-- known quantity units in the domain, and the store's household there too.
alter table public.foods
    add column usual_store_id uuid references public.grocery_stores (id) on delete set null,
    add column usual_amount numeric,
    add column usual_unit text;

alter table public.foods
    add constraint foods_usual_amount_pair check ((usual_amount is null) = (usual_unit is null)),
    add constraint foods_usual_amount_positive check (usual_amount is null or usual_amount > 0);

-- Serves reads of foods by usual store within a household: the
-- on delete set null scan when a grocery store is removed, and "what do we
-- usually buy at Costco" (restock groups planned lines by this store).
create index foods_usual_store_idx
    on public.foods (household_id, usual_store_id)
    where usual_store_id is not null;
