-- SECURITY DEFINER with search_path = public lets a public-schema object
-- shadow auth.uid() / the household tables. The body already schema-qualifies
-- every name, so an empty path is a no-op for the function and a closed door
-- for shadowing.
create or replace function public.bootstrap_household(
    p_name text,
    p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
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
