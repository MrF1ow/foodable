import type { NutritionGoals } from "../db/nutrition.js";
import type {
    ProductCheckNutrient,
    ProductCheckToday,
} from "./product-checks.js";
import type { TodayDayTotals } from "./today.js";

type DailyGoalKey = Exclude<
    keyof NutritionGoals,
    "user_id" | "updated_at" | "target_weight_g"
>;

const GOAL_REMAINING: {
    nutrient: ProductCheckNutrient;
    goal: DailyGoalKey;
    total: keyof TodayDayTotals;
}[] = [
    { nutrient: "calories", goal: "daily_calories", total: "calories" },
    { nutrient: "protein_g", goal: "daily_protein_g", total: "protein_g" },
    { nutrient: "carbs_g", goal: "daily_carbs_g", total: "carbs_g" },
    { nutrient: "fat_g", goal: "daily_fat_g", total: "fat_g" },
    { nutrient: "fiber_g", goal: "daily_fiber_g", total: "fiber_g" },
    { nutrient: "sugar_g", goal: "daily_sugar_g", total: "sugar_g" },
    { nutrient: "alcohol_g", goal: "daily_alcohol_g", total: "alcohol_g" },
    {
        nutrient: "caffeine_mg",
        goal: "daily_caffeine_mg",
        total: "caffeine_mg",
    },
];

/** Remaining budget per nutrient for product checks on a calendar day. */
export function productCheckRemainingForDay(
    goals: NutritionGoals | null,
    totals: TodayDayTotals,
    showAlcohol: boolean,
): ProductCheckToday["remaining"] {
    if (goals == null) return {};
    const remaining: ProductCheckToday["remaining"] = {};
    for (const row of GOAL_REMAINING) {
        if (row.nutrient === "alcohol_g" && !showAlcohol) continue;
        const target = goals[row.goal];
        if (typeof target !== "number") continue;
        const used = totals[row.total];
        const usedNum = typeof used === "number" ? used : 0;
        remaining[row.nutrient] = Math.max(0, target - usedNum);
    }
    return remaining;
}
