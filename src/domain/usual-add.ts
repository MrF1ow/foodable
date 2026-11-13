import { normalizeBarcode } from "../foods.js";
import {
    assertBarcodeFree,
    findFoodByNameAndBrand,
    FoodsInputError,
    linkProduct,
    matchFoodsByWords,
    newFood,
    NO_USUAL_SCHEDULE,
    normalizeFoodName,
    parseUsualPurchase,
    removeProduct,
    setUsualProduct,
    setUsualPurchase,
    setUsualSchedule,
    similarFoods,
    type Food,
    type FoodKind,
    type FoodServing,
    type FoodsStore,
    type NutritionBasis,
    type UsualPurchasePatch,
    type UsualStoreLookup,
} from "./foods.js";

/**
 * A refusal the Add a usual form can show under one input. `field` is the
 * input's name (`name`, `calories`, `protein_g`, `carbs_g`, `fat_g`, `basis`,
 * `serving_amount`, `serving_unit`, `barcode`, `food`), or null when the
 * problem belongs to the whole entry.
 */
export class UsualInputError extends FoodsInputError {
    readonly field: string | null;

    constructor(message: string, field: string | null = null) {
        super(message);
        this.name = "UsualInputError";
        this.field = field;
    }
}

function nowIso(): string {
    return new Date().toISOString();
}

async function liveFood(
    store: FoodsStore,
    householdId: string,
    foodId: string,
): Promise<Food> {
    const food = await store.getFood(householdId, foodId);
    if (!food || food.archivedAt) throw new FoodsInputError("Unknown food.");
    return food;
}

/**
 * A plain food is the thing a usual is: not filed under another food, not a
 * branded row and not one scanned from Open Food Facts. Only such a row can be
 * the usual as it is, and only such rows are offered as "what is it?".
 */
export function isPlainFoodRow(
    food: Pick<Food, "genericFoodId" | "brand" | "offSourceId">,
): boolean {
    return !food.genericFoodId && food.brand == null && !food.offSourceId;
}

function collapseSpaces(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A product's name without its brand at either end: the name to suggest for the food. */
export function nameWithoutBrand(name: string, brand: string | null): string {
    const trimmed = collapseSpaces(name);
    const b = brand?.trim();
    if (!b) return trimmed;
    const sep = "[\\s\\-\u2013\\u00b7,:]*";
    const cut = trimmed
        .replace(new RegExp(`^${escapeRegExp(b)}${sep}`, "i"), "")
        .replace(new RegExp(`${sep}${escapeRegExp(b)}$`, "i"), "")
        .trim();
    return cut || trimmed;
}

export type UsualFoodSuggestions = {
    /** The plain food the product is already filed under, when there is one. */
    filed: Food | null;
    /** Other plain foods it could be, best first. */
    matches: Food[];
};

/**
 * The foods a scanned product could be: the one it is filed under, then real
 * plain foods only (never another brand's product), found by the person's
 * search or, with none, by the product's own name without its brand.
 */
export function suggestUsualFoods(
    product: Food,
    foods: readonly Food[],
    aliases: ReadonlyMap<string, string[]>,
    query = "",
): UsualFoodSuggestions {
    const live = (id: string | null) => {
        const food = id ? foods.find((f) => f.id === id) : undefined;
        return food && !food.archivedAt ? food : null;
    };
    const filed = live(product.genericFoodId);
    const search = query.trim();
    const plain = foods.filter(
        (f) =>
            !f.archivedAt &&
            isPlainFoodRow(f) &&
            f.kind === product.kind &&
            f.id !== product.id,
    );
    const candidates = search
        ? matchFoodsByWords(search, plain, aliases)
        : similarFoods(
              nameWithoutBrand(product.name, product.brand),
              plain,
              aliases,
              {
                  kind: product.kind,
                  keepResolved: true,
              },
          ).map((c) => c.food);
    return {
        filed,
        matches: candidates
            .filter((f) => f.id !== filed?.id)
            .slice(0, search ? 8 : 3),
    };
}

/** The live plain food that goes by this name (or alias), or null. */
async function findPlainFoodByName(
    store: FoodsStore,
    householdId: string,
    kind: FoodKind,
    name: string,
): Promise<Food | null> {
    const byName = await findFoodByNameAndBrand(
        store,
        householdId,
        kind,
        name,
        null,
    );
    if (byName && !byName.archivedAt) return byName;
    const aliasId = await store.getAliasFoodId(
        householdId,
        normalizeFoodName(name),
    );
    if (!aliasId) return null;
    const aliased = await store.getFood(householdId, aliasId);
    return aliased && !aliased.archivedAt && aliased.kind === kind
        ? aliased
        : null;
}

export type UsualFromProductInput = {
    productId: string;
    /** The plain food the product is. Omit it for a product already linked. */
    foodId?: string | null;
    /** Or a name for the plain food: reused when one has it, else created. */
    newFoodName?: string | null;
    purchase?: UsualPurchasePatch;
    stores: UsualStoreLookup;
    createdBy?: string | null;
};

/** A refusal from the shared food rules, shown under the food input. */
function underFoodField(err: unknown): unknown {
    return err instanceof FoodsInputError && !(err instanceof UsualInputError)
        ? new UsualInputError(err.message, "food")
        : err;
}

/**
 * Adds a scanned product to Usuals. The usual is the plain food the product
 * is: the product is linked under it (the same link Settings › Items "Belongs
 * to…" makes, moving it if it sat under another food), becomes its usual
 * product, and the food is stamped as added. A product already under a food
 * goes to that food unless another is named. Returns the plain food.
 *
 * A scanned barcode can belong to a plain food itself (one typed by hand with
 * that barcode). Such a row is not filed under anything: when it is the one
 * named, or nothing is named and it is plain (no brand, not a scanned catalog
 * row), it is stamped as the usual as it is, with no link to itself.
 */
export async function addUsualFromProduct(
    store: FoodsStore,
    householdId: string,
    input: UsualFromProductInput,
): Promise<Food> {
    const product = await liveFood(store, householdId, input.productId);
    if (input.purchase != null) {
        await parseUsualPurchase(householdId, input.purchase, input.stores);
    }
    const foodId = input.foodId?.trim() || null;
    const newName = collapseSpaces(input.newFoodName ?? "") || null;
    let created: Food | null = null;
    let target: Food;
    try {
        if (foodId) {
            target = await liveFood(store, householdId, foodId);
        } else if (newName) {
            const existing = await findPlainFoodByName(
                store,
                householdId,
                product.kind,
                newName,
            );
            if (existing) {
                target = existing;
            } else {
                created = await store.insertFood(
                    newFood({
                        householdId,
                        kind: product.kind,
                        name: newName,
                        createdBy: input.createdBy ?? null,
                    }),
                );
                target = created;
            }
        } else if (product.genericFoodId) {
            target = await liveFood(store, householdId, product.genericFoodId);
        } else if (isPlainFoodRow(product)) {
            target = product;
        } else {
            throw new UsualInputError(
                "Pick the food this product is, or type a name for it.",
                "food",
            );
        }
    } catch (err) {
        throw underFoodField(err);
    }
    const self = target.id === product.id;
    try {
        if (self) {
            if (target.genericFoodId) {
                throw new FoodsInputError(
                    "That food is a product of another food.",
                );
            }
            if (input.purchase != null) {
                await setUsualPurchase(
                    store,
                    householdId,
                    target.id,
                    input.purchase,
                    { stores: input.stores },
                );
            }
        } else {
            await linkProduct(store, householdId, product.id, target.id);
            await setUsualProduct(store, householdId, target.id, product.id, {
                purchase: input.purchase,
                stores: input.stores,
            });
        }
    } catch (err) {
        // Do not leave a food behind that this call made for nothing.
        if (created) {
            await store.updateFoodRow({
                ...created,
                archivedAt: nowIso(),
                updatedAt: nowIso(),
            });
        }
        throw underFoodField(err);
    }
    const refreshed = await liveFood(store, householdId, target.id);
    const saved = await store.updateFoodRow({
        ...refreshed,
        usualAddedAt: nowIso(),
        updatedAt: nowIso(),
    });
    if (!saved) throw new FoodsInputError("Unknown food.");
    return saved;
}

export type UsualByHandBasis = "per_100g" | "per_100ml" | "per_serving";

export type UsualByHandInput = {
    name: string;
    kind?: FoodKind;
    basis: UsualByHandBasis;
    /** The serving the macros are for (`per_serving`), or an optional label. */
    serving?: { amount: number | string | null; unit: string | null } | null;
    calories: number | string | null | undefined;
    proteinG: number | string | null | undefined;
    carbsG: number | string | null | undefined;
    fatG: number | string | null | undefined;
    /** A barcode that missed a scan, to find the food by next time. */
    barcode?: string | null;
    purchase?: UsualPurchasePatch;
    stores: UsualStoreLookup;
    createdBy?: string | null;
};

const MACROS = [
    { key: "calories", field: "calories", label: "calories" },
    { key: "proteinG", field: "protein_g", label: "protein" },
    { key: "carbsG", field: "carbs_g", label: "carbs" },
    { key: "fatG", field: "fat_g", label: "fat" },
] as const;

type MacroKey = (typeof MACROS)[number]["key"];

function parseMacro(
    raw: number | string | null | undefined,
    field: string,
    label: string,
): number {
    const blank = raw == null || (typeof raw === "string" && raw.trim() === "");
    if (blank) throw new UsualInputError(`Enter the ${label}.`, field);
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n) || n < 0) {
        throw new UsualInputError(
            `The ${label} must be a number, zero or more.`,
            field,
        );
    }
    return n;
}

function parseServing(
    raw: UsualByHandInput["serving"],
    required: boolean,
): FoodServing | null {
    const amountBlank =
        raw?.amount == null ||
        (typeof raw.amount === "string" && raw.amount.trim() === "");
    const unitRaw = raw?.unit?.trim().toLowerCase() ?? "";
    if (amountBlank && unitRaw === "" && !required) return null;
    if (amountBlank) {
        throw new UsualInputError(
            "Enter the serving size, more than zero.",
            "serving_amount",
        );
    }
    const amount = Number(String(raw!.amount).trim());
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new UsualInputError(
            "The serving size must be more than zero.",
            "serving_amount",
        );
    }
    if (unitRaw === "") {
        throw new UsualInputError("Pick the serving unit.", "serving_unit");
    }
    if (unitRaw !== "g" && unitRaw !== "ml") {
        throw new UsualInputError(
            "Enter the serving in g or ml. Anything else (each, cup) needs a weight or volume Foodable would have to guess, so use per 100 g or per 100 ml instead.",
            "serving_unit",
        );
    }
    return { label: `${amount} ${unitRaw}`, amount, unit: unitRaw };
}

function round4(n: number): number {
    return Math.round(n * 10_000) / 10_000;
}

/** Equal within a small tolerance: typed figures and OFF's rounded ones. */
function sameMacro(a: number, b: number): boolean {
    return (
        Math.abs(a - b) <=
        Math.max(0.01, 0.005 * Math.max(Math.abs(a), Math.abs(b)))
    );
}

/**
 * Adds a usual that has no scanned product: a name, its four macros (all
 * required) and the basis they are per. A serving in g or ml converts to per
 * 100 g / per 100 ml, the way the foods table stores nutrition; any other
 * serving unit is refused. A plain food with the same normalized name is
 * reused: macros it lacks are filled, equal ones kept, and different ones
 * refuse the entry without touching the food. An optional barcode is attached
 * to the food. Returns the plain food.
 */
export async function addUsualByHand(
    store: FoodsStore,
    householdId: string,
    input: UsualByHandInput,
): Promise<Food> {
    const name = collapseSpaces(input.name ?? "");
    if (!name) throw new UsualInputError("Enter a food name.", "name");
    const kind: FoodKind = input.kind ?? "food";
    if (
        input.basis !== "per_100g" &&
        input.basis !== "per_100ml" &&
        input.basis !== "per_serving"
    ) {
        throw new UsualInputError(
            "Pick what the macros are per: 100 g, 100 ml or a serving.",
            "basis",
        );
    }
    const entered = {
        calories: parseMacro(input.calories, "calories", "calories"),
        proteinG: parseMacro(input.proteinG, "protein_g", "protein"),
        carbsG: parseMacro(input.carbsG, "carbs_g", "carbs"),
        fatG: parseMacro(input.fatG, "fat_g", "fat"),
    };
    const serving = parseServing(input.serving, input.basis === "per_serving");
    let basis: NutritionBasis;
    let scale = 1;
    if (input.basis === "per_serving") {
        basis = serving!.unit === "ml" ? "100ml" : "100g";
        scale = 100 / serving!.amount;
    } else {
        basis = input.basis === "per_100ml" ? "100ml" : "100g";
        if (serving && serving.unit !== (basis === "100ml" ? "ml" : "g")) {
            throw new UsualInputError(
                `The serving must be in ${basis === "100ml" ? "ml" : "g"} to match the macros.`,
                "serving_unit",
            );
        }
    }
    const per100 = {} as Record<MacroKey, number>;
    for (const { key } of MACROS) per100[key] = round4(entered[key] * scale);

    const purchase =
        input.purchase != null
            ? await parseUsualPurchase(
                  householdId,
                  input.purchase,
                  input.stores,
              )
            : {};
    let barcode: string | null = null;
    if (input.barcode != null && input.barcode.trim() !== "") {
        barcode = normalizeBarcode(input.barcode);
        if (!barcode) {
            throw new UsualInputError(
                "That is not a barcode. Barcodes are 8 to 14 digits.",
                "barcode",
            );
        }
    }

    const existing = await findPlainFoodByName(store, householdId, kind, name);
    if (existing?.genericFoodId) {
        throw new UsualInputError(
            `${existing.name} is a product of another food. Pick a different name.`,
            "name",
        );
    }
    if (barcode) {
        try {
            await assertBarcodeFree(
                store,
                householdId,
                barcode,
                existing?.id ?? null,
            );
        } catch (err) {
            throw err instanceof FoodsInputError
                ? new UsualInputError(err.message, "barcode")
                : err;
        }
    }

    const stamp = nowIso();
    let food: Food;
    if (!existing) {
        food = await store.insertFood(
            newFood({
                householdId,
                kind,
                name,
                nutritionBasis: basis,
                ...per100,
                serving,
                nutritionSource: "manual",
                usualStoreId: purchase.usualStoreId ?? null,
                usualAmount: purchase.usualAmount ?? null,
                usualAddedAt: stamp,
                createdBy: input.createdBy ?? null,
            }),
        );
    } else {
        const stored = MACROS.filter(({ key }) => existing[key] != null);
        if (stored.length > 0) {
            const storedBasis: NutritionBasis =
                existing.nutritionBasis ?? "100g";
            const same =
                storedBasis === basis &&
                stored.every(({ key }) =>
                    sameMacro(existing[key]!, per100[key]),
                );
            if (!same) {
                throw new UsualInputError(
                    `${existing.name} is already in your foods with different nutrition. Use that food, or change its nutrition in Items first.`,
                    null,
                );
            }
        }
        const next: Food = {
            ...existing,
            usualAddedAt: stamp,
            updatedAt: stamp,
        };
        if (stored.length < MACROS.length) {
            for (const { key } of MACROS) {
                if (next[key] == null) next[key] = per100[key];
            }
            next.nutritionBasis = basis;
            next.nutritionSource ??= "manual";
        }
        if (serving && next.serving == null) next.serving = serving;
        if (purchase.usualStoreId !== undefined) {
            next.usualStoreId = purchase.usualStoreId;
        }
        if (purchase.usualAmount !== undefined) {
            next.usualAmount = purchase.usualAmount;
        }
        const saved = await store.updateFoodRow(next);
        if (!saved) throw new FoodsInputError("Unknown food.");
        food = saved;
    }
    if (barcode) await store.setBarcode(householdId, barcode, food.id);
    return food;
}

/**
 * Takes a food off the Usuals list for good: every product comes off its list
 * (which also clears the usual product), the added-by-hand stamp goes, and the
 * schedule, paused flag, add-when-low switch, low level and last-restocked day
 * go back to `NO_USUAL_SCHEDULE`. Safe to repeat.
 */
export async function removeUsual(
    store: FoodsStore,
    householdId: string,
    foodId: string,
): Promise<Food> {
    const food = await liveFood(store, householdId, foodId);
    const listed = await store.listFoods(householdId);
    for (const product of listed) {
        if (product.genericFoodId !== food.id || product.archivedAt) continue;
        await removeProduct(store, householdId, food.id, product.id);
    }
    const current = await liveFood(store, householdId, foodId);
    if (current.usualAddedAt != null) {
        await store.updateFoodRow({
            ...current,
            usualAddedAt: null,
            updatedAt: nowIso(),
        });
    }
    return setUsualSchedule(store, householdId, foodId, NO_USUAL_SCHEDULE);
}
