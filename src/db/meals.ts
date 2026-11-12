import { recentLogDistinctKey } from "../domain/meals.js";
import { recentHistoryStart } from "../domain/log-search.js";
import { todayInTz } from "../domain/tz.js";
import { getMealsInRange, type Meal } from "./nutrition.js";
import { getProfile, timezoneFromProfile } from "./profiles.js";

const RECENT_LOG_SCAN_DAYS = 90;

/** Last N distinct meal logs for a user, newest first. */
export async function recentLogs(
    userId: string,
    limit: number,
): Promise<Meal[]> {
    const profile = await getProfile(userId);
    const tz = timezoneFromProfile(profile) ?? "UTC";
    const end = todayInTz(tz);
    const start = recentHistoryStart(end, RECENT_LOG_SCAN_DAYS);
    const meals = await getMealsInRange(userId, start, end, tz);
    const sorted = meals
        .slice()
        .sort((a, b) => b.logged_at.localeCompare(a.logged_at));
    const seen = new Set<string>();
    const out: Meal[] = [];
    for (const meal of sorted) {
        const key = recentLogDistinctKey(meal);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(meal);
        if (out.length >= limit) break;
    }
    return out;
}
