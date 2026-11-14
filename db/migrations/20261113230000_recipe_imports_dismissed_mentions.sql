-- Keys of foods a recipe's steps mention that the household chose not to add
-- as ingredients. The warnings themselves are computed on read.
alter table public.recipe_imports
    add column if not exists dismissed_mentions jsonb not null default '[]'::jsonb;
