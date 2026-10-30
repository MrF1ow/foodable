import { isNamedAllergen, type NamedAllergen } from "./rules.js";
import { normalizeBarcode, type FoodResult } from "../foods.js";

export type FoodKind = "food" | "supply";

export type NutritionSource =
    "openfoodfacts" | "manual" | "estimate" | "recipe";

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
};

export type FoodsStore = {
    listFoods(householdId: string): Promise<Food[]>;
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

export type MemoryFoodsStore = FoodsStore & {
    refs: { foodId: string }[];
    trackRef(foodId: string): { foodId: string };
};

export function createMemoryFoodsStore(): MemoryFoodsStore {
    const foods: Food[] = [];
    const barcodes: { householdId: string; barcode: string; foodId: string }[] =
        [];
    const aliases: { householdId: string; alias: string; foodId: string }[] =
        [];
    const refs: { foodId: string }[] = [];

    const store: MemoryFoodsStore = {
        refs,
        trackRef(foodId) {
            const row = { foodId };
            refs.push(row);
            return row;
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
            return copyFood(row);
        },
        async getByNormalizedName(householdId, kind, normalizedName) {
            const row = foods.find(
                (food) =>
                    food.householdId === householdId &&
                    food.kind === kind &&
                    food.normalizedName === normalizedName &&
                    food.archivedAt == null,
            );
            return row ? copyFood(row) : null;
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
                .map((row) => row.alias);
        },
        async listAllAliases(householdId) {
            const grouped = new Map<string, string[]>();
            for (const row of aliases) {
                if (row.householdId !== householdId) continue;
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
            const needle = normalizeFoodName(query);
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
        async repointFoodRefs(_householdId, fromId, toId) {
            for (const row of refs) {
                if (row.foodId === fromId) row.foodId = toId;
            }
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
        createdBy: input.createdBy ?? null,
        archivedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
    };
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

export async function findOrCreateFoodByBarcode(
    store: FoodsStore,
    householdId: string,
    barcode: string,
    lookup: (barcode: string) => Promise<FoodResult | null>,
): Promise<Food> {
    const normalized = normalizeBarcode(barcode);
    if (!normalized) throw new FoodsInputError("Enter a valid barcode.");
    const existingId = await store.getBarcodeFoodId(householdId, normalized);
    if (existingId) {
        const existing = await store.getFood(householdId, existingId);
        if (existing && !existing.archivedAt) return existing;
    }
    const hit = await lookup(normalized);
    if (hit == null) throw new FoodsInputError("Unknown barcode.");
    const byOff = await store.getByOffSourceId(householdId, normalized);
    if (byOff) {
        await store.setBarcode(householdId, normalized, byOff.id);
        return byOff;
    }
    const byName = await existingByNameOrAlias(
        store,
        householdId,
        "food",
        normalizeFoodName(hit.name),
    );
    if (byName) {
        await store.setBarcode(householdId, normalized, byName.id);
        return byName;
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
    return created;
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
    const normalized = normalizeFoodName(trimmed);
    const existing = await existingByNameOrAlias(
        store,
        householdId,
        kind,
        normalized,
    );
    if (existing) return existing;
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

export async function updateFood(
    store: FoodsStore,
    householdId: string,
    foodId: string,
    patch: FoodPatch,
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
    const archivedAt =
        patch.archived === undefined
            ? current.archivedAt
            : patch.archived
              ? (current.archivedAt ?? nowIso())
              : null;
    const next: Food = {
        ...current,
        name,
        normalizedName: normalizeFoodName(name),
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
        updatedAt: nowIso(),
    };
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
    await store.updateFoodRow({
        ...drop,
        archivedAt: nowIso(),
        updatedAt: nowIso(),
    });
    return keep;
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
};

export async function searchFoodCatalog(
    store: FoodsStore,
    householdId: string,
    query: string,
    offHits: FoodResult[],
): Promise<FoodSearchHit[]> {
    const household = await store.searchFoods(householdId, query);
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
        });
    }
    for (const food of offHits) {
        if (householdBarcodes.has(food.barcode)) continue;
        const existingId = await store.getBarcodeFoodId(
            householdId,
            food.barcode,
        );
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
        created_by: row.createdBy,
        archived_at: row.archivedAt,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
    };
}
