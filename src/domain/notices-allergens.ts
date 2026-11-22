import type { EffectiveFood } from "./foods.js";
import type { FridgeItem } from "./fridge.js";
import {
    allergenNotices,
    type GroceryAllergenMember,
    type GroceryLine,
} from "./grocery.js";
import type { Notice } from "./notices.js";
import { NOTICE_SEVERITY } from "./notices.js";
import { addPlanDays, WEEK_PLAN_DAYS } from "./plan-week.js";
import type { RecipePlan } from "./plan.js";
import type { ProductCheckMember } from "./product-checks.js";
import {
    memberChecksForProduct,
    productCheckFromFood,
} from "./product-screen.js";
import type { Recipe, RecipeIngredient } from "./recipes.js";

export type AllergenConditionInput = {
    /** The household's date: the plan window starts here. */
    today: string;
    /** Every member with their allergens. */
    members: readonly GroceryAllergenMember[];
    lines: readonly Pick<
        GroceryLine,
        "id" | "displayName" | "foodId" | "checked"
    >[];
    plans: readonly Pick<RecipePlan, "recipeId" | "date">[];
    recipes: readonly Pick<Recipe, "id" | "name">[];
    ingredients: readonly Pick<
        RecipeIngredient,
        "recipeId" | "displayName" | "foodId"
    >[];
    fridgeItems: readonly Pick<FridgeItem, "id" | "displayName" | "foodId">[];
    /** The foods the lines, ingredients and items point at, as the household
     *  sees them (a plain food carries its usual product's allergens). */
    foodsById: ReadonlyMap<string, EffectiveFood>;
};

type Params = Notice["params"];

function withParams(notice: Notice, extra: Params): Notice {
    return { ...notice, params: { ...notice.params, ...extra } };
}

/** Open grocery lines, matched the way the grocery list and `list_grocery_lines`
 *  match them: the food's allergens when the line has a food, else its name. */
function groceryConflicts(input: AllergenConditionInput): Notice[] {
    const out: Notice[] = [];
    for (const line of input.lines) {
        if (line.checked) continue;
        const food = line.foodId ? input.foodsById.get(line.foodId) : undefined;
        const [notice] = allergenNotices(
            { kind: "grocery_line", id: line.id },
            line.displayName,
            [...input.members],
            food ? food.allergens : null,
        );
        if (!notice) continue;
        out.push(
            withParams(notice, {
                name: line.displayName,
                ...(line.foodId ? { foodId: line.foodId } : {}),
            }),
        );
    }
    return out;
}

/** Recipes planned in the next seven days, matched the way `get_recipe`
 *  matches one: every ingredient's food when all are in the catalog, else the
 *  ingredient names. */
function recipeConflicts(input: AllergenConditionInput): Notice[] {
    const last = addPlanDays(input.today, WEEK_PLAN_DAYS - 1);
    const firstPlanned = new Map<string, string>();
    for (const plan of input.plans) {
        if (plan.date < input.today || plan.date > last) continue;
        const seen = firstPlanned.get(plan.recipeId);
        if (seen === undefined || plan.date < seen) {
            firstPlanned.set(plan.recipeId, plan.date);
        }
    }
    const out: Notice[] = [];
    for (const recipe of input.recipes) {
        const plannedOn = firstPlanned.get(recipe.id);
        if (plannedOn === undefined) continue;
        const rows = input.ingredients.filter(
            (row) => row.recipeId === recipe.id,
        );
        const foods = rows.flatMap((row) => {
            const food = row.foodId
                ? input.foodsById.get(row.foodId)
                : undefined;
            return food ? [food] : [];
        });
        const allCatalogued = rows.every(
            (row) => row.foodId && input.foodsById.has(row.foodId),
        );
        const [notice] = allergenNotices(
            { kind: "recipe", id: recipe.id },
            rows.map((row) => row.displayName).join(" "),
            [...input.members],
            allCatalogued ? foods.flatMap((food) => food.allergens) : null,
        );
        if (!notice) continue;
        out.push(
            withParams(notice, {
                name: recipe.name,
                recipeName: recipe.name,
                plannedOn,
            }),
        );
    }
    return out;
}

/** Fridge items, checked the way the product check checks a product: the
 *  food's named allergens and OFF "contains" tags against each member's named
 *  allergens. A trace is a warning there, so it is not a conflict here. */
function fridgeConflicts(input: AllergenConditionInput): Notice[] {
    const checkMembers: ProductCheckMember[] = input.members.map((member) => ({
        id: member.userId ?? member.displayName,
        name: member.displayName,
        allergens: member.allergens.map((row) => row.allergen),
        dislikes: [],
        warnTraces: false,
        compareGoals: false,
    }));
    const out: Notice[] = [];
    for (const item of input.fridgeItems) {
        const food = item.foodId ? input.foodsById.get(item.foodId) : undefined;
        if (!food) continue;
        const byMember = memberChecksForProduct(
            productCheckFromFood(food),
            checkMembers,
        );
        const hit: ProductCheckMember[] = [];
        const labels = new Set<string>();
        for (const member of checkMembers) {
            const block = byMember
                .get(member.id)
                ?.find((n) => n.code === "food.product_allergen");
            if (!block) continue;
            hit.push(member);
            for (const label of block.params.allergens as string[]) {
                labels.add(label);
            }
        }
        if (hit.length === 0) continue;
        out.push({
            code: "food.product_allergen",
            severity: NOTICE_SEVERITY["food.product_allergen"],
            subject: { kind: "fridge_item", id: item.id },
            related: hit.map((member) => ({
                kind: "member" as const,
                id: member.id,
                name: member.name,
            })),
            params: {
                allergens: [...labels],
                name: item.displayName,
                foodId: food.id,
            },
        });
    }
    return out;
}

/**
 * The household's current allergen conflicts, one block notice per conflict
 * (not per member): an open grocery line, a recipe planned in the next seven
 * days, a fridge item. Each is keyed by its subject, so it is the same
 * notice for as long as the conflict lasts, whoever it names; it is gone
 * when the line is ticked or removed, the plan passes or is removed, the item
 * is used up, or the member's allergen is. Nothing here is a warning: an
 * uncatalogued line that matches nothing is "unknown allergen data" on the
 * list, not a conflict.
 */
export function allergenConditionNotices(
    input: AllergenConditionInput,
): Notice[] {
    if (!input.members.some((member) => member.allergens.length > 0)) {
        return [];
    }
    return [
        ...groceryConflicts(input),
        ...recipeConflicts(input),
        ...fridgeConflicts(input),
    ];
}
