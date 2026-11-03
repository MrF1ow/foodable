-- The household always has an owner while it has members.
--
-- transfer_household_ownership hands the owner role to another member in one
-- transaction. household_members_one_owner admits one owner per household, so
-- the current owner is demoted before the new one is promoted.
--
-- When the owner's membership row goes away without a transfer (they delete
-- their account, which cascades from auth.users), the member with the oldest
-- Auth account becomes owner. The trigger fires on DELETE only: on UPDATE it
-- would run between the transfer's demote and promote and pick someone else.
-- Additive only: two functions and a trigger, no data touched.

create or replace function public.transfer_household_ownership(
    p_household_id uuid,
    p_from_user_id uuid,
    p_to_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_household_id is null or p_from_user_id is null or p_to_user_id is null then
        raise exception 'household, current owner and new owner are required';
    end if;

    if p_from_user_id = p_to_user_id then
        raise exception 'that person is already the owner';
    end if;

    -- Serialize against a concurrent transfer or removal in this household.
    perform 1
    from public.household_members m
    where m.household_id = p_household_id
    for update;

    if not exists (
        select 1
        from public.household_members m
        where m.household_id = p_household_id
          and m.user_id = p_from_user_id
          and m.role = 'owner'
    ) then
        raise exception 'only the household owner may transfer ownership';
    end if;

    if not exists (
        select 1
        from public.household_members m
        where m.household_id = p_household_id
          and m.user_id = p_to_user_id
    ) then
        raise exception 'not a household member';
    end if;

    update public.household_members
    set role = 'member'
    where household_id = p_household_id
      and user_id = p_from_user_id;

    update public.household_members
    set role = 'owner'
    where household_id = p_household_id
      and user_id = p_to_user_id;
end;
$$;

revoke all on function public.transfer_household_ownership(uuid, uuid, uuid) from public;
revoke execute on function public.transfer_household_ownership(uuid, uuid, uuid) from anon, authenticated;
grant execute on function public.transfer_household_ownership(uuid, uuid, uuid) to service_role;

create or replace function public.promote_household_owner_on_leave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_next uuid;
begin
    if exists (
        select 1
        from public.household_members m
        where m.household_id = old.household_id
          and m.role = 'owner'
    ) then
        return null;
    end if;

    -- Longest-standing account first; user_id breaks an exact tie so the
    -- choice is deterministic.
    select m.user_id into v_next
    from public.household_members m
    left join auth.users u on u.id = m.user_id
    where m.household_id = old.household_id
    order by u.created_at asc nulls last, m.user_id
    limit 1;

    if v_next is not null then
        update public.household_members
        set role = 'owner'
        where household_id = old.household_id
          and user_id = v_next;
    end if;

    return null;
end;
$$;

revoke all on function public.promote_household_owner_on_leave() from public;
revoke execute on function public.promote_household_owner_on_leave() from anon, authenticated;

drop trigger if exists household_members_promote_on_owner_leave on public.household_members;
create trigger household_members_promote_on_owner_leave
    after delete on public.household_members
    for each row
    when (old.role = 'owner')
    execute function public.promote_household_owner_on_leave();
