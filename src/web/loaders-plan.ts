/**
 * What This week on Today and Recipes is read from. The reader itself lives in
 * `db/plan-week.ts` (the MCP plan tools share it); this module keeps the page
 * view apart from `loaders.ts` so the pages that only show it can be tested
 * with this one module stubbed.
 */
import { loadWeekPlanInputs } from "../db/plan-week.js";
import {
    buildWeekPlanView,
    type WeekPlanView,
} from "./pages/v2/recipes-plan.js";

export { loadWeekPlanInputs, type WeekPlanInputs } from "../db/plan-week.js";

/** This week for Today and Recipes: seven days, the plans on them, what is missing. */
export async function loadWeekPlanView(
    householdId: string,
    today?: string,
): Promise<WeekPlanView> {
    return buildWeekPlanView(await loadWeekPlanInputs(householdId, today));
}
