import type { Food } from "./foods.js";
import { effectiveFoodsByIds, type FoodsStore } from "./foods.js";
import type { FridgeStore } from "./fridge.js";
import {
    assertDismissibleCode,
    dismissalKey,
    dismissedKeySet,
    isDismissedIn,
    lookupDismissalKey,
    NoticeDismissError,
    type NoticeDismissal,
    type NoticeDismissalsStore,
} from "./notice-dismissals.js";
import type { Notice } from "./notices.js";
import type { NoticeSubjectKind } from "./notice-dismissals.js";
import { sortNotices } from "./notices.js";
import { listRecipes, recipeNotices, type RecipesStore } from "./recipes.js";
import type { GroceryListStore } from "./grocery.js";
import { fridgeNotices, utcTodayFromDate } from "./stock.js";

export type NoticesForDeps = {
    foods: FoodsStore;
    fridge: FridgeStore;
    recipes: RecipesStore;
    dismissals: NoticeDismissalsStore;
    /** When given, fridge notices learn whether their food is already on the
     *  grocery list, as the fridge page does, so their "Add to grocery list"
     *  action shows the same way. Optional: the count does not depend on it. */
    grocery?: GroceryListStore;
};

export type NoticesForResult = {
    notices: Notice[];
    dismissals: NoticeDismissal[];
    subjectNames: Map<string, string>;
    /** Panel group keys (`recipe:<id>` or `<kind>:<id>`) to activity ms, newest-first ordering. */
    subjectTimes: Map<string, number>;
    noticeFoods: ReadonlyMap<string, Pick<Food, "genericFoodId">>;
};

function subjectNameKey(kind: NoticeSubjectKind, id: string): string {
    return `${kind}:${id}`;
}

/** Panel grouping key; recipe-ingredient notices roll up under their recipe. */
export function panelGroupKey(notice: Notice): string {
    if (notice.subject.kind === "recipe_ingredient") {
        return `recipe:${notice.subject.recipeId}`;
    }
    return `${notice.subject.kind}:${notice.subject.id}`;
}

/** Display name for a notice group from params or related recipe context. */
export function subjectLabel(
    notice: Notice,
    recipeNames: ReadonlyMap<string, string>,
): string {
    if (notice.subject.kind === "recipe_ingredient") {
        const recipeName =
            (typeof notice.params.recipeName === "string" &&
            notice.params.recipeName.length > 0
                ? notice.params.recipeName
                : undefined) ??
            recipeNames.get(notice.subject.recipeId) ??
            "Recipe";
        return recipeName;
    }
    const name = notice.params.name;
    if (typeof name === "string" && name.length > 0) return name;
    if (notice.subject.kind === "recipe") {
        return recipeNames.get(notice.subject.id) ?? "Recipe";
    }
    return "Item";
}

export function dismissalSubjectLabel(
    dismissal: NoticeDismissal,
    subjectNames: ReadonlyMap<string, string>,
): string {
    const key = subjectNameKey(dismissal.subjectKind, dismissal.subjectId);
    return subjectNames.get(key) ?? "Removed item";
}

async function buildSubjectTimes(
    deps: NoticesForDeps,
    householdId: string,
): Promise<Map<string, number>> {
    const subjectTimes = new Map<string, number>();
    const [fridgeTimes, recipeTimes] = await Promise.all([
        deps.fridge.itemActivityMsById?.(householdId) ??
            Promise.resolve(new Map<string, number>()),
        deps.recipes.recipeActivityMsById?.(householdId) ??
            Promise.resolve(new Map<string, number>()),
    ]);
    for (const [id, ms] of fridgeTimes) {
        subjectTimes.set(`fridge_item:${id}`, ms);
    }
    for (const [id, ms] of recipeTimes) {
        subjectTimes.set(`recipe:${id}`, ms);
    }
    // Subjects with no activity timestamp are sorted last (see needs-attention page).
    return subjectTimes;
}

export async function noticesFor(
    deps: NoticesForDeps,
    householdId: string,
    opts?: { today?: string; includeDismissed?: boolean },
): Promise<NoticesForResult> {
    const today = opts?.today ?? utcTodayFromDate(new Date());
    const dismissals = await deps.dismissals.listForHousehold(householdId);
    const dismissed = dismissedKeySet(dismissals);

    const [recipes, fridgeItems, allIngredients, subjectTimes, grocery] =
        await Promise.all([
            listRecipes(deps.recipes, householdId),
            deps.fridge.listItems(householdId),
            deps.recipes.listIngredientsForHousehold(householdId),
            buildSubjectTimes(deps, householdId),
            deps.grocery
                ? Promise.all([
                      deps.grocery.listLines(householdId),
                      deps.foods.listFoods(householdId),
                  ]).then(([lines, foods]) => ({
                      lines,
                      foodsById: new Map(
                          foods.map((row) => [
                              row.id,
                              { id: row.id, genericFoodId: row.genericFoodId },
                          ]),
                      ),
                  }))
                : Promise.resolve(undefined),
        ]);

    const foodIds = new Set<string>();
    for (const ing of allIngredients) {
        if (ing.foodId) foodIds.add(ing.foodId);
    }
    const catalog = await effectiveFoodsByIds(deps.foods, householdId, [
        ...foodIds,
    ]);

    const recipeNames = new Map<string, string>();
    for (const recipe of recipes) {
        recipeNames.set(recipe.id, recipe.name);
    }

    const subjectNames = new Map<string, string>();
    for (const recipe of recipes) {
        subjectNames.set(subjectNameKey("recipe", recipe.id), recipe.name);
        subjectNames.set(`recipe:${recipe.id}`, recipe.name);
    }
    for (const ing of allIngredients) {
        const recipeName = recipeNames.get(ing.recipeId) ?? "Recipe";
        subjectNames.set(
            subjectNameKey("recipe_ingredient", ing.id),
            `${recipeName} — ${ing.displayName}`,
        );
    }
    for (const item of fridgeItems) {
        subjectNames.set(
            subjectNameKey("fridge_item", item.id),
            item.displayName,
        );
    }

    const noticeFoods = new Map<string, Pick<Food, "genericFoodId">>();
    for (const [id, food] of catalog) {
        noticeFoods.set(id, { genericFoodId: food.genericFoodId });
    }

    const ingredientsByRecipe = new Map<string, typeof allIngredients>();
    for (const ing of allIngredients) {
        const list = ingredientsByRecipe.get(ing.recipeId) ?? [];
        list.push(ing);
        ingredientsByRecipe.set(ing.recipeId, list);
    }

    const raw: Notice[] = [];
    for (const recipe of recipes) {
        const ings = ingredientsByRecipe.get(recipe.id) ?? [];
        const recipeNoticesList = recipeNotices(recipe.id, ings, catalog);
        for (const n of recipeNoticesList) {
            raw.push({
                ...n,
                params: { ...n.params, recipeName: recipe.name },
            });
        }
    }
    raw.push(...fridgeNotices(fridgeItems, today, grocery));

    let filtered = raw;
    if (!opts?.includeDismissed) {
        filtered = raw.filter((n) => !isDismissedIn(n, dismissed));
    }

    const notices = sortNotices(filtered);
    for (const notice of notices) {
        const panelKey = panelGroupKey(notice);
        if (panelKey.startsWith("recipe:") && !subjectNames.has(panelKey)) {
            const recipeId = panelKey.slice("recipe:".length);
            subjectNames.set(
                panelKey,
                recipeNames.get(recipeId) ?? subjectLabel(notice, recipeNames),
            );
        }
    }

    return {
        notices,
        dismissals,
        subjectNames,
        subjectTimes,
        noticeFoods,
    };
}

export type DismissNoticeInput = {
    code: Notice["code"];
    subjectKind: NoticeSubjectKind;
    subjectId: string;
    relatedId?: string;
};

export async function dismissNotice(
    deps: NoticesForDeps,
    householdId: string,
    userId: string,
    input: DismissNoticeInput,
): Promise<NoticeDismissal> {
    assertDismissibleCode(input.code);

    const { notices } = await noticesFor(deps, householdId, {
        includeDismissed: true,
    });
    const key = lookupDismissalKey(
        input.code,
        input.subjectKind,
        input.subjectId,
        input.relatedId,
    );
    const match = notices.find((n) => {
        const dk = dismissalKey(n);
        return (
            dk.code === key.code &&
            dk.subjectKind === key.subjectKind &&
            dk.subjectId === key.subjectId &&
            dk.relatedKey === key.relatedKey
        );
    });
    if (!match) {
        throw new NoticeDismissError(
            "That notice is not open for this household.",
        );
    }

    return deps.dismissals.insert({
        householdId,
        code: key.code,
        subjectKind: key.subjectKind,
        subjectId: key.subjectId,
        relatedKey: key.relatedKey,
        dismissedBy: userId,
    });
}

export async function undoDismissal(
    deps: Pick<NoticesForDeps, "dismissals">,
    householdId: string,
    dismissalId: string,
): Promise<void> {
    const rows = await deps.dismissals.listForHousehold(householdId);
    const row = rows.find((r) => r.id === dismissalId);
    if (!row) {
        throw new NoticeDismissError("Dismissal not found.");
    }
    const removed = await deps.dismissals.deleteById(householdId, dismissalId);
    if (!removed) {
        throw new NoticeDismissError("Dismissal not found.");
    }
}
