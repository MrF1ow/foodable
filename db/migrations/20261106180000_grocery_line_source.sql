-- Grocery line source: manual, recipe, restock, or notice, plus an optional
-- fridge item when the line was added for restock or a notice.
alter table public.grocery_lines
    add column source text not null default 'manual',
    add column source_fridge_item_id uuid references public.fridge_items (id) on delete set null;

alter table public.grocery_lines
    add constraint grocery_lines_source_check
        check (source in ('manual', 'recipe', 'restock', 'notice'));

-- Deleting a fridge item checks this foreign key (on delete set null); without
-- an index that check scans grocery_lines, as 20261102120000_hot_query_indexes
-- measured for stock_movements. Partial: most lines have no fridge item.
create index grocery_lines_source_fridge_item_idx
    on public.grocery_lines (source_fridge_item_id)
    where source_fridge_item_id is not null;
