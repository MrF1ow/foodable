import {
    findManualFood,
    looseFoodKey,
    newFood,
    normalizeFoodName,
    pluralFreeFoodKey,
    type FoodsStore,
} from "./foods.js";
import { createRecipe, type Recipe, type RecipesStore } from "./recipes.js";
import {
    SHARE_DOCUMENT_LIMITS,
    type ShareDocument,
    type ShareDocumentFood,
} from "./sharing-document.js";

/**
 * Importing a shared recipe (a `ShareDocument` from another deploy) as a new
 * recipe of this household. A copy: nothing links it to the original, and
 * nothing of the sharing household comes with it.
 *
 * `planSharedImport` reads and decides, `applySharedImport` writes what the
 * plan says, `importSharedRecipe` does both in one transaction. Each
 * ingredient resolves to a household food by `findManualFood`, the matcher
 * every manual ingredient uses (normalized name, then alias, then the loose
 * key and the household's singular/plural setting), so "Eggs" in the document
 * finds the household's "egg". A food that is found is never touched: its own
 * nutrition and unit factors win over the shipped ones. A food that is not
 * found is created from what the document ships, per 100 g, with unknown
 * values left null (a missing `grams_per_each` stays null, so the recipe shows
 * the gap rather than a guess).
 */

export type PlannedFood =
    /** An existing household food: `name` is the household's own name for it. */
    | { kind: "matched"; foodId: string; name: string }
    /** A food this import creates; `key` ties lines that name the same food. */
    | { kind: "create"; key: string };

export type PlannedIngredient = {
    amount: number | null;
    unit: string | null;
    food: PlannedFood;
};

export type PlannedNewFood = {
    key: string;
    name: string;
    nutrition: ShareDocumentFood;
};

export type SharedImportPlan = {
    recipe: {
        /** The name it will have: the document's, or one that is free. */
        name: string;
        /** The document's name when it had to change, else null. */
        renamedFrom: string | null;
        portions: number;
        instructions: string | null;
        tags: string[];
    };
    ingredients: PlannedIngredient[];
    /** One entry per distinct new food, in the order the lines first need it. */
    newFoods: PlannedNewFood[];
};

export type SharedImportStores = {
    foods: FoodsStore;
    recipes: RecipesStore;
};

export type SharedImportResult = {
    recipe: Recipe;
    /**
     * One entry per ingredient line, in recipe order. `matched`: the household
     * already had that food. `created`: this import added it (every line that
     * names a new food is `created`, including a second line for the same one).
     */
    ingredients: {
        name: string;
        foodId: string;
        status: "matched" | "created";
    }[];
    matched: number;
    created: number;
    renamedFrom: string | null;
};

type Transaction = <T>(fn: () => Promise<T>) => Promise<T>;

const SUFFIX_LIMIT = SHARE_DOCUMENT_LIMITS.name;

/**
 * `name`, or `name (2)`, `name (3)`, … when the household already has a recipe
 * by that name (ignoring case and spacing). Two recipes with one name look
 * like a glitch in a list; importing the same link twice is the usual way to
 * get there. The name is cut, never the suffix, to stay within the name limit.
 */
export function uniqueRecipeName(
    name: string,
    existing: readonly string[],
): string {
    const taken = new Set(existing.map(normalizeFoodName));
    if (!taken.has(normalizeFoodName(name))) return name;
    for (let n = 2; ; n += 1) {
        const suffix = ` (${n})`;
        const base =
            name.length + suffix.length > SUFFIX_LIMIT
                ? name.slice(0, SUFFIX_LIMIT - suffix.length).trimEnd()
                : name;
        const candidate = `${base}${suffix}`;
        if (!taken.has(normalizeFoodName(candidate))) return candidate;
    }
}

/** Resolves every ingredient and the recipe name. Reads only; writes nothing. */
export async function planSharedImport(
    stores: SharedImportStores,
    householdId: string,
    doc: ShareDocument,
): Promise<SharedImportPlan> {
    const newFoods: PlannedNewFood[] = [];
    const keys = new Set<string>();
    // New foods are told apart the way `findManualFood` tells them from the
    // household's own: by loose key, and by plural-free key when the
    // household treats singular and plural as one food.
    const plurals =
        (await stores.foods.pluralsSameFood?.(householdId)) ?? false;
    const identity = (name: string) =>
        (plurals ? pluralFreeFoodKey(name) : looseFoodKey(name)) ||
        normalizeFoodName(name);
    const ingredients: PlannedIngredient[] = [];
    for (const line of doc.ingredients) {
        const found = await findManualFood(
            stores.foods,
            householdId,
            "food",
            line.food_name,
        );
        let food: PlannedFood;
        if (found) {
            food = { kind: "matched", foodId: found.id, name: found.name };
        } else {
            const key = identity(line.food_name);
            if (!keys.has(key)) {
                keys.add(key);
                newFoods.push({
                    key,
                    name: line.food_name,
                    nutrition: { ...line.food },
                });
            }
            food = { kind: "create", key };
        }
        ingredients.push({ amount: line.amount, unit: line.unit, food });
    }
    const existing = await stores.recipes.listRecipes(householdId);
    const name = uniqueRecipeName(
        doc.name,
        existing.map((recipe) => recipe.name),
    );
    return {
        recipe: {
            name,
            renamedFrom: name === doc.name ? null : doc.name,
            portions: doc.portions,
            instructions: doc.instructions,
            tags: [...doc.tags],
        },
        ingredients,
        newFoods,
    };
}

const NUTRIENT_KEYS = [
    "calories",
    "protein_g",
    "carbs_g",
    "fat_g",
    "fiber_g",
    "sugar_g",
    "saturated_fat_g",
    "alcohol_g",
    "caffeine_mg",
] as const satisfies readonly (keyof ShareDocumentFood)[];

function hasShippedNutrition(food: ShareDocumentFood): boolean {
    return NUTRIENT_KEYS.some((key) => food[key] !== null);
}

async function write(
    stores: SharedImportStores,
    input: { householdId: string; creatorId: string; plan: SharedImportPlan },
): Promise<SharedImportResult> {
    const { householdId, creatorId, plan } = input;
    const created = new Map<string, { id: string; name: string }>();
    for (const spec of plan.newFoods) {
        const n = spec.nutrition;
        const food = await stores.foods.insertFood(
            newFood({
                householdId,
                kind: "food",
                name: spec.name,
                calories: n.calories,
                proteinG: n.protein_g,
                carbsG: n.carbs_g,
                fatG: n.fat_g,
                fiberG: n.fiber_g,
                sugarG: n.sugar_g,
                saturatedFatG: n.saturated_fat_g,
                alcoholG: n.alcohol_g,
                caffeineMg: n.caffeine_mg,
                // The basis only matters beside shipped numbers.
                nutritionBasis: hasShippedNutrition(n)
                    ? (n.nutrition_basis ?? null)
                    : null,
                gramsPerMl: n.grams_per_ml,
                gramsPerEach: n.grams_per_each,
                // The document carries numbers someone entered; it is neither
                // an Open Food Facts hit nor an estimate of ours.
                nutritionSource: hasShippedNutrition(n) ? "manual" : null,
                createdBy: creatorId,
            }),
        );
        created.set(spec.key, { id: food.id, name: food.name });
    }

    const recipe = await createRecipe(stores.recipes, {
        householdId,
        creatorId,
        name: plan.recipe.name,
        yieldPortions: plan.recipe.portions,
        instructions: plan.recipe.instructions,
        tags: plan.recipe.tags,
        verification: "verified",
    });

    const lines: SharedImportResult["ingredients"] = [];
    for (const [index, line] of plan.ingredients.entries()) {
        let target: { id: string; name: string };
        let status: "matched" | "created";
        if (line.food.kind === "matched") {
            target = { id: line.food.foodId, name: line.food.name };
            status = "matched";
        } else {
            const made = created.get(line.food.key);
            if (!made) {
                throw new Error(
                    `The import plan has no food for "${line.food.key}".`,
                );
            }
            target = made;
            status = "created";
        }
        const quantity =
            line.amount !== null && line.unit !== null
                ? { amount: line.amount, unit: line.unit }
                : null;
        await stores.recipes.insertIngredient({
            id: crypto.randomUUID(),
            householdId,
            recipeId: recipe.id,
            kind: "food",
            displayName: target.name,
            quantity,
            foodId: target.id,
            sortOrder: index,
            // The same note every unmeasured ingredient gets.
            note: quantity === null ? "to taste" : null,
        });
        lines.push({ name: target.name, foodId: target.id, status });
    }
    return {
        recipe,
        ingredients: lines,
        matched: lines.filter((l) => l.status === "matched").length,
        created: lines.filter((l) => l.status === "created").length,
        renamedFrom: plan.recipe.renamedFrom,
    };
}

/** Writes what `planSharedImport` decided, all or nothing within `transaction`. */
export async function applySharedImport(
    stores: SharedImportStores,
    input: { householdId: string; creatorId: string; plan: SharedImportPlan },
    opts: { transaction?: Transaction } = {},
): Promise<SharedImportResult> {
    const run = opts.transaction ?? ((fn) => fn());
    return run(() => write(stores, input));
}

/**
 * Plans and applies in one transaction, so a food that appears between the
 * two is matched, not created twice.
 */
export async function importSharedRecipe(
    stores: SharedImportStores,
    input: {
        householdId: string;
        creatorId: string;
        document: ShareDocument;
    },
    opts: { transaction?: Transaction } = {},
): Promise<SharedImportResult> {
    const run = opts.transaction ?? ((fn) => fn());
    return run(async () =>
        write(stores, {
            householdId: input.householdId,
            creatorId: input.creatorId,
            plan: await planSharedImport(
                stores,
                input.householdId,
                input.document,
            ),
        }),
    );
}
