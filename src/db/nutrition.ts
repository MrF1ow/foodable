import type { SQL } from "bun";
import {
    GOAL_DAY_FIELDS,
    goalDayFromRow,
    goalsForDate,
    goalsResolver,
    isCalendarDate,
    type GoalDayField,
    type GoalDayOverride,
    type GoalDayStore,
    type GoalsByDate,
} from "../domain/insights.js";
import { zonedDayStartUtc, zonedNextDayStartUtc } from "../domain/tz.js";
import { decodeEscapeSequences } from "../normalize.js";
import { toStoredInteger } from "../domain/units.js";
import { escapeLikePattern, tokenizeQuery } from "../search.js";
import { deleteAuthUser } from "./users.js";
import {
    definedColumns,
    insertReturning,
    maybeOne,
    one,
    pgCode,
    rows,
    run,
    type Tx,
} from "./sql.js";

const MEALS = "meals";
const MEAL_ITEMS = "meal_items";
const WATER_LOG = "water_log";
const WEIGHT_LOG = "weight_log";
const NUTRITION_GOALS = "nutrition_goals";
const NUTRITION_GOAL_DAYS = "nutrition_goal_days";

function nutritionFailed(context: string, err: unknown): Error {
    const message = err instanceof Error ? err.message : String(err);
    return new Error(`Failed to ${context}: ${message}`);
}

function patchKeys(keys: string[]): [string, ...string[]] {
    return keys as [string, ...string[]];
}

function sqlState(err: unknown): string | undefined {
    return (
        pgCode(err) ?? (err instanceof Error ? pgCode(err.cause) : undefined)
    );
}

async function countForUser(
    tx: Tx,
    table: string,
    userId: string,
    context: string,
): Promise<number> {
    try {
        const [row] = await rows<{ count: number }>(
            tx,
            tx`
                select count(*)::int as count
                from ${tx.unsafe(table)}
                where user_id = ${userId}
            `,
        );
        return row?.count ?? 0;
    } catch (err) {
        throw nutritionFailed(context, err);
    }
}

// ---------- Idempotency ----------

// Derive a stable idempotency key from the request content so the column is
// always populated and retries dedupe even when the client omits a key. The
// resolved logged_at is part of the digest, so two genuinely separate but
// otherwise-identical entries (logged at different times) get distinct keys and
// are never wrongly merged. A retry replays the same args — including the same
// logged_at — and therefore lands on the same key. The "auto:" prefix marks
// server-derived keys, distinguishing them from client-supplied ones.
//
// The digest is POSITIONAL over whatever the caller passes, so the field list
// at each call site is frozen: see the warning inside mealIdempotencyKey before
// touching one.
function deriveIdempotencyKey(
    parts: (string | number | null | undefined)[],
): string {
    const digest = new Bun.CryptoHasher("sha256")
        .update(parts.map((p) => p ?? "").join("\u0000"))
        .digest("hex");
    return `auto:${digest}`;
}

// ---------- Meals ----------

export interface Meal {
    id: string;
    user_id: string;
    logged_at: string;
    meal_type: string | null;
    description: string;
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    // Total sugars (not added sugar); alcohol is pure ethanol in grams.
    fiber_g: number | null;
    sugar_g: number | null;
    alcohol_g: number | null;
    // MILLIGRAMS, unlike every other nutrient here — labels and guidelines are
    // all stated in mg, so the unit rides in the name at every layer.
    // Contributes no energy: never feed this into a kcal derivation.
    caffeine_mg: number | null;
    notes: string | null;
    idempotency_key: string | null;
    items?: MealItem[];
}

export interface MealItem {
    id: string;
    meal_id: string;
    user_id: string;
    household_id: string | null;
    food_id: string | null;
    recipe_id: string | null;
    label: string;
    amount: number | null;
    unit: string | null;
    grams: number | null;
    portions: number | null;
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    fiber_g: number | null;
    sugar_g: number | null;
    alcohol_g: number | null;
    caffeine_mg: number | null;
    sort_order: number;
    created_at: string;
}

export interface MealItemWrite {
    household_id: string | null;
    food_id: string | null;
    recipe_id: string | null;
    label: string;
    amount: number | null;
    unit: string | null;
    grams: number | null;
    portions: number | null;
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    fiber_g: number | null;
    sugar_g: number | null;
    alcohol_g: number | null;
    caffeine_mg: number | null;
    sort_order: number;
}

export interface MealInput {
    description: string;
    meal_type: "breakfast" | "lunch" | "dinner" | "snack";
    calories?: number;
    protein_g?: number;
    carbs_g?: number;
    fat_g?: number;
    fiber_g?: number;
    sugar_g?: number;
    alcohol_g?: number;
    // Milligrams — see Meal.caffeine_mg.
    caffeine_mg?: number;
    logged_at?: string;
    notes?: string;
    idempotency_key?: string;
    items?: MealItemWrite[];
    item_digest?: string;
}

export interface MealInsertResult {
    meal: Meal;
    deduplicated: boolean;
}

/**
 * The server-derived idempotency key for a meal write, over the resolved
 * logged_at (so the digest and the persisted row agree). Exported and pure so
 * the frozen field list below is testable directly — see
 * src/db/nutrition-helpers.test.ts — exactly as rowContentDigest is in
 * src/domain/import.ts.
 */
export function mealIdempotencyKey(
    userId: string,
    input: MealInput,
    loggedAt: string,
): string {
    // DO NOT ADD FIELDS TO THIS ARRAY. It is deliberately incomplete:
    // fiber_g, sugar_g, alcohol_g and caffeine_mg are EXCLUDED on purpose, and
    // any future meal *column* must be too. The digest is positional over
    // exactly these values, so appending one changes the derived key of every
    // future write — a user re-logging or re-importing something they already
    // have would get a duplicate row instead of a clean no-op, and every
    // "auto:" key already stored would be orphaned. This repo has shipped
    // that bug once already (see CLAUDE.md, "Bulk meal import"); the mirror
    // of this array is rowContentDigest in src/domain/import.ts, which carries the
    // same warning.
    //
    // Item-backed meals are the one additive exception: `item_digest` is
    // appended only when present, so free-text meals keep today's key.
    //
    // Accepted consequence: two meals identical except for their fiber (or
    // sugar, or alcohol, or caffeine) dedupe to one. Dedup stability beats
    // precision here, and a caller who needs distinct rows can pass an explicit
    // idempotency_key.
    const parts: (string | number | null | undefined)[] = [
        userId,
        input.description,
        input.meal_type,
        input.calories,
        input.protein_g,
        input.carbs_g,
        input.fat_g,
        input.notes,
        loggedAt,
    ];
    // Item-backed meals append the canonical item list so two different
    // food lists cannot collide. Free-text meals omit this segment, so
    // their keys stay byte-identical to the frozen field list above.
    if (input.item_digest) parts.push(input.item_digest);
    return deriveIdempotencyKey(parts);
}

/**
 * The idempotency key updateMeal should persist for `fields` applied on top
 * of `existing`, or null when the row's current key must be left alone.
 *
 * mealIdempotencyKey derives a content digest so retries dedupe without a
 * client-supplied key — but updateMeal never recomputed it, so editing a
 * meal's content left the digest describing the pre-edit content (#84): a
 * replay of the ORIGINAL log_meal call then deduped onto the corrected row
 * ("Meal already logged"), while re-logging the CORRECTED content created a
 * duplicate. Recomputing over the merged (existing + changed) fields keeps
 * the key describing what the row now says.
 *
 * Only when the current key is "auto:"-prefixed: a caller-supplied key
 * encodes the caller's own request-level idempotency choice, which
 * updateMeal must not override.
 */
export function updatedMealIdempotencyKey(
    userId: string,
    existing: Meal,
    fields: Partial<MealInput>,
): string | null {
    if (!existing.idempotency_key?.startsWith("auto:")) return null;

    const merged: MealInput = {
        description: fields.description ?? existing.description,
        meal_type:
            (fields.meal_type as MealInput["meal_type"] | undefined) ??
            (existing.meal_type as MealInput["meal_type"]),
        calories:
            fields.calories !== undefined
                ? toStoredInteger(fields.calories)
                : (existing.calories ?? undefined),
        protein_g: fields.protein_g ?? existing.protein_g ?? undefined,
        carbs_g: fields.carbs_g ?? existing.carbs_g ?? undefined,
        fat_g: fields.fat_g ?? existing.fat_g ?? undefined,
        notes: fields.notes ?? existing.notes ?? undefined,
        item_digest: fields.item_digest,
    };
    // existing.logged_at came back through PostgREST, which renders
    // timestamptz as "+00:00" (and drops an all-zero fractional part) —
    // never as the "Z"-suffixed, millisecond-padded form every write path
    // hashes (new Date().toISOString(), here and in insertMeal/importMeals).
    // Re-serializing through Date canonicalizes it back to that shared
    // format. Skipping this made every edit that leaves logged_at untouched
    // — the common case — persist a key a fresh, identical log_meal call
    // could never reproduce, silently reopening the "duplicate on re-log"
    // half of #84.
    const loggedAt =
        fields.logged_at ?? new Date(existing.logged_at).toISOString();

    return mealIdempotencyKey(userId, merged, loggedAt);
}

export async function insertMeal(
    userId: string,
    input: MealInput,
): Promise<MealInsertResult> {
    // calories is an integer column and Postgres rejects a fractional value
    // outright (22P02), so round before anything else reads the input — the
    // digest below included, or re-logging the same meal would derive a key
    // from 388.54 while the stored row said 389 and the dedup would miss.
    const meal: MealInput =
        input.calories == null
            ? input
            : { ...input, calories: toStoredInteger(input.calories) };

    // Resolve logged_at once so the digest and the persisted row agree.
    const loggedAt = meal.logged_at ?? new Date().toISOString();
    // Always populate the key: use the client's if given, otherwise derive a
    // stable one from the request content (see mealIdempotencyKey).
    const idempotencyKey =
        meal.idempotency_key ?? mealIdempotencyKey(userId, meal, loggedAt);

    return run(async (tx) => {
        let existing: Meal | null;
        try {
            existing = await maybeOne<Meal>(
                tx,
                tx`
                    select *
                    from ${tx.unsafe(MEALS)}
                    where user_id = ${userId}
                      and idempotency_key = ${idempotencyKey}
                `,
                "look up meal",
            );
        } catch (err) {
            throw nutritionFailed("look up meal", err);
        }
        if (existing) {
            existing.items = await listMealItemsInTx(tx, userId, [existing.id]);
            return { meal: existing, deduplicated: true };
        }

        const payload = {
            user_id: userId,
            description: decodeEscapeSequences(meal.description),
            meal_type: meal.meal_type,
            calories: meal.calories ?? null,
            protein_g: meal.protein_g ?? null,
            carbs_g: meal.carbs_g ?? null,
            fat_g: meal.fat_g ?? null,
            fiber_g: meal.fiber_g ?? null,
            sugar_g: meal.sugar_g ?? null,
            alcohol_g: meal.alcohol_g ?? null,
            caffeine_mg: meal.caffeine_mg ?? null,
            logged_at: loggedAt,
            notes:
                meal.notes != null ? decodeEscapeSequences(meal.notes) : null,
            idempotency_key: idempotencyKey,
        };

        let saved: Meal;
        try {
            saved = await tx.savepoint(async (sp) =>
                insertReturning<Meal>(
                    sp as Tx,
                    MEALS,
                    payload,
                    "*",
                    "insert meal",
                ),
            );
        } catch (err) {
            // Concurrent retry with the same idempotency key — the other request
            // already inserted the row. Fetch and return it instead of failing.
            if (sqlState(err) === "23505") {
                let raced: Meal | null;
                try {
                    raced = await maybeOne<Meal>(
                        tx,
                        tx`
                            select *
                            from ${tx.unsafe(MEALS)}
                            where user_id = ${userId}
                              and idempotency_key = ${idempotencyKey}
                        `,
                        "resolve idempotent meal",
                    );
                } catch (raceErr) {
                    throw nutritionFailed("resolve idempotent meal", raceErr);
                }
                if (raced) {
                    raced.items = await listMealItemsInTx(tx, userId, [
                        raced.id,
                    ]);
                    return { meal: raced, deduplicated: true };
                }
            }
            if (
                err instanceof Error &&
                err.message.startsWith("Failed to insert meal:")
            ) {
                throw err;
            }
            throw nutritionFailed("insert meal", err);
        }

        if (input.items && input.items.length > 0) {
            saved.items = await replaceMealItemsInTx(
                tx,
                userId,
                saved.id,
                input.items,
            );
        }
        return { meal: saved, deduplicated: false };
    });
}

const MEAL_ITEM_COLS =
    "id, meal_id, user_id, household_id, food_id, recipe_id, label, amount, unit, grams, portions, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, alcohol_g, caffeine_mg, sort_order, created_at";

async function listMealItemsInTx(
    tx: Tx,
    userId: string,
    mealIds: string[],
): Promise<MealItem[]> {
    if (mealIds.length === 0) return [];
    try {
        return await rows<MealItem>(
            tx,
            tx`
                select ${tx.unsafe(MEAL_ITEM_COLS)}
                from ${tx.unsafe(MEAL_ITEMS)}
                where user_id = ${userId}
                  and meal_id = any(${tx.array(mealIds, "uuid")})
                order by sort_order asc
            `,
        );
    } catch (err) {
        throw nutritionFailed("list meal items", err);
    }
}

export async function listMealItems(
    userId: string,
    mealIds: string[],
): Promise<MealItem[]> {
    return run(async (tx) => listMealItemsInTx(tx, userId, mealIds));
}

export async function attachMealItems(
    userId: string,
    meals: Meal[],
): Promise<Meal[]> {
    const items = await listMealItems(
        userId,
        meals.map((meal) => meal.id),
    );
    const byMeal = new Map<string, MealItem[]>();
    for (const item of items) {
        const group = byMeal.get(item.meal_id) ?? [];
        group.push(item);
        byMeal.set(item.meal_id, group);
    }
    for (const meal of meals) {
        meal.items = byMeal.get(meal.id) ?? [];
    }
    return meals;
}

async function replaceMealItemsInTx(
    tx: Tx,
    userId: string,
    mealId: string,
    items: MealItemWrite[],
): Promise<MealItem[]> {
    try {
        await tx`
            delete from ${tx.unsafe(MEAL_ITEMS)}
            where user_id = ${userId}
              and meal_id = ${mealId}
        `;
    } catch (err) {
        throw nutritionFailed("replace meal items", err);
    }
    if (items.length === 0) return [];
    const inserted: MealItem[] = [];
    for (let index = 0; index < items.length; index++) {
        const item = items[index]!;
        try {
            const row = await insertReturning<MealItem>(
                tx,
                MEAL_ITEMS,
                {
                    meal_id: mealId,
                    user_id: userId,
                    household_id: item.household_id,
                    food_id: item.food_id,
                    recipe_id: item.recipe_id,
                    label: item.label,
                    amount: item.amount,
                    unit: item.unit,
                    grams: item.grams,
                    portions: item.portions,
                    calories: item.calories,
                    protein_g: item.protein_g,
                    carbs_g: item.carbs_g,
                    fat_g: item.fat_g,
                    fiber_g: item.fiber_g,
                    sugar_g: item.sugar_g,
                    alcohol_g: item.alcohol_g,
                    caffeine_mg: item.caffeine_mg,
                    sort_order: item.sort_order ?? index,
                },
                MEAL_ITEM_COLS,
                "insert meal items",
            );
            inserted.push(row);
        } catch (err) {
            if (
                err instanceof Error &&
                err.message.startsWith("Failed to insert meal items:")
            ) {
                throw err;
            }
            throw nutritionFailed("insert meal items", err);
        }
    }
    inserted.sort((a, b) => a.sort_order - b.sort_order);
    return inserted;
}

export async function replaceMealItems(
    userId: string,
    mealId: string,
    items: MealItemWrite[],
): Promise<MealItem[]> {
    return run(async (tx) => replaceMealItemsInTx(tx, userId, mealId, items));
}

export async function countMealItems(userId: string): Promise<number> {
    return run(async (tx) =>
        countForUser(tx, MEAL_ITEMS, userId, "count meal items"),
    );
}

export async function getAllMealItems(userId: string): Promise<MealItem[]> {
    const expected = await countMealItems(userId);
    if (expected === 0) return [];
    const items = await fetchAllPages<MealItem>(async (from, to) => {
        const limit = to - from + 1;
        return run(async (tx) => {
            try {
                return await rows<MealItem>(
                    tx,
                    tx`
                        select ${tx.unsafe(MEAL_ITEM_COLS)}
                        from ${tx.unsafe(MEAL_ITEMS)}
                        where user_id = ${userId}
                        order by meal_id asc, sort_order asc, id asc
                        offset ${from}
                        limit ${limit}
                    `,
                );
            } catch (err) {
                throw nutritionFailed("get meal items", err);
            }
        });
    });
    if (items.length < expected) {
        throw new Error(
            `getAllMealItems: fetched ${items.length} items but countMealItems reported ${expected} — export would be truncated`,
        );
    }
    return items;
}

export function snapshotToMealItemWrite(
    item: {
        foodId: string | null;
        recipeId: string | null;
        label: string;
        amount: number | null;
        unit: string | null;
        grams: number | null;
        portions: number | null;
        calories: number | null;
        protein_g: number | null;
        carbs_g: number | null;
        fat_g: number | null;
        fiber_g: number | null;
        sugar_g: number | null;
        alcohol_g: number | null;
        caffeine_mg: number | null;
        sortOrder: number;
    },
    householdId: string | null,
): MealItemWrite {
    return {
        household_id: householdId,
        food_id: item.foodId,
        recipe_id: item.recipeId,
        label: item.label,
        amount: item.amount,
        unit: item.unit,
        grams: item.grams,
        portions: item.portions,
        calories: item.calories,
        protein_g: item.protein_g,
        carbs_g: item.carbs_g,
        fat_g: item.fat_g,
        fiber_g: item.fiber_g,
        sugar_g: item.sugar_g,
        alcohol_g: item.alcohol_g,
        caffeine_mg: item.caffeine_mg,
        sort_order: item.sortOrder,
    };
}

export async function getMealsByDate(
    userId: string,
    date: string,
    tz: string = "UTC",
): Promise<Meal[]> {
    const startUtc = zonedDayStartUtc(date, tz);
    const endUtc = zonedNextDayStartUtc(date, tz);

    const meals = await run(async (tx) => {
        try {
            return await rows<Meal>(
                tx,
                tx`
                    select *
                    from ${tx.unsafe(MEALS)}
                    where user_id = ${userId}
                      and logged_at >= ${startUtc.toISOString()}
                      and logged_at < ${endUtc.toISOString()}
                    order by logged_at asc
                `,
            );
        } catch (err) {
            throw nutritionFailed("get meals", err);
        }
    });
    return attachMealItems(userId, meals);
}

export async function getMealsInRange(
    userId: string,
    startDate: string,
    endDate: string,
    tz: string = "UTC",
): Promise<Meal[]> {
    const startUtc = zonedDayStartUtc(startDate, tz);
    const endUtc = zonedNextDayStartUtc(endDate, tz);

    const meals = await run(async (tx) => {
        try {
            return await rows<Meal>(
                tx,
                tx`
                    select *
                    from ${tx.unsafe(MEALS)}
                    where user_id = ${userId}
                      and logged_at >= ${startUtc.toISOString()}
                      and logged_at < ${endUtc.toISOString()}
                    order by logged_at asc
                `,
            );
        } catch (err) {
            throw nutritionFailed("get meals", err);
        }
    });
    return attachMealItems(userId, meals);
}

/**
 * How many meal rows this user already has. Used by bulk import to bound total
 * growth: rate limiting is per HTTP request, so one batched call writes many
 * rows for a single limiter hit.
 */
export async function countMeals(userId: string): Promise<number> {
    return run(async (tx) => countForUser(tx, MEALS, userId, "count meals"));
}

/**
 * Which of `keys` are already present for this user. Lets a dry-run import
 * predict deduplication instead of promising creates that will not happen.
 */
export async function existingIdempotencyKeys(
    userId: string,
    keys: string[],
): Promise<Set<string>> {
    if (keys.length === 0) return new Set();

    const data = await run(async (tx) => {
        try {
            return await rows<{ idempotency_key: string | null }>(
                tx,
                tx`
                    select idempotency_key
                    from ${tx.unsafe(MEALS)}
                    where user_id = ${userId}
                      and idempotency_key = any(${tx.array(keys, "text")})
                `,
            );
        } catch (err) {
            throw nutritionFailed("check existing meals", err);
        }
    });
    return new Set(
        data
            .map((r) => r.idempotency_key)
            .filter((k): k is string => k !== null),
    );
}

/** Postgres casts every element of an `in (...)` list against the column type,
 *  so one non-uuid id would fail the entire lookup — and with it the whole
 *  import — rather than simply not matching. Filter before querying. */
const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which of `ids` are meals this user already has. An export of this server's
 * own data carries each meal's id, so a re-import can recognize the meals it
 * describes instead of writing a second copy of every one of them.
 *
 * Scoped by user_id, so another user's id is reported as absent and the row
 * imports as a new meal — never as a match against a row they cannot see.
 */
export async function existingMealIds(
    userId: string,
    ids: string[],
): Promise<Set<string>> {
    const uuids = ids.filter((id) => UUID_RE.test(id));
    if (uuids.length === 0) return new Set();

    const data = await run(async (tx) => {
        try {
            return await rows<{ id: string }>(
                tx,
                tx`
                    select id
                    from ${tx.unsafe(MEALS)}
                    where user_id = ${userId}
                      and id = any(${tx.array(uuids, "uuid")})
                `,
            );
        } catch (err) {
            throw nutritionFailed("check existing meals", err);
        }
    });
    return new Set(data.map((r) => r.id.toLowerCase()));
}

/**
 * Fetch pages via `fetchPage(from, to)` (inclusive, 0-indexed) until a page
 * comes back shorter than `pageSize`. A plain unbounded select silently caps
 * at PostgREST's `db-max-rows` (default 1000), so any query that can return
 * more rows than that must page through `.range()` instead of relying on one
 * request to return everything.
 */
export async function fetchAllPages<T>(
    fetchPage: (from: number, to: number) => Promise<T[]>,
    pageSize = 1000,
): Promise<T[]> {
    const all: T[] = [];
    for (let from = 0; ; from += pageSize) {
        const page = await fetchPage(from, from + pageSize - 1);
        all.push(...page);
        if (page.length < pageSize) break;
    }
    return all;
}

/**
 * All of a user's meals, oldest first — used by export_all_data. Pages through
 * `.range()` (see `fetchAllPages`) rather than one unbounded select, since a
 * user can have up to MAX_MEALS_PER_USER (200,000) meals, far past the
 * PostgREST row cap. `id` is a secondary sort key so rows sharing a
 * `logged_at` timestamp still get a stable order across page boundaries —
 * without it, ties straddling a page edge could be skipped or duplicated.
 * Reconciles the fetched total against `countMeals` (an independent exact
 * count) so a truncated result throws instead of silently exporting less
 * than the user has.
 */
export async function getAllMeals(userId: string): Promise<Meal[]> {
    const expected = await countMeals(userId);
    if (expected === 0) return [];

    const meals = await fetchAllPages<Meal>(async (from, to) => {
        const limit = to - from + 1;
        return run(async (tx) => {
            try {
                return await rows<Meal>(
                    tx,
                    tx`
                        select *
                        from ${tx.unsafe(MEALS)}
                        where user_id = ${userId}
                        order by logged_at asc, id asc
                        offset ${from}
                        limit ${limit}
                    `,
                );
            } catch (err) {
                throw nutritionFailed("get meals", err);
            }
        });
    });

    if (meals.length < expected) {
        throw new Error(
            `getAllMeals: fetched ${meals.length} meals but countMeals reported ${expected} — export would be truncated`,
        );
    }
    return meals;
}

// Keyword search over past meals. Each query string is an alternative (OR'd
// across, e.g. the same food in two languages); within one alternative every
// word token must match the column (AND'd via chained .ilike). We deliberately
// avoid PostgREST's .or() — its logic-tree grammar treats commas/parens inside
// values as structure and the old PostgREST client did not quote them — and
// instead run
// one cheap per-user query per (alternative × column) and merge in code.
async function searchMealsQuery(
    userId: string,
    tokens: string[],
    column: "description" | "notes",
    opts: { limit: number; sinceIso?: string },
): Promise<Meal[]> {
    return run(async (tx) => {
        try {
            const conditions: SQL.Query<unknown>[] = [tx`user_id = ${userId}`];
            if (opts.sinceIso) {
                conditions.push(tx`logged_at >= ${opts.sinceIso}`);
            }
            for (const token of tokens) {
                const pattern = `%${escapeLikePattern(token)}%`;
                if (column === "description") {
                    conditions.push(tx`description ilike ${pattern}`);
                } else {
                    conditions.push(tx`notes ilike ${pattern}`);
                }
            }
            const where = conditions.reduce(
                (acc, part, i) => (i === 0 ? part : tx`${acc} and ${part}`),
                conditions[0]!,
            );
            return await rows<Meal>(
                tx,
                tx`
                    select *
                    from ${tx.unsafe(MEALS)}
                    where ${where}
                    order by logged_at desc
                    limit ${opts.limit}
                `,
            );
        } catch (err) {
            throw nutritionFailed("search meals", err);
        }
    });
}

export async function searchMeals(
    userId: string,
    queries: string[],
    opts: { limit?: number; sinceIso?: string } = {},
): Promise<Meal[]> {
    const limit = opts.limit ?? 50;
    const tokenized = queries
        .map(tokenizeQuery)
        .filter((tokens) => tokens.length > 0);
    if (tokenized.length === 0) return [];

    const results = await Promise.all(
        tokenized.flatMap((tokens) => [
            searchMealsQuery(userId, tokens, "description", {
                limit,
                sinceIso: opts.sinceIso,
            }),
            searchMealsQuery(userId, tokens, "notes", {
                limit,
                sinceIso: opts.sinceIso,
            }),
        ]),
    );

    const seen = new Set<string>();
    const merged: Meal[] = [];
    for (const page of results) {
        for (const meal of page) {
            if (!seen.has(meal.id)) {
                seen.add(meal.id);
                merged.push(meal);
            }
        }
    }
    merged.sort((a, b) => b.logged_at.localeCompare(a.logged_at));
    return attachMealItems(userId, merged.slice(0, limit));
}

/** True when a row matched and was deleted; false when the id is unknown or
 *  belongs to another user — the handler must not claim success either way. */
export async function deleteMeal(userId: string, id: string): Promise<boolean> {
    return run(async (tx) => {
        try {
            const data = await rows<{ id: string }>(
                tx,
                tx`
                    delete from ${tx.unsafe(MEALS)}
                    where id = ${id}
                      and user_id = ${userId}
                    returning id
                `,
            );
            return data.length > 0;
        } catch (err) {
            throw nutritionFailed("delete meal", err);
        }
    });
}

export async function updateMeal(
    userId: string,
    id: string,
    fields: Partial<MealInput>,
): Promise<Meal> {
    return run(async (tx) => {
        let existing: Meal | null;
        try {
            existing = await maybeOne<Meal>(
                tx,
                tx`
                    select *
                    from ${tx.unsafe(MEALS)}
                    where id = ${id}
                      and user_id = ${userId}
                `,
                "update meal",
            );
        } catch (err) {
            throw nutritionFailed("update meal", err);
        }
        if (!existing) throw new Error("Failed to update meal: meal not found");

        const update: Record<string, unknown> = {};
        if (fields.description !== undefined)
            update.description = decodeEscapeSequences(fields.description);
        if (fields.meal_type !== undefined) update.meal_type = fields.meal_type;
        // Integer column — see toStoredInteger.
        if (fields.calories !== undefined)
            update.calories = toStoredInteger(fields.calories);
        if (fields.protein_g !== undefined) update.protein_g = fields.protein_g;
        if (fields.carbs_g !== undefined) update.carbs_g = fields.carbs_g;
        if (fields.fat_g !== undefined) update.fat_g = fields.fat_g;
        if (fields.fiber_g !== undefined) update.fiber_g = fields.fiber_g;
        if (fields.sugar_g !== undefined) update.sugar_g = fields.sugar_g;
        if (fields.alcohol_g !== undefined) update.alcohol_g = fields.alcohol_g;
        if (fields.caffeine_mg !== undefined)
            update.caffeine_mg = fields.caffeine_mg;
        if (fields.logged_at !== undefined) update.logged_at = fields.logged_at;
        if (fields.notes !== undefined)
            update.notes =
                fields.notes != null
                    ? decodeEscapeSequences(fields.notes)
                    : fields.notes;

        const newKey = updatedMealIdempotencyKey(userId, existing, fields);
        if (newKey !== null) update.idempotency_key = newKey;

        const { row: patch, keys } = definedColumns(update);
        let saved: Meal;
        try {
            if (keys.length === 0) {
                saved = existing;
            } else {
                saved = await one<Meal>(
                    tx,
                    tx`
                        update ${tx.unsafe(MEALS)} set ${tx(patch, ...patchKeys(keys))}
                        where id = ${id}
                          and user_id = ${userId}
                        returning *
                    `,
                    "update meal",
                );
            }
        } catch (err) {
            throw nutritionFailed("update meal", err);
        }

        if (fields.items) {
            saved.items = await replaceMealItemsInTx(
                tx,
                userId,
                saved.id,
                fields.items,
            );
        } else {
            saved.items = await listMealItemsInTx(tx, userId, [saved.id]);
        }
        return saved;
    });
}

// ---------- Nutrition goals ----------

export interface NutritionGoals {
    user_id: string;
    daily_calories: number | null;
    daily_protein_g: number | null;
    daily_carbs_g: number | null;
    daily_fat_g: number | null;
    daily_fiber_g: number | null;
    // Total sugars, and pure ethanol. Both are ceilings ("stay under"), unlike
    // every other goal here, which is a floor — see formatGoalLine in mcp.ts.
    daily_sugar_g: number | null;
    daily_alcohol_g: number | null;
    // Milligrams, and a ceiling too — 0 means "none". numeric(7,2) in the DB,
    // since mg targets run three orders larger than the gram ones above.
    daily_caffeine_mg: number | null;
    daily_water_ml: number | null;
    target_weight_g: number | null;
    updated_at: string;
}

export interface NutritionGoalsInput {
    daily_calories?: number | null;
    daily_protein_g?: number | null;
    daily_carbs_g?: number | null;
    daily_fat_g?: number | null;
    daily_fiber_g?: number | null;
    daily_sugar_g?: number | null;
    daily_alcohol_g?: number | null;
    daily_caffeine_mg?: number | null;
    daily_water_ml?: number | null;
    target_weight_g?: number | null;
}

/** Per-day override writes omit target_weight_g (defaults-only). */
export type NutritionGoalDayInput = Omit<
    NutritionGoalsInput,
    "target_weight_g"
>;

function assertCalendarDates(dates: readonly string[], context: string): void {
    for (const date of dates) {
        if (!isCalendarDate(date)) {
            throw new Error(`${context}: invalid calendar date ${date}`);
        }
    }
}

function goalDayStoredValue(
    field: GoalDayField,
    value: number | null | undefined,
): number | null {
    if (value == null) return null;
    if (field === "daily_calories" || field === "daily_water_ml") {
        return toStoredInteger(value);
    }
    return value;
}

function goalDayOverrideAllNull(
    row: Record<GoalDayField, number | null>,
): boolean {
    return GOAL_DAY_FIELDS.every((f) => row[f] == null);
}

export async function upsertNutritionGoals(
    userId: string,
    input: NutritionGoalsInput,
): Promise<NutritionGoals> {
    const payload: Record<string, unknown> = {
        user_id: userId,
        updated_at: new Date().toISOString(),
    };
    if (input.daily_calories !== undefined) {
        payload.daily_calories =
            input.daily_calories == null
                ? null
                : toStoredInteger(input.daily_calories);
    }
    if (input.daily_protein_g !== undefined)
        payload.daily_protein_g = input.daily_protein_g;
    if (input.daily_carbs_g !== undefined)
        payload.daily_carbs_g = input.daily_carbs_g;
    if (input.daily_fat_g !== undefined)
        payload.daily_fat_g = input.daily_fat_g;
    if (input.daily_fiber_g !== undefined)
        payload.daily_fiber_g = input.daily_fiber_g;
    if (input.daily_sugar_g !== undefined)
        payload.daily_sugar_g = input.daily_sugar_g;
    if (input.daily_alcohol_g !== undefined)
        payload.daily_alcohol_g = input.daily_alcohol_g;
    if (input.daily_caffeine_mg !== undefined)
        payload.daily_caffeine_mg = input.daily_caffeine_mg;
    if (input.daily_water_ml !== undefined) {
        payload.daily_water_ml =
            input.daily_water_ml == null
                ? null
                : toStoredInteger(input.daily_water_ml);
    }
    if (input.target_weight_g !== undefined)
        payload.target_weight_g = input.target_weight_g;

    return run(async (tx) => {
        const { row, keys } = definedColumns(payload);
        const updateKeys = keys.filter((k) => k !== "user_id");
        const setClause = updateKeys
            .map((k) => `${k} = excluded.${k}`)
            .join(", ");
        try {
            return await one<NutritionGoals>(
                tx,
                tx`
                    insert into ${tx.unsafe(NUTRITION_GOALS)} ${tx(row, ...patchKeys(keys))}
                    on conflict (user_id) do update set ${tx.unsafe(setClause)}
                    returning *
                `,
                "save goals",
            );
        } catch (err) {
            throw nutritionFailed("save goals", err);
        }
    });
}

async function fetchNutritionGoals(
    tx: Tx,
    userId: string,
): Promise<NutritionGoals | null> {
    return await maybeOne<NutritionGoals>(
        tx,
        tx`
            select *
            from ${tx.unsafe(NUTRITION_GOALS)}
            where user_id = ${userId}
        `,
        "get goals",
    );
}

export async function getNutritionGoals(
    userId: string,
): Promise<NutritionGoals | null> {
    return run(async (tx) => {
        try {
            return await fetchNutritionGoals(tx, userId);
        } catch (err) {
            throw nutritionFailed("get goals", err);
        }
    });
}

export async function upsertGoalDays(
    userId: string,
    householdId: string,
    dates: string[],
    input: NutritionGoalDayInput,
): Promise<GoalDayOverride[]> {
    assertCalendarDates(dates, "upsert goal days");
    // Only the fields the caller gave are written, in one statement per day,
    // so two overlapping partial updates of the same day both survive (a
    // read-merge-write would let the later call put back the earlier one's
    // stale values).
    const provided = GOAL_DAY_FIELDS.filter((f) => input[f] !== undefined);
    const uniqueDates = [...new Set(dates)];
    if (provided.length === 0 || uniqueDates.length === 0) return [];
    const allNull = GOAL_DAY_FIELDS.map((f) => `${f} is null`).join(" and ");
    return run(async (tx) => {
        const saved: GoalDayOverride[] = [];
        try {
            for (const date of uniqueDates) {
                const payload: Record<string, unknown> = {
                    household_id: householdId,
                    user_id: userId,
                    date,
                    updated_at: new Date().toISOString(),
                };
                for (const field of provided) {
                    payload[field] = goalDayStoredValue(field, input[field]);
                }
                const keys = Object.keys(payload);
                const setClause = [...provided, "updated_at"]
                    .map((k) => `${k} = excluded.${k}`)
                    .join(", ");
                const written = await one<Record<string, unknown>>(
                    tx,
                    tx`
                        insert into ${tx.unsafe(NUTRITION_GOAL_DAYS)} ${tx(payload, ...patchKeys(keys))}
                        on conflict (household_id, user_id, date) do update
                        set ${tx.unsafe(setClause)}
                        returning *
                    `,
                    "upsert goal day",
                );
                const row = goalDayFromRow(written);
                if (goalDayOverrideAllNull(row)) {
                    // An override with every field cleared means "use the
                    // defaults", the same as no row at all.
                    await tx`
                        delete from ${tx.unsafe(NUTRITION_GOAL_DAYS)}
                        where
                            household_id = ${householdId}
                            and user_id = ${userId}
                            and date = ${date}::date
                            and ${tx.unsafe(allNull)}
                    `;
                    continue;
                }
                saved.push(row);
            }
            return saved;
        } catch (err) {
            throw nutritionFailed("upsert goal days", err);
        }
    });
}

export async function clearGoalDays(
    userId: string,
    householdId: string,
    dates: string[],
): Promise<number> {
    assertCalendarDates(dates, "clear goal days");
    if (dates.length === 0) return 0;
    return run(async (tx) => {
        try {
            const deleted = await rows<{ id: string }>(
                tx,
                tx`
                    delete from ${tx.unsafe(NUTRITION_GOAL_DAYS)}
                    where
                        household_id = ${householdId}
                        and user_id = ${userId}
                        and date::text = any(${tx.array(dates, "text")})
                    returning id
                `,
            );
            return deleted.length;
        } catch (err) {
            throw nutritionFailed("clear goal days", err);
        }
    });
}

/**
 * How many per-day goal overrides this user has. Independent exact count, used
 * by `getAllGoalDays` to prove the paged fetch came back whole.
 */
export async function countGoalDays(userId: string): Promise<number> {
    return run(async (tx) =>
        countForUser(tx, NUTRITION_GOAL_DAYS, userId, "count goal days"),
    );
}

/**
 * All of a user's per-day goal overrides, sorted by calendar date — used by
 * export_all_data. Pages through `fetchAllPages` for consistency with the other
 * export readers. `id` is a secondary sort key so rows sharing a date still get
 * a stable order across page boundaries. Reconciles the fetched total against
 * `countGoalDays` so a truncated result throws instead of silently exporting
 * less than the user has.
 */
export async function getAllGoalDays(
    userId: string,
): Promise<GoalDayOverride[]> {
    const expected = await countGoalDays(userId);
    if (expected === 0) return [];

    const raw = await fetchAllPages<Record<string, unknown>>(
        async (from, to) => {
            const limit = to - from + 1;
            return run(async (tx) => {
                try {
                    return await rows<Record<string, unknown>>(
                        tx,
                        tx`
                        select *
                        from ${tx.unsafe(NUTRITION_GOAL_DAYS)}
                        where user_id = ${userId}
                        order by date asc, id asc
                        offset ${from}
                        limit ${limit}
                    `,
                    );
                } catch (err) {
                    throw nutritionFailed("get goal days", err);
                }
            });
        },
    );

    const goalDays = raw.map(goalDayFromRow);
    if (goalDays.length < expected) {
        throw new Error(
            `getAllGoalDays: fetched ${goalDays.length} rows but countGoalDays reported ${expected} — export would be truncated`,
        );
    }
    return goalDays;
}

export const pgGoalDayStore: GoalDayStore = {
    overrideForDate(userId, date) {
        if (!isCalendarDate(date)) return Promise.resolve(null);
        return run(async (tx) => {
            try {
                const row = await maybeOne<Record<string, unknown>>(
                    tx,
                    tx`
                        select *
                        from ${tx.unsafe(NUTRITION_GOAL_DAYS)}
                        where user_id = ${userId} and date = ${date}::date
                    `,
                    "get goal day",
                );
                return row ? goalDayFromRow(row) : null;
            } catch (err) {
                throw nutritionFailed("get goal day", err);
            }
        });
    },
    overridesInRange(userId, startDate, endDate) {
        if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) {
            return Promise.resolve([]);
        }
        return run(async (tx) => {
            try {
                const list = await rows<Record<string, unknown>>(
                    tx,
                    tx`
                        select *
                        from ${tx.unsafe(NUTRITION_GOAL_DAYS)}
                        where
                            user_id = ${userId}
                            and date between ${startDate}::date and ${endDate}::date
                        order by date
                    `,
                );
                return list.map(goalDayFromRow);
            } catch (err) {
                throw nutritionFailed("get goal days", err);
            }
        });
    },
};

export async function getGoalsForDate(
    userId: string,
    date: string,
): Promise<NutritionGoals | null> {
    const defaults = await getNutritionGoals(userId);
    if (!isCalendarDate(date)) {
        return goalsForDate(defaults, [], date);
    }
    const override = await pgGoalDayStore.overrideForDate(userId, date);
    return goalsForDate(defaults, override ? [override] : [], date);
}

export async function getGoalsForRange(
    userId: string,
    startDate: string,
    endDate: string,
): Promise<{ defaults: NutritionGoals | null; forDate: GoalsByDate }> {
    const defaults = await getNutritionGoals(userId);
    if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) {
        return { defaults, forDate: goalsResolver(defaults, []) };
    }
    const overrides = await pgGoalDayStore.overridesInRange(
        userId,
        startDate,
        endDate,
    );
    return {
        defaults,
        forDate: goalsResolver(defaults, overrides),
    };
}

// ---------- Water log ----------

export interface WaterEntry {
    id: string;
    user_id: string;
    amount_ml: number;
    logged_at: string;
    notes: string | null;
    created_at: string;
    idempotency_key: string | null;
}

export interface WaterInput {
    amount_ml: number;
    logged_at?: string;
    notes?: string;
    idempotency_key?: string;
}

export interface WaterInsertResult {
    entry: WaterEntry;
    deduplicated: boolean;
}

export async function insertWater(
    userId: string,
    input: WaterInput,
): Promise<WaterInsertResult> {
    // Resolve logged_at once so the digest and the persisted row agree.
    const loggedAt = input.logged_at ?? new Date().toISOString();
    // Always populate the key: use the client's if given, otherwise derive a
    // stable one from the request content (see deriveIdempotencyKey).
    const idempotencyKey =
        input.idempotency_key ??
        deriveIdempotencyKey([userId, input.amount_ml, input.notes, loggedAt]);

    return run(async (tx) => {
        let existing: WaterEntry | null;
        try {
            existing = await maybeOne<WaterEntry>(
                tx,
                tx`
                    select *
                    from ${tx.unsafe(WATER_LOG)}
                    where user_id = ${userId}
                      and idempotency_key = ${idempotencyKey}
                `,
                "look up water",
            );
        } catch (err) {
            throw nutritionFailed("look up water", err);
        }
        if (existing) return { entry: existing, deduplicated: true };

        const payload = {
            user_id: userId,
            amount_ml: input.amount_ml,
            logged_at: loggedAt,
            notes: input.notes ?? null,
            idempotency_key: idempotencyKey,
        };

        try {
            const entry = await tx.savepoint(async (sp) =>
                insertReturning<WaterEntry>(
                    sp as Tx,
                    WATER_LOG,
                    payload,
                    "*",
                    "insert water",
                ),
            );
            return { entry, deduplicated: false };
        } catch (err) {
            if (sqlState(err) === "23505") {
                let raced: WaterEntry | null;
                try {
                    raced = await maybeOne<WaterEntry>(
                        tx,
                        tx`
                            select *
                            from ${tx.unsafe(WATER_LOG)}
                            where user_id = ${userId}
                              and idempotency_key = ${idempotencyKey}
                        `,
                        "resolve idempotent water",
                    );
                } catch (raceErr) {
                    throw nutritionFailed("resolve idempotent water", raceErr);
                }
                if (raced) return { entry: raced, deduplicated: true };
            }
            if (
                err instanceof Error &&
                err.message.startsWith("Failed to insert water:")
            ) {
                throw err;
            }
            throw nutritionFailed("insert water", err);
        }
    });
}

export async function getWaterByDate(
    userId: string,
    date: string,
    tz: string = "UTC",
): Promise<WaterEntry[]> {
    const startUtc = zonedDayStartUtc(date, tz);
    const endUtc = zonedNextDayStartUtc(date, tz);

    return run(async (tx) => {
        try {
            return await rows<WaterEntry>(
                tx,
                tx`
                    select *
                    from ${tx.unsafe(WATER_LOG)}
                    where user_id = ${userId}
                      and logged_at >= ${startUtc.toISOString()}
                      and logged_at < ${endUtc.toISOString()}
                    order by logged_at asc
                `,
            );
        } catch (err) {
            throw nutritionFailed("get water", err);
        }
    });
}

export async function getWaterInRange(
    userId: string,
    startDate: string,
    endDate: string,
    tz: string = "UTC",
): Promise<WaterEntry[]> {
    const startUtc = zonedDayStartUtc(startDate, tz);
    const endUtc = zonedNextDayStartUtc(endDate, tz);

    return run(async (tx) => {
        try {
            return await rows<WaterEntry>(
                tx,
                tx`
                    select *
                    from ${tx.unsafe(WATER_LOG)}
                    where user_id = ${userId}
                      and logged_at >= ${startUtc.toISOString()}
                      and logged_at < ${endUtc.toISOString()}
                    order by logged_at asc
                `,
            );
        } catch (err) {
            throw nutritionFailed("get water", err);
        }
    });
}

/**
 * How many water rows this user already has. Independent exact count, used by
 * `getAllWater` to prove the paged fetch came back whole.
 */
export async function countWater(userId: string): Promise<number> {
    return run(async (tx) =>
        countForUser(tx, WATER_LOG, userId, "count water"),
    );
}

/**
 * All of a user's water entries, oldest first — used by export_all_data. Pages
 * through `.range()` (see `fetchAllPages`) rather than one unbounded select,
 * since a heavy logger blows past PostgREST's 1000-row cap. `id` is a secondary
 * sort key so rows sharing a `logged_at` timestamp still get a stable order
 * across page boundaries — without it, ties straddling a page edge could be
 * skipped or duplicated. Reconciles the fetched total against `countWater` so a
 * truncated result throws instead of silently exporting less than the user has.
 */
export async function getAllWater(userId: string): Promise<WaterEntry[]> {
    const expected = await countWater(userId);
    if (expected === 0) return [];

    const entries = await fetchAllPages<WaterEntry>(async (from, to) => {
        const limit = to - from + 1;
        return run(async (tx) => {
            try {
                return await rows<WaterEntry>(
                    tx,
                    tx`
                        select *
                        from ${tx.unsafe(WATER_LOG)}
                        where user_id = ${userId}
                        order by logged_at asc, id asc
                        offset ${from}
                        limit ${limit}
                    `,
                );
            } catch (err) {
                throw nutritionFailed("get water", err);
            }
        });
    });

    if (entries.length < expected) {
        throw new Error(
            `getAllWater: fetched ${entries.length} entries but countWater reported ${expected} — export would be truncated`,
        );
    }
    return entries;
}

/** True when a row matched and was deleted; see deleteMeal. */
export async function deleteWater(
    userId: string,
    id: string,
): Promise<boolean> {
    return run(async (tx) => {
        try {
            const data = await rows<{ id: string }>(
                tx,
                tx`
                    delete from ${tx.unsafe(WATER_LOG)}
                    where id = ${id}
                      and user_id = ${userId}
                    returning id
                `,
            );
            return data.length > 0;
        } catch (err) {
            throw nutritionFailed("delete water", err);
        }
    });
}

// ---------- Weight log ----------

export interface WeightEntry {
    id: string;
    user_id: string;
    weight_g: number;
    logged_at: string;
    notes: string | null;
    created_at: string;
    idempotency_key: string | null;
}

export interface WeightInput {
    weight_g: number;
    logged_at?: string;
    notes?: string;
    idempotency_key?: string;
}

export interface WeightInsertResult {
    entry: WeightEntry;
    deduplicated: boolean;
}

export async function insertWeight(
    userId: string,
    input: WeightInput,
): Promise<WeightInsertResult> {
    // Resolve logged_at once so the digest and the persisted row agree.
    const loggedAt = input.logged_at ?? new Date().toISOString();
    // Always populate the key: use the client's if given, otherwise derive a
    // stable one from the request content (see deriveIdempotencyKey).
    const idempotencyKey =
        input.idempotency_key ??
        deriveIdempotencyKey([userId, input.weight_g, input.notes, loggedAt]);

    return run(async (tx) => {
        let existing: WeightEntry | null;
        try {
            existing = await maybeOne<WeightEntry>(
                tx,
                tx`
                    select *
                    from ${tx.unsafe(WEIGHT_LOG)}
                    where user_id = ${userId}
                      and idempotency_key = ${idempotencyKey}
                `,
                "look up weight",
            );
        } catch (err) {
            throw nutritionFailed("look up weight", err);
        }
        if (existing) return { entry: existing, deduplicated: true };

        const payload = {
            user_id: userId,
            weight_g: input.weight_g,
            logged_at: loggedAt,
            notes: input.notes ?? null,
            idempotency_key: idempotencyKey,
        };

        try {
            const entry = await tx.savepoint(async (sp) =>
                insertReturning<WeightEntry>(
                    sp as Tx,
                    WEIGHT_LOG,
                    payload,
                    "*",
                    "insert weight",
                ),
            );
            return { entry, deduplicated: false };
        } catch (err) {
            if (sqlState(err) === "23505") {
                let raced: WeightEntry | null;
                try {
                    raced = await maybeOne<WeightEntry>(
                        tx,
                        tx`
                            select *
                            from ${tx.unsafe(WEIGHT_LOG)}
                            where user_id = ${userId}
                              and idempotency_key = ${idempotencyKey}
                        `,
                        "resolve idempotent weight",
                    );
                } catch (raceErr) {
                    throw nutritionFailed("resolve idempotent weight", raceErr);
                }
                if (raced) return { entry: raced, deduplicated: true };
            }
            if (
                err instanceof Error &&
                err.message.startsWith("Failed to insert weight:")
            ) {
                throw err;
            }
            throw nutritionFailed("insert weight", err);
        }
    });
}

export async function getWeightByDate(
    userId: string,
    date: string,
    tz: string = "UTC",
): Promise<WeightEntry[]> {
    const startUtc = zonedDayStartUtc(date, tz);
    const endUtc = zonedNextDayStartUtc(date, tz);

    return run(async (tx) => {
        try {
            return await rows<WeightEntry>(
                tx,
                tx`
                    select *
                    from ${tx.unsafe(WEIGHT_LOG)}
                    where user_id = ${userId}
                      and logged_at >= ${startUtc.toISOString()}
                      and logged_at < ${endUtc.toISOString()}
                    order by logged_at asc
                `,
            );
        } catch (err) {
            throw nutritionFailed("get weight", err);
        }
    });
}

export async function getWeightInRange(
    userId: string,
    startDate: string,
    endDate: string,
    tz: string = "UTC",
): Promise<WeightEntry[]> {
    const startUtc = zonedDayStartUtc(startDate, tz);
    const endUtc = zonedNextDayStartUtc(endDate, tz);

    return run(async (tx) => {
        try {
            return await rows<WeightEntry>(
                tx,
                tx`
                    select *
                    from ${tx.unsafe(WEIGHT_LOG)}
                    where user_id = ${userId}
                      and logged_at >= ${startUtc.toISOString()}
                      and logged_at < ${endUtc.toISOString()}
                    order by logged_at asc
                `,
            );
        } catch (err) {
            throw nutritionFailed("get weight", err);
        }
    });
}

/**
 * How many weight rows this user already has. Independent exact count, used by
 * `getAllWeight` to prove the paged fetch came back whole.
 */
export async function countWeight(userId: string): Promise<number> {
    return run(async (tx) =>
        countForUser(tx, WEIGHT_LOG, userId, "count weight"),
    );
}

/**
 * All of a user's weight entries, oldest first — used by export_all_data. Pages
 * through `.range()` (see `fetchAllPages`) rather than one unbounded select,
 * since years of daily weigh-ins outrun PostgREST's 1000-row cap. `id` is a
 * secondary sort key so rows sharing a `logged_at` timestamp still get a stable
 * order across page boundaries — without it, ties straddling a page edge could
 * be skipped or duplicated. Reconciles the fetched total against `countWeight`
 * so a truncated result throws instead of silently exporting less than the user
 * has.
 */
export async function getAllWeight(userId: string): Promise<WeightEntry[]> {
    const expected = await countWeight(userId);
    if (expected === 0) return [];

    const entries = await fetchAllPages<WeightEntry>(async (from, to) => {
        const limit = to - from + 1;
        return run(async (tx) => {
            try {
                return await rows<WeightEntry>(
                    tx,
                    tx`
                        select *
                        from ${tx.unsafe(WEIGHT_LOG)}
                        where user_id = ${userId}
                        order by logged_at asc, id asc
                        offset ${from}
                        limit ${limit}
                    `,
                );
            } catch (err) {
                throw nutritionFailed("get weight", err);
            }
        });
    });

    if (entries.length < expected) {
        throw new Error(
            `getAllWeight: fetched ${entries.length} entries but countWeight reported ${expected} — export would be truncated`,
        );
    }
    return entries;
}

/** Most recent weight entry overall, or null if none logged. */
export async function getLatestWeight(
    userId: string,
): Promise<WeightEntry | null> {
    return run(async (tx) => {
        try {
            return await maybeOne<WeightEntry>(
                tx,
                tx`
                    select *
                    from ${tx.unsafe(WEIGHT_LOG)}
                    where user_id = ${userId}
                    order by logged_at desc
                    limit 1
                `,
                "get latest weight",
            );
        } catch (err) {
            throw nutritionFailed("get latest weight", err);
        }
    });
}

export async function updateWeight(
    userId: string,
    id: string,
    fields: { weight_g?: number; logged_at?: string; notes?: string | null },
): Promise<WeightEntry> {
    const update: Record<string, unknown> = {};
    if (fields.weight_g !== undefined) update.weight_g = fields.weight_g;
    if (fields.logged_at !== undefined) update.logged_at = fields.logged_at;
    if (fields.notes !== undefined)
        update.notes =
            fields.notes != null
                ? decodeEscapeSequences(fields.notes)
                : fields.notes;

    // No `.single()` here (unlike updateMeal, which pre-checks existence in a
    // separate query): a stale/wrong/other-user's id then matches zero rows,
    // which `.select()` reports as an empty array rather than PostgREST's
    // opaque "JSON object requested, multiple (or no) rows returned" — one
    // round trip, and no window between a check and the update itself where
    // a concurrent delete could reintroduce that same opaque error.
    return run(async (tx) => {
        const { row: patch, keys } = definedColumns(update);
        try {
            if (keys.length === 0) {
                const existing = await maybeOne<WeightEntry>(
                    tx,
                    tx`
                        select *
                        from ${tx.unsafe(WEIGHT_LOG)}
                        where id = ${id}
                          and user_id = ${userId}
                    `,
                    "update weight",
                );
                if (!existing)
                    throw new Error("Failed to update weight: entry not found");
                return existing;
            }
            const data = await rows<WeightEntry>(
                tx,
                tx`
                    update ${tx.unsafe(WEIGHT_LOG)} set ${tx(patch, ...patchKeys(keys))}
                    where id = ${id}
                      and user_id = ${userId}
                    returning *
                `,
            );
            if (data.length === 0)
                throw new Error("Failed to update weight: entry not found");
            return data[0]!;
        } catch (err) {
            if (
                err instanceof Error &&
                err.message === "Failed to update weight: entry not found"
            ) {
                throw err;
            }
            throw nutritionFailed("update weight", err);
        }
    });
}

/** Returns true if an entry was deleted, false if no matching row was found. */
export async function deleteWeight(
    userId: string,
    id: string,
): Promise<boolean> {
    return run(async (tx) => {
        try {
            const data = await rows<{ id: string }>(
                tx,
                tx`
                    delete from ${tx.unsafe(WEIGHT_LOG)}
                    where id = ${id}
                      and user_id = ${userId}
                    returning id
                `,
            );
            return data.length > 0;
        } catch (err) {
            throw nutritionFailed("delete weight", err);
        }
    });
}

// ---------- Delete all user data ----------

export type DeleteAllUserDataDeps = {
    auth?: { deleteUser: (userId: string) => Promise<void> };
};

export async function deleteAllUserData(
    userId: string,
    deps?: DeleteAllUserDataDeps,
): Promise<void> {
    // export_archives rows cascade from public.users on delete, so they need no
    // separate step. public.users is deleted last inside the transaction, after
    // the four no-action tables, so FK checks still pass.

    await run(async (tx) => {
        const deleteUserRows = async (
            table: string,
            context: string,
        ): Promise<void> => {
            try {
                await tx`
                    delete from ${tx.unsafe(table)}
                    where user_id = ${userId}
                `;
            } catch (err) {
                throw nutritionFailed(context, err);
            }
        };

        await deleteUserRows("tool_analytics", "delete analytics");
        await deleteUserRows(WATER_LOG, "delete water log");
        await deleteUserRows(WEIGHT_LOG, "delete weight log");
        await deleteUserRows(NUTRITION_GOALS, "delete goals");
        await deleteUserRows("profiles", "delete profile");
        // recipe_portions.user_id carries no foreign key, so the auth delete below
        // would leave these rows behind. The recipes themselves are household
        // data and stay.
        await deleteUserRows("recipe_portions", "delete recipe portions");
        await deleteUserRows(MEALS, "delete meals");
        await deleteUserRows("oauth_tokens", "delete tokens");
        await deleteUserRows("refresh_tokens", "delete refresh tokens");
        await deleteUserRows("auth_codes", "delete auth codes");

        if (deps?.auth) {
            await deps.auth.deleteUser(userId);
            return;
        }
        const deleted = await deleteAuthUser(userId, tx);
        if (!deleted) {
            throw new Error("Failed to delete user: User not found");
        }
    });
}
