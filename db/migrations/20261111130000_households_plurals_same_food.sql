-- Household setting: treat singular and plural food names as the same food.

alter table public.households
    add column if not exists plurals_same_food boolean not null default false;
