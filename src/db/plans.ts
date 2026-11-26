import {
    PLAN_SERVINGS_MAX,
    PlanInputError,
    repeatOverlapError,
    checkPlanDate,
    checkPlanDays,
    checkPlanMembers,
    checkPlanRepeat,
    checkPlanServings,
    checkPlanSkippedDays,
    checkPlanSlot,
    expandRules,
    isPlanRepeat,
    isPlanSlot,
    planEntries,
    parseRuleEntryId,
    ruleEntryId,
    rulesShareDay,
    shiftPlanDate,
    type PlanEntry,
    type PlanMove,
    type PlanRule,
    type PlanSlot,
    type PlansStore,
    type PlanTransaction,
    type RecipePlan,
} from "../domain/plan.js";
import { maybeOne, pgCode, pgError, rows, run, type Tx } from "./sql.js";

const RECIPE_PLANS = "recipe_plans";
const PLAN_RULES = "plan_rules";
const RECIPES = "recipes";
// date::text keeps the calendar day as written, whatever the session zone.
export const PLAN_COLS =
    "id, household_id, recipe_id, date::text as date, slot, servings, member_ids::text[] as member_ids, created_by, created_at";
// date columns as text, so a day stays as written whatever the session zone;
// skipped_on and days come back as plain arrays.
export const PLAN_RULE_COLS =
    "id, household_id, recipe_id, meal, servings, starts_on::text as starts_on, rule, days::int[] as days, ends_on::text as ends_on, skipped_on::text[] as skipped_on, member_ids::text[] as member_ids, created_by, created_at";
// Day, then breakfast to snack, then the order they were planned in.
export const PLAN_ORDER = `date, case slot
    when 'breakfast' then 0
    when 'lunch' then 1
    when 'dinner' then 2
    else 3
end, created_at, id`;

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The key `planTransaction("plan-recipe", ...)` takes, so a store write that
 * can create or merge a plan waits behind (and in front of) the domain's own
 * serialized planning for that household. Re-taking it inside the same
 * transaction is a no-op.
 */
async function lockHouseholdPlans(tx: Tx, householdId: string): Promise<void> {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`plan-recipe:${householdId}`}, 0))`;
}

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
        memberIds: ((row.member_ids as unknown[] | null) ?? []).map(String),
        createdBy: row.created_by != null ? String(row.created_by) : null,
        createdAt: String(row.created_at),
    };
}

export function planRuleFromRow(row: Record<string, unknown>): PlanRule {
    const slot = String(row.meal);
    if (!isPlanSlot(slot)) {
        throw new Error(`plan_rules row ${String(row.id)} has meal ${slot}`);
    }
    const repeat = String(row.rule);
    if (!isPlanRepeat(repeat)) {
        throw new Error(`plan_rules row ${String(row.id)} has rule ${repeat}`);
    }
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        recipeId: String(row.recipe_id),
        slot,
        servings: Number(row.servings),
        startsOn: String(row.starts_on),
        repeat,
        days: ((row.days as unknown[] | null) ?? []).map(Number),
        endsOn: row.ends_on != null ? String(row.ends_on) : null,
        skippedOn: ((row.skipped_on as unknown[] | null) ?? []).map(String),
        memberIds: ((row.member_ids as unknown[] | null) ?? []).map(String),
        createdBy: row.created_by != null ? String(row.created_by) : null,
        createdAt: String(row.created_at),
    };
}

/** The repeats that cover any day from `from` to `to`. */
async function rulesInRange(
    tx: Tx,
    householdId: string,
    from: string,
    to: string,
): Promise<PlanRule[]> {
    const data = await rows<Record<string, unknown>>(
        tx,
        tx`
            select ${tx.unsafe(PLAN_RULE_COLS)}
            from ${tx.unsafe(PLAN_RULES)}
            where household_id = ${householdId}
              and starts_on <= ${to}::date
              and (ends_on is null or ends_on >= ${from}::date)
            order by created_at, id
        `,
    );
    return data.map(planRuleFromRow);
}

/** One-off plans and the days of repeats from `from` to `to`, in week order. */
async function entriesInRange(
    tx: Tx,
    householdId: string,
    from: string,
    to: string,
): Promise<PlanEntry[]> {
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
    return planEntries(
        data.map(recipePlanFromRow),
        await rulesInRange(tx, householdId, from, to),
        from,
        to,
    );
}

/** A repeat with its row locked, so a day taken off or a move cannot race. */
async function lockedRule(
    tx: Tx,
    householdId: string,
    ruleId: string,
): Promise<PlanRule | null> {
    const row = await maybeOne<Record<string, unknown>>(
        tx,
        tx`
            select ${tx.unsafe(PLAN_RULE_COLS)}
            from ${tx.unsafe(PLAN_RULES)}
            where household_id = ${householdId}
              and id = ${ruleId}::uuid
            for update
        `,
        "get plan rule",
    );
    return row ? planRuleFromRow(row) : null;
}

/** The day of a repeat an entry id names, when it is still on the series. */
async function lockedRuleDay(
    tx: Tx,
    householdId: string,
    id: string,
): Promise<{ rule: PlanRule; entry: PlanEntry } | null> {
    const parsed = parseRuleEntryId(id);
    if (!parsed) return null;
    const rule = await lockedRule(tx, householdId, parsed.ruleId);
    if (!rule) return null;
    const entry = expandRules([rule], parsed.date, parsed.date)[0];
    return entry ? { rule, entry } : null;
}

async function skipRuleDay(
    tx: Tx,
    householdId: string,
    ruleId: string,
    date: string,
): Promise<void> {
    await tx`
        update ${tx.unsafe(PLAN_RULES)}
        set skipped_on = (
                select coalesce(array_agg(d order by d), '{}'::date[])
                from (
                    select distinct d
                    from unnest(array_append(skipped_on, ${date}::date)) as d
                ) days
            ),
            updated_at = now()
        where household_id = ${householdId}
          and id = ${ruleId}::uuid
    `;
}

/**
 * The entry the week shows for this recipe, day and meal, a one-off or a day
 * of a repeat, other than `exceptId`.
 */
async function planAt(
    tx: Tx,
    householdId: string,
    recipeId: string,
    date: string,
    slot: PlanSlot,
    exceptId?: string,
): Promise<PlanEntry | null> {
    const day = await entriesInRange(tx, householdId, date, date);
    return (
        day.find(
            (entry) =>
                entry.recipeId === recipeId &&
                entry.slot === slot &&
                entry.id !== exceptId,
        ) ?? null
    );
}

/**
 * A repeat was just made: the one-offs already on days it covers hold those
 * days, so the repeat skips each day and leaves the one-off's servings as
 * they are. Returns the repeat as it now
 * stands.
 */
async function absorbOneOffs(tx: Tx, rule: PlanRule): Promise<PlanRule> {
    const data = await rows<Record<string, unknown>>(
        tx,
        tx`
            select id, date::text as date
            from ${tx.unsafe(RECIPE_PLANS)}
            where household_id = ${rule.householdId}
              and recipe_id = ${rule.recipeId}::uuid
              and slot = ${rule.slot}::text
              and date >= ${rule.startsOn}::date
            order by created_at, id
            for update
        `,
    );
    let skipped = false;
    for (const row of data) {
        const date = String(row.date);
        if (expandRules([rule], date, date).length === 0) continue;
        skipped = true;
        await skipRuleDay(tx, rule.householdId, rule.id, date);
    }
    if (!skipped) return rule;
    return (await lockedRule(tx, rule.householdId, rule.id)) ?? rule;
}

/**
 * One day of a repeat leaves the series and lands on its own: the day is
 * skipped in its repeat and a one-off plan is made on the new day. A day that
 * already holds the recipe and meal is already planned, and nothing changes.
 * One transaction, under the household's plan lock.
 */
async function moveRuleDay(
    tx: Tx,
    householdId: string,
    found: { rule: PlanRule; entry: PlanEntry },
    date: string,
    slot: PlanSlot,
    servings: number | null,
): Promise<PlanMove | null> {
    const { rule, entry } = found;
    // Saved with nothing changed: the day stays on its series.
    if (
        date === entry.date &&
        slot === entry.slot &&
        (servings === null || servings === entry.servings)
    ) {
        return { plan: { ...entry }, alreadyPlanned: false };
    }
    const there = await planAt(
        tx,
        householdId,
        rule.recipeId,
        date,
        slot,
        entry.id,
    );
    if (there) return { plan: there, alreadyPlanned: true };
    await skipRuleDay(tx, householdId, rule.id, entry.date);
    const inserted = await maybeOne<Record<string, unknown>>(
        tx,
        tx`
            insert into ${tx.unsafe(RECIPE_PLANS)} (
                household_id, recipe_id, date, slot, servings, member_ids,
                created_by
            )
            values (
                ${householdId}::uuid,
                ${rule.recipeId}::uuid,
                ${date}::date,
                ${slot}::text,
                ${servings ?? entry.servings}::numeric,
                ${tx.array(rule.memberIds ?? [], "uuid")},
                ${rule.createdBy}::uuid
            )
            returning ${tx.unsafe(PLAN_COLS)}
        `,
        "move plan",
    );
    return inserted
        ? { plan: recipePlanFromRow(inserted), alreadyPlanned: false }
        : null;
}

export function liveRecipePlansStore(): PlansStore {
    return {
        async addPlan(plan) {
            const date = checkPlanDate(plan.date);
            const slot = checkPlanSlot(plan.slot);
            const servings = checkPlanServings(plan.servings ?? 1);
            const memberIds = checkPlanMembers(plan.memberIds);
            // A malformed id names no recipe; sending it would fail the uuid cast.
            if (!UUID_RE.test(plan.recipeId)) return null;
            return run(async (tx) => {
                try {
                    await lockHouseholdPlans(tx, plan.householdId);
                    // One plan per recipe, day and meal, a one-off or a day of
                    // a repeat: planning it again is that plan, whatever the
                    // servings.
                    const planned = await planAt(
                        tx,
                        plan.householdId,
                        plan.recipeId,
                        date,
                        slot,
                    );
                    if (planned) return planned;
                    // Selecting from saved recipes keeps a recipe id from
                    // another household, or a draft, from being planned: no
                    // row, no insert.
                    // In a savepoint: a refused insert aborts only the
                    // savepoint, so the transaction can still commit.
                    const inserted = await tx.savepoint((sp) =>
                        maybeOne<Record<string, unknown>>(
                            sp as Tx,
                            sp`
                            insert into ${sp.unsafe(RECIPE_PLANS)} (
                                id, household_id, recipe_id, date, slot,
                                servings, member_ids, created_by
                            )
                            select
                                ${plan.id ?? crypto.randomUUID()}::uuid,
                                r.household_id,
                                r.id,
                                ${date}::date,
                                ${slot}::text,
                                ${servings}::numeric,
                                ${sp.array(memberIds, "uuid")},
                                ${plan.createdBy ?? null}::uuid
                            from ${sp.unsafe(RECIPES)} r
                            where r.id = ${plan.recipeId}::uuid
                              and r.household_id = ${plan.householdId}::uuid
                              and r.verification = 'verified'
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
            if (!UUID_RE.test(id)) {
                const parsed = parseRuleEntryId(id);
                if (!parsed) return null;
                return run(async (tx) => {
                    try {
                        const day = await entriesInRange(
                            tx,
                            householdId,
                            parsed.date,
                            parsed.date,
                        );
                        const canonical = ruleEntryId(
                            parsed.ruleId,
                            parsed.date,
                        );
                        return (
                            day.find((entry) => entry.id === canonical) ?? null
                        );
                    } catch (err) {
                        throw pgError("get plan", err);
                    }
                });
            }
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
                    return await entriesInRange(tx, householdId, from, to);
                } catch (err) {
                    throw pgError("list plans", err);
                }
            });
        },
        async movePlan(householdId, id, date, slot, servings) {
            const nextDate = checkPlanDate(date);
            const nextSlot = checkPlanSlot(slot);
            const nextServings =
                servings === undefined ? null : checkPlanServings(servings);
            if (!UUID_RE.test(id)) {
                if (!parseRuleEntryId(id)) return null;
                return run(async (tx) => {
                    try {
                        await lockHouseholdPlans(tx, householdId);
                        const found = await lockedRuleDay(tx, householdId, id);
                        if (!found) return null;
                        return await moveRuleDay(
                            tx,
                            householdId,
                            found,
                            nextDate,
                            nextSlot,
                            nextServings,
                        );
                    } catch (err) {
                        throw pgError("move plan", err);
                    }
                });
            }
            return run(async (tx) => {
                try {
                    await lockHouseholdPlans(tx, householdId);
                    const moving = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            select ${tx.unsafe(PLAN_COLS)}
                            from ${tx.unsafe(RECIPE_PLANS)}
                            where household_id = ${householdId}
                              and id = ${id}::uuid
                            for update
                        `,
                        "get plan",
                    );
                    if (!moving) return null;
                    // The same recipe already planned there, a one-off or a day
                    // of a repeat: already planned, nothing moves.
                    const there = await planAt(
                        tx,
                        householdId,
                        String(moving.recipe_id),
                        nextDate,
                        nextSlot,
                        id,
                    );
                    if (there) return { plan: there, alreadyPlanned: true };
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            update ${tx.unsafe(RECIPE_PLANS)}
                            set date = ${nextDate}::date,
                                slot = ${nextSlot}::text,
                                servings = coalesce(${nextServings}::numeric, servings)
                            where household_id = ${householdId}
                              and id = ${id}::uuid
                            returning ${tx.unsafe(PLAN_COLS)}
                        `,
                        "move plan",
                    );
                    return data
                        ? {
                              plan: recipePlanFromRow(data),
                              alreadyPlanned: false,
                          }
                        : null;
                } catch (err) {
                    throw pgError("move plan", err);
                }
            });
        },
        async updatePlanServings(householdId, id, servings) {
            const next = checkPlanServings(servings);
            if (!UUID_RE.test(id)) {
                if (!parseRuleEntryId(id)) return null;
                // One day of a repeat with other servings is a plan of its own.
                return run(async (tx) => {
                    try {
                        await lockHouseholdPlans(tx, householdId);
                        const found = await lockedRuleDay(tx, householdId, id);
                        if (!found) return null;
                        return (
                            (
                                await moveRuleDay(
                                    tx,
                                    householdId,
                                    found,
                                    found.entry.date,
                                    found.entry.slot,
                                    next,
                                )
                            )?.plan ?? null
                        );
                    } catch (err) {
                        throw pgError("update plan servings", err);
                    }
                });
            }
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
            if (!UUID_RE.test(id)) {
                if (!parseRuleEntryId(id)) return false;
                // One day of a repeat: that day is skipped, the rest stay.
                return run(async (tx) => {
                    try {
                        await lockHouseholdPlans(tx, householdId);
                        const found = await lockedRuleDay(tx, householdId, id);
                        if (!found) return false;
                        await skipRuleDay(
                            tx,
                            householdId,
                            found.rule.id,
                            found.entry.date,
                        );
                        return true;
                    } catch (err) {
                        throw pgError("remove plan", err);
                    }
                });
            }
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
        async addRule(rule) {
            const startsOn = checkPlanDate(rule.startsOn);
            const slot = checkPlanSlot(rule.slot);
            const servings = checkPlanServings(rule.servings ?? 1);
            const repeat = checkPlanRepeat(rule.repeat);
            const days = repeat === "days" ? checkPlanDays(rule.days) : [];
            const memberIds = checkPlanMembers(rule.memberIds);
            // A repeat that carries on from an earlier one keeps its skipped
            // days and its last day.
            const skippedOn = checkPlanSkippedDays(rule.skippedOn);
            const endsOn =
                rule.endsOn == null ? null : checkPlanDate(rule.endsOn);
            if (!UUID_RE.test(rule.recipeId)) return null;
            return run(async (tx) => {
                try {
                    await lockHouseholdPlans(tx, rule.householdId);
                    // One repeat per recipe and meal on a day: refused while
                    // another one (ended ones for the days they still cover)
                    // shows on a day this one would.
                    const candidate = {
                        startsOn,
                        endsOn,
                        repeat,
                        days,
                        skippedOn,
                    };
                    const others = await rows<Record<string, unknown>>(
                        tx,
                        tx`
                            select ${tx.unsafe(PLAN_RULE_COLS)}
                            from ${tx.unsafe(PLAN_RULES)}
                            where household_id = ${rule.householdId}::uuid
                              and recipe_id = ${rule.recipeId}::uuid
                              and meal = ${slot}::text
                        `,
                    );
                    const clashing = others
                        .map(planRuleFromRow)
                        .filter((other) => rulesShareDay(other, candidate));
                    if (clashing.length > 0) {
                        throw repeatOverlapError(slot, clashing, candidate);
                    }
                    // Selecting from saved recipes keeps a recipe id from
                    // another household, or a draft, from being planned: no
                    // row, no insert.
                    const inserted = await tx.savepoint((sp) =>
                        maybeOne<Record<string, unknown>>(
                            sp as Tx,
                            sp`
                            insert into ${sp.unsafe(PLAN_RULES)} (
                                id, household_id, recipe_id, meal, servings,
                                starts_on, rule, days, member_ids, created_by,
                                ends_on, skipped_on
                            )
                            select
                                ${rule.id ?? crypto.randomUUID()}::uuid,
                                r.household_id,
                                r.id,
                                ${slot}::text,
                                ${servings}::numeric,
                                ${startsOn}::date,
                                ${repeat}::text,
                                ${days}::int[]::smallint[],
                                ${sp.array(memberIds, "uuid")},
                                ${rule.createdBy ?? null}::uuid,
                                ${endsOn}::date,
                                ${skippedOn}::text[]::date[]
                            from ${sp.unsafe(RECIPES)} r
                            where r.id = ${rule.recipeId}::uuid
                              and r.household_id = ${rule.householdId}::uuid
                              and r.verification = 'verified'
                            returning ${sp.unsafe(PLAN_RULE_COLS)}
                        `,
                            "plan recipe",
                        ),
                    );
                    if (!inserted) return null;
                    const saved = planRuleFromRow(inserted);
                    return await absorbOneOffs(tx, saved);
                } catch (err) {
                    if (err instanceof PlanInputError) throw err;
                    // The recipe was deleted between the select and the insert.
                    if (pgCode(err) === "23503") return null;
                    throw pgError("plan recipe", err);
                }
            });
        },
        async getRule(householdId, id) {
            if (!UUID_RE.test(id)) return null;
            return run(async (tx) => {
                try {
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            select ${tx.unsafe(PLAN_RULE_COLS)}
                            from ${tx.unsafe(PLAN_RULES)}
                            where household_id = ${householdId}
                              and id = ${id}::uuid
                        `,
                        "get plan rule",
                    );
                    return data ? planRuleFromRow(data) : null;
                } catch (err) {
                    throw pgError("get plan rule", err);
                }
            });
        },
        async listRules(householdId) {
            return run(async (tx) => {
                try {
                    const data = await rows<Record<string, unknown>>(
                        tx,
                        tx`
                            select ${tx.unsafe(PLAN_RULE_COLS)}
                            from ${tx.unsafe(PLAN_RULES)}
                            where household_id = ${householdId}
                              and ends_on is null
                            order by created_at, id
                        `,
                    );
                    return data.map(planRuleFromRow);
                } catch (err) {
                    throw pgError("list plan rules", err);
                }
            });
        },
        async removeRule(householdId, ruleId) {
            if (!UUID_RE.test(ruleId)) return false;
            return run(async (tx) => {
                try {
                    await lockHouseholdPlans(tx, householdId);
                    const removed = await rows(
                        tx,
                        tx`
                            delete from ${tx.unsafe(PLAN_RULES)}
                            where household_id = ${householdId}
                              and id = ${ruleId}::uuid
                            returning id
                        `,
                    );
                    return removed.length > 0;
                } catch (err) {
                    throw pgError("remove plan rule", err);
                }
            });
        },
        async endRuleBefore(householdId, ruleId, date) {
            const lastDay = shiftPlanDate(checkPlanDate(date), -1);
            if (!UUID_RE.test(ruleId)) return null;
            return run(async (tx) => {
                try {
                    await lockHouseholdPlans(tx, householdId);
                    // Ending from a later day never brings an earlier end back.
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            update ${tx.unsafe(PLAN_RULES)}
                            set ends_on = least(
                                    coalesce(ends_on, ${lastDay}::date),
                                    ${lastDay}::date
                                ),
                                updated_at = now()
                            where household_id = ${householdId}
                              and id = ${ruleId}::uuid
                            returning ${tx.unsafe(PLAN_RULE_COLS)}
                        `,
                        "end plan rule",
                    );
                    return data ? planRuleFromRow(data) : null;
                } catch (err) {
                    throw pgError("end plan rule", err);
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
