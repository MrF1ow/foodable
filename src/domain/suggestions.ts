/**
 * What to cook for an empty meal slot, and which recipe uses each expiring
 * item. Pure and serialisable: callers pass data the page already loaded
 * (recipes with their ingredients and per-portion macros, the stock, the
 * expiring items) and get plain objects back, so the same functions feed the
 * household app and a chat widget.
 */

import type { FridgeItem } from "./fridge.js";
import { familyIdOf } from "./food-quantity.js";
import { sameFood, type LinkedNeed } from "./linking.js";
import {
    macrosForPerson,
    recipeCanMakeNow,
    type RecipeFilterRow,
    type RecipeMacros,
} from "./recipes.js";
import type { MealTypeSlot } from "./today.js";
import type { Food } from "./foods.js";
import type { RecipesListPrefetch } from "./notices-for.js";

/** At most this many suggestions for one empty slot. */
export const MAX_SLOT_SUGGESTIONS = 2;

/** A recipe with its ingredients and the macros of one portion. */
export type SuggestionRecipe = RecipeFilterRow;

/** The part of a fridge item the suggestions read. */
export type ExpiringItem = Pick<
    FridgeItem,
    "id" | "displayName" | "foodId" | "expiresOn"
>;

/**
 * What is left of today's targets. Only calories is a cap; protein, carbs and
 * fat are targets to reach, so they rank recipes and never exclude one. A null
 * or missing figure is "no target on that nutrient". Pass `null` for the whole
 * object when there is no goal at all: nothing can be fitted, so nothing is
 * suggested.
 */
export type MacrosLeft = {
    calories: number | null;
    protein_g?: number | null;
    carbs_g?: number | null;
    fat_g?: number | null;
};

export type SuggestedMacros = Pick<
    RecipeMacros,
    "calories" | "protein_g" | "carbs_g" | "fat_g"
>;

export type SlotSuggestion = {
    recipeId: string;
    name: string;
    macrosPerPortion: SuggestedMacros;
    /** Expiring items this recipe uses, soonest expiry first. */
    usesExpiring: { id: string; displayName: string; expiresOn: string }[];
};

export type SuggestForSlotInput = {
    slot: MealTypeSlot;
    recipes: readonly SuggestionRecipe[];
    stock: LinkedNeed[];
    macrosLeft: MacrosLeft | null;
    expiring: readonly ExpiringItem[];
    foodsById?: ReadonlyMap<string, Food>;
};

export type ExpiringRecipe = {
    recipeId: string;
    name: string;
    /** Macros of one portion are not fully known. */
    incomplete: boolean;
};

export type ExpiringUse = {
    item: { id: string; displayName: string; expiresOn: string };
    /** Cookable recipes that use the item, best first (the "Use in:" line). */
    recipes: ExpiringRecipe[];
};

type DatedItem = ExpiringItem & { expiresOn: string };

/** Expiring items with a date, soonest first, ties by name then id. */
function datedItems(expiring: readonly ExpiringItem[]): DatedItem[] {
    return expiring
        .filter((item): item is DatedItem => Boolean(item.expiresOn))
        .sort(
            (a, b) =>
                a.expiresOn.localeCompare(b.expiresOn) ||
                a.displayName.localeCompare(b.displayName) ||
                a.id.localeCompare(b.id),
        );
}

/** The expiring items a recipe uses (ingredient and item are the same food). */
function usedItems(
    row: SuggestionRecipe,
    items: readonly DatedItem[],
    foodsById: ReadonlyMap<string, Food>,
): DatedItem[] {
    return items.filter((item) =>
        row.ingredients.some((ingredient) =>
            sameFood(
                { quantity: ingredient.quantity, foodId: ingredient.foodId },
                { quantity: null, foodId: item.foodId },
                foodsById,
            ),
        ),
    );
}

/**
 * The first item of each food family in `items`, which must already be sorted
 * soonest first, so two packs of the same food count once, at the date that
 * goes off first.
 */
function onePerFood(
    items: readonly DatedItem[],
    foodsById: ReadonlyMap<string, Food>,
): DatedItem[] {
    const seen = new Set<string>();
    return items.filter((item) => {
        const key = item.foodId
            ? `food:${familyIdOf(item.foodId, foodsById)}`
            : `item:${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * One portion fits when its calories are known and do not exceed the calories
 * left (equal fits); no calorie target means any complete recipe fits. Protein,
 * carbs and fat are targets to reach, not caps, so they never rule a recipe
 * out, but all four must be known: unknown means "cannot tell", never zero, so
 * a recipe with incomplete macros never fits.
 */
export function portionFitsMacros(
    macros: RecipeMacros,
    left: MacrosLeft | null,
): boolean {
    if (left == null || macros.incomplete) return false;
    if (
        macros.calories == null ||
        macros.protein_g == null ||
        macros.carbs_g == null ||
        macros.fat_g == null
    ) {
        return false;
    }
    return left.calories == null || macros.calories <= left.calories;
}

function pickMacros(macros: RecipeMacros): SuggestedMacros {
    return {
        calories: macros.calories,
        protein_g: macros.protein_g,
        carbs_g: macros.carbs_g,
        fat_g: macros.fat_g,
    };
}

function hasSlotTag(row: SuggestionRecipe, slot: MealTypeSlot): boolean {
    return row.recipe.tags.some((tag) => tag.trim().toLowerCase() === slot);
}

/** Calories left unused after one portion; 0 when there is no calorie limit. */
function calorieSlack(row: SuggestionRecipe, left: MacrosLeft): number {
    if (left.calories == null || row.macrosPerPortion.calories == null) {
        return 0;
    }
    return left.calories - row.macrosPerPortion.calories;
}

/** How much of the protein still to go one portion covers. */
function proteinCovered(row: SuggestionRecipe, left: MacrosLeft): number {
    const protein = row.macrosPerPortion.protein_g;
    if (protein == null || left.protein_g == null) return 0;
    return Math.min(protein, Math.max(left.protein_g, 0));
}

/** Grams of carbs and fat one portion adds beyond what is left of them. */
function carbFatOvershoot(row: SuggestionRecipe, left: MacrosLeft): number {
    let over = 0;
    for (const key of ["carbs_g", "fat_g"] as const) {
        const limit = left[key];
        const value = row.macrosPerPortion[key];
        if (limit == null || value == null) continue;
        over += Math.max(0, value - Math.max(limit, 0));
    }
    return over;
}

/**
 * Up to {@link MAX_SLOT_SUGGESTIONS} recipes for an empty slot: cookable from
 * stock, complete macros, one portion fits what is left today.
 *
 * Order: recipes that use an expiring item first (the one expiring soonest,
 * then the one using more expiring items), then recipes tagged with the slot's
 * name (`breakfast`, `lunch`, ...; a recipe's tags are free text, so this is
 * only a tiebreak, never a filter), then the one covering more of the protein
 * still to go, then the one overshooting carbs and fat less, then the closest
 * calorie fit (fewest calories left unused), then name and id so the result is
 * deterministic. Only calories can exclude a recipe.
 */
export function suggestForSlot(input: SuggestForSlotInput): SlotSuggestion[] {
    const { slot, recipes, stock, macrosLeft, expiring } = input;
    if (macrosLeft == null) return [];
    const foodsById = input.foodsById ?? new Map<string, Food>();
    const items = datedItems(expiring);

    const candidates = recipes
        .filter((row) =>
            recipeCanMakeNow(row.recipe, row.ingredients, stock, foodsById),
        )
        .filter((row) => portionFitsMacros(row.macrosPerPortion, macrosLeft))
        .map((row) => ({
            row,
            used: onePerFood(usedItems(row, items, foodsById), foodsById),
            slotTagged: hasSlotTag(row, slot),
            protein: proteinCovered(row, macrosLeft),
            overshoot: carbFatOvershoot(row, macrosLeft),
            slack: calorieSlack(row, macrosLeft),
        }));

    candidates.sort((a, b) => {
        const aUses = a.used.length > 0;
        const bUses = b.used.length > 0;
        if (aUses !== bUses) return aUses ? -1 : 1;
        if (aUses && bUses) {
            const bySoonest = a.used[0]!.expiresOn.localeCompare(
                b.used[0]!.expiresOn,
            );
            if (bySoonest !== 0) return bySoonest;
            if (a.used.length !== b.used.length) {
                return b.used.length - a.used.length;
            }
        }
        if (a.slotTagged !== b.slotTagged) return a.slotTagged ? -1 : 1;
        if (a.protein !== b.protein) return b.protein - a.protein;
        if (a.overshoot !== b.overshoot) return a.overshoot - b.overshoot;
        if (a.slack !== b.slack) return a.slack - b.slack;
        return (
            a.row.recipe.name.localeCompare(b.row.recipe.name) ||
            a.row.recipe.id.localeCompare(b.row.recipe.id)
        );
    });

    return candidates.slice(0, MAX_SLOT_SUGGESTIONS).map((c) => ({
        recipeId: c.row.recipe.id,
        name: c.row.recipe.name,
        macrosPerPortion: pickMacros(c.row.macrosPerPortion),
        usesExpiring: c.used.map((item) => ({
            id: item.id,
            displayName: item.displayName,
            expiresOn: item.expiresOn,
        })),
    }));
}

/**
 * For each expiring item (soonest first), the cookable recipes that use it.
 * Recipes with incomplete macros are allowed here: the line only names a
 * recipe, it does not claim a fit. Within an item, recipes with fully known
 * macros come first, then those using more expiring items, then name and id;
 * `recipes[0]` is the one for the "Use in: ..." line. Items no cookable recipe
 * uses are returned with an empty list so callers can align rows with items.
 */
export function recipesUsingExpiring(
    recipes: readonly SuggestionRecipe[],
    stock: LinkedNeed[],
    expiring: readonly ExpiringItem[],
    foodsById: ReadonlyMap<string, Food> = new Map(),
): ExpiringUse[] {
    const items = datedItems(expiring);
    const cookable = recipes
        .filter((row) =>
            recipeCanMakeNow(row.recipe, row.ingredients, stock, foodsById),
        )
        .map((row) => {
            const used = usedItems(row, items, foodsById);
            return {
                row,
                usedIds: new Set(used.map((item) => item.id)),
                usedCount: onePerFood(used, foodsById).length,
            };
        });

    return items.map((item) => {
        const matching = cookable
            .filter((c) => c.usedIds.has(item.id))
            .sort((a, b) => {
                const aDone = !a.row.macrosPerPortion.incomplete;
                const bDone = !b.row.macrosPerPortion.incomplete;
                if (aDone !== bDone) return aDone ? -1 : 1;
                if (a.usedCount !== b.usedCount) {
                    return b.usedCount - a.usedCount;
                }
                return (
                    a.row.recipe.name.localeCompare(b.row.recipe.name) ||
                    a.row.recipe.id.localeCompare(b.row.recipe.id)
                );
            });
        return {
            item: {
                id: item.id,
                displayName: item.displayName,
                expiresOn: item.expiresOn,
            },
            recipes: matching.map((c) => ({
                recipeId: c.row.recipe.id,
                name: c.row.recipe.name,
                incomplete: c.row.macrosPerPortion.incomplete,
            })),
        };
    });
}

/** Recipes as the Recipes page reads them, from data already loaded. */
export function recipeRowsFromPrefetch(
    prefetch: RecipesListPrefetch,
): SuggestionRecipe[] {
    const byRecipe = new Map<string, RecipesListPrefetch["allIngredients"]>();
    for (const row of prefetch.allIngredients) {
        const list = byRecipe.get(row.recipeId) ?? [];
        list.push(row);
        byRecipe.set(row.recipeId, list);
    }
    return prefetch.recipes.map((recipe) => {
        const ingredients = byRecipe.get(recipe.id) ?? [];
        return {
            recipe,
            ingredients,
            macrosPerPortion: macrosForPerson(
                ingredients,
                recipe.yieldPortions,
                1,
                prefetch.foodsById,
            ),
        };
    });
}

/**
 * The recipes that use each expiring item, plus the one cookable recipe that
 * uses the most of them (two or more; a recipe using a single item is already
 * that item's "Use in" line). Ties keep the first recipe in item order.
 */
export function useSoonFromPrefetch(
    prefetch: RecipesListPrefetch,
    expiring: readonly ExpiringItem[],
): {
    uses: ExpiringUse[];
    best: { row: SuggestionRecipe; itemCount: number } | null;
} {
    if (expiring.length === 0) return { uses: [], best: null };
    const rows = recipeRowsFromPrefetch(prefetch);
    const uses = recipesUsingExpiring(
        rows,
        prefetch.fridgeItems.map((item) => ({
            quantity: item.quantity,
            foodId: item.foodId,
        })),
        expiring,
        prefetch.foodsById,
    );
    const counts = new Map<string, number>();
    for (const use of uses) {
        for (const recipe of use.recipes) {
            counts.set(recipe.recipeId, (counts.get(recipe.recipeId) ?? 0) + 1);
        }
    }
    let best: { recipeId: string; count: number } | null = null;
    for (const use of uses) {
        for (const recipe of use.recipes) {
            const count = counts.get(recipe.recipeId) ?? 0;
            if (count >= 2 && (best == null || count > best.count)) {
                best = { recipeId: recipe.recipeId, count };
            }
        }
    }
    const row = best && rows.find((r) => r.recipe.id === best.recipeId);
    return {
        uses,
        best: best && row ? { row, itemCount: best.count } : null,
    };
}
