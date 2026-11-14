-- A member's profile picture: one small image per (household, member), kept
-- in the database so the deploy needs no object store. Any member of the
-- household reads its pictures (they show beside names everywhere); only the
-- member writes or removes their own. The composite foreign key to
-- household_members means removing a member, or deleting their login (which
-- cascades to the membership), takes the picture with it.

create table public.member_avatars (
    household_id uuid not null,
    user_id uuid not null,
    content_type text not null
        check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
    bytes bytea not null check (octet_length(bytes) <= 65536),
    updated_at timestamptz not null default now(),
    primary key (household_id, user_id),
    constraint member_avatars_member_fkey
        foreign key (household_id, user_id)
        references public.household_members (household_id, user_id)
        on delete cascade
);

alter table public.member_avatars enable row level security;

grant select, insert, update, delete on public.member_avatars to service_role;
revoke all on public.member_avatars from anon, authenticated;

create policy member_avatars_app_read
    on public.member_avatars
    for select
    to foodable_app
    using (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
    );

create policy member_avatars_app_insert
    on public.member_avatars
    for insert
    to foodable_app
    with check (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
        and user_id = auth.uid()
    );

create policy member_avatars_app_update
    on public.member_avatars
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

create policy member_avatars_app_delete
    on public.member_avatars
    for delete
    to foodable_app
    using (
        household_id = nullif(current_setting('app.household_id', true), '')::uuid
        and user_id = auth.uid()
    );
