-- Household-scoped dismissals for info-level notice suggestions. A dismissal
-- hides a notice until its subject or related thing is removed (merged,
-- archived or deleted; the writers clean up). related_key is not
-- null default '' so Postgres unique treats single-subject rows consistently
-- (nulls are distinct and would allow duplicate single-subject dismissals).
--
-- Needs attention count (noticesFor: dismissals, recipes, every ingredient,
-- the effective food catalog and fridge items, then the filter), measured on
-- a bench copy of the dev data:
--   1 household, 10 recipes, 44 ingredients, 20 fridge items    5.1 ms median
--   same, inflated to 510 recipes, 4,488 ingredients, 1,020 fridge items and
--   2,000 dismissals                                              33 ms median
-- so the count is computed per page load and not stored.

create table public.notice_dismissals (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    code text not null,
    subject_kind text not null check (subject_kind in (
        'food', 'recipe', 'recipe_ingredient', 'fridge_item', 'grocery_line'
    )),
    subject_id uuid not null,
    related_key text not null default '',
    dismissed_by uuid references public.users (id) on delete set null,
    created_at timestamptz not null default now()
);

alter table public.notice_dismissals enable row level security;

grant select, insert, update, delete on public.notice_dismissals to service_role;

revoke all on public.notice_dismissals from anon, authenticated;

-- One row per dismissed notice identity; loaded once per noticesFor request.
create unique index if not exists notice_dismissals_key
    on public.notice_dismissals (household_id, code, subject_kind, subject_id, related_key);

-- Show dismissed for one subject; cleanup when that subject is merged or deleted.
create index if not exists notice_dismissals_subject_idx
    on public.notice_dismissals (household_id, subject_kind, subject_id);

-- Cleanup the other half of a pair dismissal; partial so singles cost nothing.
create index if not exists notice_dismissals_related_key_idx
    on public.notice_dismissals (household_id, related_key)
    where related_key <> '';

-- Needs attention "Show dismissed" history, newest first.
create index if not exists notice_dismissals_household_created_idx
    on public.notice_dismissals (household_id, created_at desc);
