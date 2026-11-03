create or replace function public.add_household_member(
    p_household_id uuid,
    p_auth_user_id uuid,
    p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid;
begin
    if p_household_id is null then
        raise exception 'household required';
    end if;

    if p_auth_user_id is null then
        raise exception 'auth user required';
    end if;

    if p_display_name is null or length(trim(p_display_name)) = 0 then
        raise exception 'person name required';
    end if;

    if not exists (
        select 1
        from public.households h
        where h.id = p_household_id
    ) then
        raise exception 'not a household member';
    end if;

    select m.user_id into v_user_id
    from public.household_members m
    where m.household_id = p_household_id
      and m.user_id = p_auth_user_id;

    if found then
        return v_user_id;
    end if;

    insert into public.household_members (
        household_id,
        user_id,
        role,
        display_name
    )
    values (
        p_household_id,
        p_auth_user_id,
        'member',
        trim(p_display_name)
    );

    return p_auth_user_id;
exception
    when unique_violation then
        raise exception 'that login is already in use';
end;
$$;

revoke all on function public.add_household_member(uuid, uuid, text) from public;
grant execute on function public.add_household_member(uuid, uuid, text) to service_role;
