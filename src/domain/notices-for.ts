import type { EffectiveFood, Food, PossibleDuplicatePair } from "./foods.js";
import {
    duplicatesNeedRefCounts,
    foodDisplayName,
    effectiveFoodsByIds,
    effectiveFoodsFromListed,
    possibleDuplicates,
    type FoodsStore,
} from "./foods.js";
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
import { NOTICE_SEVERITY, sortNotices } from "./notices.js";
import {
    listRecipes,
    recipeNotices,
    type Recipe,
    type RecipeIngredient,
    type RecipesStore,
} from "./recipes.js";
import type { FridgeItem } from "./fridge.js";
import type {
    GroceryAllergenMember,
    GroceryLine,
    GroceryListStore,
} from "./grocery.js";
import { allergenConditionNotices } from "./notices-allergens.js";
import {
    PLAN_NOTICE_DAYS,
    planMissingNotices,
    runningLowNotices,
    weighInDueNotices,
    type WeighInStore,
} from "./notices-actionable.js";
import type { PlansStore, RecipePlan } from "./plan.js";
import {
    addPlanDays,
    loadPlanVersionSources,
    planRecipesOf,
    WEEK_PLAN_DAYS,
} from "./plan-week.js";
import {
    sameMember,
    variantFor,
    type RecipeVariantsStore,
} from "./recipe-variants.js";
import { groceryRestockNotices } from "./restock.js";
import { fridgeNotices } from "./stock.js";

export type NoticesForDeps = {
    foods: FoodsStore;
    fridge: FridgeStore;
    recipes: RecipesStore;
    dismissals: NoticeDismissalsStore;
    /** When given, fridge notices learn whether their food is already on the
     *  grocery list, as the fridge page does, so their "Add to grocery list"
     *  action shows the same way. Optional: the count does not depend on it. */
    grocery?: GroceryListStore;
    /** Planned recipes, for the missing-for-plan notice. Without it none is produced. */
    plans?: PlansStore;
    /** Members' versions of the planned recipes. With it a plan that names
     *  people is totalled from their versions, as the week plan does; without
     *  it every plan counts at the base. */
    variants?: RecipeVariantsStore;
    /** Latest weigh-ins, for the weigh-in notice. Without it none is produced. */
    weighIns?: WeighInStore;
    /** Every member with their allergens, for the allergen conditions. Without
     *  it none is produced. */
    allergenMembers?: (householdId: string) => Promise<GroceryAllergenMember[]>;
};

export type RecipesListPrefetch = {
    recipes: Recipe[];
    allIngredients: RecipeIngredient[];
    fridgeItems: FridgeItem[];
    foodsById: ReadonlyMap<string, EffectiveFood>;
};

export type NoticesForResult = {
    notices: Notice[];
    dismissals: NoticeDismissal[];
    subjectNames: Map<string, string>;
    /** Panel group keys (`recipe:<id>` or `<kind>:<id>`) to activity ms, newest-first ordering. */
    subjectTimes: Map<string, number>;
    noticeFoods: ReadonlyMap<string, Pick<Food, "genericFoodId">>;
    catalogFoods: Food[];
    aliasMap: ReadonlyMap<string, string[]>;
    barcodedIds: ReadonlySet<string>;
    possibleDuplicatePairs: PossibleDuplicatePair[];
    recipesListPrefetch: RecipesListPrefetch;
};

function subjectNameKey(kind: NoticeSubjectKind, id: string): string {
    return `${kind}:${id}`;
}

export function possibleDuplicateNoticesByFoodId(
    notices: readonly Notice[],
): Map<string, Notice[]> {
    const map = new Map<string, Notice[]>();
    for (const notice of notices) {
        if (notice.code !== "food.possible_duplicate") continue;
        if (notice.subject.kind !== "food") continue;
        const rel = notice.related.find((r) => r.kind === "food");
        if (!rel) continue;
        for (const id of [notice.subject.id, rel.id]) {
            const list = map.get(id) ?? [];
            list.push(notice);
            map.set(id, list);
        }
    }
    return map;
}

export function possibleDuplicateNotices(
    foods: readonly Food[],
    aliases: ReadonlyMap<string, string[]>,
    barcodedIds: ReadonlySet<string>,
    dismissed: ReadonlySet<string>,
    refCounts: ReadonlyMap<string, number> = new Map(),
): Notice[] {
    const pairs = possibleDuplicates(
        foods,
        aliases,
        barcodedIds,
        dismissed,
        refCounts,
    );
    return pairs.map(({ subject, related, rule }) => ({
        code: "food.possible_duplicate",
        severity: NOTICE_SEVERITY["food.possible_duplicate"],
        subject: { kind: "food", id: subject.id },
        related: [
            { kind: "food", id: related.id, name: foodDisplayName(related) },
        ],
        params: { rule, name: foodDisplayName(subject), foodId: subject.id },
    }));
}

/** Panel grouping key; recipe-ingredient notices roll up under their recipe. */
export function panelGroupKey(notice: Notice): string {
    if (notice.subject.kind === "recipe_ingredient") {
        return `recipe:${notice.subject.recipeId}`;
    }
    return `${notice.subject.kind}:${notice.subject.id}`;
}

/**
 * One allergen notice per recipe, whoever it names: a recipe notice for a
 * person's own version joins the one already found for the same recipe (their
 * names, allergens and the earliest planned day), or is added.
 */
function mergeRecipeAllergenNotice(found: Notice[], notice: Notice): void {
    const same = found.find(
        (other) =>
            other.code === notice.code &&
            other.subject.kind === notice.subject.kind &&
            other.subject.id === notice.subject.id,
    );
    if (!same || notice.subject.kind !== "recipe") {
        found.push(notice);
        return;
    }
    const related = new Map(
        [...same.related, ...notice.related].map((row) => [
            `${row.kind}:${row.id}`,
            row,
        ]),
    );
    const labels = new Set([
        ...((same.params.allergens as string[]) ?? []),
        ...((notice.params.allergens as string[]) ?? []),
    ]);
    const days = [same.params.plannedOn, notice.params.plannedOn].filter(
        (day): day is string => typeof day === "string",
    );
    same.related = [...related.values()];
    same.params = {
        ...same.params,
        allergens: [...labels],
        ...(days.length > 0 ? { plannedOn: days.sort()[0] } : {}),
    };
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
    if (dismissal.code === "food.possible_duplicate" && dismissal.relatedKey) {
        const sub =
            subjectNames.get(
                subjectNameKey(dismissal.subjectKind, dismissal.subjectId),
            ) ?? "Removed item";
        const rel =
            subjectNames.get(subjectNameKey("food", dismissal.relatedKey)) ??
            "Removed item";
        return `${sub} · ${rel}`;
    }
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
    opts: {
        today: string;
        includeDismissed?: boolean;
        /** When set (e.g. Possible duplicates page), used for job exclusion and not fetched again. */
        refCounts?: ReadonlyMap<string, number>;
        /**
         * Also produce the notices that come with a one-tap action: running
         * low, missing for the plan, weigh-in due. Off by default so only the
         * surfaces that can act on them (the new app, the MCP tools for its
         * callers) ever see them.
         */
        actionable?: boolean;
        /** The household's time zone, for counting days since a weigh-in. Default UTC. */
        timezone?: string;
        /**
         * Also produce the allergen conditions: an open grocery line, a recipe
         * planned in the next seven days or a fridge item that a member's
         * allergen conflicts with. Off by default: the pages and tools show
         * those warnings where they are made (the grocery list, the recipe, the
         * product check), so only the stored notifications ask for them. They
         * are built from what the read already loaded; what it adds is the
         * members' allergens and, only when someone has one, the plan window.
         */
        allergens?: boolean;
    },
): Promise<NoticesForResult> {
    const today = opts.today;
    const dismissals = await deps.dismissals.listForHousehold(householdId);
    const dismissed = dismissedKeySet(dismissals);

    const [
        recipes,
        fridgeItems,
        allIngredients,
        subjectTimes,
        grocery,
        catalogFoods,
        aliasMap,
        barcodedIds,
        allergenMembers,
    ] = await Promise.all([
        listRecipes(deps.recipes, householdId),
        deps.fridge.listItems(householdId),
        deps.recipes.listIngredientsForHousehold(householdId),
        buildSubjectTimes(deps, householdId),
        deps.grocery
            ? deps.grocery.listLines(householdId).then((lines) => ({ lines }))
            : Promise.resolve(undefined),
        deps.foods.listFoods(householdId),
        deps.foods.listAllAliases(householdId),
        deps.foods.listBarcodedFoodIds(householdId),
        opts.allergens && deps.allergenMembers
            ? deps.allergenMembers(householdId)
            : Promise.resolve([] as GroceryAllergenMember[]),
    ]);
    const groceryWithFoods = grocery
        ? {
              ...grocery,
              foodsById: new Map(
                  catalogFoods.map((row) => [
                      row.id,
                      { id: row.id, genericFoodId: row.genericFoodId },
                  ]),
              ),
          }
        : undefined;

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
    for (const food of catalogFoods) {
        if (food.archivedAt) continue;
        subjectNames.set(
            subjectNameKey("food", food.id),
            foodDisplayName(food),
        );
    }
    if (grocery) {
        for (const line of grocery.lines) {
            subjectNames.set(
                subjectNameKey("grocery_line", line.id),
                line.displayName,
            );
            subjectNames.set(`grocery_line:${line.id}`, line.displayName);
        }
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
    raw.push(...fridgeNotices(fridgeItems, today, groceryWithFoods));
    const dismissedForDuplicates = opts?.includeDismissed
        ? new Set<string>()
        : dismissed;
    let refCounts = opts?.refCounts;
    if (refCounts == null && duplicatesNeedRefCounts(catalogFoods)) {
        refCounts = await deps.foods.countFoodRefs(householdId);
    }
    const refCountsForPossible = refCounts ?? new Map();
    const duplicateNotices = possibleDuplicateNotices(
        catalogFoods,
        aliasMap,
        barcodedIds,
        dismissedForDuplicates,
        refCountsForPossible,
    );
    const possibleDuplicatePairs = possibleDuplicates(
        catalogFoods,
        aliasMap,
        barcodedIds,
        dismissed,
        refCountsForPossible,
    );
    raw.push(...duplicateNotices);
    for (const notice of duplicateNotices) {
        if (notice.subject.kind === "food") {
            const name = notice.params.name;
            if (typeof name === "string" && name.length > 0) {
                subjectNames.set(
                    subjectNameKey("food", notice.subject.id),
                    name,
                );
            }
        }
    }
    if (grocery) {
        raw.push(...groceryRestockNotices(grocery.lines, fridgeItems, today));
    }
    // The plan window both the one-tap notices and the allergen conditions
    // need, read once: the longer of the two, and only as far as someone needs
    // it (no one with an allergen on file means no allergen read at all).
    const allergic = allergenMembers.some(
        (member) => member.allergens.length > 0,
    );
    const noticeLastDay = addPlanDays(today, PLAN_NOTICE_DAYS - 1);
    const noticePlanDays =
        opts.actionable && grocery && deps.plans ? PLAN_NOTICE_DAYS : 0;
    const planDays = Math.max(noticePlanDays, allergic ? WEEK_PLAN_DAYS : 0);
    const plans =
        deps.plans && planDays > 0
            ? await deps.plans.listPlans(
                  householdId,
                  today,
                  addPlanDays(today, planDays - 1),
              )
            : undefined;
    // One effective-food map for the catalog, shared by what reads it.
    let listedFoodsById: Map<string, EffectiveFood> | undefined;
    const listedFoods = () =>
        (listedFoodsById ??= effectiveFoodsFromListed(catalogFoods));

    if (opts.actionable) {
        const actionable = await actionableNotices(deps, householdId, {
            today,
            timezone: opts.timezone ?? "UTC",
            listedFoods,
            fridgeItems,
            lines: grocery?.lines,
            plans: plans?.filter((plan) => plan.date <= noticeLastDay),
            recipes,
            allIngredients,
        });
        raw.push(...actionable.notices);
        for (const [key, name] of actionable.subjectNames) {
            subjectNames.set(key, name);
        }
    }

    // What a person's own version of a planned recipe is made from, for the
    // plans that name people; undefined when no plan does.
    const allergenVersions = async () => {
        if (!deps.variants || !plans) return undefined;
        const sources = await loadPlanVersionSources(
            { recipes: deps.recipes, variants: deps.variants },
            householdId,
            plans,
            allIngredients,
        );
        return sources
            ? {
                  ingredients: sources.ingredients,
                  overrides: sources.overrides,
              }
            : undefined;
    };

    if (allergic) {
        // From what this read already holds: the list, the plans just read,
        // the recipes and their ingredients, the fridge and the catalog. Only
        // a food the catalog does not list (an archived one a line, an
        // ingredient or an item still names) is read again.
        const foodsById = new Map(listedFoods());
        for (const [id, food] of catalog) {
            if (!foodsById.has(id)) foodsById.set(id, food);
        }
        const unlisted = new Set<string>();
        for (const id of [
            ...(grocery?.lines ?? []).map((line) => line.foodId),
            ...fridgeItems.map((item) => item.foodId),
        ]) {
            if (id && !foodsById.has(id)) unlisted.add(id);
        }
        if (unlisted.size > 0) {
            for (const [id, food] of await effectiveFoodsByIds(
                deps.foods,
                householdId,
                unlisted,
            )) {
                foodsById.set(id, food);
            }
        }
        const versions = await allergenVersions();
        const allergenInput = {
            today,
            members: allergenMembers,
            lines: grocery?.lines ?? [],
            plans: plans ?? [],
            recipes,
            ingredients: allIngredients,
            fridgeItems,
            foodsById,
        };
        // A plan that names people is checked for each of them against their
        // own version of the recipe, as `get_recipe` shows it; a plan that
        // names nobody checks the base for everyone.
        const isNamed = (plan: { memberIds?: readonly string[] }) =>
            versions != null && (plan.memberIds?.length ?? 0) > 0;
        const found = allergenConditionNotices({
            ...allergenInput,
            plans: allergenInput.plans.filter((plan) => !isNamed(plan)),
        });
        for (const plan of allergenInput.plans.filter(isNamed)) {
            for (const userId of plan.memberIds ?? []) {
                const person = allergenMembers.find(
                    (member) =>
                        member.userId != null &&
                        sameMember(member.userId, userId),
                );
                const recipe = recipes.find((row) => row.id === plan.recipeId);
                if (!person || !recipe || !versions) continue;
                const mine = variantFor(
                    {
                        id: recipe.id,
                        ingredients: versions.ingredients.filter(
                            (row) => row.recipeId === recipe.id,
                        ),
                    },
                    versions.overrides,
                    userId,
                );
                for (const notice of allergenConditionNotices({
                    today,
                    members: [person],
                    lines: [],
                    fridgeItems: [],
                    plans: [{ recipeId: recipe.id, date: plan.date }],
                    recipes: [recipe],
                    ingredients: mine.ingredients.map((row) => ({
                        recipeId: recipe.id,
                        displayName: row.displayName,
                        foodId: row.foodId,
                    })),
                    foodsById,
                })) {
                    mergeRecipeAllergenNotice(found, notice);
                }
            }
        }
        raw.push(...found);
    }

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
        catalogFoods,
        aliasMap,
        barcodedIds,
        possibleDuplicatePairs,
        recipesListPrefetch: {
            recipes,
            allIngredients,
            fridgeItems,
            foodsById: catalog,
        },
    };
}

/**
 * The producers of `notices-actionable`, fed from what `noticesFor` already
 * loaded. Running low and missing-for-plan need the grocery list to know what
 * is already on it, so they are skipped without one; weigh-in needs its store.
 */
async function actionableNotices(
    deps: NoticesForDeps,
    householdId: string,
    input: {
        today: string;
        timezone: string;
        /** The catalog's effective foods (computed once per read). */
        listedFoods: () => ReadonlyMap<string, EffectiveFood>;
        fridgeItems: readonly FridgeItem[];
        lines: readonly GroceryLine[] | undefined;
        /** The plans of the next `PLAN_NOTICE_DAYS` days; none without a plans store. */
        plans: readonly RecipePlan[] | undefined;
        recipes: readonly Recipe[];
        allIngredients: readonly RecipeIngredient[];
    },
): Promise<{ notices: Notice[]; subjectNames: Map<string, string> }> {
    const notices: Notice[] = [];
    const subjectNames = new Map<string, string>();
    const { lines } = input;
    if (lines) {
        const foodsById = input.listedFoods();
        notices.push(
            ...runningLowNotices({
                foodsById,
                stock: input.fridgeItems,
                lines,
                today: input.today,
            }),
        );
        if (input.plans) {
            const { plans } = input;
            const recipes = planRecipesOf(
                plans,
                input.recipes,
                input.allIngredients,
                deps.variants
                    ? await loadPlanVersionSources(
                          { recipes: deps.recipes, variants: deps.variants },
                          householdId,
                          plans,
                          input.allIngredients,
                      )
                    : undefined,
            );
            notices.push(
                ...planMissingNotices({
                    plans,
                    recipes,
                    stock: input.fridgeItems.map((item) => ({
                        quantity: item.quantity,
                        foodId: item.foodId,
                    })),
                    lines,
                    foodsById,
                    today: input.today,
                }),
            );
        }
    }
    if (deps.weighIns) {
        const members = await deps.weighIns.latestWeighIns(householdId);
        for (const notice of weighInDueNotices({
            members,
            today: input.today,
            timezone: input.timezone,
        })) {
            notices.push(notice);
            subjectNames.set(
                subjectNameKey("member", notice.subject.id),
                String(notice.params.name),
            );
        }
    }
    return { notices, subjectNames };
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
    opts: { today: string; actionable?: boolean; timezone?: string },
): Promise<NoticeDismissal> {
    assertDismissibleCode(input.code);

    const { notices } = await noticesFor(deps, householdId, {
        today: opts.today,
        actionable: opts.actionable,
        timezone: opts.timezone,
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
