-- Supabase stops copying SELECT, INSERT, UPDATE, and DELETE onto new public
-- tables on 30 October 2026. Grants already on a table stay. These two
-- statements are that platform revoke, so a fresh db push matches production
-- after the date. The four tables below were created while the old defaults
-- were on and have no GRANT in history. GRANT only adds, and service_role
-- already holds these privileges, so the running app is unchanged.

alter default privileges for role postgres in schema public
    revoke select, insert, update, delete on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
    revoke usage, select on sequences from anon, authenticated, service_role;

grant select, insert, update, delete on table public.nutrition_goals to service_role;
grant select, insert, update, delete on table public.water_log to service_role;
grant select, insert, update, delete on table public.profiles to service_role;
grant select, insert, update, delete on table public.weight_log to service_role;
