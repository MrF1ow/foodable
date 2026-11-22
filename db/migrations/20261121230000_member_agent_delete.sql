-- Each member's own switch for the agents they connected: whether those
-- agents may delete, clear or overwrite on their behalf. Off by default for a
-- member added from now on. The household's "Any agent can delete"
-- switch (agents.destructive_allowed in households.household_preferences)
-- keeps its stored value and becomes the owner's household-wide off, which
-- overrides every personal switch. Additive: nothing is dropped.
--
-- Backfill, in this file: every existing member gets the household's current
-- value, so no agent gains a right it did not have. A household with no such
-- key counts as allowed (a stored false is the only way off), exactly as the
-- app reads it.

alter table public.household_members
    add column if not exists agents_can_delete boolean not null default false;

update public.household_members m
set agents_can_delete =
    (h.household_preferences -> 'agents.destructive_allowed') is distinct from 'false'::jsonb
from public.households h
where h.id = m.household_id;
