import {
    type Food,
    type FoodsStore,
    FoodsInputError,
    findFoodById,
    findOrCreateManualFoodForRecipeImport,
} from "./foods.js";
import type { RecipeImport } from "./recipe-import.js";
import {
    type MentionWarning,
    findMissingMentions,
    mentionKey,
} from "./recipe-mentions.js";
import {
    type Recipe,
    type RecipeIngredient,
    type RecipesStore,
    RecipeInputError,
    addRecipeIngredientById,
} from "./recipes.js";

/**
 * The adapters around `findMissingMentions`: load what it needs, store a
 * dismissal, add a mentioned food as an ingredient. Warnings are computed on
 * every read and never stored, and only a recipe with an import row gets any:
 * a hand-made recipe is the person's own word.
 */

/** Household foods and aliases the steps can name, with their ids. */
async function mentionVocabulary(
    foods: FoodsStore,
    householdId: string,
): Promise<{ name: string; foodId: string }[]> {
    const [all, aliases] = await Promise.all([
        foods.listFoods(householdId),
        foods.listAllAliases(householdId),
    ]);
    const out: { name: string; foodId: string }[] = [];
    for (const food of all) {
        // A supply is not a recipe ingredient, and a brand's product page is
        // reached through the plain food it belongs to.
        if (food.kind !== "food" || food.archivedAt) continue;
        if (food.genericFoodId) continue;
        out.push({ name: food.name, foodId: food.id });
        for (const alias of aliases.get(food.id) ?? []) {
            out.push({ name: alias, foodId: food.id });
        }
    }
    return out;
}

/** What a caller that already loaded the recipe can hand over to skip the reads. */
export type LoadedRecipe = {
    recipe?: Recipe;
    ingredients?: RecipeIngredient[];
    /** `null` is "loaded, and it has no import row". */
    importRow?: RecipeImport | null;
};

export async function recipeMentionWarnings(
    stores: { recipes: RecipesStore; foods: FoodsStore },
    householdId: string,
    recipeId: string,
    loaded: LoadedRecipe = {},
): Promise<MentionWarning[]> {
    const importRow =
        loaded.importRow !== undefined
            ? loaded.importRow
            : await stores.recipes.getImport(householdId, recipeId);
    if (!importRow) return [];
    const recipe =
        loaded.recipe ??
        (await stores.recipes.getRecipe(householdId, recipeId));
    if (!recipe) return [];
    const ingredients =
        loaded.ingredients ??
        (await stores.recipes.listIngredients(householdId, recipeId));
    const linked = await stores.foods.getFoodsByIds(
        householdId,
        ingredients.flatMap((i) => (i.foodId ? [i.foodId] : [])),
    );
    // A brand's product stands for the plain food it belongs to.
    const plainIds = [
        ...new Set(
            [...linked.values()].flatMap((f) =>
                f.genericFoodId && !linked.has(f.genericFoodId)
                    ? [f.genericFoodId]
                    : [],
            ),
        ),
    ];
    const plain =
        plainIds.length > 0
            ? await stores.foods.getFoodsByIds(householdId, plainIds)
            : new Map<string, Food>();
    return findMissingMentions({
        instructions: recipe.instructions,
        ingredients: ingredients.map((i) => {
            const food = i.foodId ? linked.get(i.foodId) : undefined;
            const generic = food?.genericFoodId
                ? (linked.get(food.genericFoodId) ??
                  plain.get(food.genericFoodId))
                : undefined;
            return {
                name: i.displayName,
                foodName: food?.name ?? null,
                foodId: i.foodId,
                genericFoodId: food?.genericFoodId ?? null,
                genericFoodName: generic?.name ?? null,
            };
        }),
        vocabulary: await mentionVocabulary(stores.foods, householdId),
        dismissed: importRow.dismissedMentions,
    });
}

/** The longest raw key a caller may hand in. */
const DISMISSAL_KEY_MAX = 120;

/**
 * Stop warning about one food, whatever spelling the key is in. The key is
 * stored the way the detector writes it, so a later check matches it. No
 * import row means nothing to dismiss. A raw key is capped; a key already
 * read off a warning (`stored`) is kept whole, since cutting it would stop
 * it ever matching that warning again.
 */
export async function dismissRecipeMention(
    store: RecipesStore,
    householdId: string,
    recipeId: string,
    key: string,
    opts: { stored?: boolean } = {},
): Promise<void> {
    const normalized = opts.stored
        ? key
        : mentionKey(key.trim()).slice(0, DISMISSAL_KEY_MAX);
    if (!normalized) throw new RecipeInputError("Choose a food to dismiss.");
    await store.addDismissedMention(householdId, recipeId, normalized);
}

/**
 * The warning a key names, or a `RecipeInputError` saying why there is none:
 * the recipe is unknown, was made by hand (nothing checks its steps), or the
 * food was already added or dismissed.
 */
async function flaggedMention(
    stores: { recipes: RecipesStore; foods: FoodsStore },
    householdId: string,
    recipeId: string,
    key: string,
): Promise<{ recipe: Recipe; warning: MentionWarning }> {
    const recipe = await stores.recipes.getRecipe(householdId, recipeId);
    if (!recipe) throw new RecipeInputError("Unknown recipe.");
    const importRow = await stores.recipes.getImport(householdId, recipeId);
    if (!importRow)
        throw new RecipeInputError("This recipe has no step check.");
    const warnings = await recipeMentionWarnings(
        stores,
        householdId,
        recipeId,
        { recipe, importRow },
    );
    const wanted = mentionKey(key.trim());
    const warning = warnings.find((w) => w.key === wanted);
    if (!warning) {
        throw new RecipeInputError(
            "That food is no longer flagged: it was added or dismissed.",
        );
    }
    return { recipe, warning };
}

/**
 * Dismiss a warning that is still showing. A food that is no longer flagged is
 * an error, so a stale button says so instead of doing nothing.
 */
export async function dismissFlaggedMention(
    stores: { recipes: RecipesStore; foods: FoodsStore },
    householdId: string,
    recipeId: string,
    key: string,
): Promise<void> {
    const { warning } = await flaggedMention(
        stores,
        householdId,
        recipeId,
        key,
    );
    await dismissRecipeMention(
        stores.recipes,
        householdId,
        recipeId,
        warning.key,
        { stored: true },
    );
}

/** What a mentioned food is added as when the steps give no amount. */
function fallbackAmount(food: Food): { amount: number; unit: string } {
    if (food.serving) {
        return { amount: food.serving.amount, unit: food.serving.unit };
    }
    return { amount: 1, unit: "each" };
}

export type AddedMention = {
    ingredient: RecipeIngredient;
    foodName: string;
    /** True when no catalog food matched and one was created for it. */
    createdFood: boolean;
};

/**
 * Add the food a warning names as an ingredient: its catalog food when the
 * warning matched one, else the food the importer would resolve or create for
 * that name (an unattended write, so a near match never blocks it). The amount
 * is the steps' own ("2 eggs" is 2 each), else one pack serving, else 1 each.
 */
export async function addMentionedIngredient(
    stores: { recipes: RecipesStore; foods: FoodsStore },
    householdId: string,
    recipeId: string,
    key: string,
): Promise<AddedMention> {
    const { warning } = await flaggedMention(
        stores,
        householdId,
        recipeId,
        key,
    );
    let createdFood = false;
    let food: Food;
    if (warning.foodId) {
        try {
            food = await findFoodById(
                stores.foods,
                householdId,
                warning.foodId,
            );
        } catch (err) {
            // Archived between the warning and this lookup: say so like any
            // other stale button.
            if (!(err instanceof FoodsInputError)) throw err;
            throw new RecipeInputError(
                "That food is no longer in the catalog.",
            );
        }
    } else {
        // The importer's lookup creates through `insertFood`, so a call there
        // is exactly "no catalog food matched".
        const watched: FoodsStore = {
            ...stores.foods,
            insertFood: async (row) => {
                createdFood = true;
                return stores.foods.insertFood(row);
            },
        };
        try {
            food = await findOrCreateManualFoodForRecipeImport(
                watched,
                householdId,
                "food",
                warning.food,
            );
        } catch (err) {
            // Two Adds of one new food at once: the loser is told, not crashed.
            if (err instanceof FoodsInputError) {
                throw new RecipeInputError(err.message);
            }
            throw err;
        }
    }
    const quantity =
        warning.amount != null
            ? { amount: warning.amount, unit: "each" }
            : fallbackAmount(food);
    const ingredient = await addRecipeIngredientById(
        stores.recipes,
        stores.foods,
        {
            householdId,
            recipeId,
            foodId: food.id,
            amount: quantity.amount,
            unit: quantity.unit,
            note: warning.note,
        },
    );
    // The ordinary add re-checks an unverified recipe and leaves a verified
    // one verified; a warning is advice, so this must not do more than that.
    return { ingredient, foodName: food.name, createdFood };
}
