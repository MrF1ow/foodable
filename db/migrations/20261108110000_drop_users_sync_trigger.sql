-- Phase 3.5 contract (docs/postgres-plan.md): public.users is written by the app;
-- auth.users is left in place (bootstrap stub / Supabase-owned) and nothing reads it.

do $$
begin
    if to_regclass('auth.users') is not null then
        drop trigger if exists sync_auth_users_to_public_users on auth.users;
    end if;
end $$;

drop function if exists public.sync_auth_user_to_public_users();
