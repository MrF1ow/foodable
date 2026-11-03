-- Phase 8, step 1: the app no longer writes the legacy identity JSON.
--
-- Fridge items, grocery lines and recipe ingredients resolve their food
-- through food_id; identity is derived from the food on read. New rows leave
-- the column empty, so it has to accept null. Old code still on the host keeps
-- writing it, so this is safe to push before the matching deploy.
--
-- Nothing is dropped here. A later contract migration drops these columns
-- (and recipe_ingredients.nutrition, households.fridge_locations,
-- profiles.accent_swatch) once this has run in production.

alter table public.fridge_items
    alter column identity drop not null;

alter table public.grocery_lines
    alter column identity drop not null;

alter table public.recipe_ingredients
    alter column identity drop not null;
