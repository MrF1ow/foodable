import { isCalendarDate } from "../../../domain/insights.js";
import type { NutritionGoals } from "../../../db/nutrition.js";

const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];

/**
 * The day goals were set, as "Oct 2" (with the year when it is not `today`'s
 * year). Null when there is no valid date, so a caller shows nothing.
 */
export function formatGoalSince(
    date: string | null | undefined,
    today: string,
): string | null {
    if (!date || !isCalendarDate(date)) return null;
    const month = MONTHS[Number(date.slice(5, 7)) - 1]!;
    const day = Number(date.slice(8, 10));
    const year = date.slice(0, 4);
    return year === today.slice(0, 4)
        ? `${month} ${day}`
        : `${month} ${day}, ${year}`;
}

/** The goals' name, trimmed; null when there is none. */
export function goalName(
    goals: Pick<NutritionGoals, "goal_name"> | null,
): string | null {
    const name = goals?.goal_name?.trim();
    return name ? name : null;
}
