-- Feature flags persistence (STG-4): sticky pins, kill-switch snapshot, beta
-- membership with audit history, and daily evaluation counts. Server-only:
-- the adapter in src/flags.ts reads and writes through service_role.

-- Sticky pins per user or household; re-evaluated when epoch changes or the
-- pin expires (12 h after assignment).
create table public.flag_assignments (
    id uuid primary key default gen_random_uuid(),
    subject_kind text not null check (subject_kind in ('user', 'household')),
    user_id uuid references public.users (id) on delete cascade,
    household_id uuid references public.households (id) on delete cascade,
    check (
        (subject_kind = 'user' and user_id is not null and household_id is null)
        or (
            subject_kind = 'household'
            and household_id is not null
            and user_id is null
        )
    ),
    subject_id uuid generated always as (coalesce(user_id, household_id)) stored,
    flag_name text not null check (flag_name ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$'),
    value jsonb not null,
    reason text not null check (length(reason) between 1 and 64),
    epoch integer not null default 0 check (epoch >= 0),
    assigned_at timestamptz not null default now(),
    expires_at timestamptz not null,
    check (expires_at > assigned_at),
    constraint flag_assignments_subject_flag_key unique (subject_kind, subject_id, flag_name)
);

-- flag_assignments_subject_flag_key: one pin per flag; leading columns load all
-- pins for one subject. Expiry sweep uses a separate index.
create index flag_assignments_expires_idx on public.flag_assignments (expires_at);

-- User cascade deletes pin rows by user_id.
create index flag_assignments_user_id_idx
    on public.flag_assignments (user_id) where user_id is not null;

-- Household cascade deletes pin rows by household_id.
create index flag_assignments_household_id_idx
    on public.flag_assignments (household_id) where household_id is not null;

alter table public.flag_assignments enable row level security;

grant select, insert, update, delete on public.flag_assignments to service_role;

revoke all on public.flag_assignments from anon, authenticated;

-- Last-known kill-switch values when the Railway SDK registry is stale.
create table public.flag_snapshot (
    flag_name text primary key check (flag_name ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$'),
    value jsonb not null,
    saved_at timestamptz not null default now()
);

alter table public.flag_snapshot enable row level security;

grant select, insert, update, delete on public.flag_snapshot to service_role;

revoke all on public.flag_snapshot from anon, authenticated;

-- Members who opted into the beta group (Settings › Try new features).
create table public.flag_beta_members (
    user_id uuid primary key references public.users (id) on delete cascade,
    joined_at timestamptz not null default now()
);

alter table public.flag_beta_members enable row level security;

grant select, insert, update, delete on public.flag_beta_members to service_role;

revoke all on public.flag_beta_members from anon, authenticated;

create table public.flag_beta_events (
    id bigint generated always as identity primary key,
    user_id uuid not null references public.users (id) on delete cascade,
    action text not null check (action in ('joined', 'left')),
    actor uuid references public.users (id) on delete set null,
    at timestamptz not null default now()
);

-- Join/leave history for one member, newest first.
create index flag_beta_events_user_at_idx on public.flag_beta_events (user_id, at desc);

-- Actor set-null on user delete looks up by actor.
create index flag_beta_events_actor_idx
    on public.flag_beta_events (actor) where actor is not null;

alter table public.flag_beta_events enable row level security;

grant select, insert, update, delete on public.flag_beta_events to service_role;

grant usage, select on sequence public.flag_beta_events_id_seq to service_role;

revoke all on public.flag_beta_events from anon, authenticated;

create or replace function public.flag_beta_events_no_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if old.actor is not null
        and new.actor is null
        and new.id = old.id
        and new.user_id = old.user_id
        and new.action = old.action
        and new.at = old.at
    then
        return new;
    end if;
    raise exception 'flag_beta_events is append-only';
end;
$$;

revoke all on function public.flag_beta_events_no_update() from public;
revoke execute on function public.flag_beta_events_no_update() from anon, authenticated;

-- Append-only audit log; deletes are allowed for the user cascade and the only
-- allowed update is the actor set null from the user cascade.
create trigger flag_beta_events_no_update
    before update on public.flag_beta_events
    for each row
    execute function public.flag_beta_events_no_update();

-- Daily evaluation counts, upserted once a minute from the adapter.
create table public.flag_eval_daily (
    day date not null,
    flag_name text not null check (flag_name ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$'),
    value text not null,
    reason text not null check (length(reason) between 1 and 64),
    client text not null check (length(client) between 1 and 81),
    count bigint not null default 0 check (count >= 0),
    updated_at timestamptz not null default now(),
    primary key (day, flag_name, value, reason, client)
);

alter table public.flag_eval_daily enable row level security;

grant select, insert, update, delete on public.flag_eval_daily to service_role;

revoke all on public.flag_eval_daily from anon, authenticated;
