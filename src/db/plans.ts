import {
    checkPlanDate,
    checkPlanServings,
    checkPlanSlot,
    isPlanSlot,
    type PlansStore,
    type PlanTransaction,
    type RecipePlan,
} from "../domain/plan.js";
import { maybeOne, pgCode, pgError, rows, run, type Tx } from "./sql.js";

const RECIPE_PLANS = "recipe_plans";
const RECIPES = "recipes";
// date::text keeps the calendar day as written, whatever the session zone.
export const PLAN_COLS =
    "id, household_id, recipe_id, date::text as date, slot, servings, created_by, created_at";
// Day, then breakfast to snack, then the order they were planned in.
export const PLAN_ORDER = `date, case slot
    when 'breakfast' then 0
    when 'lunch' then 1
    when 'dinner' then 2
    else 3
end, created_at, id`;

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function recipePlanFromRow(row: Record<string, unknown>): RecipePlan {
    const slot = String(row.slot);
    if (!isPlanSlot(slot)) {
        throw new Error(`recipe_plans row ${String(row.id)} has slot ${slot}`);
    }
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        recipeId: String(row.recipe_id),
        date: String(row.date),
        slot,
        servings: Number(row.servings),
        createdBy: row.created_by != null ? String(row.created_by) : null,
        createdAt: String(row.created_at),
    };
}

export function liveRecipePlansStore(): PlansStore {
    return {
        async addPlan(plan) {
            const date = checkPlanDate(plan.date);
            const slot = checkPlanSlot(plan.slot);
            const servings = checkPlanServings(plan.servings ?? 1);
            // A malformed id names no recipe; sending it would fail the uuid cast.
            if (!UUID_RE.test(plan.recipeId)) return null;
            return run(async (tx) => {
                try {
                    // Selecting from recipes keeps a recipe id from another
                    // household from being planned: no row, no insert.
                    // In a savepoint: a refused insert aborts only the
                    // savepoint, so the transaction can still commit.
                    const inserted = await tx.savepoint((sp) =>
                        maybeOne<Record<string, unknown>>(
                            sp as Tx,
                            sp`
                            insert into ${sp.unsafe(RECIPE_PLANS)} (
                                id, household_id, recipe_id, date, slot,
                                servings, created_by
                            )
                            select
                                ${plan.id ?? crypto.randomUUID()}::uuid,
                                r.household_id,
                                r.id,
                                ${date}::date,
                                ${slot}::text,
                                ${servings}::numeric,
                                ${plan.createdBy ?? null}::uuid
                            from ${sp.unsafe(RECIPES)} r
                            where r.id = ${plan.recipeId}::uuid
                              and r.household_id = ${plan.householdId}::uuid
                            returning ${sp.unsafe(PLAN_COLS)}
                        `,
                            "plan recipe",
                        ),
                    );
                    return inserted ? recipePlanFromRow(inserted) : null;
                } catch (err) {
                    // The recipe was deleted between the select and the insert
                    // check: the foreign key refuses, and it is not planned.
                    if (pgCode(err) === "23503") return null;
                    throw pgError("plan recipe", err);
                }
            });
        },
        async getPlan(householdId, id) {
            if (!UUID_RE.test(id)) return null;
            return run(async (tx) => {
                try {
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            select ${tx.unsafe(PLAN_COLS)}
                            from ${tx.unsafe(RECIPE_PLANS)}
                            where household_id = ${householdId}
                              and id = ${id}::uuid
                        `,
                        "get plan",
                    );
                    return data ? recipePlanFromRow(data) : null;
                } catch (err) {
                    throw pgError("get plan", err);
                }
            });
        },
        async listPlans(householdId, from, to) {
            checkPlanDate(from);
            checkPlanDate(to);
            return run(async (tx) => {
                try {
                    const data = await rows<Record<string, unknown>>(
                        tx,
                        tx`
                            select ${tx.unsafe(PLAN_COLS)}
                            from ${tx.unsafe(RECIPE_PLANS)}
                            where household_id = ${householdId}
                              and date between ${from}::date and ${to}::date
                            order by ${tx.unsafe(PLAN_ORDER)}
                        `,
                    );
                    return data.map(recipePlanFromRow);
                } catch (err) {
                    throw pgError("list plans", err);
                }
            });
        },
        async movePlan(householdId, id, date, slot) {
            const nextDate = checkPlanDate(date);
            const nextSlot = checkPlanSlot(slot);
            if (!UUID_RE.test(id)) return null;
            return run(async (tx) => {
                try {
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            update ${tx.unsafe(RECIPE_PLANS)}
                            set date = ${nextDate}::date, slot = ${nextSlot}::text
                            where household_id = ${householdId}
                              and id = ${id}::uuid
                            returning ${tx.unsafe(PLAN_COLS)}
                        `,
                        "move plan",
                    );
                    return data ? recipePlanFromRow(data) : null;
                } catch (err) {
                    throw pgError("move plan", err);
                }
            });
        },
        async updatePlanServings(householdId, id, servings) {
            const next = checkPlanServings(servings);
            if (!UUID_RE.test(id)) return null;
            return run(async (tx) => {
                try {
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            update ${tx.unsafe(RECIPE_PLANS)}
                            set servings = ${next}::numeric
                            where household_id = ${householdId}
                              and id = ${id}::uuid
                            returning ${tx.unsafe(PLAN_COLS)}
                        `,
                        "update plan servings",
                    );
                    return data ? recipePlanFromRow(data) : null;
                } catch (err) {
                    throw pgError("update plan servings", err);
                }
            });
        },
        async removePlan(householdId, id) {
            if (!UUID_RE.test(id)) return false;
            return run(async (tx) => {
                try {
                    const removed = await rows(
                        tx,
                        tx`
                            delete from ${tx.unsafe(RECIPE_PLANS)}
                            where household_id = ${householdId}
                              and id = ${id}::uuid
                            returning id
                        `,
                    );
                    return removed.length > 0;
                } catch (err) {
                    throw pgError("remove plan", err);
                }
            });
        },
    };
}

/**
 * Which planning write is being serialized. The two touch different rows
 * (`recipe_plans` and `grocery_lines`), so each has its own key: planning
 * never waits on adding the missing foods, and two of the same kind do.
 */
export type PlanLockOperation = "plan-recipe" | "plan-missing";

/**
 * The `transaction` the planning domain functions take, for the live stores:
 * one such write per household at a time. The second waits on the first's
 * advisory lock, then reads what the first committed, so "planned twice is one
 * plan" and "a second call adds nothing" hold when agents, the chat card and
 * the web app fire together.
 */
export function planTransaction(
    operation: PlanLockOperation,
    householdId: string,
): PlanTransaction {
    return (fn) =>
        run(async (tx) => {
            await tx`select pg_advisory_xact_lock(hashtextextended(${`${operation}:${householdId}`}, 0))`;
            return fn();
        });
}
