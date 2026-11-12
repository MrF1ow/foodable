-- How a member weights the product score, and their two product-check
-- switches. One row per member. `preset` is a named preset, 'custom' (then
-- `weights` holds the four part weights) or 'household' (no own choice: the
-- household default applies). The household default itself is not a table: it
-- is the `score.default` key of households.household_preferences. A member
-- without a row uses the default weights and has both switches on.
--
-- Additive only. A member reads the settings of their household (a score for
-- another member uses that member's weights) and writes only their own row,
-- inside the household the transaction acts for. Removing a member from the
-- household, or deleting their login, takes their settings with it.

create table public.member_score_settings (
    user_id uuid primary key references public.users (id) on delete cascade,
    household_id uuid not null references public.households (id) on delete cascade,
    preset text not null,
    weights jsonb,
    warn_traces boolean not null default true,
    compare_goals boolean not null default true,
    updated_at timestamptz not null default now(),
    constraint member_score_settings_member_fkey
        foreign key (household_id, user_id)
        references public.household_members (household_id, user_id)
        on delete cascade
);

alter table public.member_score_settings enable row level security;

grant select, insert, update, delete on public.member_score_settings to service_role;
revoke all on public.member_score_settings from anon, authenticated;

-- Reading a household's settings, and the cascade when a household goes.
create index if not exists member_score_settings_household_id_idx
    on public.member_score_settings (household_id);

create policy member_score_settings_app_select
    on public.member_score_settings
    for select
    to foodable_app
    using (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
    );

create policy member_score_settings_app_insert
    on public.member_score_settings
    for insert
    to foodable_app
    with check (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
        and user_id = auth.uid()
    );

create policy member_score_settings_app_update
    on public.member_score_settings
    for update
    to foodable_app
    using (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
        and user_id = auth.uid()
    )
    with check (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
        and user_id = auth.uid()
    );

create policy member_score_settings_app_delete
    on public.member_score_settings
    for delete
    to foodable_app
    using (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
        and user_id = auth.uid()
    );
