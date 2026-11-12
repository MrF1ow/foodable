-- A goal can carry a name the member writes ("Recomp"), a short note, and the
-- day the targets were last set. Additive only: all three are nullable, there
-- is no backfill, and an existing row simply has no name yet.
alter table public.nutrition_goals
    add column if not exists goal_name text check (char_length(goal_name) <= 40),
    add column if not exists goal_note text check (char_length(goal_note) <= 280),
    add column if not exists goals_set_on date;
