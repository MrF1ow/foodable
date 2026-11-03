-- bootstrap_household used to insert a member when a household already
-- existed. create_household and add_household_member are the write paths.
-- authenticated stays revoked.

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

    raise exception 'not a household member';
end;
$$;

revoke execute on function public.bootstrap_household(text, text) from authenticated;
