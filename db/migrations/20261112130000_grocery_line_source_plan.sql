-- Grocery lines added for the week plan carry source 'plan'.
--
-- Additive only: the source check admits one more value. No rows move.

alter table public.grocery_lines
    drop constraint if exists grocery_lines_source_check;

alter table public.grocery_lines
    add constraint grocery_lines_source_check
        check (source in ('manual', 'recipe', 'restock', 'notice', 'plan'));
