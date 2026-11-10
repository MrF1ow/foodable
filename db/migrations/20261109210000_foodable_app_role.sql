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

-- No EXECUTE on public functions. The security definer ones (household
-- creation, membership, ownership and bot token functions) take a household
-- id and act on it as their owner, so foodable_app calling one could reach
-- another household. The app calls them as the system, after its own check
-- that the caller may. Trigger functions still fire for foodable_app's
-- writes: a trigger's function is not checked for EXECUTE when it fires.
do $$
declare
    r record;
begin
    for r in
        select p.oid::regprocedure as fn
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosecdef
    loop
        execute format('revoke execute on function %s from foodable_app', r.fn);
    end loop;
end
$$;

-- Objects created later by whoever runs the migrations (the owner).
alter default privileges in schema public
    grant select, insert, update, delete on tables to foodable_app;

alter default privileges in schema public
    grant usage, select on sequences to foodable_app;
