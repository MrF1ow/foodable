-- Minimum Supabase-shaped objects that supabase/migrations/ expect on plain Postgres.
-- Safe on a real Supabase database: every statement is a no-op when the object
-- already exists. Nothing here uses CREATE OR REPLACE, ALTER, DROP, GRANT, or
-- COMMENT on existing objects — replacing Supabase's auth.uid() would be a
-- production incident.

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
    end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    encrypted_password text,
    created_at timestamptz default now()
);

do $$
begin
    if not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'auth'
          and p.proname = 'uid'
          and pg_get_function_identity_arguments(p.oid) = ''
    ) then
        create function auth.uid() returns uuid
        language sql
        stable
        as $body$
            select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
        $body$;
    end if;
end
$$;

create schema if not exists storage;

create table if not exists storage.buckets (
    id text primary key,
    name text,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[]
);

create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text,
    name text,
    owner uuid
);
