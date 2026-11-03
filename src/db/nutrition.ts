import { zonedDayStartUtc, zonedNextDayStartUtc } from "../domain/tz.js";
import { decodeEscapeSequences } from "../normalize.js";
import { toStoredInteger } from "../domain/units.js";
import { escapeLikePattern, tokenizeQuery } from "../search.js";
import { liveExportArchiveStore } from "./exports.js";
import { getSupabase } from "./client.js";

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
 * src/supabase.test.ts — exactly as rowContentDigest is in src/import.ts.
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
    // of this array is rowContentDigest in src/import.ts, which carries the
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
    const sb = getSupabase();

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

    const { data: existing, error: selErr } = await sb
        .from("meals")
        .select("*")
        .eq("user_id", userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
    if (selErr) throw new Error(`Failed to look up meal: ${selErr.message}`);
    if (existing) {
        const found = existing as Meal;
        found.items = await listMealItems(userId, [found.id]);
        return { meal: found, deduplicated: true };
    }

    const { data, error } = await sb
        .from("meals")
        .insert({
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
        })
        .select()
        .single();

    if (error) {
        // Concurrent retry with the same idempotency key — the other request
        // already inserted the row. Fetch and return it instead of failing.
        if (error.code === "23505") {
            const { data: raced, error: raceErr } = await sb
                .from("meals")
                .select("*")
                .eq("user_id", userId)
                .eq("idempotency_key", idempotencyKey)
                .maybeSingle();
            if (raceErr)
                throw new Error(
                    `Failed to resolve idempotent meal: ${raceErr.message}`,
                );
            if (raced) {
                const found = raced as Meal;
                found.items = await listMealItems(userId, [found.id]);
                return { meal: found, deduplicated: true };
            }
        }
        throw new Error(`Failed to insert meal: ${error.message}`);
    }
    const saved = data as Meal;
    if (input.items && input.items.length > 0) {
        await replaceMealItems(userId, saved.id, input.items);
        saved.items = await listMealItems(userId, [saved.id]);
    }
    return { meal: saved, deduplicated: false };
}

const MEAL_ITEM_COLS =
    "id, meal_id, user_id, household_id, food_id, recipe_id, label, amount, unit, grams, portions, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, alcohol_g, caffeine_mg, sort_order, created_at";

export async function listMealItems(
    userId: string,
    mealIds: string[],
): Promise<MealItem[]> {
    if (mealIds.length === 0) return [];
    const { data, error } = await getSupabase()
        .from("meal_items")
        .select(MEAL_ITEM_COLS)
        .eq("user_id", userId)
        .in("meal_id", mealIds)
        .order("sort_order", { ascending: true });
    if (error) throw new Error(`Failed to list meal items: ${error.message}`);
    return (data as MealItem[]) ?? [];
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

export async function replaceMealItems(
    userId: string,
    mealId: string,
    items: MealItemWrite[],
): Promise<MealItem[]> {
    const sb = getSupabase();
    const { error: delErr } = await sb
        .from("meal_items")
        .delete()
        .eq("user_id", userId)
        .eq("meal_id", mealId);
    if (delErr)
        throw new Error(`Failed to replace meal items: ${delErr.message}`);
    if (items.length === 0) return [];
    const { data, error } = await sb
        .from("meal_items")
        .insert(
            items.map((item, index) => ({
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
            })),
        )
        .select(MEAL_ITEM_COLS)
        .order("sort_order", { ascending: true });
    if (error) throw new Error(`Failed to insert meal items: ${error.message}`);
    return (data as MealItem[]) ?? [];
}

export async function countMealItems(userId: string): Promise<number> {
    const { count, error } = await getSupabase()
        .from("meal_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
    if (error) throw new Error(`Failed to count meal items: ${error.message}`);
    return count ?? 0;
}

export async function getAllMealItems(userId: string): Promise<MealItem[]> {
    const expected = await countMealItems(userId);
    if (expected === 0) return [];
    const items = await fetchAllPages<MealItem>(async (from, to) => {
        const { data, error } = await getSupabase()
            .from("meal_items")
            .select(MEAL_ITEM_COLS)
            .eq("user_id", userId)
            .order("meal_id", { ascending: true })
            .order("sort_order", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to);
        if (error)
            throw new Error(`Failed to get meal items: ${error.message}`);
        return (data as MealItem[]) ?? [];
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

    const { data, error } = await getSupabase()
        .from("meals")
        .select("*")
        .eq("user_id", userId)
        .gte("logged_at", startUtc.toISOString())
        .lt("logged_at", endUtc.toISOString())
        .order("logged_at", { ascending: true });

    if (error) throw new Error(`Failed to get meals: ${error.message}`);
    return attachMealItems(userId, (data as Meal[]) ?? []);
}

export async function getMealsInRange(
    userId: string,
    startDate: string,
    endDate: string,
    tz: string = "UTC",
): Promise<Meal[]> {
    const startUtc = zonedDayStartUtc(startDate, tz);
    const endUtc = zonedNextDayStartUtc(endDate, tz);

    const { data, error } = await getSupabase()
        .from("meals")
        .select("*")
        .eq("user_id", userId)
        .gte("logged_at", startUtc.toISOString())
        .lt("logged_at", endUtc.toISOString())
        .order("logged_at", { ascending: true });

    if (error) throw new Error(`Failed to get meals: ${error.message}`);
    return attachMealItems(userId, (data as Meal[]) ?? []);
}

/**
 * How many meal rows this user already has. Used by bulk import to bound total
 * growth: rate limiting is per HTTP request, so one batched call writes many
 * rows for a single limiter hit.
 */
export async function countMeals(userId: string): Promise<number> {
    const { count, error } = await getSupabase()
        .from("meals")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);

    if (error) throw new Error(`Failed to count meals: ${error.message}`);
    return count ?? 0;
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

    const { data, error } = await getSupabase()
        .from("meals")
        .select("idempotency_key")
        .eq("user_id", userId)
        .in("idempotency_key", keys);

    if (error) {
        throw new Error(`Failed to check existing meals: ${error.message}`);
    }
    return new Set(
        ((data as { idempotency_key: string | null }[]) ?? [])
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

    const { data, error } = await getSupabase()
        .from("meals")
        .select("id")
        .eq("user_id", userId)
        .in("id", uuids);

    if (error) {
        throw new Error(`Failed to check existing meals: ${error.message}`);
    }
    return new Set(
        ((data as { id: string }[]) ?? []).map((r) => r.id.toLowerCase()),
    );
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
        const { data, error } = await getSupabase()
            .from("meals")
            .select("*")
            .eq("user_id", userId)
            .order("logged_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to);

        if (error) throw new Error(`Failed to get meals: ${error.message}`);
        return (data as Meal[]) ?? [];
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
// values as structure and supabase-js does not quote them — and instead run
// one cheap per-user query per (alternative × column) and merge in code.
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

    const buildQuery = (tokens: string[], column: "description" | "notes") => {
        let q = getSupabase().from("meals").select("*").eq("user_id", userId);
        if (opts.sinceIso) q = q.gte("logged_at", opts.sinceIso);
        for (const token of tokens) {
            q = q.ilike(column, `%${escapeLikePattern(token)}%`);
        }
        return q.order("logged_at", { ascending: false }).limit(limit);
    };

    const results = await Promise.all(
        tokenized.flatMap((tokens) => [
            buildQuery(tokens, "description"),
            buildQuery(tokens, "notes"),
        ]),
    );

    const seen = new Set<string>();
    const merged: Meal[] = [];
    for (const { data, error } of results) {
        if (error) {
            throw new Error(`Failed to search meals: ${error.message}`);
        }
        for (const meal of (data as Meal[]) ?? []) {
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
    const { data, error } = await getSupabase()
        .from("meals")
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .select("id");

    if (error) throw new Error(`Failed to delete meal: ${error.message}`);
    return (data?.length ?? 0) > 0;
}

export async function updateMeal(
    userId: string,
    id: string,
    fields: Partial<MealInput>,
): Promise<Meal> {
    const sb = getSupabase();

    const { data: existing, error: selErr } = await sb
        .from("meals")
        .select("*")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
    if (selErr) throw new Error(`Failed to update meal: ${selErr.message}`);
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

    const newKey = updatedMealIdempotencyKey(userId, existing as Meal, fields);
    if (newKey !== null) update.idempotency_key = newKey;

    const { data, error } = await sb
        .from("meals")
        .update(update)
        .eq("id", id)
        .eq("user_id", userId)
        .select()
        .single();

    if (error) throw new Error(`Failed to update meal: ${error.message}`);
    const saved = data as Meal;
    if (fields.items) {
        saved.items = await replaceMealItems(userId, saved.id, fields.items);
    } else {
        saved.items = await listMealItems(userId, [saved.id]);
    }
    return saved;
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

export async function upsertNutritionGoals(
    userId: string,
    input: NutritionGoalsInput,
): Promise<NutritionGoals> {
    const { data, error } = await getSupabase()
        .from("nutrition_goals")
        .upsert(
            {
                user_id: userId,
                // daily_calories and daily_water_ml are integer columns; the
                // gram targets are numeric(6,2) and daily_caffeine_mg is
                // numeric(7,2). See toStoredInteger — a water goal converted
                // from "half a gallon" arrives fractional.
                daily_calories:
                    input.daily_calories == null
                        ? null
                        : toStoredInteger(input.daily_calories),
                daily_protein_g: input.daily_protein_g ?? null,
                daily_carbs_g: input.daily_carbs_g ?? null,
                daily_fat_g: input.daily_fat_g ?? null,
                daily_fiber_g: input.daily_fiber_g ?? null,
                daily_sugar_g: input.daily_sugar_g ?? null,
                daily_alcohol_g: input.daily_alcohol_g ?? null,
                daily_caffeine_mg: input.daily_caffeine_mg ?? null,
                daily_water_ml:
                    input.daily_water_ml == null
                        ? null
                        : toStoredInteger(input.daily_water_ml),
                target_weight_g: input.target_weight_g ?? null,
                updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
        )
        .select()
        .single();

    if (error) throw new Error(`Failed to save goals: ${error.message}`);
    return data as NutritionGoals;
}

export async function getNutritionGoals(
    userId: string,
): Promise<NutritionGoals | null> {
    const { data, error } = await getSupabase()
        .from("nutrition_goals")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

    if (error) throw new Error(`Failed to get goals: ${error.message}`);
    return (data as NutritionGoals | null) ?? null;
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
    const sb = getSupabase();

    // Resolve logged_at once so the digest and the persisted row agree.
    const loggedAt = input.logged_at ?? new Date().toISOString();
    // Always populate the key: use the client's if given, otherwise derive a
    // stable one from the request content (see deriveIdempotencyKey).
    const idempotencyKey =
        input.idempotency_key ??
        deriveIdempotencyKey([userId, input.amount_ml, input.notes, loggedAt]);

    const { data: existing, error: selErr } = await sb
        .from("water_log")
        .select("*")
        .eq("user_id", userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
    if (selErr) throw new Error(`Failed to look up water: ${selErr.message}`);
    if (existing) return { entry: existing as WaterEntry, deduplicated: true };

    const { data, error } = await sb
        .from("water_log")
        .insert({
            user_id: userId,
            amount_ml: input.amount_ml,
            logged_at: loggedAt,
            notes: input.notes ?? null,
            idempotency_key: idempotencyKey,
        })
        .select()
        .single();

    if (error) {
        if (error.code === "23505") {
            const { data: existing, error: raceErr } = await sb
                .from("water_log")
                .select("*")
                .eq("user_id", userId)
                .eq("idempotency_key", idempotencyKey)
                .maybeSingle();
            if (raceErr)
                throw new Error(
                    `Failed to resolve idempotent water: ${raceErr.message}`,
                );
            if (existing)
                return {
                    entry: existing as WaterEntry,
                    deduplicated: true,
                };
        }
        throw new Error(`Failed to insert water: ${error.message}`);
    }
    return { entry: data as WaterEntry, deduplicated: false };
}

export async function getWaterByDate(
    userId: string,
    date: string,
    tz: string = "UTC",
): Promise<WaterEntry[]> {
    const startUtc = zonedDayStartUtc(date, tz);
    const endUtc = zonedNextDayStartUtc(date, tz);

    const { data, error } = await getSupabase()
        .from("water_log")
        .select("*")
        .eq("user_id", userId)
        .gte("logged_at", startUtc.toISOString())
        .lt("logged_at", endUtc.toISOString())
        .order("logged_at", { ascending: true });

    if (error) throw new Error(`Failed to get water: ${error.message}`);
    return (data as WaterEntry[]) ?? [];
}

export async function getWaterInRange(
    userId: string,
    startDate: string,
    endDate: string,
    tz: string = "UTC",
): Promise<WaterEntry[]> {
    const startUtc = zonedDayStartUtc(startDate, tz);
    const endUtc = zonedNextDayStartUtc(endDate, tz);

    const { data, error } = await getSupabase()
        .from("water_log")
        .select("*")
        .eq("user_id", userId)
        .gte("logged_at", startUtc.toISOString())
        .lt("logged_at", endUtc.toISOString())
        .order("logged_at", { ascending: true });

    if (error) throw new Error(`Failed to get water: ${error.message}`);
    return (data as WaterEntry[]) ?? [];
}

/**
 * How many water rows this user already has. Independent exact count, used by
 * `getAllWater` to prove the paged fetch came back whole.
 */
export async function countWater(userId: string): Promise<number> {
    const { count, error } = await getSupabase()
        .from("water_log")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);

    if (error) throw new Error(`Failed to count water: ${error.message}`);
    return count ?? 0;
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
        const { data, error } = await getSupabase()
            .from("water_log")
            .select("*")
            .eq("user_id", userId)
            .order("logged_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to);

        if (error) throw new Error(`Failed to get water: ${error.message}`);
        return (data as WaterEntry[]) ?? [];
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
    const { data, error } = await getSupabase()
        .from("water_log")
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .select("id");

    if (error) throw new Error(`Failed to delete water: ${error.message}`);
    return (data?.length ?? 0) > 0;
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
    const sb = getSupabase();

    // Resolve logged_at once so the digest and the persisted row agree.
    const loggedAt = input.logged_at ?? new Date().toISOString();
    // Always populate the key: use the client's if given, otherwise derive a
    // stable one from the request content (see deriveIdempotencyKey).
    const idempotencyKey =
        input.idempotency_key ??
        deriveIdempotencyKey([userId, input.weight_g, input.notes, loggedAt]);

    const { data: existing, error: selErr } = await sb
        .from("weight_log")
        .select("*")
        .eq("user_id", userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
    if (selErr) throw new Error(`Failed to look up weight: ${selErr.message}`);
    if (existing) return { entry: existing as WeightEntry, deduplicated: true };

    const { data, error } = await sb
        .from("weight_log")
        .insert({
            user_id: userId,
            weight_g: input.weight_g,
            logged_at: loggedAt,
            notes: input.notes ?? null,
            idempotency_key: idempotencyKey,
        })
        .select()
        .single();

    if (error) {
        if (error.code === "23505") {
            const { data: existing, error: raceErr } = await sb
                .from("weight_log")
                .select("*")
                .eq("user_id", userId)
                .eq("idempotency_key", idempotencyKey)
                .maybeSingle();
            if (raceErr)
                throw new Error(
                    `Failed to resolve idempotent weight: ${raceErr.message}`,
                );
            if (existing)
                return {
                    entry: existing as WeightEntry,
                    deduplicated: true,
                };
        }
        throw new Error(`Failed to insert weight: ${error.message}`);
    }
    return { entry: data as WeightEntry, deduplicated: false };
}

export async function getWeightByDate(
    userId: string,
    date: string,
    tz: string = "UTC",
): Promise<WeightEntry[]> {
    const startUtc = zonedDayStartUtc(date, tz);
    const endUtc = zonedNextDayStartUtc(date, tz);

    const { data, error } = await getSupabase()
        .from("weight_log")
        .select("*")
        .eq("user_id", userId)
        .gte("logged_at", startUtc.toISOString())
        .lt("logged_at", endUtc.toISOString())
        .order("logged_at", { ascending: true });

    if (error) throw new Error(`Failed to get weight: ${error.message}`);
    return (data as WeightEntry[]) ?? [];
}

export async function getWeightInRange(
    userId: string,
    startDate: string,
    endDate: string,
    tz: string = "UTC",
): Promise<WeightEntry[]> {
    const startUtc = zonedDayStartUtc(startDate, tz);
    const endUtc = zonedNextDayStartUtc(endDate, tz);

    const { data, error } = await getSupabase()
        .from("weight_log")
        .select("*")
        .eq("user_id", userId)
        .gte("logged_at", startUtc.toISOString())
        .lt("logged_at", endUtc.toISOString())
        .order("logged_at", { ascending: true });

    if (error) throw new Error(`Failed to get weight: ${error.message}`);
    return (data as WeightEntry[]) ?? [];
}

/**
 * How many weight rows this user already has. Independent exact count, used by
 * `getAllWeight` to prove the paged fetch came back whole.
 */
export async function countWeight(userId: string): Promise<number> {
    const { count, error } = await getSupabase()
        .from("weight_log")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);

    if (error) throw new Error(`Failed to count weight: ${error.message}`);
    return count ?? 0;
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
        const { data, error } = await getSupabase()
            .from("weight_log")
            .select("*")
            .eq("user_id", userId)
            .order("logged_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to);

        if (error) throw new Error(`Failed to get weight: ${error.message}`);
        return (data as WeightEntry[]) ?? [];
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
    const { data, error } = await getSupabase()
        .from("weight_log")
        .select("*")
        .eq("user_id", userId)
        .order("logged_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw new Error(`Failed to get latest weight: ${error.message}`);
    return (data as WeightEntry | null) ?? null;
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
    const { data, error } = await getSupabase()
        .from("weight_log")
        .update(update)
        .eq("id", id)
        .eq("user_id", userId)
        .select();

    if (error) throw new Error(`Failed to update weight: ${error.message}`);
    if (!data || data.length === 0)
        throw new Error("Failed to update weight: entry not found");
    return data[0] as WeightEntry;
}

/** Returns true if an entry was deleted, false if no matching row was found. */
export async function deleteWeight(
    userId: string,
    id: string,
): Promise<boolean> {
    const { data, error } = await getSupabase()
        .from("weight_log")
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .select("id");

    if (error) throw new Error(`Failed to delete weight: ${error.message}`);
    return (data?.length ?? 0) > 0;
}

// ---------- Delete all user data ----------

/**
 * Storage key the whole-account export archive is written to — one per user,
 * so each export overwrites the last. Lives here rather than in src/export.ts
 * because deletion needs it too and src/export.ts already imports from this
 * module; the other direction would be a cycle.
 */
export function exportArchivePath(userId: string): string {
    return `${userId}/foodable-export.zip`;
}

/**
 * EVERY key an export may have left in the bucket for this user, current and
 * historical. `deleteAllUserData` removes all of them, and that is the whole
 * reason this list exists rather than a single inlined path: the archive holds
 * the user's complete meal, water, weight, goals and profile history, so a key
 * missed here survives the account that asked to be erased — and keeps
 * resolving through the signed URL the user was already handed, for the rest
 * of its hour. Renaming the archive without adding its old name to this list
 * is exactly that bug, and `remove` reports a missing path as success, so
 * nothing would surface it. Add, do not replace.
 */
export function exportStoragePaths(userId: string): string[] {
    return [
        exportArchivePath(userId),
        // Written by the meals-only export that the archive replaced. Nothing
        // creates it any more; it stays here to clean up files left behind by
        // exports taken before that change.
        `${userId}/meals.csv`,
        // Written before the archive object was renamed to foodable-export.zip.
        // Nothing creates it any more; it stays here so account deletion still
        // removes a leftover from the old key. Add, do not replace.
        `${userId}/nutrition-mcp-export.zip`,
    ];
}

export async function deleteAllUserData(userId: string): Promise<void> {
    const sb = getSupabase();

    const { error: analyticsErr } = await sb
        .from("tool_analytics")
        .delete()
        .eq("user_id", userId);
    if (analyticsErr)
        throw new Error(`Failed to delete analytics: ${analyticsErr.message}`);

    const { error: waterErr } = await sb
        .from("water_log")
        .delete()
        .eq("user_id", userId);
    if (waterErr)
        throw new Error(`Failed to delete water log: ${waterErr.message}`);

    const { error: weightErr } = await sb
        .from("weight_log")
        .delete()
        .eq("user_id", userId);
    if (weightErr)
        throw new Error(`Failed to delete weight log: ${weightErr.message}`);

    const { error: goalsErr } = await sb
        .from("nutrition_goals")
        .delete()
        .eq("user_id", userId);
    if (goalsErr)
        throw new Error(`Failed to delete goals: ${goalsErr.message}`);

    const { error: profileErr } = await sb
        .from("profiles")
        .delete()
        .eq("user_id", userId);
    if (profileErr)
        throw new Error(`Failed to delete profile: ${profileErr.message}`);

    // Remove any export file from the "exports" storage bucket. Missing paths
    // are not an error, so this is a no-op for users who never exported.
    await liveExportArchiveStore().remove(exportStoragePaths(userId));

    // recipe_portions.user_id carries no foreign key, so the auth delete below
    // would leave these rows behind. The recipes themselves are household
    // data and stay.
    const { error: portionsErr } = await sb
        .from("recipe_portions")
        .delete()
        .eq("user_id", userId);
    if (portionsErr)
        throw new Error(
            `Failed to delete recipe portions: ${portionsErr.message}`,
        );

    const { error: mealsErr } = await sb
        .from("meals")
        .delete()
        .eq("user_id", userId);
    if (mealsErr)
        throw new Error(`Failed to delete meals: ${mealsErr.message}`);

    const { error: tokensErr } = await sb
        .from("oauth_tokens")
        .delete()
        .eq("user_id", userId);
    if (tokensErr)
        throw new Error(`Failed to delete tokens: ${tokensErr.message}`);

    const { error: refreshErr } = await sb
        .from("refresh_tokens")
        .delete()
        .eq("user_id", userId);
    if (refreshErr)
        throw new Error(
            `Failed to delete refresh tokens: ${refreshErr.message}`,
        );

    const { error: authErr } = await sb
        .from("auth_codes")
        .delete()
        .eq("user_id", userId);
    if (authErr)
        throw new Error(`Failed to delete auth codes: ${authErr.message}`);

    const { error: userErr } = await sb.auth.admin.deleteUser(userId);
    if (userErr) throw new Error(`Failed to delete user: ${userErr.message}`);
}
