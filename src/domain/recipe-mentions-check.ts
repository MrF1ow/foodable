import {
    type Food,
    type FoodsStore,
    findFoodById,
    findOrCreateManualFoodForRecipeImport,
} from "./foods.js";
import { recheckRecipe } from "./recipe-import.js";
import { type MentionWarning, findMissingMentions } from "./recipe-mentions.js";
import {
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

export async function recipeMentionWarnings(
    stores: { recipes: RecipesStore; foods: FoodsStore },
    householdId: string,
    recipeId: string,
): Promise<MentionWarning[]> {
    const importRow = await stores.recipes.getImport(householdId, recipeId);
    if (!importRow) return [];
    const recipe = await stores.recipes.getRecipe(householdId, recipeId);
    if (!recipe) return [];
    const ingredients = await stores.recipes.listIngredients(
        householdId,
        recipeId,
    );
    const linked = await stores.foods.getFoodsByIds(
        householdId,
        ingredients.flatMap((i) => (i.foodId ? [i.foodId] : [])),
    );
    return findMissingMentions({
        instructions: recipe.instructions,
        ingredients: ingredients.map((i) => ({
            name: i.displayName,
            foodName: i.foodId ? (linked.get(i.foodId)?.name ?? null) : null,
            foodId: i.foodId,
        })),
        vocabulary: await mentionVocabulary(stores.foods, householdId),
        dismissed: importRow.dismissedMentions,
    });
}

/** Stop warning about one food. No import row means nothing to dismiss. */
export async function dismissRecipeMention(
    store: RecipesStore,
    householdId: string,
    recipeId: string,
    key: string,
): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) throw new RecipeInputError("Choose a food to dismiss.");
    const importRow = await store.getImport(householdId, recipeId);
    if (!importRow) return;
    if (importRow.dismissedMentions.includes(trimmed)) return;
    await store.upsertImport({
        ...importRow,
        dismissedMentions: [...importRow.dismissedMentions, trimmed],
    });
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
    const warnings = await recipeMentionWarnings(stores, householdId, recipeId);
    const warning = warnings.find((w) => w.key === key.trim());
    if (!warning) {
        throw new RecipeInputError(
            "That food is no longer flagged: it was added or dismissed.",
        );
    }
    let createdFood = false;
    let food: Food;
    if (warning.foodId) {
        food = await findFoodById(stores.foods, householdId, warning.foodId);
    } else {
        const known = new Set(
            (await stores.foods.listFoods(householdId)).map((f) => f.id),
        );
        food = await findOrCreateManualFoodForRecipeImport(
            stores.foods,
            householdId,
            "food",
            warning.food,
        );
        createdFood = !known.has(food.id);
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
    await recheckRecipe(stores.recipes, householdId, recipeId);
    return { ingredient, foodName: food.name, createdFood };
}
