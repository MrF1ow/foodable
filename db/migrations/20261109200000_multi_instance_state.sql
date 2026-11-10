-- OAuth login sessions, rate-limit buckets, and auth ban state for multi-instance deploys.

create table public.oauth_login_sessions (
    id text primary key,
    payload jsonb not null,
    expires_at timestamptz not null
);

create index oauth_login_sessions_expires_idx
    on public.oauth_login_sessions (expires_at);

alter table public.oauth_login_sessions enable row level security;

grant select, insert, update, delete on public.oauth_login_sessions to service_role;

revoke all on public.oauth_login_sessions from anon, authenticated;

create table public.rate_limit_buckets (
    key text not null,
    window_start timestamptz not null,
    count int not null,
    primary key (key, window_start)
);

alter table public.rate_limit_buckets enable row level security;

grant select, insert, update, delete on public.rate_limit_buckets to service_role;

revoke all on public.rate_limit_buckets from anon, authenticated;

create table public.auth_bans (
    ip_key text primary key,
    strikes int not null default 0,
    escalation int not null default 0,
    last_failure_at timestamptz not null,
    banned_until timestamptz,
    updated_at timestamptz not null default now()
);

alter table public.auth_bans enable row level security;

grant select, insert, update, delete on public.auth_bans to service_role;

revoke all on public.auth_bans from anon, authenticated;
