-- R2: imported recipes stay unverified until they pass the deterministic check.

alter table public.recipes
    add column verification text not null default 'verified'
        constraint recipes_verification_check
            check (verification in ('verified', 'unverified'));

create index recipes_household_source_url_idx
    on public.recipes (household_id, source_url);

create table public.recipe_imports (
    recipe_id uuid primary key references public.recipes (id) on delete cascade,
    household_id uuid not null references public.households (id) on delete cascade,
    source_kind text not null check (source_kind in (
        'website', 'instagram', 'facebook', 'threads', 'tiktok', 'pinterest', 'youtube', 'text'
    )),
    source_url text,
    source_text text,
    source_text_origin text check (source_text_origin in ('pasted', 'shared', 'read')),
    transcript text,
    credit text,
    unresolved_lines jsonb not null default '[]'::jsonb,
    problems jsonb not null default '[]'::jsonb,
    imported_at timestamptz not null default now(),
    constraint recipe_imports_source_text_origin_pair check (
        (source_text is null) = (source_text_origin is null)
    )
);

create index recipe_imports_household_idx on public.recipe_imports (household_id);

alter table public.recipe_imports enable row level security;

create policy recipe_imports_member_all
    on public.recipe_imports
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

grant select, insert, update, delete on table public.recipe_imports to authenticated;
grant select, insert, update, delete on table public.recipe_imports to service_role;
