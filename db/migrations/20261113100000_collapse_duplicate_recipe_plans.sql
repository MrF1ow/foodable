-- A recipe planned twice on the same day and meal slot is one plan. Moving a
-- plan onto a day and slot that already held the same recipe used to leave
-- both rows. This collapses the existing ones; the unique index that keeps new
-- ones out is the next migration, so the data change and the new constraint
-- never ship in one step.
--
-- Per (household, recipe, date, slot) the earliest plan is kept (created_at,
-- then id) and takes the servings of the others, capped at the 999 the app
-- allows, so no planned portions silently vanish. No foreign key points at
-- recipe_plans, so deleting the extra rows leaves no dangling reference. The
-- one soft reference is a dismissed plan.missing_ingredient notice, which is
-- scoped by plan id: a dismissal made on a deleted duplicate stops applying
-- and that notice can show once more. Keeping the earliest row keeps the
-- dismissals that matter most, since the earliest plan is the one a notice was
-- most likely raised for. A database with no duplicates matches no row here.

with ranked as (
    select
        id,
        servings,
        sum(servings) over (
            partition by household_id, recipe_id, date, slot
        ) as total_servings,
        row_number() over (
            partition by household_id, recipe_id, date, slot
            order by created_at asc, id asc
        ) as rn
    from public.recipe_plans
)
update public.recipe_plans p
set servings = least(r.total_servings, 999)
from ranked r
where p.id = r.id
  and r.rn = 1
  and r.total_servings <> r.servings;

delete from public.recipe_plans p
using (
    select
        id,
        row_number() over (
            partition by household_id, recipe_id, date, slot
            order by created_at asc, id asc
        ) as rn
    from public.recipe_plans
) d
where p.id = d.id
  and d.rn > 1;
