-- An owner can raise a member to admin without giving up ownership.
--
-- Admins manage the household beside the owner (settings, stores, everyone's
-- rules, adding people); roles, removal, transfer and the bot token stay with
-- the owner. household_members_one_owner is untouched: still one owner.
--
-- Additive only: the role check admits one more value, and the owner-leave
-- trigger function now promotes an admin before a plain member. No rows move.

alter table public.household_members
    drop constraint if exists household_members_role_check;

alter table public.household_members
    add constraint household_members_role_check
    check (role in ('owner', 'admin', 'member'));

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

    -- An admin first, then the longest-standing account; user_id breaks an
    -- exact tie so the choice is deterministic.
    select m.user_id into v_next
    from public.household_members m
    left join auth.users u on u.id = m.user_id
    where m.household_id = old.household_id
    order by (m.role = 'admin') desc, u.created_at asc nulls last, m.user_id
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
