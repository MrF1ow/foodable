-- Phase 4: whole-account export archives in Postgres (replaces Storage bucket).

create table public.export_archives (
    user_id uuid primary key references public.users (id) on delete cascade,
    archive bytea not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);

alter table public.export_archives enable row level security;

grant select, insert, update, delete on public.export_archives to service_role;

revoke all on public.export_archives from anon, authenticated;
