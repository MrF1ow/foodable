-- Singleton household plus membership keyed by auth.users.id.
-- Nutrition rows stay on user_id. There is no people.id subject.

create table public.households (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    fridge_locations text[] not null default '{}',
    recipe_search_places jsonb not null default '[]'::jsonb,
    household_preferences jsonb not null default '{}'::jsonb,
    created_at timestamptz default now()
);

-- Expression unique index on (true) admits at most one row.
create unique index households_singleton on public.households ((true));

create table public.household_members (
    household_id uuid not null references public.households (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    role text not null check (role in ('owner', 'member')),
    display_name text not null,
    unique (household_id, user_id)
);

create unique index household_members_one_owner
    on public.household_members (household_id)
    where role = 'owner';

create or replace function public.bootstrap_household(
    p_name text,
    p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
    v_household_id uuid;
begin
    if v_uid is null then
        raise exception 'not authenticated';
    end if;

    select household_id into v_household_id
    from public.household_members
    where user_id = v_uid;

    if found then
        return v_household_id;
    end if;

    select id into v_household_id
    from public.households
    limit 1;

    if v_household_id is not null then
        insert into public.household_members (
            household_id,
            user_id,
            role,
            display_name
        )
        values (
            v_household_id,
            v_uid,
            'member',
            p_display_name
        );
        return v_household_id;
    end if;

    insert into public.households (name)
    values (p_name)
    returning id into v_household_id;

    insert into public.household_members (
        household_id,
        user_id,
        role,
        display_name
    )
    values (
        v_household_id,
        v_uid,
        'owner',
        p_display_name
    );

    return v_household_id;
exception
    when unique_violation then
        -- Concurrent first-owner race: the singleton index rejected the
        -- second households row. Join the winner as a member.
        select household_id into v_household_id
        from public.household_members
        where user_id = v_uid;

        if found then
            return v_household_id;
        end if;

        select id into v_household_id
        from public.households
        limit 1;

        if v_household_id is null then
            raise;
        end if;

        insert into public.household_members (
            household_id,
            user_id,
            role,
            display_name
        )
        values (
            v_household_id,
            v_uid,
            'member',
            p_display_name
        );

        return v_household_id;
end;
$$;

revoke all on function public.bootstrap_household(text, text) from public;
grant execute on function public.bootstrap_household(text, text) to authenticated;
grant execute on function public.bootstrap_household(text, text) to service_role;

alter table public.households enable row level security;
alter table public.household_members enable row level security;

create policy household_members_select_own
    on public.household_members
    for select
    to authenticated
    using (user_id = auth.uid());

create policy households_select_member
    on public.households
    for select
    to authenticated
    using (
        id in (
            select household_id
            from public.household_members
            where user_id = auth.uid()
        )
    );

grant select on table public.households to authenticated;
grant select on table public.household_members to authenticated;
grant all on table public.households to service_role;
grant all on table public.household_members to service_role;
