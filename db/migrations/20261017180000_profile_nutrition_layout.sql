alter table public.profiles
    add column if not exists nutrition_layout text[];
