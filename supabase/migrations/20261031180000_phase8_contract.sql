-- Phase 8, step 2: contract the legacy food identity shape.
--
-- Step 1 (20261031120000) stopped every read and write of these columns and
-- ran in production first. Fridge items, grocery lines and recipe
-- ingredients name their food by food_id alone; nutrition comes from the
-- foods row. households.fridge_locations was superseded by the
-- fridge_locations table (20261005010200), and profiles.accent_swatch by the
-- single accent. Take a backup before pushing: the dropped data does not
-- come back without it.

-- foodable:contract identity JSON superseded by food_id; unread and unwritten since 20261031120000
alter table public.fridge_items drop column identity;
-- foodable:contract identity JSON superseded by food_id; unread and unwritten since 20261031120000
alter table public.grocery_lines drop column identity;
-- foodable:contract identity JSON superseded by food_id; unread and unwritten since 20261031120000
alter table public.recipe_ingredients drop column identity;
-- foodable:contract per-ingredient nutrition snapshot; nutrition is read from foods via food_id
alter table public.recipe_ingredients drop column nutrition;
-- foodable:contract dislikes are free text; identity was only ever written as null
alter table public.member_dislikes drop column identity;

-- foodable:contract every row resolves to a food; checked null-free before the push
alter table public.fridge_items alter column food_id set not null;
-- foodable:contract every row resolves to a food; checked null-free before the push
alter table public.grocery_lines alter column food_id set not null;
-- foodable:contract every row resolves to a food; checked null-free before the push
alter table public.recipe_ingredients alter column food_id set not null;

-- foodable:contract locations live in the fridge_locations table since 20261005010200
alter table public.households drop column fridge_locations;
-- foodable:contract one accent for every theme; the swatch picker is gone
alter table public.profiles drop column accent_swatch;

-- Superseded by create_household; nothing calls it.
drop function if exists public.bootstrap_household(text, text);
