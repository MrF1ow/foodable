-- Experimental open sign-up can create more than one household. Closed and
-- invite deploys still pass p_allow_additional = false, and stay at exactly
-- one household: create_household takes a transaction advisory lock before
-- it checks, so two concurrent calls cannot both see an empty table.
--
-- A person belongs to at most one household. Until now the one-household
-- index made that true by construction; with it gone, a unique index on
-- household_members (user_id) keeps it true.

create unique index if not exists household_members_one_household_per_user
    on public.household_members (user_id);

-- foodable:contract open signup replaces the singleton index with an explicit check in create_household
drop index if exists public.households_singleton;

drop function if exists public.create_household(uuid, text, text);

create or replace function public.create_household(
    p_user_id uuid,
    p_name text,
    p_display_name text,
    p_allow_additional boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_household_id uuid;
begin
    if p_user_id is null then
        raise exception 'auth user required';
    end if;

    if p_name is null or length(trim(p_name)) = 0 then
        raise exception 'household name required';
    end if;

    if p_display_name is null or length(trim(p_display_name)) = 0 then
        raise exception 'person name required';
    end if;

    -- Serialise every household creation (the constant names this lock only).
    perform pg_advisory_xact_lock(7314001);

    if exists (
        select 1
        from public.household_members m
        where m.user_id = p_user_id
    ) then
        raise exception 'already in a household';
    end if;

    if not p_allow_additional and exists (select 1 from public.households) then
        raise exception 'household already exists';
    end if;

    insert into public.households (name)
    values (trim(p_name))
    returning id into v_household_id;

    insert into public.household_members (
        household_id,
        user_id,
        role,
        display_name
    )
    values (
        v_household_id,
        p_user_id,
        'owner',
        trim(p_display_name)
    );

    return v_household_id;
exception
    when unique_violation then
        raise exception 'household already exists';
end;
$$;

revoke all on function public.create_household(uuid, text, text, boolean) from public;
revoke all on function public.create_household(uuid, text, text, boolean) from anon;
revoke all on function public.create_household(uuid, text, text, boolean) from authenticated;
grant execute on function public.create_household(uuid, text, text, boolean) to service_role;
-- Called as the system only, after the app has checked the sign-up policy.
revoke execute on function public.create_household(uuid, text, text, boolean) from foodable_app;
