create table public.household_mcp_tokens (
    household_id uuid primary key references public.households (id) on delete cascade,
    token_hash bytea not null unique check (octet_length(token_hash) = 32),
    issued_at timestamptz not null default now(),
    issued_by uuid references auth.users (id) on delete set null
);

alter table public.household_mcp_tokens enable row level security;

revoke all on table public.household_mcp_tokens from public, anon, authenticated;
grant all on table public.household_mcp_tokens to postgres, service_role;

create or replace function public.household_mcp_token_hash(p_token_hash_hex text)
returns bytea
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
    if p_token_hash_hex is null
        or length(p_token_hash_hex) <> 64
        or p_token_hash_hex !~ '^[0-9a-f]+$'
    then
        return null;
    end if;
    return decode(p_token_hash_hex, 'hex');
end;
$$;

create or replace function public.resolve_household_mcp_token(p_token_hash_hex text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_token_hash bytea := public.household_mcp_token_hash(p_token_hash_hex);
begin
    if v_token_hash is null then
        return null;
    end if;

    return (
        select t.household_id
        from public.household_mcp_tokens t
        where t.token_hash = v_token_hash
    );
end;
$$;

create or replace function public.rotate_household_mcp_token(
    p_household_id uuid,
    p_token_hash_hex text,
    p_issued_by uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_token_hash bytea := public.household_mcp_token_hash(p_token_hash_hex);
    v_issued_at timestamptz;
begin
    if p_household_id is null then
        raise exception 'household id required';
    end if;

    if v_token_hash is null then
        raise exception 'token hash must be 32 bytes';
    end if;

    insert into public.household_mcp_tokens (
        household_id,
        token_hash,
        issued_by
    )
    values (
        p_household_id,
        v_token_hash,
        p_issued_by
    )
    on conflict (household_id) do update
        set token_hash = excluded.token_hash,
            issued_at = now(),
            issued_by = excluded.issued_by
    returning issued_at into v_issued_at;

    return v_issued_at;
end;
$$;

revoke all on function public.household_mcp_token_hash(text) from public, anon, authenticated;
revoke all on function public.resolve_household_mcp_token(text) from public, anon, authenticated;
revoke all on function public.rotate_household_mcp_token(uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.household_mcp_token_hash(text) to service_role;
grant execute on function public.resolve_household_mcp_token(text) to service_role;
grant execute on function public.rotate_household_mcp_token(uuid, text, uuid) to service_role;
