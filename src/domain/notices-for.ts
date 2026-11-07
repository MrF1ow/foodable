import { effectiveFoodsByIds, type FoodsStore } from "./foods.js";
import type { FridgeStore } from "./fridge.js";
import {
    assertDismissibleCode,
    dismissalKey,
    isDismissed,
    lookupDismissalKey,
    NoticeDismissError,
    type NoticeDismissal,
    type NoticeDismissalsStore,
} from "./notice-dismissals.js";
import type { Notice } from "./notices.js";
import type { NoticeSubjectKind } from "./notice-dismissals.js";
import { sortNotices } from "./notices.js";
import { listRecipes, recipeNotices, type RecipesStore } from "./recipes.js";
import { fridgeNotices, utcTodayFromDate } from "./stock.js";

export type NoticesForDeps = {
    foods: FoodsStore;
    fridge: FridgeStore;
    recipes: RecipesStore;
    dismissals: NoticeDismissalsStore;
};

export type NoticesForResult = {
    notices: Notice[];
    dismissals: NoticeDismissal[];
    subjectNames: Map<string, string>;
};

function subjectGroupKey(kind: NoticeSubjectKind, id: string): string {
    return `${kind}:${id}`;
}

/** Display name for a notice group from params or related recipe context. */
export function subjectLabel(
    notice: Notice,
    recipeNames: ReadonlyMap<string, string>,
): string {
    const name = notice.params.name;
    if (typeof name === "string" && name.length > 0) return name;
    if (notice.subject.kind === "recipe") {
        return recipeNames.get(notice.subject.id) ?? "Recipe";
    }
    return "Item";
}

export async function noticesFor(
    deps: NoticesForDeps,
    householdId: string,
    opts?: { today?: string; includeDismissed?: boolean },
): Promise<NoticesForResult> {
    const today = opts?.today ?? utcTodayFromDate(new Date());
    const dismissals = await deps.dismissals.listForHousehold(householdId);

    const [recipes, fridgeItems, allIngredients] = await Promise.all([
        listRecipes(deps.recipes, householdId),
        deps.fridge.listItems(householdId),
        deps.recipes.listIngredientsForHousehold(householdId),
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
    raw.push(...fridgeNotices(fridgeItems, today));

    let filtered = raw;
    if (!opts?.includeDismissed) {
        filtered = raw.filter((n) => !isDismissed(n, dismissals));
    }

    const notices = sortNotices(filtered);
    const subjectNames = new Map<string, string>();
    for (const notice of notices) {
        const key = subjectGroupKey(notice.subject.kind, notice.subject.id);
        if (!subjectNames.has(key)) {
            subjectNames.set(key, subjectLabel(notice, recipeNames));
        }
    }

    return { notices, dismissals, subjectNames };
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
