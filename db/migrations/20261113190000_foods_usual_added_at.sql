-- When a plain food was added to the household's Usuals by hand, with or
-- without a product. A plain food is a usual when it has live products or this
-- is set, so a usual typed in (no barcode, no product yet) can be listed.
-- Additive and nullable, no backfill: a null keeps today's rule (a usual is a
-- food with products). The column lives on the food row beside the other usual
-- fields, so nothing new needs its own RLS or grants.
alter table public.foods
    add column if not exists usual_added_at timestamptz;

comment on column public.foods.usual_added_at is
    'When the food was added to Usuals; null = a usual only through its products.';
