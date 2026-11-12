// What a share link points at, loaded for a visitor. Pure over the stores it
// is handed (memory stores in unit tests, live ones in the route), so the one
// rule that matters is testable: the object is read scoped to the link's own
// household, never by id alone.

import { listGrocery, type GroceryListStore } from "../../domain/grocery.js";
import type { FoodsStore } from "../../domain/foods.js";
import type { RecipesStore } from "../../domain/recipes.js";
import type { SettingsStore } from "../../domain/settings.js";
import {
    recipeShareDocument,
    type ShareDocument,
} from "../../domain/sharing-document.js";
import {
    shareView,
    type ShareableGroceryList,
    type ShareLink,
    type ShareView,
} from "../../domain/sharing.js";

export type ShareLoadStores = {
    recipes: RecipesStore;
    grocery: GroceryListStore;
    settings: SettingsStore;
};

type OrderableList = {
    stores: readonly { id: string; sortOrder?: number }[];
    sections: readonly { id: string; storeId: string }[];
    lines: readonly { storeId: string; sectionId: string }[];
};

/**
 * Lines in the order the Groceries page shows them: store by store, section
 * by section within a store (the order the sections arrive in), a line keeping
 * its place within its section. A line in a section its store no longer has
 * follows that store's known sections; a line whose store is gone goes last
 * (the share view files it under "Other").
 */
export function orderGroceryLines<L extends OrderableList["lines"][number]>(
    list: Omit<OrderableList, "lines"> & { lines: readonly L[] },
): L[] {
    const out: L[] = [];
    const placed = new Set<L>();
    for (const store of list.stores) {
        const inStore = list.lines.filter((l) => l.storeId === store.id);
        for (const section of list.sections.filter(
            (s) => s.storeId === store.id,
        )) {
            for (const line of inStore) {
                if (line.sectionId === section.id) {
                    out.push(line);
                    placed.add(line);
                }
            }
        }
        for (const line of inStore) {
            if (!placed.has(line)) {
                out.push(line);
                placed.add(line);
            }
        }
    }
    for (const line of list.lines) {
        if (!placed.has(line)) out.push(line);
    }
    return out;
}

/**
 * The view a visitor gets for a live link, or null when the object cannot be
 * loaded (the recipe was deleted, or `targetId` names nothing in the link's
 * household): the route answers that exactly like an unknown token.
 */
export async function loadShareView(
    link: ShareLink,
    stores: ShareLoadStores,
): Promise<ShareView | null> {
    if (link.kind === "recipe") {
        if (link.targetId === null) return null;
        const recipe = await stores.recipes.getRecipe(
            link.householdId,
            link.targetId,
        );
        if (!recipe) return null;
        const ingredients = await stores.recipes.listIngredients(
            link.householdId,
            recipe.id,
        );
        return shareView("recipe", { ...recipe, ingredients });
    }
    const snapshot = await listGrocery(
        stores.grocery,
        stores.settings,
        link.householdId,
    );
    const list: ShareableGroceryList = {
        stores: snapshot.stores,
        lines: orderGroceryLines(snapshot),
    };
    return shareView("grocery_list", list);
}

export type ShareDocumentStores = {
    recipes: RecipesStore;
    foods: FoodsStore;
};

/**
 * The portable document for a recipe link, or null when there is none: a
 * grocery-list link (only recipes travel), a recipe that cannot be loaded, or
 * one outside the document's bounds. The route answers all of those with the
 * one 404. The recipe, its ingredients and the foods they point at are all
 * read scoped to `link.householdId`, so an ingredient whose `food_id` names
 * another household's food ships as an unknown food, never that food.
 */
export async function loadShareDocument(
    link: ShareLink,
    stores: ShareDocumentStores,
): Promise<ShareDocument | null> {
    if (link.kind !== "recipe" || link.targetId === null) return null;
    const recipe = await stores.recipes.getRecipe(
        link.householdId,
        link.targetId,
    );
    if (!recipe) return null;
    const ingredients = await stores.recipes.listIngredients(
        link.householdId,
        recipe.id,
    );
    const foodIds = ingredients.flatMap((i) => (i.foodId ? [i.foodId] : []));
    const foods =
        foodIds.length === 0
            ? new Map()
            : await stores.foods.getFoodsByIds(link.householdId, foodIds);
    return recipeShareDocument({ ...recipe, ingredients }, foods);
}
