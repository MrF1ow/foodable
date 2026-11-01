-- foodable:contract repoint user foreign keys from auth.users to public.users

alter table public.household_members
    drop constraint household_members_user_id_fkey,
    add constraint household_members_user_id_fkey
        foreign key (user_id) references public.users (id) on delete cascade;

alter table public.meal_items
    drop constraint meal_items_user_id_fkey,
    add constraint meal_items_user_id_fkey
        foreign key (user_id) references public.users (id) on delete cascade;

alter table public.member_allergens
    drop constraint member_allergens_user_id_fkey,
    add constraint member_allergens_user_id_fkey
        foreign key (user_id) references public.users (id) on delete cascade;

alter table public.member_dislikes
    drop constraint member_dislikes_user_id_fkey,
    add constraint member_dislikes_user_id_fkey
        foreign key (user_id) references public.users (id) on delete cascade;

alter table public.nutrition_goals
    drop constraint nutrition_goals_user_id_fkey,
    add constraint nutrition_goals_user_id_fkey
        foreign key (user_id) references public.users (id) on delete cascade;

alter table public.person_rules
    drop constraint person_rules_user_id_fkey,
    add constraint person_rules_user_id_fkey
        foreign key (user_id) references public.users (id) on delete cascade;

alter table public.profiles
    drop constraint profiles_user_id_fkey,
    add constraint profiles_user_id_fkey
        foreign key (user_id) references public.users (id) on delete cascade;

alter table public.water_log
    drop constraint water_log_user_id_fkey,
    add constraint water_log_user_id_fkey
        foreign key (user_id) references public.users (id) on delete cascade;

alter table public.weight_log
    drop constraint weight_log_user_id_fkey,
    add constraint weight_log_user_id_fkey
        foreign key (user_id) references public.users (id) on delete cascade;

alter table public.foods
    drop constraint foods_created_by_fkey,
    add constraint foods_created_by_fkey
        foreign key (created_by) references public.users (id) on delete set null;

alter table public.household_mcp_tokens
    drop constraint household_mcp_tokens_issued_by_fkey,
    add constraint household_mcp_tokens_issued_by_fkey
        foreign key (issued_by) references public.users (id) on delete set null;

alter table public.stock_movements
    drop constraint stock_movements_actor_user_id_fkey,
    add constraint stock_movements_actor_user_id_fkey
        foreign key (actor_user_id) references public.users (id) on delete set null;

alter table public.auth_codes
    drop constraint auth_codes_user_id_fkey,
    add constraint auth_codes_user_id_fkey
        foreign key (user_id) references public.users (id);

alter table public.meals
    drop constraint meals_user_id_fkey,
    add constraint meals_user_id_fkey
        foreign key (user_id) references public.users (id);

alter table public.oauth_tokens
    drop constraint oauth_tokens_user_id_fkey,
    add constraint oauth_tokens_user_id_fkey
        foreign key (user_id) references public.users (id);

alter table public.refresh_tokens
    drop constraint refresh_tokens_user_id_fkey,
    add constraint refresh_tokens_user_id_fkey
        foreign key (user_id) references public.users (id);

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

    select m.user_id into v_next
    from public.household_members m
    left join public.users u on u.id = m.user_id
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
