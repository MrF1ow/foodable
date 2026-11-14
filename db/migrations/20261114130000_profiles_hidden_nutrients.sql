-- Which of the optional limit nutrients a member has switched off under
-- Settings › Nutrients shown. Per member, like alcohol_tracking_enabled, but
-- a list so one column covers fiber, sugar and caffeine; an empty list (the
-- default) shows all three, exactly as before this column existed. Alcohol
-- keeps its own opt-in column. Additive, no backfill: `not valid` makes the
-- check apply to new and changed rows without scanning the table.

alter table public.profiles
    add column if not exists hidden_nutrients text[] not null default '{}';

alter table public.profiles
    add constraint profiles_hidden_nutrients_known
    check (hidden_nutrients <@ array['fiber', 'sugar', 'caffeine']::text[])
    not valid;
