-- Phase 5 expand: stock ledger and fridge date columns.
-- fridge_items stays the current state. stock_movements is the audit trail.
-- No columns are dropped.

create table public.stock_movements (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.households (id) on delete cascade,
    food_id uuid not null references public.foods (id) on delete cascade,
    fridge_item_id uuid references public.fridge_items (id) on delete set null,
    delta numeric not null,
    unit text not null,
    reason text not null check (reason in
        ('purchase', 'cook', 'eat', 'discard', 'adjust')),
    grocery_line_id uuid,
    recipe_id uuid,
    meal_id uuid,
    actor_user_id uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now()
);

create index stock_movements_food_idx
    on public.stock_movements (household_id, food_id, created_at desc);

alter table public.fridge_items
    add column purchased_on date,
    add column opened_on date,
    add column expires_on date;

alter table public.stock_movements enable row level security;

create policy stock_movements_member_all
    on public.stock_movements
    for all
    to authenticated
    using (
        household_id in (
            select household_id
            from public.household_members
            where user_id = auth.uid()
        )
    )
    with check (
        household_id in (
            select household_id
            from public.household_members
            where user_id = auth.uid()
        )
    );

grant select, insert, update, delete on table public.stock_movements to authenticated;
grant all on table public.stock_movements to service_role;
