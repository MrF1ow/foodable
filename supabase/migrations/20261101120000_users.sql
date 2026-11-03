-- Phase 3 expand: public.users mirrors auth.users until the app switch.

create table public.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    password_hash text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index users_email_lower_uniq
    on public.users (lower(email))
    where email is not null;

alter table public.users enable row level security;

grant select, insert, update, delete on public.users to service_role;

revoke all on public.users from anon, authenticated;

create or replace function public.sync_auth_user_to_public_users()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        delete from public.users where id = old.id;
        return old;
    end if;

    insert into public.users (id, email, password_hash, created_at, updated_at)
    values (
        new.id,
        new.email,
        new.encrypted_password,
        coalesce(new.created_at, now()),
        now()
    )
    on conflict (id) do update
        set email = excluded.email,
            password_hash = excluded.password_hash,
            updated_at = now();

    return new;
end;
$$;

revoke all on function public.sync_auth_user_to_public_users() from public;
revoke execute on function public.sync_auth_user_to_public_users() from anon, authenticated;

create trigger sync_auth_users_to_public_users
after insert or update of email, encrypted_password or delete
on auth.users
for each row
execute function public.sync_auth_user_to_public_users();
