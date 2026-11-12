import { isNamedAllergen, type NamedAllergen } from "./rules.js";
import { normalizeBarcode, type FoodResult } from "../foods.js";
import { additiveRisk, type AdditiveRisk } from "./additive-risk.js";
import { filterOffNutrientLevels } from "./off-nutrient-levels.js";
import type { NutrientLevel } from "./product-score.js";
import { isQuantityUnit } from "./quantity.js";
import {
    cleanupDismissalsForFood,
    dismissalKeyString,
    lookupDismissalKey,
    type MemoryNoticeDismissalsHolder,
    type NoticeDismissalsStore,
} from "./notice-dismissals.js";

export type FoodKind = "food" | "supply";

export type NutritionSource =
    "openfoodfacts" | "manual" | "estimate" | "recipe";

export type UsualAmount = { amount: number; unit: string };

/** How often a usual is bought again; null on the food means no schedule. */
export const RESTOCK_SCHEDULES = [
    "weekly",
    "every_n_weeks",
    "monthly",
] as const;
export type RestockSchedule = (typeof RESTOCK_SCHEDULES)[number];

/** The largest N a household can enter for "every N weeks" (two years). */
export const RESTOCK_MAX_EVERY_WEEKS = 104;

export type FoodQuality = {
    nutriscoreGrade: "a" | "b" | "c" | "d" | "e" | null;
    novaGroup: 1 | 2 | 3 | 4 | null;
    ecoscoreGrade: "a-plus" | "a" | "b" | "c" | "d" | "e" | "f" | null;
    additives: { tag: string; risk: AdditiveRisk | null }[] | null;
    allergensTags: string[] | null;
    tracesTags: string[] | null;
    ingredientsAnalysisTags: string[] | null;
    labelsTags: string[] | null;
    fetchedAt: string;
};

export type Food = {
    id: string;
    householdId: string;
    kind: FoodKind;
    name: string;
    normalizedName: string;
    brand: string | null;
    defaultUnit: string;
    gramsPerEach: number | null;
    gramsPerMl: number | null;
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    sugarG: number | null;
    saturatedFatG: number | null;
    alcoholG: number | null;
    caffeineMg: number | null;
    nutritionSource: NutritionSource | null;
    offNutrientLevels: Record<string, NutrientLevel> | null;
    allergens: string[];
    offSourceId: string | null;
    genericFoodId: string | null;
    usualProductId: string | null;
    usualStoreId: string | null;
    usualAmount: UsualAmount | null;
    /** The usual's restock schedule; lives on the plain food, never on a product. */
    restockSchedule: RestockSchedule | null;
    /** N for `every_n_weeks` (required exactly then), null otherwise. */
    restockEveryWeeks: number | null;
    restockPaused: boolean;
    /** Add the usual to the list when its stock is below the low level. */
    restockWhenLow: boolean;
    /** In the usual amount's unit; null means a quarter of the usual amount. */
    restockLowLevel: number | null;
    /** `YYYY-MM-DD` of the last put-away or tick-off, in the household's day. */
    lastRestockedOn: string | null;
    offQuality: FoodQuality | null;
    createdBy: string | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
};

export type UsualScheduleKey =
    | "restockSchedule"
    | "restockEveryWeeks"
    | "restockPaused"
    | "restockWhenLow"
    | "restockLowLevel"
    | "lastRestockedOn";

/** The six schedule fields of a usual, as stored on the plain food. */
export type UsualScheduleFields = Pick<Food, UsualScheduleKey>;

/** A usual with no schedule, never paused, not added when low, never restocked. */
export const NO_USUAL_SCHEDULE: Readonly<UsualScheduleFields> = Object.freeze({
    restockSchedule: null,
    restockEveryWeeks: null,
    restockPaused: false,
    restockWhenLow: false,
    restockLowLevel: null,
    lastRestockedOn: null,
});

export type FoodPatch = {
    name?: string;
    brand?: string | null;
    defaultUnit?: string;
    gramsPerEach?: number | null;
    gramsPerMl?: number | null;
    calories?: number | null;
    proteinG?: number | null;
    carbsG?: number | null;
    fatG?: number | null;
    fiberG?: number | null;
    sugarG?: number | null;
    alcoholG?: number | null;
    caffeineMg?: number | null;
    nutritionSource?: NutritionSource | null;
    allergens?: string[];
    aliases?: string[];
    archived?: boolean;
    usualStoreId?: string | null;
    usualAmount?: { amount: number | null; unit: string | null } | null;
};

export type FoodsStore = {
    listFoods(householdId: string): Promise<Food[]>;
    /** Counts referring rows per food id in fridge, grocery, recipe, meals, and stock (household-scoped). */
    countFoodRefs(householdId: string): Promise<Map<string, number>>;
    getFood(householdId: string, id: string): Promise<Food | null>;
    getFoodsByIds(
        householdId: string,
        ids: readonly string[],
    ): Promise<Map<string, Food>>;
    insertFood(row: Food): Promise<Food>;
    updateFoodRow(row: Food): Promise<Food | null>;
    getByNormalizedName(
        householdId: string,
        kind: FoodKind,
        normalizedName: string,
    ): Promise<Food | null>;
    getByOffSourceId(
        householdId: string,
        offSourceId: string,
    ): Promise<Food | null>;
    getBarcodeFoodId(
        householdId: string,
        barcode: string,
    ): Promise<string | null>;
    listBarcodes(householdId: string, foodId: string): Promise<string[]>;
    /** Barcodes per food id, in the same order as `listBarcodes` for each food. */
    listBarcodesForFoods(
        householdId: string,
        foodIds: readonly string[],
    ): Promise<Map<string, string[]>>;
    /** Household food id per barcode that exists in the household (one entry per barcode). */
    getBarcodeFoodIds(
        householdId: string,
        barcodes: readonly string[],
    ): Promise<Map<string, string>>;
    setBarcode(
        householdId: string,
        barcode: string,
        foodId: string,
    ): Promise<void>;
    deleteBarcodesForFood(
        householdId: string,
        foodId: string,
    ): Promise<string[]>;
    getAliasFoodId(householdId: string, alias: string): Promise<string | null>;
    listAliases(householdId: string, foodId: string): Promise<string[]>;
    /** Every alias in the household, grouped by food id, in `listAliases` order. */
    listAllAliases(householdId: string): Promise<Map<string, string[]>>;
    setAlias(householdId: string, alias: string, foodId: string): Promise<void>;
    deleteAlias(householdId: string, alias: string): Promise<void>;
    deleteAliasesForFood(
        householdId: string,
        foodId: string,
    ): Promise<string[]>;
    searchFoods(householdId: string, query: string): Promise<Food[]>;
    listBarcodedFoodIds(householdId: string): Promise<Set<string>>;
    repointFoodRefs(
        householdId: string,
        fromId: string,
        toId: string,
    ): Promise<void>;
    /**
     * Write only the OFF quality columns. Applies when the row is live and its
     * stored `fetchedAt` is null or older; with `onlyIfUnset`, only when it is
     * null (a miss stamp never replaces data written while the lookup ran).
     */
    setFoodQuality(
        householdId: string,
        foodId: string,
        quality: FoodQuality,
        opts?: { onlyIfUnset?: boolean },
    ): Promise<Food | null>;
    /** Write only `saturated_fat_g` and `off_nutrient_levels` from an OFF refresh. */
    setFoodOffNutrition(
        householdId: string,
        foodId: string,
        patch: FoodOffNutritionPatch,
    ): Promise<Food | null>;
    /**
     * The household's "treat singular and plural as the same food" setting.
     * Name resolution reads it only after an exact name and alias miss. A
     * store without it behaves as off.
     */
    pluralsSameFood?(householdId: string): Promise<boolean>;
};

export type FoodOffNutritionPatch = {
    saturatedFatG?: number;
    offNutrientLevels?: Record<string, NutrientLevel>;
};

export class FoodsInputError extends Error {
    readonly code = "foods_input" as const;

    constructor(message: string) {
        super(message);
        this.name = "FoodsInputError";
    }
}

export type UsualStoreLookup = {
    listStores(householdId: string): Promise<{ id: string }[]>;
};

export type UsualPurchasePatch = {
    usualStoreId?: string | null;
    usualAmount?: { amount: number | null; unit: string | null } | null;
};

function blankUsualAmountInput(
    row: { amount: number | null; unit: string | null } | null | undefined,
): boolean {
    if (row == null) return true;
    const a =
        row.amount == null
            ? ""
            : typeof row.amount === "number"
              ? String(row.amount)
              : "";
    const u = row.unit?.trim() ?? "";
    return a.trim() === "" && u === "";
}

export async function parseUsualPurchase(
    householdId: string,
    patch: UsualPurchasePatch,
    stores: UsualStoreLookup | undefined,
): Promise<{ usualStoreId?: string | null; usualAmount?: UsualAmount | null }> {
    const out: {
        usualStoreId?: string | null;
        usualAmount?: UsualAmount | null;
    } = {};
    if (patch.usualStoreId !== undefined) {
        const raw = patch.usualStoreId;
        if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
            out.usualStoreId = null;
        } else {
            const id = String(raw).trim();
            if (!stores) {
                throw new FoodsInputError("Unknown store.");
            }
            const listed = await stores.listStores(householdId);
            const ids = new Set(listed.map((s) => s.id));
            if (!ids.has(id)) {
                throw new FoodsInputError("Unknown store.");
            }
            out.usualStoreId = id;
        }
    }
    if (patch.usualAmount !== undefined) {
        if (
            patch.usualAmount == null ||
            blankUsualAmountInput(patch.usualAmount)
        ) {
            out.usualAmount = null;
        } else {
            const row = patch.usualAmount;
            const amt = row.amount;
            const unitRaw = row.unit?.trim() ?? "";
            const hasAmt = amt != null && String(amt).trim() !== "";
            const hasUnit = unitRaw !== "";
            if (hasAmt !== hasUnit) {
                throw new FoodsInputError(
                    "Enter a usual amount with its unit.",
                );
            }
            if (!hasAmt) {
                out.usualAmount = null;
            } else {
                const n = typeof amt === "number" ? amt : Number(amt);
                // When both amount and unit are present, reject an unknown unit
                // before a bad amount so compound mistakes report unit first.
                if (!isQuantityUnit(unitRaw)) {
                    throw new FoodsInputError(
                        "Pick a known unit for the usual amount.",
                    );
                }
                if (!Number.isFinite(n) || n <= 0) {
                    throw new FoodsInputError(
                        "The usual amount must be greater than zero.",
                    );
                }
                out.usualAmount = { amount: n, unit: unitRaw };
            }
        }
    }
    return out;
}

const OFF_ALLERGEN_MAP: Record<string, NamedAllergen> = {
    peanut: "peanut",
    peanuts: "peanut",
    "tree-nut": "tree_nut",
    "tree-nuts": "tree_nut",
    nuts: "tree_nut",
    nut: "tree_nut",
    milk: "milk",
    lactose: "milk",
    egg: "egg",
    eggs: "egg",
    wheat: "wheat",
    gluten: "wheat",
    soy: "soy",
    soya: "soy",
    soybean: "soy",
    soybeans: "soy",
    fish: "fish",
    shellfish: "shellfish",
    crustaceans: "shellfish",
    crustacean: "shellfish",
    molluscs: "shellfish",
    mollusks: "shellfish",
    sesame: "sesame",
    "sesame-seeds": "sesame",
};

export function normalizeFoodName(raw: string): string {
    return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

export function mapOffAllergenTags(tags: unknown): NamedAllergen[] {
    if (!Array.isArray(tags)) return [];
    const seen = new Set<NamedAllergen>();
    for (const tag of tags) {
        if (typeof tag !== "string") continue;
        const slug = tag
            .trim()
            .toLowerCase()
            .replace(/^en:/, "")
            .replaceAll("_", "-");
        const mapped = OFF_ALLERGEN_MAP[slug];
        if (mapped) seen.add(mapped);
    }
    return [...seen];
}

export function catalogNutritionFromOff(food: FoodResult): {
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    sugarG: number | null;
    saturatedFatG: number | null;
    alcoholG: number | null;
} {
    const serving = (food.serving ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
    if (serving === "100g") {
        const saturatedRaw = food.saturated_fat_g ?? null;
        const saturatedFatG =
            saturatedRaw != null && saturatedRaw < 0 ? null : saturatedRaw;
        return {
            calories: food.calories,
            proteinG: food.protein_g,
            carbsG: food.carbs_g,
            fatG: food.fat_g,
            fiberG: food.fiber_g,
            sugarG: food.sugar_g,
            saturatedFatG,
            alcoholG: food.alcohol_g,
        };
    }
    return {
        calories: null,
        proteinG: null,
        carbsG: null,
        fatG: null,
        fiberG: null,
        sugarG: null,
        saturatedFatG: null,
        alcoholG: null,
    };
}

export function offNutrientLevelsFromHit(
    hit: FoodResult,
): Record<string, NutrientLevel> | null {
    return filterOffNutrientLevels(hit.nutrient_levels);
}

function offNutrientLevelsFromRow(
    value: unknown,
): Record<string, NutrientLevel> | null {
    return filterOffNutrientLevels(value);
}

export function offNutritionPatchFromHit(
    food: Food,
    hit: FoodResult,
): FoodOffNutritionPatch | null {
    const patch: FoodOffNutritionPatch = {};
    const nutrition = catalogNutritionFromOff(hit);
    if (food.saturatedFatG == null && nutrition.saturatedFatG != null) {
        patch.saturatedFatG = nutrition.saturatedFatG;
    }
    const levels = offNutrientLevelsFromHit(hit);
    if (
        levels != null &&
        (food.offNutrientLevels == null || hitQualityIsNewer(food, hit))
    ) {
        patch.offNutrientLevels = levels;
    }
    return Object.keys(patch).length > 0 ? patch : null;
}

export function foodQualityFromHit(hit: FoodResult): FoodQuality | null {
    const q = hit.quality;
    if (q === undefined) return null;
    return {
        nutriscoreGrade: q.nutriscore_grade,
        novaGroup: q.nova_group,
        ecoscoreGrade: q.ecoscore_grade,
        additives:
            q.additives_tags == null
                ? null
                : q.additives_tags.map((tag) => ({
                      tag,
                      risk: additiveRisk(tag),
                  })),
        allergensTags: q.allergens_tags == null ? null : [...q.allergens_tags],
        tracesTags: q.traces_tags == null ? null : [...q.traces_tags],
        ingredientsAnalysisTags:
            q.ingredients_analysis_tags == null
                ? null
                : [...q.ingredients_analysis_tags],
        labelsTags: q.labels_tags == null ? null : [...q.labels_tags],
        fetchedAt: q.fetched_at,
    };
}

function hitQualityIsNewer(food: Food, hit: FoodResult): boolean {
    const next = foodQualityFromHit(hit);
    if (next == null) return false;
    if (food.offQuality == null) return true;
    return (
        new Date(next.fetchedAt).getTime() >
        new Date(food.offQuality.fetchedAt).getTime()
    );
}

/** OFF confirmed the barcode exists but returned no usable product-quality fields. */
export function offQualityMissStamp(fetchedAt: string): FoodQuality {
    return {
        nutriscoreGrade: null,
        novaGroup: null,
        ecoscoreGrade: null,
        additives: null,
        allergensTags: null,
        tracesTags: null,
        ingredientsAnalysisTags: null,
        labelsTags: null,
        fetchedAt,
    };
}

/** Stored when OFF confirmed the barcode but returned no product-quality fields. */
export function offQualityIsEmptyMiss(quality: FoodQuality): boolean {
    return (
        quality.nutriscoreGrade == null &&
        quality.novaGroup == null &&
        quality.ecoscoreGrade == null &&
        quality.additives == null &&
        quality.allergensTags == null &&
        quality.tracesTags == null &&
        quality.ingredientsAnalysisTags == null &&
        quality.labelsTags == null
    );
}

export async function applyHitQualityToFood(
    store: FoodsStore,
    food: Food,
    hit: FoodResult,
): Promise<Food> {
    let current = food;
    const offPatch = offNutritionPatchFromHit(current, hit);
    if (offPatch) {
        const patched = await store.setFoodOffNutrition(
            current.householdId,
            current.id,
            offPatch,
        );
        if (patched) current = patched;
    }
    if (!hitQualityIsNewer(current, hit)) return current;
    const offQuality = foodQualityFromHit(hit);
    if (offQuality == null) return current;
    const updated = await store.setFoodQuality(
        current.householdId,
        current.id,
        offQuality,
    );
    return (
        updated ??
        (await store.getFood(current.householdId, current.id)) ??
        current
    );
}

export async function refreshFoodQualityByBarcode(
    store: FoodsStore,
    householdId: string,
    barcode: string,
    hit: FoodResult,
): Promise<Food | null> {
    const foodId = await store.getBarcodeFoodId(householdId, barcode);
    if (!foodId) return null;
    const food = await store.getFood(householdId, foodId);
    if (!food || food.archivedAt) return null;
    return applyHitQualityToFood(store, food, hit);
}

const OFF_COUNT_UNITS = new Set([
    "",
    "each",
    "unit",
    "units",
    "pcs",
    "pc",
    "piece",
    "pieces",
    "serving",
    "servings",
    "x",
    "count",
    "counts",
    "item",
    "items",
    "egg",
    "eggs",
]);

const COUNT_SERVING_WORD =
    /\b(egg|eggs|cookie|cookies|slice|slices|piece|pieces|each|unit|capsule|tablet|bar|bars)\b/i;

function countFromServingLabel(
    serving: string | null | undefined,
): number | null {
    if (!serving) return null;
    if (!COUNT_SERVING_WORD.test(serving)) return null;
    const match = serving.trim().match(/^(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : 1;
}

function gramsFromServingLabel(
    serving: string | null | undefined,
): number | null {
    if (!serving) return null;
    const match = serving.match(/(\d+(?:\.\d+)?)\s*g\b/i);
    if (!match) return null;
    const grams = Number(match[1]);
    return grams > 0 ? grams : null;
}

/** Prefill grams_per_each from OFF when the serving is a count. */
export function gramsPerEachFromOff(food: {
    serving?: string | null;
    serving_quantity?: number | null;
    serving_quantity_unit?: string | null;
}): number | null {
    const unit = (food.serving_quantity_unit ?? "").trim().toLowerCase();
    const qty =
        food.serving_quantity != null && Number.isFinite(food.serving_quantity)
            ? food.serving_quantity
            : null;
    const count = countFromServingLabel(food.serving);
    if (count == null || !(count > 0)) return null;
    if (unit === "g" || unit === "gr" || unit === "gram" || unit === "grams") {
        if (qty != null && qty > 0) return Math.round((qty / count) * 10) / 10;
    }
    if (OFF_COUNT_UNITS.has(unit) && qty != null && qty > 0 && qty >= 5) {
        // Some OFF records store the serving mass in serving_quantity with a
        // count unit. Only treat large values as grams, never "1 each" as 1 g.
        return Math.round((qty / count) * 10) / 10;
    }
    const labeled = gramsFromServingLabel(food.serving);
    if (labeled == null) return null;
    return Math.round((labeled / count) * 10) / 10;
}

function copyQuality(q: FoodQuality): FoodQuality {
    return {
        nutriscoreGrade: q.nutriscoreGrade,
        novaGroup: q.novaGroup,
        ecoscoreGrade: q.ecoscoreGrade,
        additives:
            q.additives == null
                ? null
                : q.additives.map((a) => ({ tag: a.tag, risk: a.risk })),
        allergensTags: q.allergensTags == null ? null : [...q.allergensTags],
        tracesTags: q.tracesTags == null ? null : [...q.tracesTags],
        ingredientsAnalysisTags:
            q.ingredientsAnalysisTags == null
                ? null
                : [...q.ingredientsAnalysisTags],
        labelsTags: q.labelsTags == null ? null : [...q.labelsTags],
        fetchedAt: q.fetchedAt,
    };
}

function copyFood(row: Food): Food {
    return {
        ...row,
        allergens: [...row.allergens],
        usualAmount:
            row.usualAmount == null
                ? null
                : {
                      amount: row.usualAmount.amount,
                      unit: row.usualAmount.unit,
                  },
        offQuality: row.offQuality == null ? null : copyQuality(row.offQuality),
        offNutrientLevels:
            row.offNutrientLevels == null ? null : { ...row.offNutrientLevels },
    };
}

function foodKey(row: {
    householdId: string;
    kind: FoodKind;
    normalizedName: string;
    brand: string | null;
    archivedAt: string | null;
}): string | null {
    if (row.archivedAt) return null;
    return `${row.householdId}\0${row.kind}\0${row.normalizedName}\0${row.brand ?? ""}`;
}

export type MemoryFoodRefRow = {
    foodId: string;
    householdId?: string;
    [key: string]: unknown;
};

export type MemoryFoodRefHolder = {
    repointFood(householdId: string, fromId: string, toId: string): void;
    countFoodRefs?(householdId: string): Map<string, number>;
};

export type MemoryFoodsStore = FoodsStore &
    MemoryNoticeDismissalsHolder & {
        refs: MemoryFoodRefRow[];
        trackRef(
            foodId: string,
            householdId?: string,
            extra?: Record<string, unknown>,
        ): MemoryFoodRefRow;
        linkRefs(holder: MemoryFoodRefHolder): void;
        setPluralsSameFood(householdId: string, enabled: boolean): void;
    };

export function createMemoryFoodsStore(): MemoryFoodsStore {
    const foods: Food[] = [];
    const barcodes: { householdId: string; barcode: string; foodId: string }[] =
        [];
    const aliases: { householdId: string; alias: string; foodId: string }[] =
        [];
    const refs: MemoryFoodRefRow[] = [];
    const refHolders: MemoryFoodRefHolder[] = [];
    let linkedDismissals: NoticeDismissalsStore | undefined;
    const pluralsOn = new Set<string>();

    const store: MemoryFoodsStore = {
        refs,
        setPluralsSameFood(householdId, enabled) {
            if (enabled) pluralsOn.add(householdId);
            else pluralsOn.delete(householdId);
        },
        async pluralsSameFood(householdId) {
            return pluralsOn.has(householdId);
        },
        linkDismissals(s) {
            linkedDismissals = s;
        },
        dismissalsStore() {
            return linkedDismissals;
        },
        trackRef(foodId, householdId, extra) {
            const row: MemoryFoodRefRow = {
                foodId,
                ...(extra ?? {}),
            };
            if (householdId !== undefined) row.householdId = householdId;
            refs.push(row);
            return row;
        },
        linkRefs(holder) {
            refHolders.push(holder);
        },
        async listFoods(householdId) {
            return foods
                .filter(
                    (row) =>
                        row.householdId === householdId &&
                        row.archivedAt == null,
                )
                .map(copyFood)
                .sort((a, b) => a.name.localeCompare(b.name));
        },
        async getFood(householdId, id) {
            const row = foods.find(
                (food) => food.householdId === householdId && food.id === id,
            );
            return row ? copyFood(row) : null;
        },
        async getFoodsByIds(householdId, ids) {
            const unique = [...new Set(ids)];
            const out = new Map<string, Food>();
            for (const id of unique) {
                const row = foods.find(
                    (food) =>
                        food.householdId === householdId && food.id === id,
                );
                if (row) out.set(id, copyFood(row));
            }
            return out;
        },
        async insertFood(row) {
            const key = foodKey(row);
            if (
                key &&
                foods.some(
                    (food) => foodKey(food) === key && food.id !== row.id,
                )
            ) {
                throw new FoodsInputError("That food already exists.");
            }
            const saved = copyFood(row);
            foods.push(saved);
            return copyFood(saved);
        },
        async updateFoodRow(row) {
            const idx = foods.findIndex(
                (food) =>
                    food.id === row.id && food.householdId === row.householdId,
            );
            if (idx < 0) return null;
            const prior = foods[idx]!;
            const key = foodKey(row);
            if (
                key &&
                foods.some(
                    (food) => foodKey(food) === key && food.id !== row.id,
                )
            ) {
                throw new FoodsInputError("That food already exists.");
            }
            foods[idx] = copyFood(row);
            if (prior.archivedAt == null && row.archivedAt != null) {
                await cleanupDismissalsForFood(
                    linkedDismissals,
                    row.householdId,
                    row.id,
                );
            }
            return copyFood(row);
        },
        async setFoodQuality(householdId, foodId, quality, opts) {
            const idx = foods.findIndex(
                (food) =>
                    food.householdId === householdId && food.id === foodId,
            );
            if (idx < 0) return null;
            const row = foods[idx]!;
            if (row.archivedAt != null) return null;
            const priorFetched = row.offQuality?.fetchedAt;
            if (priorFetched != null && opts?.onlyIfUnset) return null;
            if (
                priorFetched != null &&
                new Date(priorFetched).getTime() >=
                    new Date(quality.fetchedAt).getTime()
            ) {
                return null;
            }
            const next = copyFood(row);
            next.offQuality = copyQuality(quality);
            next.updatedAt = nowIso();
            foods[idx] = next;
            return copyFood(next);
        },
        async setFoodOffNutrition(householdId, foodId, patch) {
            const idx = foods.findIndex(
                (food) =>
                    food.householdId === householdId && food.id === foodId,
            );
            if (idx < 0) return null;
            const row = foods[idx]!;
            if (row.archivedAt != null) return null;
            let changed = false;
            const next = copyFood(row);
            if (
                patch.saturatedFatG != null &&
                patch.saturatedFatG >= 0 &&
                next.saturatedFatG == null
            ) {
                next.saturatedFatG = patch.saturatedFatG;
                changed = true;
            }
            if (patch.offNutrientLevels != null) {
                next.offNutrientLevels = { ...patch.offNutrientLevels };
                changed = true;
            }
            if (!changed) return null;
            next.updatedAt = nowIso();
            foods[idx] = next;
            return copyFood(next);
        },
        async getByNormalizedName(householdId, kind, normalizedName) {
            const matches = foods.filter(
                (food) =>
                    food.householdId === householdId &&
                    food.kind === kind &&
                    food.normalizedName === normalizedName &&
                    food.archivedAt == null,
            );
            if (matches.length === 0) return null;
            matches.sort((a, b) => {
                const aPlain = a.brand == null ? 1 : 0;
                const bPlain = b.brand == null ? 1 : 0;
                if (aPlain !== bPlain) return bPlain - aPlain;
                const byCreated = a.createdAt.localeCompare(b.createdAt);
                if (byCreated !== 0) return byCreated;
                return a.id.localeCompare(b.id);
            });
            return copyFood(matches[0]!);
        },
        async getByOffSourceId(householdId, offSourceId) {
            const row = foods.find(
                (food) =>
                    food.householdId === householdId &&
                    food.offSourceId === offSourceId &&
                    food.archivedAt == null,
            );
            return row ? copyFood(row) : null;
        },
        async getBarcodeFoodId(householdId, barcode) {
            return (
                barcodes.find(
                    (row) =>
                        row.householdId === householdId &&
                        row.barcode === barcode,
                )?.foodId ?? null
            );
        },
        async listBarcodes(householdId, foodId) {
            return barcodes
                .filter(
                    (row) =>
                        row.householdId === householdId &&
                        row.foodId === foodId,
                )
                .map((row) => row.barcode);
        },
        async listBarcodesForFoods(householdId, foodIds) {
            if (foodIds.length === 0) return new Map();
            const want = new Set(foodIds);
            const grouped = new Map<string, string[]>();
            for (const row of barcodes) {
                if (row.householdId !== householdId || !want.has(row.foodId)) {
                    continue;
                }
                const list = grouped.get(row.foodId);
                if (list) list.push(row.barcode);
                else grouped.set(row.foodId, [row.barcode]);
            }
            return grouped;
        },
        async getBarcodeFoodIds(householdId, barcodesIn) {
            if (barcodesIn.length === 0) return new Map();
            const want = new Set(barcodesIn);
            const out = new Map<string, string>();
            for (const row of barcodes) {
                if (row.householdId !== householdId || !want.has(row.barcode)) {
                    continue;
                }
                if (!out.has(row.barcode)) out.set(row.barcode, row.foodId);
            }
            return out;
        },
        async setBarcode(householdId, barcode, foodId) {
            const idx = barcodes.findIndex(
                (row) =>
                    row.householdId === householdId && row.barcode === barcode,
            );
            if (idx >= 0) barcodes[idx] = { householdId, barcode, foodId };
            else barcodes.push({ householdId, barcode, foodId });
        },
        async deleteBarcodesForFood(householdId, foodId) {
            const removed = barcodes
                .filter(
                    (row) =>
                        row.householdId === householdId &&
                        row.foodId === foodId,
                )
                .map((row) => row.barcode);
            const keep = barcodes.filter(
                (row) =>
                    !(row.householdId === householdId && row.foodId === foodId),
            );
            barcodes.length = 0;
            barcodes.push(...keep);
            return removed;
        },
        async getAliasFoodId(householdId, alias) {
            return (
                aliases.find(
                    (row) =>
                        row.householdId === householdId && row.alias === alias,
                )?.foodId ?? null
            );
        },
        async listAliases(householdId, foodId) {
            return aliases
                .filter(
                    (row) =>
                        row.householdId === householdId &&
                        row.foodId === foodId,
                )
                .map((row) => row.alias)
                .sort((a, b) => a.localeCompare(b));
        },
        async listAllAliases(householdId) {
            const grouped = new Map<string, string[]>();
            const rows = aliases
                .filter((row) => row.householdId === householdId)
                .slice()
                .sort(
                    (a, b) =>
                        a.foodId.localeCompare(b.foodId) ||
                        a.alias.localeCompare(b.alias),
                );
            for (const row of rows) {
                const list = grouped.get(row.foodId);
                if (list) list.push(row.alias);
                else grouped.set(row.foodId, [row.alias]);
            }
            return grouped;
        },
        async setAlias(householdId, alias, foodId) {
            const idx = aliases.findIndex(
                (row) => row.householdId === householdId && row.alias === alias,
            );
            if (idx >= 0) aliases[idx] = { householdId, alias, foodId };
            else aliases.push({ householdId, alias, foodId });
        },
        async deleteAlias(householdId, alias) {
            const next = aliases.filter(
                (row) =>
                    !(row.householdId === householdId && row.alias === alias),
            );
            aliases.length = 0;
            aliases.push(...next);
        },
        async deleteAliasesForFood(householdId, foodId) {
            const removed = aliases
                .filter(
                    (row) =>
                        row.householdId === householdId &&
                        row.foodId === foodId,
                )
                .map((row) => row.alias);
            const keep = aliases.filter(
                (row) =>
                    !(row.householdId === householdId && row.foodId === foodId),
            );
            aliases.length = 0;
            aliases.push(...keep);
            return removed;
        },
        async searchFoods(householdId, query) {
            // Same needle as the live store: trim and lower case only, so
            // "oat  milk" does not match "oat milk" here either.
            const needle = query.trim().toLowerCase();
            if (!needle) return [];
            const listed = await store.listFoods(householdId);
            const aliasMap = await store.listAllAliases(householdId);
            const hits: Food[] = [];
            for (const food of listed) {
                const aliasList = aliasMap.get(food.id) ?? [];
                const hay = [
                    food.name,
                    food.normalizedName,
                    food.brand ?? "",
                    ...aliasList,
                ]
                    .join(" ")
                    .toLowerCase();
                if (hay.includes(needle)) hits.push(food);
            }
            return hits;
        },
        async listBarcodedFoodIds(householdId) {
            const ids = new Set<string>();
            for (const row of barcodes) {
                if (row.householdId === householdId) ids.add(row.foodId);
            }
            return ids;
        },
        async repointFoodRefs(householdId, fromId, toId) {
            for (const row of refs) {
                if (row.foodId !== fromId) continue;
                if (
                    row.householdId !== undefined &&
                    row.householdId !== householdId
                ) {
                    continue;
                }
                row.foodId = toId;
            }
            for (const holder of refHolders) {
                holder.repointFood(householdId, fromId, toId);
            }
        },
        async countFoodRefs(householdId) {
            const counts = new Map<string, number>();
            const bump = (foodId: string, n = 1) => {
                counts.set(foodId, (counts.get(foodId) ?? 0) + n);
            };
            for (const row of refs) {
                if (
                    row.householdId !== undefined &&
                    row.householdId !== householdId
                ) {
                    continue;
                }
                bump(row.foodId);
            }
            for (const holder of refHolders) {
                const extra = holder.countFoodRefs?.(householdId);
                if (!extra) continue;
                for (const [id, n] of extra) {
                    bump(id, n);
                }
            }
            return counts;
        },
    };
    return store;
}

function nowIso(): string {
    return new Date().toISOString();
}

export function newFood(input: {
    householdId: string;
    kind: FoodKind;
    name: string;
    brand?: string | null;
    defaultUnit?: string;
    gramsPerEach?: number | null;
    gramsPerMl?: number | null;
    calories?: number | null;
    proteinG?: number | null;
    carbsG?: number | null;
    fatG?: number | null;
    fiberG?: number | null;
    sugarG?: number | null;
    saturatedFatG?: number | null;
    alcoholG?: number | null;
    caffeineMg?: number | null;
    nutritionSource?: NutritionSource | null;
    offNutrientLevels?: Record<string, NutrientLevel> | null;
    allergens?: string[];
    offSourceId?: string | null;
    genericFoodId?: string | null;
    usualProductId?: string | null;
    usualStoreId?: string | null;
    usualAmount?: UsualAmount | null;
    restockSchedule?: RestockSchedule | null;
    restockEveryWeeks?: number | null;
    restockPaused?: boolean;
    restockWhenLow?: boolean;
    restockLowLevel?: number | null;
    lastRestockedOn?: string | null;
    offQuality?: FoodQuality | null;
    createdBy?: string | null;
}): Food {
    const name = input.name.trim();
    const stamp = nowIso();
    return {
        id: crypto.randomUUID(),
        householdId: input.householdId,
        kind: input.kind,
        name,
        normalizedName: normalizeFoodName(name),
        brand: input.brand?.trim() ? input.brand.trim() : null,
        defaultUnit: input.defaultUnit ?? "g",
        gramsPerEach: input.gramsPerEach ?? null,
        gramsPerMl: input.gramsPerMl ?? null,
        calories: input.calories ?? null,
        proteinG: input.proteinG ?? null,
        carbsG: input.carbsG ?? null,
        fatG: input.fatG ?? null,
        fiberG: input.fiberG ?? null,
        sugarG: input.sugarG ?? null,
        saturatedFatG: input.saturatedFatG ?? null,
        alcoholG: input.alcoholG ?? null,
        caffeineMg: input.caffeineMg ?? null,
        nutritionSource: input.nutritionSource ?? null,
        offNutrientLevels:
            input.offNutrientLevels == null
                ? null
                : { ...input.offNutrientLevels },
        allergens: [...(input.allergens ?? [])],
        offSourceId: input.offSourceId ?? null,
        genericFoodId: input.genericFoodId ?? null,
        usualProductId: input.usualProductId ?? null,
        usualStoreId: input.usualStoreId ?? null,
        usualAmount:
            input.usualAmount == null ? null : { ...input.usualAmount },
        restockSchedule: input.restockSchedule ?? null,
        restockEveryWeeks: input.restockEveryWeeks ?? null,
        restockPaused: input.restockPaused ?? false,
        restockWhenLow: input.restockWhenLow ?? false,
        restockLowLevel: input.restockLowLevel ?? null,
        lastRestockedOn: input.lastRestockedOn ?? null,
        offQuality:
            input.offQuality == null ? null : copyQuality(input.offQuality),
        createdBy: input.createdBy ?? null,
        archivedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
    };
}

function normalizeFoodBrand(brand: string | null | undefined): string | null {
    if (brand == null) return null;
    const trimmed = brand.trim();
    return trimmed ? trimmed : null;
}

export async function findFoodByNameAndBrand(
    store: FoodsStore,
    householdId: string,
    kind: FoodKind,
    name: string,
    brand: string | null,
): Promise<Food | null> {
    const normalized = normalizeFoodName(name.trim());
    if (!normalized) return null;
    const targetBrand = normalizeFoodBrand(brand);
    const listed = await store.listFoods(householdId);
    const row = listed.find(
        (food) =>
            food.kind === kind &&
            food.normalizedName === normalized &&
            normalizeFoodBrand(food.brand) === targetBrand,
    );
    return row ? copyFood(row) : null;
}

/**
 * Rejects a barcode that a different live household food already holds.
 * `targetId` is the row the caller is about to write (null when creating):
 * a barcode it already holds is fine. Reads only, so callers run it before
 * their first write.
 */
export async function assertBarcodeFree(
    store: FoodsStore,
    householdId: string,
    normalized: string,
    targetId: string | null,
): Promise<void> {
    const ownerId = await store.getBarcodeFoodId(householdId, normalized);
    if (!ownerId || ownerId === targetId) return;
    const owner = await store.getFood(householdId, ownerId);
    if (owner && !owner.archivedAt) {
        throw new FoodsInputError(
            `That barcode already belongs to ${owner.name}.`,
        );
    }
}

/**
 * Throws the error `updateFood` would throw for these patch values, without
 * writing: name, grams factors, nutrients, and aliases held by another food.
 * Lets a create-then-update caller reject before it inserts anything.
 */
export async function assertFoodPatchValid(
    store: FoodsStore,
    householdId: string,
    foodId: string | null,
    patch: FoodPatch,
): Promise<void> {
    if (patch.name != null && !patch.name.trim()) {
        throw new FoodsInputError("Enter a food name.");
    }
    parsePositiveFactor(patch.gramsPerEach);
    parsePositiveFactor(patch.gramsPerMl);
    for (const value of [
        patch.calories,
        patch.proteinG,
        patch.carbsG,
        patch.fatG,
        patch.fiberG,
        patch.sugarG,
        patch.alcoholG,
        patch.caffeineMg,
    ]) {
        parseOptionalNutrient(value);
    }
    for (const raw of patch.aliases ?? []) {
        const alias = normalizeFoodName(raw);
        if (!alias) continue;
        const taken = await store.getAliasFoodId(householdId, alias);
        if (taken && taken !== foodId) {
            throw new FoodsInputError("That alias is already used.");
        }
    }
}

export type UpsertNameResolution =
    | { kind: "existing"; food: Food }
    | { kind: "create"; name: string; brand: string | null };

/**
 * How `upsert_food` without `food_id` resolves a name, without writing. The
 * exact name-and-brand key wins. With no brand, an unbranded name or alias
 * match is reused, but a branded row never is: the caller meant the plain
 * food. Otherwise the caller creates a new row.
 */
export async function findUpsertFoodByName(
    store: FoodsStore,
    householdId: string,
    kind: FoodKind,
    name: string,
    brand: string | null | undefined,
): Promise<UpsertNameResolution> {
    const trimmed = name.trim();
    if (!trimmed) {
        throw new FoodsInputError(
            kind === "supply" ? "Enter a supply name." : "Enter a food name.",
        );
    }
    const keyBrand = normalizeFoodBrand(brand);
    const exact = await findFoodByNameAndBrand(
        store,
        householdId,
        kind,
        trimmed,
        keyBrand,
    );
    if (exact) return { kind: "existing", food: exact };
    if (keyBrand == null) {
        const normalized = normalizeFoodName(trimmed);
        const existing = await existingByNameOrAlias(
            store,
            householdId,
            kind,
            normalized,
        );
        if (existing && !existing.brand) {
            return { kind: "existing", food: existing };
        }
        const loose = await findFoodByLooseKey(
            store,
            householdId,
            kind,
            trimmed,
            { rejectBranded: true },
        );
        if (loose) return { kind: "existing", food: loose };
    } else {
        const loose = await findFoodByLooseKey(
            store,
            householdId,
            kind,
            trimmed,
            { requiredBrand: keyBrand },
        );
        if (loose) return { kind: "existing", food: loose };
    }
    return { kind: "create", name: trimmed, brand: keyBrand };
}

async function existingByNameOrAlias(
    store: FoodsStore,
    householdId: string,
    kind: FoodKind,
    normalized: string,
): Promise<Food | null> {
    const byName = await store.getByNormalizedName(
        householdId,
        kind,
        normalized,
    );
    if (byName) return byName;
    const aliasId = await store.getAliasFoodId(householdId, normalized);
    if (!aliasId) return null;
    const aliased = await store.getFood(householdId, aliasId);
    if (!aliased || aliased.kind !== kind || aliased.archivedAt) return null;
    return aliased;
}

async function storePluralsSameFood(
    store: FoodsStore,
    householdId: string,
): Promise<boolean> {
    return store.pluralsSameFood ? store.pluralsSameFood(householdId) : false;
}

/**
 * Live foods of `kind` whose name has the same loose key as `name`. With
 * `plurals`, the plural-free key is tried when the loose key finds nothing,
 * so an exact spelling still wins over a singular or plural one.
 */
function filterLooseNameMatches(
    foods: readonly Food[],
    kind: FoodKind,
    name: string,
    plurals: boolean,
): Food[] {
    const live = foods.filter(
        (food) => food.kind === kind && food.archivedAt == null,
    );
    const key = looseFoodKey(name);
    const loose = live.filter((food) => looseFoodKey(food.name) === key);
    if (loose.length > 0 || !plurals) return loose;
    const pluralFree = pluralFreeFoodKey(name);
    if (!pluralFree) return [];
    return live.filter((food) => pluralFreeFoodKey(food.name) === pluralFree);
}

function preferLooseNameMatch(a: Food, b: Food): number {
    const aPlain = a.brand == null ? 1 : 0;
    const bPlain = b.brand == null ? 1 : 0;
    if (aPlain !== bPlain) return bPlain - aPlain;
    const byCreated = a.createdAt.localeCompare(b.createdAt);
    if (byCreated !== 0) return byCreated;
    return a.id.localeCompare(b.id);
}

async function findFoodByLooseKey(
    store: FoodsStore,
    householdId: string,
    kind: FoodKind,
    name: string,
    opts?: { rejectBranded?: boolean; requiredBrand?: string | null },
): Promise<Food | null> {
    const listed = await store.listFoods(householdId);
    const plurals = await storePluralsSameFood(store, householdId);
    let matches = filterLooseNameMatches(listed, kind, name, plurals);
    if (opts?.rejectBranded) {
        matches = matches.filter((food) => food.brand == null);
    }
    if (opts?.requiredBrand !== undefined) {
        const want = normalizeFoodBrand(opts.requiredBrand);
        matches = matches.filter(
            (food) => normalizeFoodBrand(food.brand) === want,
        );
    }
    if (matches.length === 0) return null;
    matches.sort(preferLooseNameMatch);
    return copyFood(matches[0]!);
}

export async function findOrCreateFoodByBarcodeFromHit(
    store: FoodsStore,
    householdId: string,
    normalized: string,
    hit: FoodResult,
): Promise<{ food: Food; created: boolean }> {
    const existingId = await store.getBarcodeFoodId(householdId, normalized);
    if (existingId) {
        const existing = await store.getFood(householdId, existingId);
        if (existing && !existing.archivedAt) {
            const food = await applyHitQualityToFood(store, existing, hit);
            return { food, created: false };
        }
    }
    const byOff = await store.getByOffSourceId(householdId, normalized);
    if (byOff) {
        await store.setBarcode(householdId, normalized, byOff.id);
        const food = await applyHitQualityToFood(store, byOff, hit);
        return { food, created: false };
    }
    const byName = await existingByNameOrAlias(
        store,
        householdId,
        "food",
        normalizeFoodName(hit.name),
    );
    if (byName) {
        await store.setBarcode(householdId, normalized, byName.id);
        const food = await applyHitQualityToFood(store, byName, hit);
        return { food, created: false };
    }
    const nutrition = catalogNutritionFromOff(hit);
    const created = await store.insertFood(
        newFood({
            householdId,
            kind: "food",
            name: hit.name,
            brand: hit.brand,
            ...nutrition,
            offNutrientLevels: offNutrientLevelsFromHit(hit),
            gramsPerEach: gramsPerEachFromOff(hit),
            nutritionSource: "openfoodfacts",
            allergens: hit.allergens ?? mapOffAllergenTags(hit.allergens_tags),
            offSourceId: normalized,
            offQuality: foodQualityFromHit(hit),
        }),
    );
    await store.setBarcode(householdId, normalized, created.id);
    return { food: created, created: true };
}

export async function findOrCreateFoodByBarcodeResult(
    store: FoodsStore,
    householdId: string,
    barcode: string,
    lookup: (barcode: string) => Promise<FoodResult | null>,
): Promise<{ food: Food; created: boolean }> {
    const normalized = normalizeBarcode(barcode);
    if (!normalized) throw new FoodsInputError("Enter a valid barcode.");
    const existingId = await store.getBarcodeFoodId(householdId, normalized);
    if (existingId) {
        const existing = await store.getFood(householdId, existingId);
        if (existing && !existing.archivedAt) {
            const needsNutritionFill =
                existing.offNutrientLevels == null ||
                existing.saturatedFatG == null;
            const needsOffLookup =
                existing.offQuality == null ||
                (needsNutritionFill &&
                    existing.offQuality != null &&
                    !offQualityIsEmptyMiss(existing.offQuality));
            if (needsOffLookup) {
                try {
                    const hit = await lookup(normalized);
                    if (hit) {
                        const food = await applyHitQualityToFood(
                            store,
                            existing,
                            hit,
                        );
                        return { food, created: false };
                    }
                    if (existing.offQuality == null) {
                        const stamped = await store.setFoodQuality(
                            householdId,
                            existing.id,
                            offQualityMissStamp(nowIso()),
                            { onlyIfUnset: true },
                        );
                        const food =
                            stamped ??
                            (await store.getFood(householdId, existing.id)) ??
                            existing;
                        return { food, created: false };
                    }
                    return { food: existing, created: false };
                } catch {
                    const food =
                        (await store.getFood(householdId, existing.id)) ??
                        existing;
                    return { food, created: false };
                }
            }
            return { food: existing, created: false };
        }
    }
    let hit: FoodResult | null;
    try {
        hit = await lookup(normalized);
    } catch {
        throw new FoodsInputError(
            "Couldn't reach Open Food Facts. Try again in a moment, or add the food by name.",
        );
    }
    if (hit == null) throw new FoodsInputError("Unknown barcode.");
    return findOrCreateFoodByBarcodeFromHit(
        store,
        householdId,
        normalized,
        hit,
    );
}

export async function findOrCreateFoodByBarcode(
    store: FoodsStore,
    householdId: string,
    barcode: string,
    lookup: (barcode: string) => Promise<FoodResult | null>,
): Promise<Food> {
    return (
        await findOrCreateFoodByBarcodeResult(
            store,
            householdId,
            barcode,
            lookup,
        )
    ).food;
}

/** The food `findOrCreateManualFood` would return without creating one, or null. */
export async function findManualFood(
    store: FoodsStore,
    householdId: string,
    kind: FoodKind,
    name: string,
): Promise<Food | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = await existingByNameOrAlias(
        store,
        householdId,
        kind,
        normalizeFoodName(trimmed),
    );
    if (existing) return existing;
    return findFoodByLooseKey(store, householdId, kind, trimmed);
}

/** Recipe import: try stripped names for lookup only, then create under `name`. */
export async function findOrCreateManualFoodForRecipeImport(
    store: FoodsStore,
    householdId: string,
    kind: FoodKind,
    name: string,
    opts?: { onSimilar?: OnSimilar },
): Promise<Food> {
    const trimmed = name.trim();
    if (!trimmed) {
        throw new FoodsInputError(
            kind === "supply" ? "Enter a supply name." : "Enter a food name.",
        );
    }
    const plurals = await storePluralsSameFood(store, householdId);
    for (const variant of ingredientLookupVariants(trimmed, { plurals })) {
        const found = await findManualFood(store, householdId, kind, variant);
        if (found) return found;
    }
    return findOrCreateManualFood(store, householdId, kind, trimmed, opts);
}

export async function findOrCreateManualFood(
    store: FoodsStore,
    householdId: string,
    kind: FoodKind,
    name: string,
    opts?: { onSimilar?: OnSimilar },
): Promise<Food> {
    const onSimilar = opts?.onSimilar ?? "create";
    const trimmed = name.trim();
    if (!trimmed) {
        throw new FoodsInputError(
            kind === "supply" ? "Enter a supply name." : "Enter a food name.",
        );
    }
    const found = await findManualFood(store, householdId, kind, trimmed);
    if (found) return found;
    if (onSimilar === "ask") {
        const entries = await similarFoodsForNames(store, householdId, kind, [
            trimmed,
        ]);
        if (entries.length > 0) {
            throw new SimilarFoodsError(entries);
        }
    }
    return store.insertFood(
        newFood({
            householdId,
            kind,
            name: trimmed,
        }),
    );
}

export async function findFoodById(
    store: FoodsStore,
    householdId: string,
    foodId: string,
): Promise<Food> {
    const food = await store.getFood(householdId, foodId);
    if (!food || food.archivedAt) {
        throw new FoodsInputError("Unknown food.");
    }
    return food;
}

export async function resolveFoodForWrite(
    store: FoodsStore,
    householdId: string,
    kind: FoodKind,
    input: {
        foodId?: string;
        barcode?: string;
        name?: string;
    },
    lookup?: (barcode: string) => Promise<FoodResult | null>,
    opts?: { onSimilar?: OnSimilar },
): Promise<Food> {
    const foodId = input.foodId?.trim();
    if (foodId) {
        const food = await findFoodById(store, householdId, foodId);
        if (food.kind !== kind) {
            throw new FoodsInputError(
                kind === "supply"
                    ? "That catalog item is a food."
                    : "That catalog item is a supply.",
            );
        }
        return food;
    }
    const barcode = input.barcode?.trim();
    if (barcode) {
        if (!lookup) throw new FoodsInputError("Enter a valid barcode.");
        const food = await findOrCreateFoodByBarcode(
            store,
            householdId,
            barcode,
            lookup,
        );
        if (food.kind !== kind) {
            throw new FoodsInputError(
                kind === "supply"
                    ? "That catalog item is a food."
                    : "That catalog item is a supply.",
            );
        }
        return food;
    }
    return findOrCreateManualFood(store, householdId, kind, input.name ?? "", {
        onSimilar: opts?.onSimilar,
    });
}

export async function foodsByIds(
    store: FoodsStore,
    householdId: string,
    ids: Iterable<string | null | undefined>,
): Promise<Map<string, Food>> {
    const unique = [
        ...new Set(
            [...ids].filter((id): id is string => Boolean(id && id.trim())),
        ),
    ];
    if (unique.length === 0) return new Map();
    return store.getFoodsByIds(householdId, unique);
}

export type FoodProductRef = { id: string; name: string; brand: string | null };
export type EffectiveFood = Food & { product: FoodProductRef | null };

export const NUTRITION_BLOCK_KEYS = [
    "calories",
    "proteinG",
    "carbsG",
    "fatG",
    "fiberG",
    "sugarG",
    "alcoholG",
    "caffeineMg",
] as const;

export function familyOf(food: Pick<Food, "id" | "genericFoodId">): string {
    return food.genericFoodId ?? food.id;
}

export function usualHasAnyNutrient(food: Food): boolean {
    return NUTRITION_BLOCK_KEYS.some((key) => food[key] != null);
}

export function mergeAllergens(plain: string[], usual: string[]): string[] {
    const out = [...plain];
    const seen = new Set(plain);
    for (const code of usual) {
        if (!seen.has(code)) {
            seen.add(code);
            out.push(code);
        }
    }
    return out;
}

type NutritionBlockPick = Pick<
    Food,
    (typeof NUTRITION_BLOCK_KEYS)[number] | "nutritionSource" | "saturatedFatG"
>;

function nutritionBlockFrom(source: Food): NutritionBlockPick {
    return {
        calories: source.calories,
        proteinG: source.proteinG,
        carbsG: source.carbsG,
        fatG: source.fatG,
        fiberG: source.fiberG,
        sugarG: source.sugarG,
        saturatedFatG: source.saturatedFatG,
        alcoholG: source.alcoholG,
        caffeineMg: source.caffeineMg,
        nutritionSource: source.nutritionSource,
    };
}

function mergeTagArray(
    keep: string[] | null,
    drop: string[] | null,
): string[] | null {
    if (keep !== null) return [...keep];
    if (drop !== null) return [...drop];
    return null;
}

function mergeOffQuality(
    keep: FoodQuality | null,
    drop: FoodQuality | null,
): FoodQuality | null {
    if (keep == null && drop == null) return null;
    if (keep == null) return copyQuality(drop!);
    if (drop == null) return copyQuality(keep);
    return {
        nutriscoreGrade: keep.nutriscoreGrade ?? drop.nutriscoreGrade,
        novaGroup: keep.novaGroup ?? drop.novaGroup,
        ecoscoreGrade: keep.ecoscoreGrade ?? drop.ecoscoreGrade,
        additives:
            keep.additives !== null
                ? keep.additives.map((a) => ({ tag: a.tag, risk: a.risk }))
                : drop.additives !== null
                  ? drop.additives.map((a) => ({ tag: a.tag, risk: a.risk }))
                  : null,
        allergensTags: mergeTagArray(keep.allergensTags, drop.allergensTags),
        tracesTags: mergeTagArray(keep.tracesTags, drop.tracesTags),
        ingredientsAnalysisTags: mergeTagArray(
            keep.ingredientsAnalysisTags,
            drop.ingredientsAnalysisTags,
        ),
        labelsTags: mergeTagArray(keep.labelsTags, drop.labelsTags),
        fetchedAt: keep.fetchedAt,
    };
}

/** Unknown fields on `keep` are filled from `drop` for merge; see `mergeFoods`. */
export type MergedFoodFieldPick = Pick<
    Food,
    | (typeof NUTRITION_BLOCK_KEYS)[number]
    | "nutritionSource"
    | "saturatedFatG"
    | "gramsPerEach"
    | "gramsPerMl"
    | "defaultUnit"
    | "allergens"
    | "usualStoreId"
    | "usualAmount"
    | UsualScheduleKey
    | "offQuality"
    | "offNutrientLevels"
>;

export function mergedFoodFields(keep: Food, drop: Food): MergedFoodFieldPick {
    const nutritionBlock = usualHasAnyNutrient(keep)
        ? nutritionBlockFrom(keep)
        : usualHasAnyNutrient(drop)
          ? nutritionBlockFrom(drop)
          : nutritionBlockFrom(keep);

    const saturatedFatG = keep.saturatedFatG ?? drop.saturatedFatG ?? null;

    return {
        ...nutritionBlock,
        saturatedFatG,
        gramsPerEach: keep.gramsPerEach ?? drop.gramsPerEach,
        gramsPerMl: keep.gramsPerMl ?? drop.gramsPerMl,
        defaultUnit: keep.defaultUnit.trim()
            ? keep.defaultUnit
            : drop.defaultUnit,
        allergens: mergeAllergens(keep.allergens, drop.allergens),
        usualStoreId: keep.usualStoreId ?? drop.usualStoreId,
        usualAmount:
            keep.usualAmount != null
                ? { ...keep.usualAmount }
                : drop.usualAmount != null
                  ? { ...drop.usualAmount }
                  : null,
        ...mergedUsualSchedule(keep, drop),
        offQuality: mergeOffQuality(keep.offQuality, drop.offQuality),
        offNutrientLevels: keep.offNutrientLevels ?? drop.offNutrientLevels,
    };
}

export function effectiveFood(
    food: Food,
    catalog: ReadonlyMap<string, Food>,
): EffectiveFood {
    if (food.genericFoodId) {
        return { ...copyFood(food), product: null };
    }
    const usualId = food.usualProductId;
    if (!usualId) {
        return { ...copyFood(food), product: null };
    }
    const u = catalog.get(usualId);
    if (!u || u.archivedAt || u.genericFoodId !== food.id) {
        return { ...copyFood(food), product: null };
    }
    const base = copyFood(food);
    const product: FoodProductRef = {
        id: u.id,
        name: u.name,
        brand: u.brand,
    };
    const nutritionFrom = usualHasAnyNutrient(u) ? u : food;
    const block = nutritionBlockFrom(nutritionFrom);
    const saturatedFatG =
        block.saturatedFatG ?? u.saturatedFatG ?? food.saturatedFatG ?? null;
    const usualStoreId = u.usualStoreId ?? food.usualStoreId;
    const usualAmount =
        u.usualAmount != null
            ? { ...u.usualAmount }
            : food.usualAmount != null
              ? { ...food.usualAmount }
              : null;
    return {
        ...base,
        ...block,
        saturatedFatG,
        gramsPerEach: u.gramsPerEach ?? food.gramsPerEach,
        gramsPerMl: u.gramsPerMl ?? food.gramsPerMl,
        allergens: mergeAllergens(food.allergens, u.allergens),
        usualStoreId,
        usualAmount,
        product,
    };
}

function singularizeNameToken(token: string): string {
    if (token.length > 3 && token.endsWith("s")) {
        return token.slice(0, -1);
    }
    return token;
}

function prepareFoodNameForTokens(text: string): string {
    return normalizeFoodName(text).replace(/'/g, "").replace(/&/g, " and ");
}

export function looseFoodKey(name: string): string {
    return prepareFoodNameForTokens(name)
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/** Singular mass nouns whose "-es" is not a plural ending (see `(ss)es` rule). */
const PLURAL_FREE_SS_ES_SINGULAR = new Set(["molasses"]);

/**
 * One name word with a regular English plural ending removed, for a key that
 * makes two foods one. Stricter than `singularizeNameToken`, which only feeds
 * suggestions. The result is a key, not a word: where a singular and its
 * plural differ by more than an "s", both are cut to the stem they share.
 * - words ending in "ss" or "us" are left alone ("glass", "hummus");
 * - "-ies" and a consonant before "-y" meet at "…i"
 *   ("berry"/"berries", "cookie"/"cookies"); "-ie" drops the trailing "e"
 *   to join "-ies" ("cookie"/"cookies"); "pie"/"pies" share "pie";
 * - after ch, sh, x, z, ss or o, "-es" and "-e" both come off
 *   ("peach"/"peaches", "quiche"/"quiches", "glass"/"glasses",
 *   "tomato"/"tomatoes", "sloe"/"sloes");
 * - otherwise one trailing "s" comes off ("eggs", "dates", "greens").
 * Irregular plurals ("leaves", "loaves") stay apart from their singulars.
 */
function pluralFreeNameToken(token: string): string {
    if (/(ss|us)$/.test(token)) return token;
    if (PLURAL_FREE_SS_ES_SINGULAR.has(token)) return token;
    if (token.endsWith("ies") && token.length > 4) {
        return token.slice(0, -3) + "i";
    }
    if (token.length > 3 && token.endsWith("ie")) return token.slice(0, -1);
    if (/[^aeiou]y$/.test(token)) return token.slice(0, -1) + "i";
    if (/(ch|sh|x|z|ss|o)es$/.test(token)) return token.slice(0, -2);
    if (/(ch|sh|x|z|ss|o)e$/.test(token)) return token.slice(0, -1);
    if (token.length <= 3) return token;
    const single = singularizeNameToken(token);
    return single === token ? token : pluralFreeNameToken(single);
}

/**
 * `looseFoodKey` with each word's plural ending removed, so "Eggs" and "egg"
 * share a key. Name resolution and the merge job use it only when the
 * household treats singular and plural as the same food.
 */
export function pluralFreeFoodKey(name: string): string {
    const loose = looseFoodKey(name);
    if (!loose) return "";
    return loose.split(" ").map(pluralFreeNameToken).join(" ");
}

const INGREDIENT_LOOKUP_SIZE_WORDS = new Set([
    "extra",
    "extra-large",
    "jumbo",
    "large",
    "lg",
    "md",
    "med",
    "medium",
    "sm",
    "small",
    "x-large",
    "xl",
]);

const INGREDIENT_LOOKUP_PREP_WORDS = new Set([
    "beaten",
    "chopped",
    "crushed",
    "cubed",
    "diced",
    "drained",
    "fresh",
    "grated",
    "halved",
    "julienned",
    "melted",
    "minced",
    "peeled",
    "quartered",
    "rinsed",
    "seeded",
    "shredded",
    "sliced",
    "softened",
    "thawed",
    "trimmed",
]);

function stripIngredientParentheticals(name: string): string {
    let s = name;
    let prev = "";
    while (s !== prev) {
        prev = s;
        s = s.replace(/\([^()]*\)/g, " ");
    }
    return s.replace(/\s+/g, " ").trim();
}

function ingredientLookupTokenKey(token: string): string {
    return token.toLowerCase().replace(/[,.;:]+$/, "");
}

function isIngredientLookupSizeOrPrepToken(token: string): boolean {
    const key = ingredientLookupTokenKey(token);
    return (
        INGREDIENT_LOOKUP_SIZE_WORDS.has(key) ||
        INGREDIENT_LOOKUP_PREP_WORDS.has(key)
    );
}

function stripOneLeadingSizePrepWord(
    tokens: readonly string[],
): string[] | null {
    if (tokens.length === 0) return null;
    if (isIngredientLookupSizeOrPrepToken(tokens[0]!)) {
        return tokens.slice(1);
    }
    if (
        tokens.length >= 2 &&
        ingredientLookupTokenKey(tokens[0]!) === "extra" &&
        isIngredientLookupSizeOrPrepToken(tokens[1]!)
    ) {
        return tokens.slice(2);
    }
    return null;
}

function stripOneTrailingSizePrepWord(
    tokens: readonly string[],
): string[] | null {
    if (tokens.length === 0) return null;
    const last = tokens[tokens.length - 1]!;
    if (isIngredientLookupSizeOrPrepToken(last)) {
        return tokens.slice(0, -1);
    }
    return null;
}

function stripTrailingCommaPrepClause(name: string): string | null {
    const match = name.match(/^(.+?),\s*([\w-]+)\s*$/);
    if (!match) return null;
    const prep = ingredientLookupTokenKey(match[2]!);
    if (
        !INGREDIENT_LOOKUP_PREP_WORDS.has(prep) &&
        !INGREDIENT_LOOKUP_SIZE_WORDS.has(prep)
    ) {
        return null;
    }
    return match[1]!.trim();
}

/** Strip leading/trailing prep+size one word at a time; comma clauses first. */
function gradualIngredientLookupVariants(name: string): string[] {
    const variants: string[] = [];
    const seen = new Set<string>();

    const push = (s: string) => {
        const t = s.trim();
        if (!t || seen.has(t)) return;
        seen.add(t);
        variants.push(t);
    };

    const commaStripped = stripTrailingCommaPrepClause(name);
    if (commaStripped) push(commaStripped);

    const peelBase = commaStripped ?? name;
    let tokens = peelBase.split(/\s+/).filter(Boolean);
    for (;;) {
        const leading = stripOneLeadingSizePrepWord(tokens);
        const next = leading ?? stripOneTrailingSizePrepWord(tokens);
        if (!next || next.length === 0) break;
        tokens = next;
        push(tokens.join(" "));
    }
    return variants;
}

function pushIngredientLookupVariant(variants: string[], name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (variants.includes(trimmed)) return;
    variants.push(trimmed);
}

/**
 * Names to try when recipe import links an ingredient line to an existing food.
 * Each step only narrows the string for lookup; it never rewrites stored names.
 */
export function ingredientLookupVariants(
    raw: string,
    opts: { plurals: boolean },
): string[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    const variants: string[] = [];
    pushIngredientLookupVariant(variants, trimmed);
    const noParens = stripIngredientParentheticals(trimmed);
    pushIngredientLookupVariant(variants, noParens);
    for (const step of gradualIngredientLookupVariants(noParens)) {
        pushIngredientLookupVariant(variants, step);
    }
    const mostStripped =
        variants.length > 0 ? variants[variants.length - 1]! : noParens;
    if (opts.plurals) {
        const pluralFree = pluralFreeFoodKey(mostStripped);
        if (pluralFree) pushIngredientLookupVariant(variants, pluralFree);
    }
    return variants;
}

export function foodNameTokens(text: string): string[] {
    return prepareFoodNameForTokens(text)
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map(singularizeNameToken);
}

/** The fields word matching reads; recipes and stock rows can be matched too. */
export type WordMatchable = Pick<Food, "id" | "name" | "brand" | "archivedAt">;

function foodSearchTokenSet(
    food: WordMatchable,
    aliases: readonly string[],
): { set: Set<string>; list: string[] } {
    const parts = [food.name, food.brand ?? "", ...aliases];
    const list: string[] = [];
    for (const part of parts) {
        list.push(...foodNameTokens(part));
    }
    return { set: new Set(list), list };
}

function queryTokensMatchFood(
    queryTokens: readonly string[],
    foodTokens: { set: Set<string>; list: string[] },
): boolean {
    if (queryTokens.length === 0) return false;
    for (let i = 0; i < queryTokens.length - 1; i++) {
        if (!foodTokens.set.has(queryTokens[i]!)) return false;
    }
    const last = queryTokens[queryTokens.length - 1]!;
    if (foodTokens.set.has(last)) return true;
    return foodTokens.list.some((token) => token.startsWith(last));
}

export function matchFoodsByWords<T extends WordMatchable = Food>(
    query: string,
    foods: readonly T[],
    aliasesByFoodId: ReadonlyMap<string, string[]>,
): T[] {
    const queryTokens = foodNameTokens(query);
    if (queryTokens.length === 0) return [];
    const queryNorm = normalizeFoodName(query);
    const queryLoose = looseFoodKey(query);
    const queryTokenSet = new Set(queryTokens);
    const hits: T[] = [];
    // A food every query word names outright ranks ahead of one reached only
    // by the last word's prefix, so "eggs" puts Duck eggs before Eggplant.
    const needsPrefix = new Map<string, number>();
    for (const food of foods) {
        if (food.archivedAt) continue;
        const aliases = aliasesByFoodId.get(food.id) ?? [];
        const tokens = foodSearchTokenSet(food, aliases);
        if (!queryTokensMatchFood(queryTokens, tokens)) continue;
        hits.push(food);
        needsPrefix.set(
            food.id,
            queryTokens.every((token) => tokens.set.has(token)) ? 0 : 1,
        );
    }
    const nameTokens = (food: T) => foodNameTokens(food.name);
    const extraNameTokens = (food: T) =>
        nameTokens(food).filter((token) => !queryTokenSet.has(token)).length;
    const exactRank = (food: T) => {
        if (normalizeFoodName(food.name) === queryNorm) return 0;
        if (looseFoodKey(food.name) === queryLoose) return 0;
        return 1;
    };
    hits.sort((a, b) => {
        const exact = exactRank(a) - exactRank(b);
        if (exact !== 0) return exact;
        const prefix =
            (needsPrefix.get(a.id) ?? 1) - (needsPrefix.get(b.id) ?? 1);
        if (prefix !== 0) return prefix;
        const extra = extraNameTokens(a) - extraNameTokens(b);
        if (extra !== 0) return extra;
        if (a.name.length !== b.name.length) {
            return a.name.length - b.name.length;
        }
        const byName = a.name.localeCompare(b.name);
        if (byName !== 0) return byName;
        return a.id.localeCompare(b.id);
    });
    return hits;
}

export type SimilarFoodWhy = "same_words" | "contains_words" | "word_match";
export type SimilarFoodCandidate = { food: Food; why: SimilarFoodWhy };
export type SimilarFoodsEntry = {
    name: string;
    candidates: SimilarFoodCandidate[];
};
export type OnSimilar = "ask" | "create";

export const SIMILAR_FOODS_LIMIT = 3;

function foodNameTokenSetEqual(
    a: readonly string[],
    b: readonly string[],
): boolean {
    if (a.length !== b.length) return false;
    const setA = new Set(a);
    for (const token of b) {
        if (!setA.has(token)) return false;
    }
    return true;
}

function nameStrictlyContainsTokenSet(
    queryTokens: readonly string[],
    otherTokens: readonly string[],
): boolean {
    if (otherTokens.length === 0) return false;
    if (queryTokens.length <= otherTokens.length) return false;
    const set = new Set(queryTokens);
    return otherTokens.every((token) => set.has(token));
}

function foodResolvesToName(
    name: string,
    food: Food,
    aliases: readonly string[],
): boolean {
    const nameNorm = normalizeFoodName(name);
    const nameLoose = looseFoodKey(name);
    if (
        normalizeFoodName(food.name) === nameNorm ||
        looseFoodKey(food.name) === nameLoose
    ) {
        return true;
    }
    for (const alias of aliases) {
        if (normalizeFoodName(alias) === nameNorm) {
            return true;
        }
    }
    return false;
}

export function similarFoods(
    name: string,
    foods: readonly Food[],
    aliasesByFoodId: ReadonlyMap<string, string[]>,
    opts: {
        kind: FoodKind;
        branded?: boolean;
        /**
         * Keep rows whose name or alias already matches. `upsert_food` asks
         * only after `findUpsertFoodByName` decided to create, and that skips
         * branded rows `findManualFood` would reuse, so for it those rows are
         * the likeliest candidates, not resolved names.
         */
        keepResolved?: boolean;
    },
): SimilarFoodCandidate[] {
    const isResolved = (food: Food, aliases: readonly string[]) =>
        !opts.keepResolved && foodResolvesToName(name, food, aliases);
    const queryTokens = foodNameTokens(name);
    if (queryTokens.length === 0) return [];

    const eligible = foods.filter(
        (food) =>
            food.archivedAt == null &&
            food.kind === opts.kind &&
            food.genericFoodId == null,
    );

    const seen = new Set<string>();
    const result: SimilarFoodCandidate[] = [];

    const push = (food: Food, why: SimilarFoodWhy) => {
        if (seen.has(food.id)) return;
        const aliases = aliasesByFoodId.get(food.id) ?? [];
        if (isResolved(food, aliases)) return;
        seen.add(food.id);
        result.push({ food, why });
    };

    const sortByNameId = (a: { food: Food }, b: { food: Food }): number => {
        const byName = a.food.name.localeCompare(b.food.name);
        if (byName !== 0) return byName;
        return a.food.id.localeCompare(b.food.id);
    };

    const rule1: SimilarFoodCandidate[] = [];
    for (const food of eligible) {
        const aliases = aliasesByFoodId.get(food.id) ?? [];
        if (isResolved(food, aliases)) continue;
        const labels = [food.name, ...aliases];
        for (const label of labels) {
            if (foodNameTokenSetEqual(queryTokens, foodNameTokens(label))) {
                rule1.push({ food, why: "same_words" });
                break;
            }
        }
    }
    rule1.sort(sortByNameId);
    for (const candidate of rule1) {
        push(candidate.food, candidate.why);
        if (result.length >= SIMILAR_FOODS_LIMIT) return result;
    }

    if (!opts.branded) {
        const rule2: SimilarFoodCandidate[] = [];
        for (const food of eligible) {
            const aliases = aliasesByFoodId.get(food.id) ?? [];
            if (isResolved(food, aliases)) continue;
            const labels = [food.name, ...aliases];
            for (const label of labels) {
                const labelTokens = foodNameTokens(label);
                if (labelTokens.length === 0) continue;
                if (nameStrictlyContainsTokenSet(queryTokens, labelTokens)) {
                    rule2.push({ food, why: "contains_words" });
                    break;
                }
            }
        }
        rule2.sort(sortByNameId);
        for (const candidate of rule2) {
            push(candidate.food, candidate.why);
            if (result.length >= SIMILAR_FOODS_LIMIT) return result;
        }
    }

    for (const food of matchFoodsByWords(name, eligible, aliasesByFoodId)) {
        push(food, "word_match");
        if (result.length >= SIMILAR_FOODS_LIMIT) return result;
    }
    return result;
}

export class SimilarFoodsError extends Error {
    readonly entries: SimilarFoodsEntry[];

    constructor(entries: SimilarFoodsEntry[]) {
        const parts = entries.map((entry) => {
            const first = entry.candidates[0];
            return first
                ? `"${entry.name}" may be ${first.food.name}`
                : `"${entry.name}"`;
        });
        super(`Similar foods: ${parts.join("; ")}.`);
        this.name = "SimilarFoodsError";
        this.entries = entries;
    }
}

function findManualFoodInListed(
    foods: readonly Food[],
    aliasesByFoodId: ReadonlyMap<string, string[]>,
    kind: FoodKind,
    name: string,
    plurals: boolean,
): Food | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const normalized = normalizeFoodName(trimmed);
    const byName = foods.find(
        (food) =>
            food.kind === kind &&
            !food.archivedAt &&
            food.normalizedName === normalized,
    );
    if (byName) return byName;
    for (const food of foods) {
        if (food.kind !== kind || food.archivedAt) continue;
        const aliases = aliasesByFoodId.get(food.id) ?? [];
        for (const alias of aliases) {
            if (normalizeFoodName(alias) === normalized) return food;
        }
    }
    const matches = filterLooseNameMatches(foods, kind, trimmed, plurals);
    if (matches.length === 0) return null;
    matches.sort(preferLooseNameMatch);
    return copyFood(matches[0]!);
}

/** Names that would create a new food and have similar existing ones. Writes nothing. */
export async function similarFoodsForNames(
    store: FoodsStore,
    householdId: string,
    kind: FoodKind,
    names: readonly string[],
): Promise<SimilarFoodsEntry[]> {
    const [foods, aliasesByFoodId, plurals] = await Promise.all([
        store.listFoods(householdId),
        store.listAllAliases(householdId),
        storePluralsSameFood(store, householdId),
    ]);
    const seenNorm = new Set<string>();
    const entries: SimilarFoodsEntry[] = [];
    for (const raw of names) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const norm = normalizeFoodName(trimmed);
        if (seenNorm.has(norm)) continue;
        seenNorm.add(norm);
        if (
            findManualFoodInListed(
                foods,
                aliasesByFoodId,
                kind,
                trimmed,
                plurals,
            )
        ) {
            continue;
        }
        const candidates = similarFoods(trimmed, foods, aliasesByFoodId, {
            kind,
        });
        if (candidates.length > 0) {
            entries.push({ name: trimmed, candidates });
        }
    }
    return entries;
}

/**
 * Similar foods for one name the caller has already decided to create
 * (`upsert_food` after `findUpsertFoodByName`). Nothing is skipped as
 * resolved: any name or alias match left is a row that path will not reuse.
 */
export async function similarFoodsForNewName(
    store: FoodsStore,
    householdId: string,
    kind: FoodKind,
    name: string,
    opts?: { branded?: boolean },
): Promise<SimilarFoodsEntry[]> {
    const trimmed = name.trim();
    if (!trimmed) return [];
    const [foods, aliasesByFoodId] = await Promise.all([
        store.listFoods(householdId),
        store.listAllAliases(householdId),
    ]);
    const candidates = similarFoods(trimmed, foods, aliasesByFoodId, {
        kind,
        branded: opts?.branded,
        keepResolved: true,
    });
    return candidates.length > 0 ? [{ name: trimmed, candidates }] : [];
}

export function foodHasNoNutrition(
    food: Pick<Food, (typeof NUTRITION_BLOCK_KEYS)[number]>,
): boolean {
    return !NUTRITION_BLOCK_KEYS.some((key) => food[key] != null);
}

export function suggestFoodFor(
    productName: string,
    foods: readonly Food[],
): Food | null {
    const productTokens = new Set(foodNameTokens(productName));
    const productNorm = normalizeFoodName(productName);
    const candidates: Food[] = [];
    for (const food of foods) {
        if (food.archivedAt) continue;
        if (food.genericFoodId) continue;
        if (normalizeFoodName(food.name) === productNorm) continue;
        const tokens = foodNameTokens(food.name);
        if (tokens.length === 0) continue;
        if (!tokens.every((token) => productTokens.has(token))) continue;
        candidates.push(food);
    }
    candidates.sort((a, b) => {
        const aCount = foodNameTokens(a.name).length;
        const bCount = foodNameTokens(b.name).length;
        if (bCount !== aCount) return bCount - aCount;
        if (a.name.length !== b.name.length) {
            return a.name.length - b.name.length;
        }
        return a.name.localeCompare(b.name);
    });
    return candidates[0] ?? null;
}

export type UsualProductRow = {
    food: Food;
    products: Food[];
    usual: Food | null;
};

/**
 * The Usual products page: every live plain food that has at least one live
 * product, sorted by name, with its usual product when one is set. A
 * household starts with an empty list and adds to it; nothing is listed just
 * because a recipe or grocery line uses it. `addable` is every other live
 * plain food, the choices behind "Add usual product".
 */
export function usualProductRows(input: {
    foods: readonly Food[];
    barcodedFoodIds?: ReadonlySet<string>;
}): {
    rows: UsualProductRow[];
    addable: Food[];
} {
    const barcoded = input.barcodedFoodIds ?? new Set<string>();
    const live = input.foods.filter((row) => !row.archivedAt);
    const plainFoods = live.filter((row) => !row.genericFoodId);
    const productsByPlain = new Map<string, Food[]>();
    for (const row of live) {
        if (!row.genericFoodId) continue;
        const list = productsByPlain.get(row.genericFoodId) ?? [];
        list.push(row);
        productsByPlain.set(row.genericFoodId, list);
    }
    const byName = (a: Food, b: Food) => a.name.localeCompare(b.name);
    const rows: UsualProductRow[] = [];
    const addable: Food[] = [];
    for (const food of plainFoods) {
        const products = (productsByPlain.get(food.id) ?? []).sort(byName);
        if (products.length === 0) {
            if (barcoded.has(food.id) || food.offSourceId) continue;
            addable.push(food);
            continue;
        }
        const usual =
            food.usualProductId != null
                ? (products.find((p) => p.id === food.usualProductId) ?? null)
                : null;
        rows.push({ food, products, usual });
    }
    rows.sort((a, b) => byName(a.food, b.food));
    addable.sort(byName);
    return { rows, addable };
}

export function linkProductPromptPath(
    product: Food,
    foods: readonly Food[],
    returnPath: string,
): string | null {
    if (product.genericFoodId) return null;
    const plains = foods.filter(
        (row) =>
            !row.archivedAt &&
            !row.genericFoodId &&
            row.kind === product.kind &&
            row.id !== product.id,
    );
    if (!suggestFoodFor(product.name, plains)) return null;
    const sep = returnPath.includes("?") ? "&" : "?";
    return `${returnPath}${sep}link_product=${encodeURIComponent(product.id)}`;
}

/** Build effective foods from an already-listed household catalog (no per-id loads). */
export function effectiveFoodsFromListed(
    listed: readonly Food[],
): Map<string, EffectiveFood> {
    const catalog = new Map(listed.map((food) => [food.id, food]));
    const out = new Map<string, EffectiveFood>();
    for (const food of listed) {
        out.set(food.id, effectiveFood(food, catalog));
    }
    return out;
}

export async function effectiveFoodsByIds(
    store: FoodsStore,
    householdId: string,
    ids: Iterable<string | null | undefined>,
): Promise<Map<string, EffectiveFood>> {
    const loaded = await foodsByIds(store, householdId, ids);
    const extraIds = new Set<string>();
    for (const food of loaded.values()) {
        const usualId = food.usualProductId;
        if (usualId && !loaded.has(usualId)) extraIds.add(usualId);
    }
    const usualMap =
        extraIds.size > 0
            ? await foodsByIds(store, householdId, extraIds)
            : new Map<string, Food>();
    const catalog = new Map([...loaded, ...usualMap]);
    const out = new Map<string, EffectiveFood>();
    for (const [id, food] of loaded) {
        out.set(id, effectiveFood(food, catalog));
    }
    return out;
}

async function liveProductsOf(
    store: FoodsStore,
    householdId: string,
    foodId: string,
): Promise<Food[]> {
    const listed = await store.listFoods(householdId);
    return listed.filter((row) => row.genericFoodId === foodId);
}

async function requireLiveFood(
    store: FoodsStore,
    householdId: string,
    foodId: string,
): Promise<Food> {
    const food = await store.getFood(householdId, foodId);
    if (!food || food.archivedAt) {
        throw new FoodsInputError("Unknown food.");
    }
    return food;
}

function assertCanReceiveGenericFoodId(row: Food, liveProducts: Food[]): void {
    if (row.genericFoodId) return;
    if (row.usualProductId) {
        throw new FoodsInputError("That food already has a usual product.");
    }
    if (liveProducts.length > 0) {
        throw new FoodsInputError("A product can't have its own products.");
    }
}

function assertProductRow(product: Food, liveProducts: Food[]): void {
    if (product.usualProductId) {
        throw new FoodsInputError("A product can't have its own products.");
    }
    if (liveProducts.length > 0) {
        throw new FoodsInputError("A product can't have its own products.");
    }
}

function assertPlainFoodTarget(food: Food): void {
    if (food.genericFoodId) {
        throw new FoodsInputError("That food is a product of another food.");
    }
}

function assertSameKindLiveNotSelf(
    a: Food,
    b: Food,
    aId: string,
    bId: string,
): void {
    if (aId === bId) {
        throw new FoodsInputError("Pick two different foods.");
    }
    if (a.kind !== b.kind) {
        throw new FoodsInputError(
            "A product must be the same kind as its food.",
        );
    }
}

async function saveFood(store: FoodsStore, row: Food): Promise<Food> {
    const saved = await store.updateFoodRow({ ...row, updatedAt: nowIso() });
    if (!saved) throw new FoodsInputError("Unknown food.");
    return saved;
}

export async function linkProduct(
    store: FoodsStore,
    householdId: string,
    productId: string,
    foodId: string | null,
): Promise<Food> {
    const product = await requireLiveFood(store, householdId, productId);
    if (foodId === null) {
        if (!product.genericFoodId) return product;
        const plainId = product.genericFoodId;
        const plain = await store.getFood(householdId, plainId);
        if (plain && plain.usualProductId === productId) {
            await saveFood(store, {
                ...plain,
                usualProductId: null,
            });
        }
        return saveFood(store, { ...product, genericFoodId: null });
    }
    if (productId === foodId) {
        throw new FoodsInputError("Pick two different foods.");
    }
    const food = await requireLiveFood(store, householdId, foodId);
    const productChildren = await liveProductsOf(store, householdId, productId);
    if (product.genericFoodId) {
        assertProductRow(product, productChildren);
    } else {
        assertCanReceiveGenericFoodId(product, productChildren);
    }
    assertPlainFoodTarget(food);
    assertSameKindLiveNotSelf(product, food, productId, foodId);
    if (product.genericFoodId === foodId) return product;
    if (product.genericFoodId && product.genericFoodId !== foodId) {
        const oldPlain = await store.getFood(
            householdId,
            product.genericFoodId,
        );
        if (oldPlain && oldPlain.usualProductId === productId) {
            await saveFood(store, {
                ...oldPlain,
                usualProductId: null,
            });
        }
    }
    return saveFood(store, { ...product, genericFoodId: foodId });
}

export async function setUsualPurchase(
    store: FoodsStore,
    householdId: string,
    foodId: string,
    patch: UsualPurchasePatch,
    opts: { stores: UsualStoreLookup },
): Promise<Food> {
    const parsed = await parseUsualPurchase(householdId, patch, opts.stores);
    const current = await findFoodById(store, householdId, foodId);
    let next = { ...current };
    if (parsed.usualStoreId !== undefined) {
        next = { ...next, usualStoreId: parsed.usualStoreId };
    }
    if (parsed.usualAmount !== undefined) {
        next = {
            ...next,
            usualAmount:
                parsed.usualAmount == null ? null : { ...parsed.usualAmount },
        };
    }
    return saveFood(store, next);
}

const USUAL_SCHEDULE_KEYS: readonly UsualScheduleKey[] = [
    "restockSchedule",
    "restockEveryWeeks",
    "restockPaused",
    "restockWhenLow",
    "restockLowLevel",
    "lastRestockedOn",
];

/**
 * A change to a usual's schedule fields. A field left out keeps the stored
 * value; the string forms exist so a web form can pass its text through.
 */
export type UsualSchedulePatch = {
    restockSchedule?: string | null;
    restockEveryWeeks?: number | string | null;
    restockPaused?: boolean;
    restockWhenLow?: boolean;
    restockLowLevel?: number | string | null;
    lastRestockedOn?: string | null;
};

function isBlankInput(value: unknown): boolean {
    return value == null || (typeof value === "string" && value.trim() === "");
}

function parseRestockSchedule(raw: unknown): RestockSchedule | null {
    if (isBlankInput(raw)) return null;
    const value = String(raw).trim();
    if ((RESTOCK_SCHEDULES as readonly string[]).includes(value)) {
        return value as RestockSchedule;
    }
    throw new FoodsInputError(
        "Pick weekly, every N weeks, monthly, or no schedule.",
    );
}

function parseRestockEveryWeeks(raw: unknown): number | null {
    if (isBlankInput(raw)) return null;
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isInteger(n) || n < 1 || n > RESTOCK_MAX_EVERY_WEEKS) {
        throw new FoodsInputError(
            `Enter a whole number of weeks from 1 to ${RESTOCK_MAX_EVERY_WEEKS}.`,
        );
    }
    return n;
}

function parseRestockLowLevel(raw: unknown): number | null {
    if (isBlankInput(raw)) return null;
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n) || n < 0) {
        throw new FoodsInputError("The low level must be zero or more.");
    }
    return n;
}

function parseRestockFlag(raw: unknown, label: string): boolean {
    if (typeof raw !== "boolean") {
        throw new FoodsInputError(`${label} must be on or off.`);
    }
    return raw;
}

/** A real calendar day as `YYYY-MM-DD`; anything else is rejected. */
function parseCalendarDay(raw: unknown): string | null {
    if (isBlankInput(raw)) return null;
    const text = String(raw).trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (match) {
        const [y, m, d] = [
            Number(match[1]),
            Number(match[2]),
            Number(match[3]),
        ];
        const probe = new Date(Date.UTC(y, m - 1, d));
        if (
            probe.getUTCFullYear() === y &&
            probe.getUTCMonth() === m - 1 &&
            probe.getUTCDate() === d
        ) {
            return text;
        }
    }
    throw new FoodsInputError("Enter the date as YYYY-MM-DD.");
}

/**
 * The schedule fields after `patch`, validated as one record: "every N weeks"
 * needs its N and no other schedule carries one. Switching to another
 * schedule drops the stored N unless the patch names one (which is then
 * refused). Everything the patch does not mention is carried over unchanged.
 */
export function applyUsualSchedulePatch(
    current: UsualScheduleFields,
    patch: UsualSchedulePatch,
): UsualScheduleFields {
    let schedule = current.restockSchedule;
    let everyWeeks = current.restockEveryWeeks;
    if (patch.restockSchedule !== undefined) {
        schedule = parseRestockSchedule(patch.restockSchedule);
        if (
            schedule !== "every_n_weeks" &&
            patch.restockEveryWeeks === undefined
        ) {
            everyWeeks = null;
        }
    }
    if (patch.restockEveryWeeks !== undefined) {
        everyWeeks = parseRestockEveryWeeks(patch.restockEveryWeeks);
    }
    if (schedule === "every_n_weeks") {
        if (everyWeeks == null) {
            throw new FoodsInputError("Enter how many weeks between restocks.");
        }
    } else if (everyWeeks != null) {
        throw new FoodsInputError(
            "Only an every N weeks schedule takes a number of weeks.",
        );
    }
    return {
        restockSchedule: schedule,
        restockEveryWeeks: everyWeeks,
        restockPaused:
            patch.restockPaused !== undefined
                ? parseRestockFlag(patch.restockPaused, "Paused")
                : current.restockPaused,
        restockWhenLow:
            patch.restockWhenLow !== undefined
                ? parseRestockFlag(patch.restockWhenLow, "Add when low")
                : current.restockWhenLow,
        restockLowLevel:
            patch.restockLowLevel !== undefined
                ? parseRestockLowLevel(patch.restockLowLevel)
                : current.restockLowLevel,
        lastRestockedOn:
            patch.lastRestockedOn !== undefined
                ? parseCalendarDay(patch.lastRestockedOn)
                : current.lastRestockedOn,
    };
}

/**
 * Sets a usual's schedule, paused flag, add-when-low switch and low level.
 * The schedule lives on the plain food (a standalone food counts as one);
 * a product reads its plain food's, so writing one on a product is refused.
 * Writes are never gated, and a field the patch leaves out is kept.
 */
export async function setUsualSchedule(
    store: FoodsStore,
    householdId: string,
    foodId: string,
    patch: UsualSchedulePatch,
): Promise<Food> {
    const current = await requireLiveFood(store, householdId, foodId);
    assertPlainFoodTarget(current);
    const next = applyUsualSchedulePatch(current, patch);
    const unchanged = USUAL_SCHEDULE_KEYS.every(
        (key) => current[key] === next[key],
    );
    if (unchanged) return current;
    return saveFood(store, { ...current, ...next });
}

/**
 * Stamps the day a usual was last restocked: call it when a grocery line of
 * the food (or of one of its products) is ticked off or put away. `on` is the
 * household-local day, `YYYY-MM-DD`. A product stamps its plain food, and the
 * date only moves forward, so a late retry never rewinds it. Returns null when
 * the food no longer exists.
 */
export async function markUsualRestocked(
    store: FoodsStore,
    householdId: string,
    foodId: string,
    on: string,
): Promise<Food | null> {
    const day = parseCalendarDay(on);
    if (day == null) throw new FoodsInputError("Enter the date as YYYY-MM-DD.");
    const food = await store.getFood(householdId, foodId);
    if (!food || food.archivedAt) return null;
    const plain = food.genericFoodId
        ? await store.getFood(householdId, food.genericFoodId)
        : food;
    if (!plain || plain.archivedAt) return null;
    if (plain.lastRestockedOn != null && plain.lastRestockedOn >= day) {
        return plain;
    }
    return saveFood(store, { ...plain, lastRestockedOn: day });
}

/**
 * The level a usual counts as running low below: the one the household set,
 * else a quarter of the usual amount (computed here, never stored). Pass the
 * effective food so a plain food reads its usual product's amount. Null when
 * there is neither, so nothing is guessed.
 */
export function usualLowLevel(
    food: Pick<Food, "restockLowLevel" | "usualAmount">,
): number | null {
    if (food.restockLowLevel != null) return food.restockLowLevel;
    if (food.usualAmount != null) return food.usualAmount.amount / 4;
    return null;
}

/**
 * Merging two foods keeps the schedule that exists: the kept food's own, else
 * the dropped one's (with its N). Paused and add-when-low come from the side
 * whose schedule wins, so a discarded schedule never pauses the kept one; when
 * neither side has a schedule, either side's "on" stands. The last restock
 * date is the later of the two.
 * A dropped low level comes along only with the dropped usual amount it is
 * measured in.
 */
function mergedUsualSchedule(keep: Food, drop: Food): UsualScheduleFields {
    const takeDrop =
        keep.restockSchedule == null && drop.restockSchedule != null;
    const neitherScheduled =
        keep.restockSchedule == null && drop.restockSchedule == null;
    // Paused and add-when-low belong with the schedule that wins: a discarded
    // schedule must not pause the kept one. With no schedule on either side
    // there is nothing to follow, so an "on" from either side stands.
    const flagSource = neitherScheduled
        ? {
              restockPaused: keep.restockPaused || drop.restockPaused,
              restockWhenLow: keep.restockWhenLow || drop.restockWhenLow,
          }
        : takeDrop
          ? drop
          : keep;
    const later = [keep.lastRestockedOn, drop.lastRestockedOn]
        .filter((day): day is string => day != null)
        .sort()
        .at(-1);
    return {
        restockSchedule: takeDrop ? drop.restockSchedule : keep.restockSchedule,
        restockEveryWeeks: takeDrop
            ? drop.restockEveryWeeks
            : keep.restockEveryWeeks,
        restockPaused: flagSource.restockPaused,
        restockWhenLow: flagSource.restockWhenLow,
        restockLowLevel:
            keep.restockLowLevel ??
            (keep.usualAmount == null ? drop.restockLowLevel : null),
        lastRestockedOn: later ?? null,
    };
}

function usualScheduleFromRow(row: {
    restock_schedule?: unknown;
    restock_every_weeks?: unknown;
    restock_paused?: unknown;
    restock_when_low?: unknown;
    restock_low_level?: unknown;
    last_restocked_on?: unknown;
}): UsualScheduleFields {
    const schedule = (RESTOCK_SCHEDULES as readonly unknown[]).includes(
        row.restock_schedule,
    )
        ? (row.restock_schedule as RestockSchedule)
        : null;
    const everyWeeks =
        row.restock_every_weeks == null
            ? null
            : Number(row.restock_every_weeks);
    const lowLevel =
        row.restock_low_level == null ? null : Number(row.restock_low_level);
    const lastOn = row.last_restocked_on;
    return {
        restockSchedule: schedule,
        restockEveryWeeks:
            everyWeeks != null && Number.isInteger(everyWeeks) && everyWeeks > 0
                ? everyWeeks
                : null,
        restockPaused: row.restock_paused === true,
        restockWhenLow: row.restock_when_low === true,
        restockLowLevel:
            lowLevel != null && Number.isFinite(lowLevel) ? lowLevel : null,
        lastRestockedOn:
            lastOn == null || lastOn === ""
                ? null
                : lastOn instanceof Date
                  ? lastOn.toISOString().slice(0, 10)
                  : String(lastOn).slice(0, 10),
    };
}

/**
 * Adds a product to a plain food's list. Any product counts as the food; only
 * the usual one sets its nutrition, store and amount. So adding a product
 * leaves the current usual alone, and makes the new one usual only when the
 * food has none yet (the first product a food gets is the one it reads).
 */
export async function addProduct(
    store: FoodsStore,
    householdId: string,
    foodId: string,
    productId: string,
): Promise<{ product: Food; madeUsual: boolean }> {
    const food = await requireLiveFood(store, householdId, foodId);
    if (food.genericFoodId) {
        throw new FoodsInputError("That food is a product of another food.");
    }
    const product = await linkProduct(store, householdId, productId, foodId);
    const refreshed = await requireLiveFood(store, householdId, foodId);
    if (refreshed.usualProductId) return { product, madeUsual: false };
    await setUsualProduct(store, householdId, foodId, productId);
    return { product, madeUsual: true };
}

/** Takes a product off a plain food's list; it stays in Items as its own food. */
export async function removeProduct(
    store: FoodsStore,
    householdId: string,
    foodId: string,
    productId: string,
): Promise<Food> {
    const product = await requireLiveFood(store, householdId, productId);
    if (product.genericFoodId !== foodId) {
        throw new FoodsInputError("That product is not on this food's list.");
    }
    return linkProduct(store, householdId, productId, null);
}

export async function setUsualProduct(
    store: FoodsStore,
    householdId: string,
    foodId: string,
    productId: string | null,
    opts?: { purchase?: UsualPurchasePatch; stores?: UsualStoreLookup },
): Promise<Food> {
    if (opts?.purchase != null) {
        await parseUsualPurchase(householdId, opts.purchase, opts.stores);
    }
    const food = await requireLiveFood(store, householdId, foodId);
    if (food.genericFoodId) {
        throw new FoodsInputError("That food is a product of another food.");
    }
    if (productId === null) {
        if (!food.usualProductId && opts?.purchase == null) return food;
        if (food.usualProductId) {
            await saveFood(store, { ...food, usualProductId: null });
        }
        if (opts?.purchase != null) {
            await setUsualPurchase(store, householdId, foodId, opts.purchase, {
                stores: opts.stores!,
            });
        }
        return requireLiveFood(store, householdId, foodId);
    }
    if (productId === foodId) {
        throw new FoodsInputError("Pick two different foods.");
    }
    const product = await requireLiveFood(store, householdId, productId);
    assertSameKindLiveNotSelf(food, product, foodId, productId);
    if (product.genericFoodId === foodId) {
        await saveFood(store, { ...food, usualProductId: productId });
        if (opts?.purchase != null) {
            await setUsualPurchase(
                store,
                householdId,
                productId,
                opts.purchase,
                {
                    stores: opts.stores!,
                },
            );
        }
        return requireLiveFood(store, householdId, foodId);
    }
    if (product.genericFoodId && product.genericFoodId !== foodId) {
        throw new FoodsInputError(
            "That product belongs to another food. Link it here first.",
        );
    }
    await linkProduct(store, householdId, productId, foodId);
    const refreshed = await requireLiveFood(store, householdId, foodId);
    await saveFood(store, { ...refreshed, usualProductId: productId });
    if (opts?.purchase != null) {
        await setUsualPurchase(store, householdId, productId, opts.purchase, {
            stores: opts.stores!,
        });
    }
    return requireLiveFood(store, householdId, foodId);
}

export async function createProduct(
    store: FoodsStore,
    householdId: string,
    foodId: string,
    input: {
        name: string;
        brand?: string | null;
        defaultUnit?: string;
        gramsPerEach?: number | null;
        gramsPerMl?: number | null;
        calories?: number | null;
        proteinG?: number | null;
        carbsG?: number | null;
        fatG?: number | null;
        fiberG?: number | null;
        sugarG?: number | null;
        alcoholG?: number | null;
        caffeineMg?: number | null;
        allergens?: string[];
        nutritionSource?: NutritionSource | null;
        makeUsual?: boolean;
        createdBy?: string | null;
    },
): Promise<Food> {
    const plain = await requireLiveFood(store, householdId, foodId);
    if (plain.genericFoodId) {
        throw new FoodsInputError("That food is a product of another food.");
    }
    const name = input.name.trim();
    if (!name) throw new FoodsInputError("Enter a food name.");
    const nutrients = {
        calories: parseOptionalNutrient(input.calories),
        proteinG: parseOptionalNutrient(input.proteinG),
        carbsG: parseOptionalNutrient(input.carbsG),
        fatG: parseOptionalNutrient(input.fatG),
        fiberG: parseOptionalNutrient(input.fiberG),
        sugarG: parseOptionalNutrient(input.sugarG),
        saturatedFatG: null as number | null,
        alcoholG: parseOptionalNutrient(input.alcoholG),
        caffeineMg: parseOptionalNutrient(input.caffeineMg),
    };
    const hasNutrient = NUTRITION_BLOCK_KEYS.some(
        (key) => nutrients[key] != null,
    );
    const allergens = (input.allergens ?? []).filter(
        (code) => isNamedAllergen(code) || code === "other",
    );
    const created = await store.insertFood(
        newFood({
            householdId,
            kind: plain.kind,
            name,
            brand: input.brand,
            defaultUnit: input.defaultUnit ?? plain.defaultUnit,
            gramsPerEach: parsePositiveFactor(input.gramsPerEach),
            gramsPerMl: parsePositiveFactor(input.gramsPerMl),
            ...nutrients,
            nutritionSource:
                input.nutritionSource ?? (hasNutrient ? "manual" : null),
            allergens,
            genericFoodId: foodId,
            createdBy: input.createdBy,
        }),
    );
    if (input.makeUsual) {
        await setUsualProduct(store, householdId, foodId, created.id);
    }
    return created;
}

async function applyArchiveLinkCleanup(
    store: FoodsStore,
    householdId: string,
    current: Food,
): Promise<void> {
    if (current.genericFoodId) {
        const plain = await store.getFood(householdId, current.genericFoodId);
        if (plain && plain.usualProductId === current.id) {
            await saveFood(store, { ...plain, usualProductId: null });
        }
        return;
    }
    const products = await liveProductsOf(store, householdId, current.id);
    for (const product of products) {
        await saveFood(store, { ...product, genericFoodId: null });
    }
}

function parseOptionalNutrient(
    value: number | null | undefined,
): number | null {
    if (value == null) return null;
    if (!Number.isFinite(value) || value < 0) {
        throw new FoodsInputError("Nutrition values cannot be negative.");
    }
    return value;
}

function parsePositiveFactor(value: number | null | undefined): number | null {
    if (value == null) return null;
    if (!Number.isFinite(value) || value <= 0) {
        throw new FoodsInputError(
            "Grams per item and grams per millilitre must be greater than zero.",
        );
    }
    return value;
}

export async function buildFoodUpdate(
    store: FoodsStore,
    householdId: string,
    foodId: string,
    patch: FoodPatch,
    opts?: { stores?: UsualStoreLookup },
): Promise<Food> {
    const current = await findFoodById(store, householdId, foodId);
    const name = patch.name != null ? patch.name.trim() : current.name;
    if (!name) throw new FoodsInputError("Enter a food name.");
    const brand =
        patch.brand !== undefined
            ? patch.brand?.trim()
                ? patch.brand.trim()
                : null
            : current.brand;
    const defaultUnit =
        patch.defaultUnit != null
            ? patch.defaultUnit.trim() || "g"
            : current.defaultUnit;
    const allergens = patch.allergens
        ? patch.allergens.filter(
              (code) => isNamedAllergen(code) || code === "other",
          )
        : current.allergens;
    const archiving = patch.archived === true && current.archivedAt == null;
    const unarchiving = patch.archived === false && current.archivedAt != null;
    const archivedAt =
        patch.archived === undefined
            ? current.archivedAt
            : patch.archived
              ? (current.archivedAt ?? nowIso())
              : null;
    const normalizedName = normalizeFoodName(name);
    // The same key the store enforces (kind, normalized name and brand among
    // live rows). Several live rows can share a normalized name with
    // different brands, so this scans rather than asking getByNormalizedName
    // for the one row.
    if (archivedAt == null) {
        const live = await store.listFoods(householdId);
        const taken = live.some(
            (row) =>
                row.id !== foodId &&
                row.kind === current.kind &&
                row.normalizedName === normalizedName &&
                (row.brand ?? "") === (brand ?? ""),
        );
        if (taken) throw new FoodsInputError("That food already exists.");
    }
    if (patch.aliases) {
        for (const raw of patch.aliases) {
            const alias = normalizeFoodName(raw);
            if (!alias || alias === normalizedName) continue;
            const taken = await store.getAliasFoodId(householdId, alias);
            if (taken && taken !== foodId) {
                throw new FoodsInputError("That alias is already used.");
            }
        }
    }
    const usualPatch: UsualPurchasePatch = {};
    if (patch.usualStoreId !== undefined) {
        usualPatch.usualStoreId = patch.usualStoreId;
    }
    if (patch.usualAmount !== undefined) {
        usualPatch.usualAmount = patch.usualAmount;
    }
    const parsedUsual =
        Object.keys(usualPatch).length > 0
            ? await parseUsualPurchase(householdId, usualPatch, opts?.stores)
            : {};
    return {
        ...current,
        name,
        normalizedName,
        brand,
        defaultUnit,
        gramsPerEach:
            patch.gramsPerEach !== undefined
                ? parsePositiveFactor(patch.gramsPerEach)
                : current.gramsPerEach,
        gramsPerMl:
            patch.gramsPerMl !== undefined
                ? parsePositiveFactor(patch.gramsPerMl)
                : current.gramsPerMl,
        calories:
            patch.calories !== undefined
                ? parseOptionalNutrient(patch.calories)
                : current.calories,
        proteinG:
            patch.proteinG !== undefined
                ? parseOptionalNutrient(patch.proteinG)
                : current.proteinG,
        carbsG:
            patch.carbsG !== undefined
                ? parseOptionalNutrient(patch.carbsG)
                : current.carbsG,
        fatG:
            patch.fatG !== undefined
                ? parseOptionalNutrient(patch.fatG)
                : current.fatG,
        fiberG:
            patch.fiberG !== undefined
                ? parseOptionalNutrient(patch.fiberG)
                : current.fiberG,
        sugarG:
            patch.sugarG !== undefined
                ? parseOptionalNutrient(patch.sugarG)
                : current.sugarG,
        alcoholG:
            patch.alcoholG !== undefined
                ? parseOptionalNutrient(patch.alcoholG)
                : current.alcoholG,
        caffeineMg:
            patch.caffeineMg !== undefined
                ? parseOptionalNutrient(patch.caffeineMg)
                : current.caffeineMg,
        nutritionSource:
            patch.nutritionSource !== undefined
                ? patch.nutritionSource
                : current.nutritionSource,
        allergens,
        archivedAt,
        genericFoodId: archiving || unarchiving ? null : current.genericFoodId,
        usualProductId:
            archiving || unarchiving ? null : current.usualProductId,
        usualStoreId:
            parsedUsual.usualStoreId !== undefined
                ? parsedUsual.usualStoreId
                : current.usualStoreId,
        usualAmount:
            parsedUsual.usualAmount !== undefined
                ? parsedUsual.usualAmount == null
                    ? null
                    : { ...parsedUsual.usualAmount }
                : current.usualAmount == null
                  ? null
                  : { ...current.usualAmount },
        updatedAt: nowIso(),
    };
}

export async function updateFood(
    store: FoodsStore,
    householdId: string,
    foodId: string,
    patch: FoodPatch,
    opts?: { stores?: UsualStoreLookup },
): Promise<Food> {
    const current = await findFoodById(store, householdId, foodId);
    const archiving = patch.archived === true && current.archivedAt == null;
    const next = await buildFoodUpdate(store, householdId, foodId, patch, opts);
    if (archiving) {
        await applyArchiveLinkCleanup(store, householdId, current);
    }
    const saved = await store.updateFoodRow(next);
    if (!saved) throw new FoodsInputError("Unknown food.");
    if (patch.aliases) {
        const previous = await store.listAliases(householdId, foodId);
        for (const alias of previous) {
            await store.deleteAlias(householdId, alias);
        }
        for (const raw of patch.aliases) {
            const alias = normalizeFoodName(raw);
            if (!alias || alias === saved.normalizedName) continue;
            const taken = await store.getAliasFoodId(householdId, alias);
            if (taken && taken !== foodId) {
                throw new FoodsInputError("That alias is already used.");
            }
            await store.setAlias(householdId, alias, foodId);
        }
    }
    return saved;
}

/** Same keep ordering as {@link duplicatePairs} (more refs, then older, then id). */
export function compareFoodsForMergeKeep(
    a: Food,
    b: Food,
    refCounts: ReadonlyMap<string, number>,
): number {
    const ra = refCounts.get(a.id) ?? 0;
    const rb = refCounts.get(b.id) ?? 0;
    if (rb !== ra) return rb - ra;
    const byCreated = a.createdAt.localeCompare(b.createdAt);
    if (byCreated !== 0) return byCreated;
    return a.id.localeCompare(b.id);
}

export function defaultMergeKeepId(
    a: Food,
    b: Food,
    refCounts: ReadonlyMap<string, number>,
): string {
    return compareFoodsForMergeKeep(a, b, refCounts) > 0 ? b.id : a.id;
}

export function assertMergeable(
    keep: Food,
    drop: Food,
    listed: readonly Food[],
): void {
    if (keep.id === drop.id) {
        throw new FoodsInputError("Pick two different foods to merge.");
    }
    if (drop.archivedAt) {
        throw new FoodsInputError("Unknown food.");
    }
    if (drop.kind !== keep.kind) {
        throw new FoodsInputError("Foods must be the same kind to merge.");
    }
    if (familyOf(keep) === familyOf(drop)) {
        throw new FoodsInputError(
            "Those are already the same food. Use Set usual instead.",
        );
    }
    if (keep.genericFoodId && drop.genericFoodId) {
        throw new FoodsInputError(
            "Those belong to different foods. Unlink one first.",
        );
    }
    const dropProducts = listed.filter((row) => row.genericFoodId === drop.id);
    const keepProducts = listed.filter((row) => row.genericFoodId === keep.id);
    const mergedGenericId = keep.genericFoodId ?? drop.genericFoodId;
    const mergedUsualId = keep.usualProductId ?? drop.usualProductId ?? null;
    const liveProductsAfter = keepProducts.length + dropProducts.length;
    if (mergedGenericId && (liveProductsAfter > 0 || mergedUsualId)) {
        throw new FoodsInputError(
            "Merging those would nest products two deep.",
        );
    }
}

export async function mergeFoods(
    store: FoodsStore,
    householdId: string,
    keepId: string,
    dropId: string,
): Promise<Food> {
    const keep = await findFoodById(store, householdId, keepId);
    const drop = await store.getFood(householdId, dropId);
    if (!drop) {
        throw new FoodsInputError("Unknown food.");
    }
    const listed = await store.listFoods(householdId);
    assertMergeable(keep, drop, listed);
    const dropProducts = listed.filter((row) => row.genericFoodId === dropId);
    const keepProducts = listed.filter((row) => row.genericFoodId === keepId);
    const mergedGenericId = keep.genericFoodId ?? drop.genericFoodId;
    const mergedUsualId = keep.usualProductId ?? drop.usualProductId ?? null;
    const mergedFields = mergedFoodFields(keep, drop);
    const keepNext: Food = {
        ...keep,
        ...mergedFields,
        genericFoodId: mergedGenericId,
        usualProductId: mergedUsualId,
        usualStoreId: mergedFields.usualStoreId,
        usualAmount:
            mergedFields.usualAmount == null
                ? null
                : { ...mergedFields.usualAmount },
        updatedAt: nowIso(),
    };
    const dropBarcodes = await store.deleteBarcodesForFood(householdId, dropId);
    for (const barcode of dropBarcodes) {
        const taken = await store.getBarcodeFoodId(householdId, barcode);
        if (!taken) await store.setBarcode(householdId, barcode, keepId);
    }
    const dropAliases = await store.deleteAliasesForFood(householdId, dropId);
    const extraAlias = normalizeFoodName(drop.name);
    if (extraAlias && extraAlias !== keep.normalizedName) {
        dropAliases.push(extraAlias);
    }
    for (const alias of dropAliases) {
        const taken = await store.getAliasFoodId(householdId, alias);
        if (!taken) await store.setAlias(householdId, alias, keepId);
    }
    await store.repointFoodRefs(householdId, dropId, keepId);
    await store.updateFoodRow(keepNext);
    for (const product of dropProducts) {
        await store.updateFoodRow({
            ...product,
            genericFoodId: keepId,
            updatedAt: nowIso(),
        });
    }
    for (const row of listed) {
        if (row.usualProductId === dropId) {
            await store.updateFoodRow({
                ...row,
                usualProductId: keepId,
                updatedAt: nowIso(),
            });
        }
    }
    await store.updateFoodRow({
        ...drop,
        genericFoodId: null,
        usualProductId: null,
        archivedAt: nowIso(),
        updatedAt: nowIso(),
    });
    const savedKeep = await store.getFood(householdId, keepId);
    if (!savedKeep) throw new FoodsInputError("Unknown food.");
    return savedKeep;
}

export type FoodSearchHit = {
    food_id: string | null;
    name: string;
    brand: string | null;
    barcode: string | null;
    source: string;
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    fiber_g: number | null;
    sugar_g: number | null;
    serving: string | null;
    default_unit: string | null;
    generic_food_id: string | null;
    generic_food_name: string | null;
};

export type DuplicateFoodSide = {
    id: string;
    householdId: string;
    kind: FoodKind;
    name: string;
    brand: string | null;
    references: number;
    createdAt: string;
};

export type DuplicateMerge = {
    keep: DuplicateFoodSide;
    drop: DuplicateFoodSide;
    reason: string;
    fieldsFilled: string[];
};

export type DuplicateSkip = {
    keep: DuplicateFoodSide;
    drop: DuplicateFoodSide;
    reason: string;
};

export type DuplicatePairsReport = {
    merges: DuplicateMerge[];
    skipped: DuplicateSkip[];
};

const DUPLICATE_NUTRITION_LABELS: Record<
    (typeof NUTRITION_BLOCK_KEYS)[number],
    string
> = {
    calories: "calories",
    proteinG: "protein",
    carbsG: "carbs",
    fatG: "fat",
    fiberG: "fiber",
    sugarG: "sugar",
    alcoholG: "alcohol",
    caffeineMg: "caffeine",
};

function duplicateBrandKey(brand: string | null | undefined): string | null {
    return brand?.trim() ? brand.trim() : null;
}

function formatNutrientCompareValue(value: number | null): string {
    return value == null ? "unknown" : String(value);
}

function nutritionBlockConflictReason(keep: Food, drop: Food): string | null {
    const keepHas = usualHasAnyNutrient(keep);
    const dropHas = usualHasAnyNutrient(drop);
    if (!keepHas || !dropHas) return null;
    for (const key of NUTRITION_BLOCK_KEYS) {
        if (keep[key] !== drop[key]) {
            const label = DUPLICATE_NUTRITION_LABELS[key];
            return `${label} differ: ${formatNutrientCompareValue(keep[key])} vs ${formatNutrientCompareValue(drop[key])}`;
        }
    }
    return null;
}

function allergenArraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

const FIELDS_FILLED_KEY_ORDER: (
    | keyof MergedFoodFieldPick
    | "usualProductId"
    | "usualStoreId"
    | "usualAmount"
)[] = [
    "calories",
    "proteinG",
    "carbsG",
    "fatG",
    "fiberG",
    "sugarG",
    "saturatedFatG",
    "alcoholG",
    "caffeineMg",
    "nutritionSource",
    "gramsPerEach",
    "gramsPerMl",
    "defaultUnit",
    "allergens",
    "usualStoreId",
    "usualAmount",
    "usualProductId",
    "restockSchedule",
];

function fieldsFilledKeys(
    state: Food,
    drop: Food,
    merged: MergedFoodFieldPick,
): string[] {
    const filled: string[] = [];
    for (const key of FIELDS_FILLED_KEY_ORDER) {
        if (key === "usualProductId") {
            if (!state.usualProductId && drop.usualProductId) {
                filled.push("usualProductId");
            }
            continue;
        }
        if (key === "usualAmount") {
            const before = state.usualAmount;
            const after = merged.usualAmount;
            if (before == null && after == null) continue;
            if (before == null || after == null) {
                filled.push("usualAmount");
                continue;
            }
            if (before.amount !== after.amount || before.unit !== after.unit) {
                filled.push("usualAmount");
            }
            continue;
        }
        if (key === "allergens") {
            const nextAllergens = merged.allergens;
            if (!allergenArraysEqual(state.allergens, nextAllergens)) {
                filled.push("allergens");
            }
            continue;
        }
        const before = state[key];
        const after = merged[key];
        if (before !== after) filled.push(key);
    }
    return filled;
}

/** Unit string used by stock/fridge ledger resolution (`defaultUnit || "g"`). */
export function ledgerDefaultUnit(food: Pick<Food, "defaultUnit">): string {
    return food.defaultUnit.trim() || "g";
}

function duplicateMergeReason(
    keep: Food,
    drop: Food,
    refCounts: ReadonlyMap<string, number>,
): string {
    const kr = refCounts.get(keep.id) ?? 0;
    const dr = refCounts.get(drop.id) ?? 0;
    if (kr !== dr) {
        return `more references (${kr} vs ${dr})`;
    }
    if (keep.createdAt !== drop.createdAt) {
        const kDate = keep.createdAt.slice(0, 10);
        const dDate = drop.createdAt.slice(0, 10);
        const shownKeep = kDate !== dDate ? kDate : keep.createdAt;
        const shownDrop = kDate !== dDate ? dDate : drop.createdAt;
        return `same references, older (${shownKeep} vs ${shownDrop})`;
    }
    return "same references and age, lower id";
}

function toDuplicateFoodSide(
    row: Food,
    refCounts: ReadonlyMap<string, number>,
): DuplicateFoodSide {
    return {
        id: row.id,
        householdId: row.householdId,
        kind: row.kind,
        name: row.name,
        brand: duplicateBrandKey(row.brand),
        references: refCounts.get(row.id) ?? 0,
        createdAt: row.createdAt,
    };
}

function aliasOwnersByNormalizedName(
    aliases: ReadonlyMap<string, string[]>,
): Map<string, string> {
    const owners = new Map<string, string>();
    for (const [foodId, texts] of aliases) {
        for (const raw of texts) {
            const norm = normalizeFoodName(raw);
            if (!norm) continue;
            owners.set(norm, foodId);
        }
    }
    return owners;
}

/**
 * Plans duplicate merges for a catalog snapshot and reference counts.
 * Pairing mirrors sequential {@link mergeFoods} with accumulated keep state.
 */
export function duplicatePairs(
    foods: readonly Food[],
    refCounts: ReadonlyMap<string, number>,
    aliases: ReadonlyMap<string, string[]> = new Map(),
    opts: { plurals?: boolean } = {},
): DuplicatePairsReport {
    const groupKeyOf = opts.plurals ? pluralFreeFoodKey : looseFoodKey;
    const catalog = foods;
    const foodsById = new Map(catalog.map((row) => [row.id, row]));
    const aliasOwnerByNorm = aliasOwnersByNormalizedName(aliases);
    // Aliases an earlier accepted merge in this run will write (household + text → keep id).
    const plannedAliasOwner = new Map<string, string>();
    const livePlain = foods.filter(
        (row) => row.archivedAt == null && row.genericFoodId == null,
    );

    const liveRows = catalog.filter((row) => row.archivedAt == null);

    function rowHasProducts(foodId: string): boolean {
        return liveRows.some((row) => row.genericFoodId === foodId);
    }

    type Group = {
        rows: Food[];
        householdId: string;
        kind: FoodKind;
        loose: string;
        brand: string | null;
    };
    const groups: Group[] = [];
    const byKey = new Map<string, Food[]>();

    for (const row of livePlain) {
        const loose = groupKeyOf(row.name);
        if (!loose) continue;
        const brand = duplicateBrandKey(row.brand);
        const key = `${row.householdId}\0${row.kind}\0${loose}\0${brand === null ? "" : brand}`;
        const list = byKey.get(key);
        if (list) list.push(row);
        else byKey.set(key, [row]);
    }

    for (const [, rows] of byKey) {
        if (rows.length < 2) continue;
        const first = rows[0]!;
        groups.push({
            rows,
            householdId: first.householdId,
            kind: first.kind,
            loose: groupKeyOf(first.name),
            brand: duplicateBrandKey(first.brand),
        });
    }

    groups.sort((a, b) => {
        if (a.householdId !== b.householdId) {
            return a.householdId.localeCompare(b.householdId);
        }
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        if (a.loose !== b.loose) return a.loose.localeCompare(b.loose);
        const aNull = a.brand == null ? 0 : 1;
        const bNull = b.brand == null ? 0 : 1;
        if (aNull !== bNull) return aNull - bNull;
        return (a.brand ?? "").localeCompare(b.brand ?? "");
    });

    const merges: DuplicateMerge[] = [];
    const skipped: DuplicateSkip[] = [];

    for (const group of groups) {
        const sorted = group.rows.slice().sort((a, b) => {
            const ra = refCounts.get(a.id) ?? 0;
            const rb = refCounts.get(b.id) ?? 0;
            if (rb !== ra) return rb - ra;
            const byCreated = a.createdAt.localeCompare(b.createdAt);
            if (byCreated !== 0) return byCreated;
            return a.id.localeCompare(b.id);
        });

        const keepOriginal = sorted[0]!;
        let state = copyFood(keepOriginal);
        const acceptedDropIds: string[] = [];

        for (const drop of sorted.slice(1)) {
            const keepSide = toDuplicateFoodSide(keepOriginal, refCounts);
            const dropSide = toDuplicateFoodSide(drop, refCounts);

            if (state.id === drop.id) {
                skipped.push({
                    keep: keepSide,
                    drop: dropSide,
                    reason: "Pick two different foods to merge.",
                });
                continue;
            }
            if (familyOf(state) === familyOf(drop)) {
                skipped.push({
                    keep: keepSide,
                    drop: dropSide,
                    reason: "Those are already the same food. Use Set usual instead.",
                });
                continue;
            }
            if (state.kind !== drop.kind) {
                skipped.push({
                    keep: keepSide,
                    drop: dropSide,
                    reason: "Foods must be the same kind to merge.",
                });
                continue;
            }

            const keepIdsForProducts = [state.id, ...acceptedDropIds];
            const keepHasProducts = keepIdsForProducts.some((id) =>
                rowHasProducts(id),
            );
            const dropHasProducts = rowHasProducts(drop.id);
            if (keepHasProducts && dropHasProducts) {
                skipped.push({
                    keep: keepSide,
                    drop: dropSide,
                    reason: "both have products",
                });
                continue;
            }
            if (state.usualProductId != null && drop.usualProductId != null) {
                skipped.push({
                    keep: keepSide,
                    drop: dropSide,
                    reason: "both have a usual product",
                });
                continue;
            }

            const dropNameNorm = normalizeFoodName(drop.name);
            const aliasOwnerId =
                aliasOwnerByNorm.get(dropNameNorm) ??
                plannedAliasOwner.get(`${drop.householdId}\0${dropNameNorm}`);
            if (aliasOwnerId !== undefined) {
                const allowedIds = new Set<string>([
                    keepOriginal.id,
                    drop.id,
                    ...acceptedDropIds,
                ]);
                if (!allowedIds.has(aliasOwnerId)) {
                    const owner = foodsById.get(aliasOwnerId);
                    const ownerLabel = owner?.name ?? aliasOwnerId;
                    skipped.push({
                        keep: keepSide,
                        drop: dropSide,
                        reason: `"${drop.name}" is already another name for "${ownerLabel}"`,
                    });
                    continue;
                }
            }

            if (
                state.gramsPerEach != null &&
                drop.gramsPerEach != null &&
                state.gramsPerEach !== drop.gramsPerEach
            ) {
                skipped.push({
                    keep: keepSide,
                    drop: dropSide,
                    reason: `grams per each differ: ${state.gramsPerEach} vs ${drop.gramsPerEach}`,
                });
                continue;
            }
            if (
                state.gramsPerMl != null &&
                drop.gramsPerMl != null &&
                state.gramsPerMl !== drop.gramsPerMl
            ) {
                skipped.push({
                    keep: keepSide,
                    drop: dropSide,
                    reason: `grams per ml differ: ${state.gramsPerMl} vs ${drop.gramsPerMl}`,
                });
                continue;
            }

            const keepLedgerUnit = ledgerDefaultUnit(state);
            const dropLedgerUnit = ledgerDefaultUnit(drop);
            if (keepLedgerUnit !== dropLedgerUnit) {
                skipped.push({
                    keep: keepSide,
                    drop: dropSide,
                    reason: `default unit differs: ${keepLedgerUnit} vs ${dropLedgerUnit}`,
                });
                continue;
            }

            const nutSkip = nutritionBlockConflictReason(state, drop);
            if (nutSkip) {
                skipped.push({
                    keep: keepSide,
                    drop: dropSide,
                    reason: nutSkip,
                });
                continue;
            }

            const mergedFields = mergedFoodFields(state, drop);
            const nextUsual =
                state.usualProductId ?? drop.usualProductId ?? null;
            const nextGeneric =
                state.genericFoodId ?? drop.genericFoodId ?? null;
            const nextState: Food = {
                ...state,
                ...mergedFields,
                usualProductId: nextUsual,
                genericFoodId: nextGeneric,
            };

            const fieldsFilled = fieldsFilledKeys(state, drop, mergedFields);

            merges.push({
                keep: keepSide,
                drop: dropSide,
                reason: duplicateMergeReason(keepOriginal, drop, refCounts),
                fieldsFilled,
            });

            state = nextState;
            acceptedDropIds.push(drop.id);
            // Record the aliases this merge will write, so a later group in the
            // same run (another brand or kind with the same spelling) sees the
            // text as taken: the alias table is one row per household.
            // Keyed by household, since `foods` may span several.
            if (
                dropNameNorm &&
                dropNameNorm !== keepOriginal.normalizedName &&
                !aliasOwnerByNorm.has(dropNameNorm)
            ) {
                const plannedKey = `${drop.householdId}\0${dropNameNorm}`;
                if (!plannedAliasOwner.has(plannedKey)) {
                    plannedAliasOwner.set(plannedKey, keepOriginal.id);
                }
            }
        }
    }

    return { merges, skipped };
}

/** A food's name with its brand, as lists show it: "Milk (Horizon)". */
export function foodDisplayName(food: Pick<Food, "name" | "brand">): string {
    const brand = food.brand?.trim();
    return brand ? `${food.name} (${brand})` : food.name;
}

export type PossibleDuplicateRule = "same_words" | "contains_words";

export type PossibleDuplicatePair = {
    subject: Food;
    related: Food;
    rule: PossibleDuplicateRule;
};

/** Wire names for merge-pair pick radios (Items-style snake_case). */
export const MERGE_PAIR_PICK_FIELDS = [
    "calories",
    "protein_g",
    "carbs_g",
    "fat_g",
    "fiber_g",
    "sugar_g",
    "alcohol_g",
    "caffeine_mg",
    "grams_per_each",
    "grams_per_ml",
    "default_unit",
] as const;

export type MergePairPickField = (typeof MERGE_PAIR_PICK_FIELDS)[number];

const MERGE_PICK_TO_FOOD_KEY: Record<
    MergePairPickField,
    keyof Food | "ledgerDefaultUnit"
> = {
    calories: "calories",
    protein_g: "proteinG",
    carbs_g: "carbsG",
    fat_g: "fatG",
    fiber_g: "fiberG",
    sugar_g: "sugarG",
    alcohol_g: "alcoholG",
    caffeine_mg: "caffeineMg",
    grams_per_each: "gramsPerEach",
    grams_per_ml: "gramsPerMl",
    default_unit: "ledgerDefaultUnit",
};

function foodFieldForMergePick(
    food: Food,
    field: MergePairPickField,
): string | number | null {
    if (field === "default_unit") return ledgerDefaultUnit(food);
    const key = MERGE_PICK_TO_FOOD_KEY[field];
    if (key === "ledgerDefaultUnit") return ledgerDefaultUnit(food);
    return food[key as keyof Food] as number | null;
}

const MERGE_PICK_NUTRITION_WIRES = new Set<MergePairPickField>([
    "calories",
    "protein_g",
    "carbs_g",
    "fat_g",
    "fiber_g",
    "sugar_g",
    "alcohol_g",
    "caffeine_mg",
]);

function mergePickFieldsConflict(a: Food, b: Food): MergePairPickField[] {
    const out: MergePairPickField[] = [];
    const bothHaveNutrition = usualHasAnyNutrient(a) && usualHasAnyNutrient(b);
    for (const wire of MERGE_PAIR_PICK_FIELDS) {
        if (wire === "default_unit") {
            const ua = ledgerDefaultUnit(a);
            const ub = ledgerDefaultUnit(b);
            if (ua !== ub) out.push(wire);
            continue;
        }
        const key = MERGE_PICK_TO_FOOD_KEY[wire] as keyof Food;
        const va = a[key];
        const vb = b[key];
        if (MERGE_PICK_NUTRITION_WIRES.has(wire)) {
            if (bothHaveNutrition && va !== vb) out.push(wire);
            continue;
        }
        if (va != null && vb != null && va !== vb) out.push(wire);
    }
    return out;
}

export function foodPairMergeConflicts(a: Food, b: Food): MergePairPickField[] {
    return mergePickFieldsConflict(a, b);
}

function brandKeyForDuplicate(brand: string | null | undefined): string | null {
    return brand?.trim() ? brand.trim() : null;
}

function brandsConflict(a: Food, b: Food): boolean {
    const ba = brandKeyForDuplicate(a.brand);
    const bb = brandKeyForDuplicate(b.brand);
    return ba != null && bb != null && ba !== bb;
}

function tokenSetOf(food: Food): Set<string> {
    return new Set(foodNameTokens(food.name));
}

function isStrictSubset(small: Set<string>, large: Set<string>): boolean {
    if (small.size >= large.size) return false;
    for (const t of small) {
        if (!large.has(t)) return false;
    }
    return true;
}

function pairRule(
    a: Food,
    b: Food,
    setA: Set<string>,
    setB: Set<string>,
): PossibleDuplicateRule | null {
    if (setA.size === setB.size && setA.size > 0) {
        for (const t of setA) {
            if (!setB.has(t)) return null;
        }
        return "same_words";
    }
    const largeFood = setA.size > setB.size ? a : b;
    const smallSet = setA.size < setB.size ? setA : setB;
    const largeSet = setA.size < setB.size ? setB : setA;
    if (!isStrictSubset(smallSet, largeSet)) return null;
    if (brandKeyForDuplicate(largeFood.brand) != null) return null;
    return "contains_words";
}

/** Ordered pair key for deduping (`normalizePairIds` order). */
function possibleDuplicatePairKey(idA: string, idB: string): string {
    const { subjectId, relatedKey } =
        idA < idB
            ? { subjectId: idA, relatedKey: idB }
            : { subjectId: idB, relatedKey: idA };
    return `${subjectId}\0${relatedKey}`;
}

/**
 * True when some loose-key group of the merge job has 2+ rows, so the job's
 * outcome can depend on which row it keeps (reference counts): with 3+ rows the
 * kept row's accumulated fields decide later skips, and with 2 the alias check
 * looks only at the dropped row's name. Live rows with the same normalized name
 * and brand can't coexist, so every such group has differing names. These groups
 * exist only until the merge job runs, so most page loads skip `countFoodRefs`.
 */
export function duplicatesNeedRefCounts(foods: readonly Food[]): boolean {
    const livePlain = foods.filter(
        (row) => row.archivedAt == null && row.genericFoodId == null,
    );
    const sizes = new Map<string, number>();
    for (const row of livePlain) {
        const loose = looseFoodKey(row.name);
        if (!loose) continue;
        const brand = duplicateBrandKey(row.brand);
        const key = `${row.householdId}\0${row.kind}\0${loose}\0${brand === null ? "" : brand}`;
        const next = (sizes.get(key) ?? 0) + 1;
        sizes.set(key, next);
        if (next >= 2) return true;
    }
    return false;
}

/** Pairs the merge job would auto-merge for the given reference counts. */
function jobAutoMergedPairKeys(
    foods: readonly Food[],
    refCounts: ReadonlyMap<string, number>,
    aliases: ReadonlyMap<string, string[]>,
): Set<string> {
    const { merges } = duplicatePairs(foods, refCounts, aliases);
    const parent = new Map<string, string>();
    const find = (id: string): string => {
        let p = parent.get(id) ?? id;
        if (p !== id) {
            p = find(p);
            parent.set(id, p);
        }
        return p;
    };
    const union = (a: string, b: string) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(rb, ra);
    };
    for (const m of merges) {
        union(m.keep.id, m.drop.id);
    }
    const clusterIds = new Map<string, string[]>();
    for (const m of merges) {
        for (const id of [m.keep.id, m.drop.id]) {
            const root = find(id);
            const list = clusterIds.get(root) ?? [];
            if (!list.includes(id)) list.push(id);
            clusterIds.set(root, list);
        }
    }
    const keys = new Set<string>();
    for (const ids of clusterIds.values()) {
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                keys.add(possibleDuplicatePairKey(ids[i]!, ids[j]!));
            }
        }
    }
    return keys;
}

function pairDismissed(
    idA: string,
    idB: string,
    dismissed: ReadonlySet<string>,
): boolean {
    const key = lookupDismissalKey("food.possible_duplicate", "food", idA, idB);
    return dismissed.has(dismissalKeyString(key));
}

export function possibleDuplicates(
    foods: readonly Food[],
    aliases: ReadonlyMap<string, string[]>,
    barcodedIds: ReadonlySet<string>,
    dismissed: ReadonlySet<string>,
    refCounts: ReadonlyMap<string, number> = new Map(),
): PossibleDuplicatePair[] {
    const jobMerged = jobAutoMergedPairKeys(foods, refCounts, aliases);
    const tokenSets = new Map<string, Set<string>>();
    for (const row of foods) {
        if (row.archivedAt == null) {
            tokenSets.set(row.id, tokenSetOf(row));
        }
    }
    const candidates = foods.filter(
        (row) =>
            row.archivedAt == null &&
            row.genericFoodId == null &&
            !barcodedIds.has(row.id) &&
            !row.offSourceId &&
            (tokenSets.get(row.id)?.size ?? 0) > 0,
    );

    const buckets = new Map<string, Food[]>();
    for (const food of candidates) {
        const tokens = tokenSets.get(food.id)!;
        for (const token of tokens) {
            const key = `${food.householdId}\0${food.kind}\0${token}`;
            const list = buckets.get(key);
            if (list) list.push(food);
            else buckets.set(key, [food]);
        }
    }

    const seen = new Set<string>();
    const pairs: PossibleDuplicatePair[] = [];

    for (const b of candidates) {
        const bTokens = tokenSets.get(b.id)!;
        let rarestToken: string | null = null;
        let rarestSize = Number.POSITIVE_INFINITY;
        for (const token of bTokens) {
            const key = `${b.householdId}\0${b.kind}\0${token}`;
            const size = buckets.get(key)?.length ?? 0;
            if (size < rarestSize) {
                rarestSize = size;
                rarestToken = token;
            }
        }
        if (rarestToken == null) continue;
        const bucket =
            buckets.get(`${b.householdId}\0${b.kind}\0${rarestToken}`) ?? [];
        for (const a of bucket) {
            if (a.id === b.id) continue;
            if (a.kind !== b.kind || a.householdId !== b.householdId) continue;
            const aTokens = tokenSets.get(a.id)!;
            if (![...bTokens].every((t) => aTokens.has(t))) continue;
            const rule = pairRule(a, b, aTokens, bTokens);
            if (!rule) continue;
            if (brandsConflict(a, b)) continue;
            const subjectId = a.id < b.id ? a.id : b.id;
            const relatedId = a.id < b.id ? b.id : a.id;
            const key = possibleDuplicatePairKey(subjectId, relatedId);
            if (seen.has(key)) continue;
            if (jobMerged.has(key)) continue;
            if (pairDismissed(subjectId, relatedId, dismissed)) continue;
            seen.add(key);
            const subject = subjectId === a.id ? a : b;
            const related = relatedId === a.id ? a : b;
            pairs.push({ subject, related, rule });
        }
    }

    pairs.sort((p, q) => {
        const bySub = p.subject.name.localeCompare(q.subject.name);
        if (bySub !== 0) return bySub;
        const byRel = p.related.name.localeCompare(q.related.name);
        if (byRel !== 0) return byRel;
        const byIds = p.subject.id.localeCompare(q.subject.id);
        if (byIds !== 0) return byIds;
        return p.related.id.localeCompare(q.related.id);
    });
    return pairs;
}

export type MergeFoodPairInput = {
    keepId: string;
    dropId: string;
    picks?: Partial<Record<MergePairPickField, string>>;
};

function pickFoodValue(
    field: MergePairPickField,
    food: Food,
): string | number | null {
    return foodFieldForMergePick(food, field);
}

function buildMergePairPatch(
    keep: Food,
    drop: Food,
    picks: Partial<Record<MergePairPickField, string>>,
): FoodPatch {
    const patch: FoodPatch = {};
    const conflicts = mergePickFieldsConflict(keep, drop);
    const bothHaveNutrition =
        usualHasAnyNutrient(keep) && usualHasAnyNutrient(drop);
    const nutritionConflicts = conflicts.filter((wire) =>
        MERGE_PICK_NUTRITION_WIRES.has(wire),
    );
    for (const wire of conflicts) {
        const pickId = picks[wire];
        const source =
            pickId === drop.id ? drop : pickId === keep.id ? keep : keep;
        if (pickId != null && pickId !== keep.id && pickId !== drop.id) {
            throw new FoodsInputError("Invalid field pick.");
        }
        const val = pickFoodValue(wire, source);
        if (wire === "default_unit") {
            patch.defaultUnit = String(val);
        } else if (wire === "calories") patch.calories = val as number | null;
        else if (wire === "protein_g") patch.proteinG = val as number | null;
        else if (wire === "carbs_g") patch.carbsG = val as number | null;
        else if (wire === "fat_g") patch.fatG = val as number | null;
        else if (wire === "fiber_g") patch.fiberG = val as number | null;
        else if (wire === "sugar_g") patch.sugarG = val as number | null;
        else if (wire === "alcohol_g") patch.alcoholG = val as number | null;
        else if (wire === "caffeine_mg")
            patch.caffeineMg = val as number | null;
        else if (wire === "grams_per_each")
            patch.gramsPerEach = val as number | null;
        else if (wire === "grams_per_ml")
            patch.gramsPerMl = val as number | null;
    }
    if (
        bothHaveNutrition &&
        nutritionConflicts.length > 0 &&
        nutritionConflicts.every((wire) => picks[wire] === drop.id)
    ) {
        patch.nutritionSource = drop.nutritionSource;
    }
    return patch;
}

export async function mergeFoodPair(
    store: FoodsStore,
    householdId: string,
    input: MergeFoodPairInput,
): Promise<Food> {
    const { keepId, dropId, picks = {} } = input;
    if (keepId === dropId) {
        throw new FoodsInputError("Pick two different foods to merge.");
    }
    const actualKeep = await findFoodById(store, householdId, keepId);
    const actualDrop = await store.getFood(householdId, dropId);
    if (!actualDrop || actualDrop.archivedAt) {
        throw new FoodsInputError("Unknown food.");
    }
    const listed = await store.listFoods(householdId);
    assertMergeable(actualKeep, actualDrop, listed);
    const patch = buildMergePairPatch(actualKeep, actualDrop, picks);
    const next = await buildFoodUpdate(
        store,
        householdId,
        actualKeep.id,
        patch,
    );
    await store.updateFoodRow(next);
    return mergeFoods(store, householdId, actualKeep.id, actualDrop.id);
}

export async function searchFoodCatalog(
    store: FoodsStore,
    householdId: string,
    query: string,
    offHits: FoodResult[],
): Promise<FoodSearchHit[]> {
    const listed = await store.listFoods(householdId);
    const aliasMap = await store.listAllAliases(householdId);
    const household = matchFoodsByWords(query, listed, aliasMap);
    const nameById = new Map(listed.map((row) => [row.id, row.name]));
    const genericFields = (food: Food | null | undefined) => {
        if (!food?.genericFoodId) {
            return {
                generic_food_id: null as string | null,
                generic_food_name: null as string | null,
            };
        }
        return {
            generic_food_id: food.genericFoodId,
            generic_food_name: nameById.get(food.genericFoodId) ?? null,
        };
    };
    const barcodesByFood = await store.listBarcodesForFoods(
        householdId,
        household.map((f) => f.id),
    );
    const listedById = new Map(listed.map((row) => [row.id, row]));
    const householdBarcodes = new Set<string>();
    const hits: FoodSearchHit[] = [];
    for (const food of household) {
        const barcodes = barcodesByFood.get(food.id) ?? [];
        for (const barcode of barcodes) householdBarcodes.add(barcode);
        hits.push({
            food_id: food.id,
            name: food.name,
            brand: food.brand,
            barcode: barcodes[0] ?? null,
            source: "household",
            calories: food.calories,
            protein_g: food.proteinG,
            carbs_g: food.carbsG,
            fat_g: food.fatG,
            fiber_g: food.fiberG,
            sugar_g: food.sugarG,
            serving: "100 g",
            default_unit: food.defaultUnit,
            ...genericFields(food),
        });
    }
    const offToResolve: FoodResult[] = [];
    for (const food of offHits) {
        if (householdBarcodes.has(food.barcode)) continue;
        offToResolve.push(food);
    }
    const barcodeToFoodId = await store.getBarcodeFoodIds(
        householdId,
        offToResolve.map((f) => f.barcode),
    );
    const missingFoodIds = new Set<string>();
    for (const food of offToResolve) {
        const existingId = barcodeToFoodId.get(food.barcode);
        if (existingId != null && !listedById.has(existingId)) {
            missingFoodIds.add(existingId);
        }
    }
    const loadedOffFoods = new Map<string, Food | null>();
    await Promise.all(
        [...missingFoodIds].map(async (id) => {
            loadedOffFoods.set(id, await store.getFood(householdId, id));
        }),
    );
    for (const food of offToResolve) {
        const existingId = barcodeToFoodId.get(food.barcode) ?? null;
        const existing =
            existingId != null
                ? (listedById.get(existingId) ??
                  loadedOffFoods.get(existingId) ??
                  null)
                : null;
        hits.push({
            food_id: existingId,
            name: food.name,
            brand: food.brand,
            barcode: food.barcode,
            source: food.source,
            calories: food.calories,
            protein_g: food.protein_g,
            carbs_g: food.carbs_g,
            fat_g: food.fat_g,
            fiber_g: food.fiber_g,
            sugar_g: food.sugar_g,
            serving: food.serving,
            default_unit: null,
            ...genericFields(existing),
        });
    }
    return hits;
}

function rowTextArray(value: unknown): string[] | null {
    if (value == null) return null;
    if (!Array.isArray(value)) return null;
    return value.map((item) => String(item));
}

function rowQualityTimestamp(value: unknown): string | null {
    if (value == null) return null;
    if (value instanceof Date) return value.toISOString();
    const s = String(value);
    return s.trim() ? s : null;
}

function gradeFromRow(value: unknown): FoodQuality["nutriscoreGrade"] {
    if (value == null) return null;
    const g = String(value).trim().toLowerCase();
    if (g === "a" || g === "b" || g === "c" || g === "d" || g === "e") return g;
    return null;
}

function ecoscoreFromRow(value: unknown): FoodQuality["ecoscoreGrade"] {
    if (value == null) return null;
    const g = String(value).trim().toLowerCase();
    if (
        g === "a-plus" ||
        g === "a" ||
        g === "b" ||
        g === "c" ||
        g === "d" ||
        g === "e" ||
        g === "f"
    ) {
        return g;
    }
    return null;
}

function novaFromRow(value: unknown): FoodQuality["novaGroup"] {
    if (value == null) return null;
    const n = Number(value);
    return n === 1 || n === 2 || n === 3 || n === 4 ? n : null;
}

function offQualityFromRow(row: {
    nutriscore_grade: unknown;
    nova_group: unknown;
    ecoscore_grade: unknown;
    additives_tags: unknown;
    allergens_tags: unknown;
    traces_tags: unknown;
    ingredients_analysis_tags: unknown;
    labels_tags: unknown;
    off_quality_fetched_at: unknown;
}): FoodQuality | null {
    const fetchedAt = rowQualityTimestamp(row.off_quality_fetched_at);
    if (fetchedAt == null) return null;
    const additiveTags = rowTextArray(row.additives_tags);
    return {
        nutriscoreGrade: gradeFromRow(row.nutriscore_grade),
        novaGroup: novaFromRow(row.nova_group),
        ecoscoreGrade: ecoscoreFromRow(row.ecoscore_grade),
        additives:
            additiveTags == null
                ? null
                : additiveTags.map((tag) => ({
                      tag,
                      risk: additiveRisk(tag),
                  })),
        allergensTags: rowTextArray(row.allergens_tags),
        tracesTags: rowTextArray(row.traces_tags),
        ingredientsAnalysisTags: rowTextArray(row.ingredients_analysis_tags),
        labelsTags: rowTextArray(row.labels_tags),
        fetchedAt,
    };
}

export function offQualityToRowFields(q: FoodQuality | null): {
    nutriscore_grade: string | null;
    nova_group: number | null;
    ecoscore_grade: string | null;
    additives_tags: string[] | null;
    allergens_tags: string[] | null;
    traces_tags: string[] | null;
    ingredients_analysis_tags: string[] | null;
    labels_tags: string[] | null;
    off_quality_fetched_at: string | null;
} {
    if (q == null) {
        return {
            nutriscore_grade: null,
            nova_group: null,
            ecoscore_grade: null,
            additives_tags: null,
            allergens_tags: null,
            traces_tags: null,
            ingredients_analysis_tags: null,
            labels_tags: null,
            off_quality_fetched_at: null,
        };
    }
    return {
        nutriscore_grade: q.nutriscoreGrade,
        nova_group: q.novaGroup,
        ecoscore_grade: q.ecoscoreGrade,
        additives_tags:
            q.additives == null ? null : q.additives.map((a) => a.tag),
        allergens_tags: q.allergensTags,
        traces_tags: q.tracesTags,
        ingredients_analysis_tags: q.ingredientsAnalysisTags,
        labels_tags: q.labelsTags,
        off_quality_fetched_at: q.fetchedAt,
    };
}

export function foodFromRow(row: {
    id: unknown;
    household_id: unknown;
    kind: unknown;
    name: unknown;
    normalized_name: unknown;
    brand: unknown;
    default_unit: unknown;
    grams_per_each: unknown;
    grams_per_ml: unknown;
    calories: unknown;
    protein_g: unknown;
    carbs_g: unknown;
    fat_g: unknown;
    fiber_g: unknown;
    sugar_g: unknown;
    saturated_fat_g?: unknown;
    alcohol_g: unknown;
    caffeine_mg: unknown;
    nutrition_source: unknown;
    off_nutrient_levels?: unknown;
    allergens: unknown;
    off_source_id: unknown;
    generic_food_id: unknown;
    usual_product_id: unknown;
    usual_store_id: unknown;
    usual_amount: unknown;
    usual_unit: unknown;
    restock_schedule?: unknown;
    restock_every_weeks?: unknown;
    restock_paused?: unknown;
    restock_when_low?: unknown;
    restock_low_level?: unknown;
    last_restocked_on?: unknown;
    nutriscore_grade?: unknown;
    nova_group?: unknown;
    ecoscore_grade?: unknown;
    additives_tags?: unknown;
    allergens_tags?: unknown;
    traces_tags?: unknown;
    ingredients_analysis_tags?: unknown;
    labels_tags?: unknown;
    off_quality_fetched_at?: unknown;
    created_by: unknown;
    archived_at: unknown;
    created_at: unknown;
    updated_at: unknown;
}): Food {
    const kind = row.kind === "supply" ? "supply" : "food";
    const source = row.nutrition_source;
    const nutritionSource: NutritionSource | null =
        source === "openfoodfacts" ||
        source === "manual" ||
        source === "estimate" ||
        source === "recipe"
            ? source
            : null;
    const usualAmt =
        row.usual_amount != null &&
        row.usual_unit != null &&
        String(row.usual_unit).trim() !== ""
            ? Number(row.usual_amount)
            : null;
    const usualUnit =
        usualAmt != null && Number.isFinite(usualAmt) && usualAmt > 0
            ? String(row.usual_unit).trim()
            : null;
    const usualAmount: UsualAmount | null =
        usualAmt != null &&
        usualUnit != null &&
        Number.isFinite(usualAmt) &&
        usualAmt > 0
            ? { amount: usualAmt, unit: usualUnit }
            : null;
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        kind,
        name: String(row.name),
        normalizedName: String(row.normalized_name),
        brand: typeof row.brand === "string" && row.brand ? row.brand : null,
        defaultUnit: String(row.default_unit ?? "g"),
        gramsPerEach:
            row.grams_per_each == null ? null : Number(row.grams_per_each),
        gramsPerMl: row.grams_per_ml == null ? null : Number(row.grams_per_ml),
        calories: row.calories == null ? null : Number(row.calories),
        proteinG: row.protein_g == null ? null : Number(row.protein_g),
        carbsG: row.carbs_g == null ? null : Number(row.carbs_g),
        fatG: row.fat_g == null ? null : Number(row.fat_g),
        fiberG: row.fiber_g == null ? null : Number(row.fiber_g),
        sugarG: row.sugar_g == null ? null : Number(row.sugar_g),
        saturatedFatG:
            row.saturated_fat_g == null ? null : Number(row.saturated_fat_g),
        alcoholG: row.alcohol_g == null ? null : Number(row.alcohol_g),
        caffeineMg: row.caffeine_mg == null ? null : Number(row.caffeine_mg),
        nutritionSource,
        offNutrientLevels: offNutrientLevelsFromRow(row.off_nutrient_levels),
        allergens: Array.isArray(row.allergens)
            ? row.allergens.map((item) => String(item))
            : [],
        offSourceId:
            typeof row.off_source_id === "string" && row.off_source_id
                ? row.off_source_id
                : null,
        genericFoodId:
            typeof row.generic_food_id === "string" && row.generic_food_id
                ? row.generic_food_id
                : null,
        usualProductId:
            typeof row.usual_product_id === "string" && row.usual_product_id
                ? row.usual_product_id
                : null,
        usualStoreId:
            typeof row.usual_store_id === "string" && row.usual_store_id
                ? row.usual_store_id
                : null,
        usualAmount,
        ...usualScheduleFromRow(row),
        offQuality: offQualityFromRow({
            nutriscore_grade: row.nutriscore_grade ?? null,
            nova_group: row.nova_group ?? null,
            ecoscore_grade: row.ecoscore_grade ?? null,
            additives_tags: row.additives_tags ?? null,
            allergens_tags: row.allergens_tags ?? null,
            traces_tags: row.traces_tags ?? null,
            ingredients_analysis_tags: row.ingredients_analysis_tags ?? null,
            labels_tags: row.labels_tags ?? null,
            off_quality_fetched_at: row.off_quality_fetched_at ?? null,
        }),
        createdBy:
            typeof row.created_by === "string" && row.created_by
                ? row.created_by
                : null,
        archivedAt:
            typeof row.archived_at === "string" && row.archived_at
                ? row.archived_at
                : null,
        createdAt: String(row.created_at ?? ""),
        updatedAt: String(row.updated_at ?? ""),
    };
}

export function foodToRow(row: Food) {
    return {
        id: row.id,
        household_id: row.householdId,
        kind: row.kind,
        name: row.name,
        normalized_name: row.normalizedName,
        brand: row.brand,
        default_unit: row.defaultUnit,
        grams_per_each: row.gramsPerEach,
        grams_per_ml: row.gramsPerMl,
        calories: row.calories,
        protein_g: row.proteinG,
        carbs_g: row.carbsG,
        fat_g: row.fatG,
        fiber_g: row.fiberG,
        sugar_g: row.sugarG,
        saturated_fat_g: row.saturatedFatG,
        alcohol_g: row.alcoholG,
        caffeine_mg: row.caffeineMg,
        nutrition_source: row.nutritionSource,
        off_nutrient_levels: row.offNutrientLevels,
        allergens: row.allergens,
        off_source_id: row.offSourceId,
        generic_food_id: row.genericFoodId,
        usual_product_id: row.usualProductId,
        usual_store_id: row.usualStoreId,
        usual_amount: row.usualAmount?.amount ?? null,
        usual_unit: row.usualAmount?.unit ?? null,
        restock_schedule: row.restockSchedule,
        restock_every_weeks: row.restockEveryWeeks,
        restock_paused: row.restockPaused,
        restock_when_low: row.restockWhenLow,
        restock_low_level: row.restockLowLevel,
        last_restocked_on: row.lastRestockedOn,
        ...offQualityToRowFields(row.offQuality),
        created_by: row.createdBy,
        archived_at: row.archivedAt,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
    };
}

// "Did you mean" at web entry: the view model for the question and the
// alias a chosen candidate can remember (CLN-5).

export type DidYouMeanView = {
    name: string;
    heading: string;
    candidates: { foodId: string; label: string }[];
    aliasLabel: string;
    newFoodLabel: string;
    hiddenFields: Record<string, string>;
};

const HIDDEN_OMIT = new Set([
    "food_id",
    "new_food",
    "remember_alias",
    "confirm_allergen",
]);

function candidateLabel(name: string, brand: string | null): string {
    return brand ? `${brand} · ${name}` : name;
}

export function didYouMeanView(
    entry: SimilarFoodsEntry,
    fields: Record<string, string>,
): DidYouMeanView {
    const hiddenFields: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
        if (HIDDEN_OMIT.has(key) || value === "") continue;
        hiddenFields[key] = value;
    }
    hiddenFields.alias_name = entry.name;

    const candidates = entry.candidates
        .slice(0, SIMILAR_FOODS_LIMIT)
        .map((row) => ({
            foodId: row.food.id,
            label: candidateLabel(row.food.name, row.food.brand),
        }));

    const heading =
        candidates.length === 1
            ? `Did you mean ${candidates[0]!.label}?`
            : "Did you mean one of these?";

    const aliasLabel =
        candidates.length === 1
            ? `Remember ${entry.name} as another name for ${candidates[0]!.label}`
            : `Remember ${entry.name} as another name for the food you pick`;

    const newFoodLabel = `Add ${entry.name} as a new food`;

    return {
        name: entry.name,
        heading,
        candidates,
        aliasLabel,
        newFoodLabel,
        hiddenFields,
    };
}

export type RememberAliasResult = "set" | "same" | "taken" | "skipped";

export async function rememberAliasForChoice(
    store: FoodsStore,
    householdId: string,
    foodId: string,
    aliasName: string,
): Promise<RememberAliasResult> {
    const trimmed = aliasName.trim();
    if (!trimmed) return "skipped";
    const alias = normalizeFoodName(trimmed);
    if (!alias) return "skipped";

    let food;
    try {
        food = await findFoodById(store, householdId, foodId);
    } catch {
        return "skipped";
    }
    if (alias === food.normalizedName) return "same";

    const taken = await store.getAliasFoodId(householdId, alias);
    if (taken && taken !== foodId) {
        const owner = await store.getFood(householdId, taken);
        if (owner && !owner.archivedAt) return "taken";
    }
    if (taken === foodId) return "same";

    await store.setAlias(householdId, alias, foodId);
    return "set";
}
