-- Application database role: login without bypassrls, DML on public only.
-- Policies for this role ship in later migrations; until then RLS leaves
-- every table empty for it. Password is set in ops, not in SQL.

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'foodable_app') then
        create role foodable_app
            login
            nosuperuser
            nocreatedb
            nocreaterole
            noinherit
            nobypassrls;
    end if;
end
$$;

grant usage on schema public to foodable_app;
grant usage on schema auth to foodable_app;
grant execute on function auth.uid() to foodable_app;

do $$
declare
    r record;
begin
    for r in
        select c.relname as tablename
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
    loop
        execute format(
            'grant select, insert, update, delete on table public.%I to foodable_app',
            r.tablename
        );
    end loop;

    for r in
        select c.relname as seqname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'S'
    loop
        execute format(
            'grant usage, select on sequence public.%I to foodable_app',
            r.seqname
        );
    end loop;
end
$$;

-- The app calls these functions today as the owner; several had EXECUTE
-- revoked from public and granted to service_role only.
grant execute on all functions in schema public to foodable_app;

-- Objects created later by whoever runs the migrations (the owner).
alter default privileges in schema public
    grant select, insert, update, delete on tables to foodable_app;

alter default privileges in schema public
    grant usage, select on sequences to foodable_app;

alter default privileges in schema public
    grant execute on functions to foodable_app;
