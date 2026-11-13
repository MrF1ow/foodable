-- The household's agent activity log. When an AI agent makes a destructive
-- change (a delete, a clear, an overwrite of something a person set), the
-- change is allowed without a confirm step, and one row lands here in the same
-- transaction: who it acted as, through which connection, which tool, a plain
-- sentence about it, and a snapshot of the rows as they were. The snapshot is
-- what lets the household undo the change for 24 hours. Past `undo_expires_at`
-- a sweep nulls the snapshot and the entry stays as history.
--
-- `snapshot` is `{ "v": 1, "changes": [{ "table", "op", "row", "after" }],
-- "ledger": [...] }`: the full row before the change for a delete or an update
-- (with the row as the write left it in `after` for an update, so an undo can
-- tell which columns the action changed and whether they changed since), the
-- new row's key columns for an insert, and the stock movements the action
-- wrote (`ledger`, absent when there are none), which an undo reverses. It is
-- null once purged, and for an action that cannot be undone (`undoable`
-- false). `member_id` is the user the agent acted as, null for the household
-- token. Deleting a user keeps the entry and forgets who.
--
-- Additive only. The household policy is the same one the other household
-- tables use: the household token acts with no user but sets
-- app.household_id the same way a member does, so one condition covers both.
-- Who may undo (the owner, or the member the agent acted as) is the
-- application's rule.

create table public.agent_actions (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    member_id uuid references public.users (id) on delete set null,
    connection text not null,
    tool text not null,
    summary text not null,
    destructive boolean not null default true,
    snapshot jsonb,
    undoable boolean not null default true,
    created_at timestamptz not null default now(),
    undo_expires_at timestamptz not null,
    undone_at timestamptz,
    undone_by uuid references public.users (id) on delete set null
);

alter table public.agent_actions enable row level security;

grant select, insert, update, delete on public.agent_actions to service_role;
revoke all on public.agent_actions from anon, authenticated;

-- The activity list reads a household's newest entries first.
create index if not exists agent_actions_household_created_idx
    on public.agent_actions (household_id, created_at desc);

-- The purge finds snapshots past their window; only rows still holding one.
create index if not exists agent_actions_undo_expires_idx
    on public.agent_actions (undo_expires_at)
    where snapshot is not null;

-- Deleting a user sets these to null; without an index that is a scan.
create index if not exists agent_actions_member_id_idx
    on public.agent_actions (member_id)
    where member_id is not null;

create index if not exists agent_actions_undone_by_idx
    on public.agent_actions (undone_by)
    where undone_by is not null;

create policy agent_actions_app_household
    on public.agent_actions
    for all
    to foodable_app
    using (household_id = nullif(current_setting('app.household_id', true), '')::uuid)
    with check (household_id = nullif(current_setting('app.household_id', true), '')::uuid);
