-- R5b: per-household social reader last success / failure status.

create table public.social_reader_status (
    household_id uuid not null references public.households (id) on delete cascade,
    reader text not null check (reader in ('tiktok', 'facebook')),
    last_success_at timestamptz,
    last_failure_at timestamptz,
    last_failure_reason text,
    primary key (household_id, reader)
);

alter table public.social_reader_status enable row level security;

create policy social_reader_status_member_all
    on public.social_reader_status
    for all
    to authenticated
    using (
        household_id in (
            select household_id
            from public.household_members
            where user_id = auth.uid()
        )
    )
    with check (
        household_id in (
            select household_id
            from public.household_members
            where user_id = auth.uid()
        )
    );

grant select, insert, update, delete on public.social_reader_status to authenticated;
grant select, insert, update, delete on public.social_reader_status to service_role;
