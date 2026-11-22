-- Stored notifications, one row per person, and each person's choice of which
-- kinds they get. Nothing reads or writes these yet. A condition row is
-- opened when its notice appears and gets resolved_at when the data clears;
-- an event row is written once when someone acts. notice_key is the
-- condition's dismissal key, or event:<uuid>, so the unique index below lets a
-- condition that comes back after it cleared start a fresh row.

create table public.notifications (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    recipient_user_id uuid not null references public.users (id) on delete cascade,
    kind text not null,
    bucket text not null check (bucket in ('personal', 'household')),
    source text not null check (source in ('condition', 'event')),
    notice_key text not null,
    subject_kind text,
    subject_id uuid,
    actor_user_id uuid references public.users (id) on delete set null,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    read_at timestamptz,
    snoozed_until timestamptz,
    snoozed_by uuid references public.users (id) on delete set null,
    dismissed_at timestamptz,
    dismissed_by uuid references public.users (id) on delete set null,
    resolved_at timestamptz
);

alter table public.notifications enable row level security;

grant select, insert, update, delete on public.notifications to service_role;

revoke all on public.notifications from anon, authenticated;

-- One open row per person and condition or event.
create unique index if not exists notifications_open_key
    on public.notifications (recipient_user_id, notice_key)
    where resolved_at is null;

-- A person's inbox, newest first.
create index if not exists notifications_recipient_created_idx
    on public.notifications (recipient_user_id, created_at desc);

-- Resolving a condition, and fanning a dismissal out to every member.
create index if not exists notifications_household_open_key_idx
    on public.notifications (household_id, notice_key)
    where resolved_at is null;

-- The sweep of dismissed rows.
create index if not exists notifications_dismissed_idx
    on public.notifications (dismissed_at)
    where dismissed_at is not null;

-- The sweep of conditions that cleared.
create index if not exists notifications_resolved_idx
    on public.notifications (resolved_at)
    where resolved_at is not null;

create policy notifications_app_household
    on public.notifications
    for all
    to foodable_app
    using (household_id = nullif(current_setting('app.household_id', true), '')::uuid)
    with check (household_id = nullif(current_setting('app.household_id', true), '')::uuid);

-- A person's choice for one kind. A row exists only when it differs from the
-- kind's default.
create table public.notification_prefs (
    household_id uuid not null references public.households (id) on delete cascade,
    user_id uuid not null references public.users (id) on delete cascade,
    kind text not null,
    enabled boolean not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, kind)
);

alter table public.notification_prefs enable row level security;

grant select, insert, update, delete on public.notification_prefs to service_role;

revoke all on public.notification_prefs from anon, authenticated;

create policy notification_prefs_app_household
    on public.notification_prefs
    for all
    to foodable_app
    using (household_id = nullif(current_setting('app.household_id', true), '')::uuid)
    with check (household_id = nullif(current_setting('app.household_id', true), '')::uuid);
