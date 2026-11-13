import type {
    Meal,
    MealInput,
    MealItem,
    MealItemWrite,
} from "../db/nutrition.js";
import { mealIdempotencyKey } from "../db/nutrition.js";
import { mealWriteFromItems } from "../meal-write.js";
import {
    descriptionFromItems,
    itemListDigest,
    sumItemNutrients,
    type MealItemSnapshot,
    type MealItemSpec,
    type MealNutrients,
} from "./meals.js";

export function todayEditSheetId(mealId: string): string {
    return `fd-edit-meal-${mealId}`;
}

export type EditItemQuantity = {
    value: number;
    unit: string;
    mode: "portions" | "amount";
};

/** Stepper display value and unit for a meal_items row. */
/**
 * Recipe rows step in portions. So does a row whose recipe (or food) was
 * deleted after logging: `on delete set null` clears the reference but keeps
 * `portions`, and with no amount there is nothing else to scale by.
 */
function editsByPortions(
    item: Pick<MealItem, "recipe_id" | "food_id" | "amount">,
): boolean {
    return (
        item.recipe_id != null || (item.food_id == null && item.amount == null)
    );
}

export function editItemQuantity(item: MealItem): EditItemQuantity {
    if (editsByPortions(item)) {
        const portions = item.portions ?? 1;
        return { value: portions, unit: "portion(s)", mode: "portions" };
    }
    const amount = item.amount ?? 1;
    const unit = item.unit?.trim() || "g";
    return { value: amount, unit, mode: "amount" };
}

export function submittedItemAmountsUnchanged(
    items: readonly MealItem[],
    submitted: ReadonlyMap<string, number>,
): boolean {
    if (items.length !== submitted.size) return false;
    for (const item of items) {
        const expected = editItemQuantity(item).value;
        const got = submitted.get(item.id);
        if (got == null || got !== expected) return false;
    }
    return true;
}

export function mealLocalTimeValue(
    loggedAt: string,
    _day: string,
    tz: string,
): string {
    const d = new Date(loggedAt);
    const fmt = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: tz,
    });
    const parts = fmt.formatToParts(d);
    let hour = "00";
    let minute = "00";
    for (const p of parts) {
        if (p.type === "hour") hour = p.value;
        if (p.type === "minute") minute = p.value;
    }
    return `${hour}:${minute}`;
}

/** Wall time on `day` in the member's zone, for resolveWriteTimestamp. */
export function mealLoggedAtFromLocalTime(
    day: string,
    time: string,
    tz: string,
): string {
    const trimmed = time.trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
    if (!m) throw new Error("Enter a valid time.");
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute > 59) throw new Error("Enter a valid time.");
    const h = String(hour).padStart(2, "0");
    const min = String(minute).padStart(2, "0");
    return `${day}T${h}:${min}:00`;
}

export type MacroTileValues = {
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
};

function scaleNullable(value: number | null, factor: number): number | null {
    if (value == null || !Number.isFinite(value)) return null;
    return value * factor;
}

/** Free-text meal: scale stored totals by servings (1 = as logged). */
export function scaleMealTotals(
    meal: Pick<
        Meal,
        | "calories"
        | "protein_g"
        | "carbs_g"
        | "fat_g"
        | "fiber_g"
        | "sugar_g"
        | "alcohol_g"
        | "caffeine_mg"
    >,
    servings: number,
): MacroTileValues & {
    fiber_g: number | null;
    sugar_g: number | null;
    alcohol_g: number | null;
    caffeine_mg: number | null;
} {
    if (!Number.isFinite(servings) || servings <= 0) {
        throw new Error("Enter servings greater than zero.");
    }
    return {
        calories:
            meal.calories == null ? null : Math.round(meal.calories * servings),
        protein_g: scaleNullable(meal.protein_g, servings),
        carbs_g: scaleNullable(meal.carbs_g, servings),
        fat_g: scaleNullable(meal.fat_g, servings),
        fiber_g: scaleNullable(meal.fiber_g, servings),
        sugar_g: scaleNullable(meal.sugar_g, servings),
        alcohol_g: scaleNullable(meal.alcohol_g, servings),
        caffeine_mg: scaleNullable(meal.caffeine_mg, servings),
    };
}

export function itemMacrosAtAmount(
    item: Pick<
        MealItem,
        | "amount"
        | "portions"
        | "recipe_id"
        | "food_id"
        | "calories"
        | "protein_g"
        | "carbs_g"
        | "fat_g"
        | "fiber_g"
        | "sugar_g"
        | "alcohol_g"
        | "caffeine_mg"
    >,
    amount: number,
): MacroTileValues & {
    fiber_g: number | null;
    sugar_g: number | null;
    alcohol_g: number | null;
    caffeine_mg: number | null;
} {
    const base = editsByPortions(item) ? (item.portions ?? 1) : item.amount;
    if (base == null || !Number.isFinite(base) || base <= 0) {
        return {
            calories: item.calories,
            protein_g: item.protein_g,
            carbs_g: item.carbs_g,
            fat_g: item.fat_g,
            fiber_g: item.fiber_g,
            sugar_g: item.sugar_g,
            alcohol_g: item.alcohol_g,
            caffeine_mg: item.caffeine_mg,
        };
    }
    const factor = amount / base;
    return {
        calories:
            item.calories == null ? null : Math.round(item.calories * factor),
        protein_g: scaleNullable(item.protein_g, factor),
        carbs_g: scaleNullable(item.carbs_g, factor),
        fat_g: scaleNullable(item.fat_g, factor),
        fiber_g: scaleNullable(item.fiber_g, factor),
        sugar_g: scaleNullable(item.sugar_g, factor),
        alcohol_g: scaleNullable(item.alcohol_g, factor),
        caffeine_mg: scaleNullable(item.caffeine_mg, factor),
    };
}

function digestKeyForSpec(spec: MealItemSpec): string {
    return itemListDigest([spec]);
}

function uniqueSpecs(specs: MealItemSpec[]): MealItemSpec[] {
    const seen = new Set<string>();
    const out: MealItemSpec[] = [];
    for (const spec of specs) {
        const key = digestKeyForSpec(spec);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(spec);
    }
    return out;
}

/** Candidate logging specs one stored row might have been written from. */
export function itemSpecCandidatesFromStoredItem(
    item: Pick<
        MealItem,
        "food_id" | "recipe_id" | "label" | "amount" | "unit" | "portions"
    >,
): MealItemSpec[] {
    if (item.recipe_id) {
        const portions = item.portions ?? 1;
        const label = item.label?.trim();
        const variants: MealItemSpec[] = [
            { recipeId: item.recipe_id, portions },
        ];
        if (label)
            variants.push({ recipeId: item.recipe_id, portions, name: label });
        return uniqueSpecs(variants);
    }
    if (item.food_id) {
        const amount = item.amount ?? 1;
        const unit = item.unit?.trim() || "g";
        const label = item.label?.trim();
        const variants: MealItemSpec[] = [
            { foodId: item.food_id, amount, unit },
            { foodId: item.food_id, amount },
        ];
        if (label) {
            variants.push(
                { foodId: item.food_id, name: label, amount, unit },
                { foodId: item.food_id, name: label, amount },
            );
        }
        return uniqueSpecs(variants);
    }
    const amount = item.amount ?? 1;
    const unit = item.unit?.trim() || "g";
    const label = item.label?.trim() || "";
    return uniqueSpecs([
        { name: label, amount, unit },
        { name: label, amount },
    ]);
}

/** Most combinations tried before recovery gives up on mixed conventions. */
const MAX_SPEC_COMBOS = 256;

/**
 * Candidate spec lists to try, cheapest and likeliest first. One logging call
 * uses one convention for every item (all units given or all omitted, names
 * passed or not), so the uniform picks come first; a mixed list is tried only
 * up to MAX_SPEC_COMBOS, because the full product is 4^items and a 20-item
 * meal would otherwise hash ~10^12 lists inside one request.
 */
function* candidateSpecLists(
    lists: readonly MealItemSpec[][],
): Generator<MealItemSpec[]> {
    if (lists.length === 0) return;
    const widest = Math.max(...lists.map((list) => list.length));
    const seen = new Set<string>();
    let tried = 0;
    const emit = (combo: MealItemSpec[]): MealItemSpec[] | null => {
        const key = itemListDigest(combo);
        if (seen.has(key)) return null;
        seen.add(key);
        tried++;
        return combo;
    };
    for (let k = 0; k < widest; k++) {
        const combo = emit(
            lists.map((list) => list[Math.min(k, list.length - 1)]!),
        );
        if (combo) yield combo;
    }
    const index = lists.map(() => 0);
    while (tried < MAX_SPEC_COMBOS) {
        const combo = emit(lists.map((list, i) => list[index[i]!]!));
        if (combo) yield combo;
        let pos = lists.length - 1;
        while (pos >= 0) {
            index[pos]!++;
            if (index[pos]! < lists[pos]!.length) break;
            index[pos] = 0;
            pos--;
        }
        if (pos < 0) return;
    }
}

/**
 * Guess the item specs used at log time when the stored rows alone cannot
 * tell (omitted unit, caller recipe name). Matches the meal's auto: key.
 */
export function recoverLoggingSpecsFromMeal(
    userId: string,
    meal: Pick<
        Meal,
        | "idempotency_key"
        | "description"
        | "meal_type"
        | "calories"
        | "protein_g"
        | "carbs_g"
        | "fat_g"
        | "notes"
        | "logged_at"
        | "items"
    >,
): MealItemSpec[] | null {
    if (!meal.idempotency_key?.startsWith("auto:")) return null;
    const items = meal.items ?? [];
    if (items.length === 0) return null;

    const candidateLists = items.map((item) =>
        itemSpecCandidatesFromStoredItem(item),
    );
    const loggedAt = new Date(meal.logged_at).toISOString();
    for (const specs of candidateSpecLists(candidateLists)) {
        const item_digest = itemListDigest(specs);
        const key = mealIdempotencyKey(
            userId,
            {
                description: meal.description,
                meal_type: meal.meal_type as MealInput["meal_type"],
                calories: meal.calories ?? undefined,
                protein_g: meal.protein_g ?? undefined,
                carbs_g: meal.carbs_g ?? undefined,
                fat_g: meal.fat_g ?? undefined,
                notes: meal.notes ?? undefined,
                item_digest,
            },
            loggedAt,
        );
        if (key === meal.idempotency_key) return specs;
    }
    return null;
}

export function itemSpecsFromStoredItems(
    items: readonly Pick<
        MealItem,
        "food_id" | "recipe_id" | "label" | "amount" | "unit" | "portions"
    >[],
): MealItemSpec[] {
    return items.map((item) => {
        if (item.recipe_id) {
            return {
                recipeId: item.recipe_id,
                portions: item.portions ?? 1,
            };
        }
        if (item.food_id) {
            return {
                foodId: item.food_id,
                name: item.label,
                amount: item.amount ?? 1,
                unit: item.unit?.trim() || "g",
            };
        }
        return {
            name: item.label,
            amount: item.amount ?? 1,
            unit: item.unit?.trim() || "g",
        };
    });
}

function mealItemSnapshotsFromRows(
    items: readonly MealItem[],
): MealItemSnapshot[] {
    return items.map((item, index) => ({
        foodId: item.food_id,
        recipeId: item.recipe_id,
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
        sortOrder: index,
        unknown: false,
    }));
}

function loggingSpecAtAmount(
    spec: MealItemSpec,
    item: Pick<MealItem, "recipe_id" | "food_id" | "label">,
    newAmount: number,
): MealItemSpec {
    if (item.recipe_id) {
        return { ...spec, recipeId: item.recipe_id, portions: newAmount };
    }
    if (item.food_id) {
        return { ...spec, foodId: item.food_id, amount: newAmount };
    }
    return { ...spec, name: item.label, amount: newAmount };
}

function mealItemToWriteRow(item: MealItem): MealItemWrite {
    return {
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
        sort_order: item.sort_order,
    };
}

function nutrientsFromWrite(row: MealItemWrite): MealNutrients {
    return {
        calories: row.calories,
        protein_g: row.protein_g,
        carbs_g: row.carbs_g,
        fat_g: row.fat_g,
        fiber_g: row.fiber_g,
        sugar_g: row.sugar_g,
        alcohol_g: row.alcohol_g,
        caffeine_mg: row.caffeine_mg,
    };
}

function scaledFreeTextItemWrite(
    item: MealItem,
    newAmount: number,
): MealItemWrite {
    const scaled = itemMacrosAtAmount(item, newAmount);
    if (editsByPortions(item)) {
        return {
            ...mealItemToWriteRow(item),
            portions: newAmount,
            calories: scaled.calories,
            protein_g: scaled.protein_g,
            carbs_g: scaled.carbs_g,
            fat_g: scaled.fat_g,
            fiber_g: scaled.fiber_g,
            sugar_g: scaled.sugar_g,
            alcohol_g: scaled.alcohol_g,
            caffeine_mg: scaled.caffeine_mg,
        };
    }
    const baseAmount = item.amount ?? 1;
    const grams =
        item.grams != null && baseAmount > 0
            ? Math.round(((item.grams * newAmount) / baseAmount) * 10) / 10
            : item.grams;
    return {
        ...mealItemToWriteRow(item),
        amount: newAmount,
        grams,
        calories: scaled.calories,
        protein_g: scaled.protein_g,
        carbs_g: scaled.carbs_g,
        fat_g: scaled.fat_g,
        fiber_g: scaled.fiber_g,
        sugar_g: scaled.sugar_g,
        alcohol_g: scaled.alcohol_g,
        caffeine_mg: scaled.caffeine_mg,
    };
}

function specForChangedItem(item: MealItem, newAmount: number): MealItemSpec {
    if (item.recipe_id) {
        return { recipeId: item.recipe_id, portions: newAmount };
    }
    if (item.food_id) {
        // Keep the name it was logged under: the snapshot labels the row with
        // it, and the web log path folds it into the digest a re-log writes.
        return {
            foodId: item.food_id,
            name: item.label,
            amount: newAmount,
            unit: item.unit?.trim() || "g",
            logged: item,
        };
    }
    return {
        name: item.label,
        amount: newAmount,
        unit: item.unit?.trim() || "g",
    };
}

/**
 * The spec an edited food row is recomputed from. The row's own unit wins over
 * an omitted one (the stepper shows that unit, so the new amount is in it),
 * and its stored figures stay the fallback for a unit the food cannot scale.
 */
function specToRecompute(spec: MealItemSpec, item: MealItem): MealItemSpec {
    if (!item.food_id) return spec;
    return {
        ...spec,
        unit: spec.unit?.trim() || item.unit?.trim() || "g",
        logged: item,
    };
}

export type MealEditPatchOpts = {
    storedDescription?: string | null;
    loggingSpecs?: readonly MealItemSpec[] | null;
};

/** Rebuild only rows whose submitted amount changed; untouched snapshots stay as logged. */
export async function mealEditPatchFromItemAmounts(
    householdId: string,
    items: readonly MealItem[],
    amounts: ReadonlyMap<string, number>,
    opts?: MealEditPatchOpts,
): Promise<
    Pick<
        MealInput,
        | "description"
        | "calories"
        | "protein_g"
        | "carbs_g"
        | "fat_g"
        | "fiber_g"
        | "sugar_g"
        | "alcohol_g"
        | "caffeine_mg"
        | "items"
        | "item_digest"
    >
> {
    const preEditDescription = descriptionFromItems(
        mealItemSnapshotsFromRows(items),
    );
    const keepStoredDescription =
        opts?.storedDescription != null &&
        opts.storedDescription !== preEditDescription;
    const writes: MealItemWrite[] = [];
    const digestSpecs: MealItemSpec[] = [];
    for (let index = 0; index < items.length; index++) {
        const item = items[index]!;
        const newAmount = amounts.get(item.id);
        if (newAmount == null) {
            throw new Error("Missing item amount.");
        }
        const prior = editItemQuantity(item).value;
        const loggingSpec = opts?.loggingSpecs?.[index] ?? null;
        if (loggingSpec) {
            digestSpecs.push(
                newAmount === prior
                    ? loggingSpec
                    : loggingSpecAtAmount(loggingSpec, item, newAmount),
            );
        }
        if (newAmount === prior) {
            writes.push(mealItemToWriteRow(item));
            continue;
        }
        if (item.food_id || item.recipe_id) {
            const changeSpec = specToRecompute(
                loggingSpec != null
                    ? loggingSpecAtAmount(loggingSpec, item, newAmount)
                    : specForChangedItem(item, newAmount),
                item,
            );
            const computed = await mealWriteFromItems(householdId, [
                changeSpec,
            ]);
            const row = computed.items?.[0];
            if (!row) {
                throw new Error("Could not recompute this meal item.");
            }
            writes.push({ ...row, sort_order: item.sort_order });
            continue;
        }
        writes.push(scaledFreeTextItemWrite(item, newAmount));
    }
    const totals = sumItemNutrients(writes.map(nutrientsFromWrite));
    const snapshots = writes.map((row, index) => ({
        foodId: row.food_id,
        recipeId: row.recipe_id,
        label: row.label,
        amount: row.amount,
        unit: row.unit,
        grams: row.grams,
        portions: row.portions,
        calories: row.calories,
        protein_g: row.protein_g,
        carbs_g: row.carbs_g,
        fat_g: row.fat_g,
        fiber_g: row.fiber_g,
        sugar_g: row.sugar_g,
        alcohol_g: row.alcohol_g,
        caffeine_mg: row.caffeine_mg,
        sortOrder: index,
        unknown: false,
    }));
    const description = keepStoredDescription
        ? opts!.storedDescription!
        : descriptionFromItems(snapshots);
    return {
        description,
        calories: totals.calories,
        protein_g: totals.protein_g,
        carbs_g: totals.carbs_g,
        fat_g: totals.fat_g,
        fiber_g: totals.fiber_g,
        sugar_g: totals.sugar_g,
        alcohol_g: totals.alcohol_g,
        caffeine_mg: totals.caffeine_mg,
        items: writes,
        item_digest: itemListDigest(
            digestSpecs.length > 0
                ? digestSpecs
                : itemSpecsFromStoredItems(writes),
        ),
    };
}

export function sumMacroTiles(
    parts: readonly MacroTileValues[],
): MacroTileValues {
    let calories = 0;
    let calKnown = false;
    let protein = 0;
    let proteinKnown = false;
    let carbs = 0;
    let carbsKnown = false;
    let fat = 0;
    let fatKnown = false;
    for (const p of parts) {
        if (p.calories != null) {
            calories += p.calories;
            calKnown = true;
        }
        if (p.protein_g != null) {
            protein += p.protein_g;
            proteinKnown = true;
        }
        if (p.carbs_g != null) {
            carbs += p.carbs_g;
            carbsKnown = true;
        }
        if (p.fat_g != null) {
            fat += p.fat_g;
            fatKnown = true;
        }
    }
    return {
        calories: calKnown ? Math.round(calories) : null,
        protein_g: proteinKnown ? Math.round(protein * 10) / 10 : null,
        carbs_g: carbsKnown ? Math.round(carbs * 10) / 10 : null,
        fat_g: fatKnown ? Math.round(fat * 10) / 10 : null,
    };
}
