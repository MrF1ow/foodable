-- Remember hosts that refused Foodable (401/403/429) and dead recipe links (404/410).

create table public.fetch_host_refusals (
    household_id uuid not null references public.households (id) on delete cascade,
    host text not null,
    status smallint not null check (status in (401, 403, 429)),
    refused_at timestamptz not null default now(),
    expires_at timestamptz not null,
    primary key (household_id, host)
);

create index fetch_host_refusals_expires_idx on public.fetch_host_refusals (expires_at);

create index fetch_host_refusals_list_idx on public.fetch_host_refusals (
    household_id,
    refused_at desc,
    host desc
);

alter table public.fetch_host_refusals enable row level security;

create policy fetch_host_refusals_member_all
    on public.fetch_host_refusals
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

grant select, insert, update, delete on public.fetch_host_refusals to authenticated;
grant select, insert, update, delete on public.fetch_host_refusals to service_role;

create table public.dead_links (
    household_id uuid not null references public.households (id) on delete cascade,
    url_hash text not null check (url_hash ~ '^[0-9a-f]{64}$'),
    url text not null,
    status smallint not null check (status in (404, 410)),
    seen_at timestamptz not null default now(),
    expires_at timestamptz,
    primary key (household_id, url_hash),
    check ((status = 410) = (expires_at is null))
);

create index dead_links_expires_idx on public.dead_links (expires_at)
where
    expires_at is not null;

alter table public.dead_links enable row level security;

create policy dead_links_member_all
    on public.dead_links
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

grant select, insert, update, delete on public.dead_links to authenticated;
grant select, insert, update, delete on public.dead_links to service_role;
