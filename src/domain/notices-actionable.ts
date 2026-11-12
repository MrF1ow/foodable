// The household notices that come with a one-tap action: a usual running low,
// something a planned recipe needs that is neither in stock nor on the list, and
// a weigh-in that is due. Pure functions over what `noticesFor` has already
// loaded (plus the one small store the weigh-in reads); dismissal, sorting and
// the sentence all stay with the shared notice machinery.

import { foodDisplayName, type EffectiveFood } from "./foods.js";
import type { FridgeItem } from "./fridge.js";
import { onGroceryList, type GroceryLine } from "./grocery.js";
import type { LinkedNeed } from "./linking.js";
import { NOTICE_SEVERITY, type Notice, type NoticeRelated } from "./notices.js";
import {
    coverOnList,
    missingForPlan,
    type PlanMissingLine,
    type PlanNeed,
    type PlanRecipe,
} from "./plan-week.js";
import type { RecipePlan } from "./plan.js";
import { usualsDue } from "./restock.js";
import { daysUntilExpiry } from "./stock.js";
import { dateInTz } from "./tz.js";

/** Days from today a planned recipe is looked at for what it is missing. */
export const PLAN_NOTICE_DAYS = 3;

/** A member who weighs in is reminded once their latest weigh-in is this old. */
export const WEIGH_IN_DUE_AFTER_DAYS = 7;

/**
 * Usuals whose stock has fallen below their level and that are not on the
 * list. "Below" is `usualsDue`'s low trigger, asked with no restock day so a
 * schedule that is due never hides a usual that is also low; stock that cannot
 * be counted (an unknown grams-per-each or per-ml) is never low, and no stock
 * at all is. Paused and archived usuals are skipped there too.
 */
export function runningLowNotices(input: {
    /** Every effective food of the household: usuals, their products, stocked foods. */
    foodsById: ReadonlyMap<string, EffectiveFood>;
    stock: readonly FridgeItem[];
    lines: readonly GroceryLine[];
    today: string;
}): Notice[] {
    const usuals = [...input.foodsById.values()].filter(
        (food) => food.restockWhenLow,
    );
    // -1 is no weekday: only the low half of "due" can match.
    const due = usualsDue(
        usuals,
        input.stock,
        input.today,
        -1,
        input.foodsById,
    );
    const out: Notice[] = [];
    for (const { food, reason, trigger } of due) {
        if (trigger !== "low") continue;
        if (onGroceryList({ foodId: food.id }, input.lines, input.foodsById)) {
            continue;
        }
        out.push({
            code: "grocery.running_low",
            severity: NOTICE_SEVERITY["grocery.running_low"],
            subject: { kind: "food", id: food.id },
            related: [],
            params: {
                name: foodDisplayName(food),
                foodId: food.id,
                reason,
                // A dismissal holds until the usual is next restocked.
                dismissScope: food.lastRestockedOn ?? "",
            },
        });
    }
    return out;
}

function recipesOf(needs: readonly PlanNeed[]): NoticeRelated[] {
    const seen = new Set<string>();
    const out: NoticeRelated[] = [];
    for (const need of needs) {
        if (seen.has(need.recipeId)) continue;
        seen.add(need.recipeId);
        out.push({ kind: "recipe", id: need.recipeId, name: need.recipeName });
    }
    return out;
}

/**
 * What the recipes planned for the next `PLAN_NOTICE_DAYS` days need that the
 * kitchen does not hold and the list does not cover: one notice per food. The
 * need comes from `missingForPlan` and the list check from `coverOnList`, the
 * two "Add missing to groceries" uses, so the notice and its action agree.
 * Lines with no food cannot be added and have no notice (the recipe's own
 * "not linked" notice covers them). A line whose stock could not be counted
 * is flagged `unknown` with the recipe's full amount, as it is there.
 */
export function planMissingNotices(input: {
    plans: readonly RecipePlan[];
    recipes: readonly PlanRecipe[];
    stock: readonly LinkedNeed[];
    lines: readonly GroceryLine[];
    foodsById: ReadonlyMap<string, EffectiveFood>;
    today: string;
    days?: number;
}): Notice[] {
    const missing = missingForPlan(input.plans, input.recipes, input.stock, {
        from: input.today,
        days: input.days ?? PLAN_NOTICE_DAYS,
        foodsById: input.foodsById,
    });
    // missingForPlan gives one line per kind of unit for a food ("200 g" and
    // "250 ml" when there is no density); the notice, its dismissal and the Add
    // action are per food, so the lines of a food are folded into one.
    const byFood = new Map<
        string,
        {
            lines: PlanMissingLine[];
            parts: { amount: number; unit: string }[];
            unknown: boolean;
        }
    >();
    for (const line of missing) {
        if (!line.foodId) continue;
        const cover = coverOnList(
            line,
            line.foodId,
            input.lines,
            input.foodsById,
        );
        if (cover.covered) continue;
        if (!line.neededBy[0]) continue;
        let entry = byFood.get(line.foodId);
        if (!entry) {
            entry = { lines: [], parts: [], unknown: false };
            byFood.set(line.foodId, entry);
        }
        entry.lines.push(line);
        entry.unknown ||= line.unknown;
        if (line.missing != null && cover.amount != null) {
            entry.parts.push({ amount: cover.amount, unit: line.missing.unit });
        }
    }
    const out: Notice[] = [];
    for (const [foodId, entry] of byFood) {
        const needs = entry.lines.flatMap((line) => line.neededBy);
        // The earliest plan, the first met on a tie.
        const first = needs.reduce((a, b) => (b.date < a.date ? b : a));
        const recipes = recipesOf(needs);
        const params: Notice["params"] = {
            name: entry.lines[0]!.displayName,
            foodId,
            unknown: entry.unknown ? "yes" : "no",
            recipeName: first.recipeName,
            recipeCount: recipes.length,
            plannedOn: first.date,
            daysLeft: daysUntilExpiry(input.today, first.date),
            // A dismissal holds while that plan stands.
            dismissScope: first.planId,
        };
        if (entry.parts.length > 0) {
            params.amounts = entry.parts
                .map((part) => `${part.amount} ${part.unit}`)
                .join(" + ");
        }
        out.push({
            code: "plan.missing_ingredient",
            severity: NOTICE_SEVERITY["plan.missing_ingredient"],
            subject: { kind: "food", id: foodId },
            related: recipes,
            params,
        });
    }
    return out;
}

/** A member's latest weigh-in, for members with at least one ever. */
export type LatestWeighIn = {
    userId: string;
    displayName: string;
    /** The instant of the latest weight log. */
    lastLoggedAt: string;
};

export type WeighInStore = {
    /**
     * One row per member of the household who has logged weight at least once,
     * with the instant of their latest log. Members who never did are absent.
     */
    latestWeighIns(householdId: string): Promise<LatestWeighIn[]>;
};

export function createMemoryWeighInStore(
    rows: readonly LatestWeighIn[] = [],
): WeighInStore {
    return {
        async latestWeighIns() {
            return rows.map((row) => ({ ...row }));
        },
    };
}

/**
 * Members whose latest weigh-in is `WEIGH_IN_DUE_AFTER_DAYS` or more days old,
 * counted in whole days of the household's time zone. One notice per member.
 */
export function weighInDueNotices(input: {
    members: readonly LatestWeighIn[];
    today: string;
    timezone: string;
}): Notice[] {
    const out: Notice[] = [];
    for (const member of input.members) {
        const lastOn = dateInTz(member.lastLoggedAt, input.timezone);
        const days = daysUntilExpiry(lastOn, input.today);
        if (days < WEIGH_IN_DUE_AFTER_DAYS) continue;
        out.push({
            code: "nutrition.weigh_in_due",
            severity: NOTICE_SEVERITY["nutrition.weigh_in_due"],
            subject: { kind: "member", id: member.userId },
            related: [
                {
                    kind: "member",
                    id: member.userId,
                    name: member.displayName,
                },
            ],
            params: {
                name: member.displayName,
                days,
                lastWeighedOn: lastOn,
                // A dismissal lapses once there is a newer weigh-in.
                dismissScope: lastOn,
            },
        });
    }
    return out;
}
