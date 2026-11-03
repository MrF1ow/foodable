-- First Auth user creates the singleton household as owner in one
-- transaction. Service-role only. Concurrent second insert hits the
-- households_singleton unique index and becomes household already exists.
-- authenticated loses execute on bootstrap_household so a user JWT cannot
-- join as member through PostgREST.

create or replace function public.create_household(
    p_user_id uuid,
    p_name text,
    p_display_name text
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

    if exists (select 1 from public.households) then
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

revoke all on function public.create_household(uuid, text, text) from public;
revoke all on function public.create_household(uuid, text, text) from anon;
revoke all on function public.create_household(uuid, text, text) from authenticated;
grant execute on function public.create_household(uuid, text, text) to service_role;

revoke execute on function public.bootstrap_household(text, text) from authenticated;
