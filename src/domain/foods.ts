import { isNamedAllergen, type NamedAllergen } from "./rules.js";
import { normalizeBarcode, type FoodResult } from "../foods.js";
import { isQuantityUnit } from "./quantity.js";
import {
    cleanupDismissalsForFood,
    type MemoryNoticeDismissalsHolder,
    type NoticeDismissalsStore,
} from "./notice-dismissals.js";

export type FoodKind = "food" | "supply";

export type NutritionSource =
    "openfoodfacts" | "manual" | "estimate" | "recipe";

export type UsualAmount = { amount: number; unit: string };

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
    alcoholG: number | null;
    caffeineMg: number | null;
    nutritionSource: NutritionSource | null;
    allergens: string[];
    offSourceId: string | null;
    genericFoodId: string | null;
    usualProductId: string | null;
    usualStoreId: string | null;
    usualAmount: UsualAmount | null;
    createdBy: string | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
};

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
    alcoholG: number | null;
} {
    const serving = (food.serving ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
    if (serving === "100g") {
        return {
            calories: food.calories,
            proteinG: food.protein_g,
            carbsG: food.carbs_g,
            fatG: food.fat_g,
            fiberG: food.fiber_g,
            sugarG: food.sugar_g,
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
        alcoholG: null,
    };
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

    const store: MemoryFoodsStore = {
        refs,
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
    alcoholG?: number | null;
    caffeineMg?: number | null;
    nutritionSource?: NutritionSource | null;
    allergens?: string[];
    offSourceId?: string | null;
    genericFoodId?: string | null;
    usualProductId?: string | null;
    usualStoreId?: string | null;
    usualAmount?: UsualAmount | null;
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
        alcoholG: input.alcoholG ?? null,
        caffeineMg: input.caffeineMg ?? null,
        nutritionSource: input.nutritionSource ?? null,
        allergens: [...(input.allergens ?? [])],
        offSourceId: input.offSourceId ?? null,
        genericFoodId: input.genericFoodId ?? null,
        usualProductId: input.usualProductId ?? null,
        usualStoreId: input.usualStoreId ?? null,
        usualAmount:
            input.usualAmount == null ? null : { ...input.usualAmount },
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
    const key = looseFoodKey(name);
    const listed = await store.listFoods(householdId);
    let matches = listed.filter(
        (food) =>
            food.kind === kind &&
            food.archivedAt == null &&
            looseFoodKey(food.name) === key,
    );
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
            return { food: existing, created: false };
        }
    }
    const byOff = await store.getByOffSourceId(householdId, normalized);
    if (byOff) {
        await store.setBarcode(householdId, normalized, byOff.id);
        return { food: byOff, created: false };
    }
    const byName = await existingByNameOrAlias(
        store,
        householdId,
        "food",
        normalizeFoodName(hit.name),
    );
    if (byName) {
        await store.setBarcode(householdId, normalized, byName.id);
        return { food: byName, created: false };
    }
    const nutrition = catalogNutritionFromOff(hit);
    const created = await store.insertFood(
        newFood({
            householdId,
            kind: "food",
            name: hit.name,
            brand: hit.brand,
            ...nutrition,
            gramsPerEach: gramsPerEachFromOff(hit),
            nutritionSource: "openfoodfacts",
            allergens: hit.allergens ?? mapOffAllergenTags(hit.allergens_tags),
            offSourceId: normalized,
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
            return { food: existing, created: false };
        }
    }
    const hit = await lookup(normalized);
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

export async function findOrCreateManualFood(
    store: FoodsStore,
    householdId: string,
    kind: FoodKind,
    name: string,
): Promise<Food> {
    const trimmed = name.trim();
    if (!trimmed) {
        throw new FoodsInputError(
            kind === "supply" ? "Enter a supply name." : "Enter a food name.",
        );
    }
    const found = await findManualFood(store, householdId, kind, trimmed);
    if (found) return found;
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
    return findOrCreateManualFood(store, householdId, kind, input.name ?? "");
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
    const entries = await Promise.all(
        unique.map(async (id) => {
            const food = await store.getFood(householdId, id);
            return food ? ([id, food] as const) : null;
        }),
    );
    return new Map(entries.filter((entry) => entry != null));
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

function nutritionBlockFrom(
    source: Food,
): Pick<Food, (typeof NUTRITION_BLOCK_KEYS)[number] | "nutritionSource"> {
    return {
        calories: source.calories,
        proteinG: source.proteinG,
        carbsG: source.carbsG,
        fatG: source.fatG,
        fiberG: source.fiberG,
        sugarG: source.sugarG,
        alcoholG: source.alcoholG,
        caffeineMg: source.caffeineMg,
        nutritionSource: source.nutritionSource,
    };
}

/** Unknown fields on `keep` are filled from `drop` for merge; see `mergeFoods`. */
export type MergedFoodFieldPick = Pick<
    Food,
    | (typeof NUTRITION_BLOCK_KEYS)[number]
    | "nutritionSource"
    | "gramsPerEach"
    | "gramsPerMl"
    | "defaultUnit"
    | "allergens"
    | "usualStoreId"
    | "usualAmount"
>;

export function mergedFoodFields(keep: Food, drop: Food): MergedFoodFieldPick {
    const nutritionBlock = usualHasAnyNutrient(keep)
        ? nutritionBlockFrom(keep)
        : usualHasAnyNutrient(drop)
          ? nutritionBlockFrom(drop)
          : nutritionBlockFrom(keep);

    return {
        ...nutritionBlock,
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

export function foodNameTokens(text: string): string[] {
    return prepareFoodNameForTokens(text)
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map(singularizeNameToken);
}

function foodSearchTokenSet(
    food: Food,
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

export function matchFoodsByWords(
    query: string,
    foods: readonly Food[],
    aliasesByFoodId: ReadonlyMap<string, string[]>,
): Food[] {
    const queryTokens = foodNameTokens(query);
    if (queryTokens.length === 0) return [];
    const queryNorm = normalizeFoodName(query);
    const queryLoose = looseFoodKey(query);
    const queryTokenSet = new Set(queryTokens);
    const hits: Food[] = [];
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
    const nameTokens = (food: Food) => foodNameTokens(food.name);
    const extraNameTokens = (food: Food) =>
        nameTokens(food).filter((token) => !queryTokenSet.has(token)).length;
    const exactRank = (food: Food) => {
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

export async function mergeFoods(
    store: FoodsStore,
    householdId: string,
    keepId: string,
    dropId: string,
): Promise<Food> {
    if (keepId === dropId) {
        throw new FoodsInputError("Pick two different foods to merge.");
    }
    const keep = await findFoodById(store, householdId, keepId);
    const drop = await store.getFood(householdId, dropId);
    if (!drop || drop.archivedAt) {
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
    const listed = await store.listFoods(householdId);
    const dropProducts = listed.filter((row) => row.genericFoodId === dropId);
    const keepProducts = listed.filter((row) => row.genericFoodId === keepId);
    const mergedGenericId = keep.genericFoodId ?? drop.genericFoodId;
    const mergedUsualId = keep.usualProductId ?? drop.usualProductId ?? null;
    const liveProductsAfter = keepProducts.length + dropProducts.length;
    if (mergedGenericId && (liveProductsAfter > 0 || mergedUsualId)) {
        throw new FoodsInputError(
            "Merging those would nest products two deep.",
        );
    }
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
): DuplicatePairsReport {
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
        const loose = looseFoodKey(row.name);
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
            loose: looseFoodKey(first.name),
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
    const householdBarcodes = new Set<string>();
    const hits: FoodSearchHit[] = [];
    for (const food of household) {
        const barcodes = await store.listBarcodes(householdId, food.id);
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
    for (const food of offHits) {
        if (householdBarcodes.has(food.barcode)) continue;
        const existingId = await store.getBarcodeFoodId(
            householdId,
            food.barcode,
        );
        const existing =
            existingId != null
                ? await store.getFood(householdId, existingId)
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
    alcohol_g: unknown;
    caffeine_mg: unknown;
    nutrition_source: unknown;
    allergens: unknown;
    off_source_id: unknown;
    generic_food_id: unknown;
    usual_product_id: unknown;
    usual_store_id: unknown;
    usual_amount: unknown;
    usual_unit: unknown;
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
        alcoholG: row.alcohol_g == null ? null : Number(row.alcohol_g),
        caffeineMg: row.caffeine_mg == null ? null : Number(row.caffeine_mg),
        nutritionSource,
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
        alcohol_g: row.alcoholG,
        caffeine_mg: row.caffeineMg,
        nutrition_source: row.nutritionSource,
        allergens: row.allergens,
        off_source_id: row.offSourceId,
        generic_food_id: row.genericFoodId,
        usual_product_id: row.usualProductId,
        usual_store_id: row.usualStoreId,
        usual_amount: row.usualAmount?.amount ?? null,
        usual_unit: row.usualAmount?.unit ?? null,
        created_by: row.createdBy,
        archived_at: row.archivedAt,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
    };
}
