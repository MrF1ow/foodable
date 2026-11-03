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

-- service_role is the Data API role the server uses. A table created after
-- the 30 October default-privilege revoke is invisible to that role until
-- it is granted these four privileges.
do $$
begin
    if exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and (
              not has_table_privilege('service_role', c.oid, 'SELECT')
              or not has_table_privilege('service_role', c.oid, 'INSERT')
              or not has_table_privilege('service_role', c.oid, 'UPDATE')
              or not has_table_privilege('service_role', c.oid, 'DELETE')
          )
    ) then
        raise exception 'a public table is missing service_role select, insert, update, or delete: %', (
            select string_agg(c.relname, ', ' order by c.relname)
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relkind = 'r'
              and (
                  not has_table_privilege('service_role', c.oid, 'SELECT')
                  or not has_table_privilege('service_role', c.oid, 'INSERT')
                  or not has_table_privilege('service_role', c.oid, 'UPDATE')
                  or not has_table_privilege('service_role', c.oid, 'DELETE')
              )
        );
    end if;

    if exists (
        select 1
        from pg_default_acl d
        join pg_namespace n on n.oid = d.defaclnamespace
        cross join lateral aclexplode(d.defaclacl) a
        join pg_roles r on r.oid = a.grantee
        where n.nspname = 'public'
          and pg_get_userbyid(d.defaclrole) = 'postgres'
          and r.rolname in ('anon', 'authenticated', 'service_role')
          and (
              (d.defaclobjtype = 'r' and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
              or (d.defaclobjtype = 'S' and a.privilege_type in ('SELECT', 'USAGE'))
          )
    ) then
        raise exception 'default privileges still expose new public tables or sequences to the data API';
    end if;
end
$$;
