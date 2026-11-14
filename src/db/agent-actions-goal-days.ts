import {
    goalDayFromRow,
    isCalendarDate,
    type GoalDayOverride,
} from "../domain/insights.js";
import { rows, run } from "./sql.js";

const NUTRITION_GOAL_DAYS = "nutrition_goal_days";

/** A per-day override with the id of its row, which an undo names it by. */
export type GoalDayRow = GoalDayOverride & { id: string };

/**
 * What a destructive goal write needs of the per-day overrides: the rows with
 * their ids, to record them before they go, and a delete of exactly those ids.
 */
export type GoalDayRows = {
    /** This user's overrides on these dates. */
    list(
        userId: string,
        householdId: string,
        dates: string[],
    ): Promise<GoalDayRow[]>;
    /**
     * Removes exactly these rows and no others, so what is removed is what was
     * recorded: an override added meanwhile stays. Returns how many went.
     */
    remove(userId: string, householdId: string, ids: string[]): Promise<number>;
};

function failed(context: string, err: unknown): Error {
    const message = err instanceof Error ? err.message : String(err);
    return new Error(`Failed to ${context}: ${message}`);
}

export function liveGoalDayRows(): GoalDayRows {
    return {
        async list(userId, householdId, dates) {
            for (const date of dates) {
                if (!isCalendarDate(date)) {
                    throw new Error(
                        `list goal days: invalid calendar date ${date}`,
                    );
                }
            }
            if (dates.length === 0) return [];
            return run(async (tx) => {
                try {
                    const found = await rows<Record<string, unknown>>(
                        tx,
                        tx`
                            select *
                            from ${tx.unsafe(NUTRITION_GOAL_DAYS)}
                            where
                                household_id = ${householdId}
                                and user_id = ${userId}
                                and date::text = any(${tx.array(dates, "text")})
                            order by date
                        `,
                    );
                    return found.map((row) => ({
                        ...goalDayFromRow(row),
                        id: String(row.id),
                    }));
                } catch (err) {
                    throw failed("list goal days", err);
                }
            });
        },
        async remove(userId, householdId, ids) {
            if (ids.length === 0) return 0;
            return run(async (tx) => {
                try {
                    const deleted = await rows<{ id: string }>(
                        tx,
                        tx`
                            delete from ${tx.unsafe(NUTRITION_GOAL_DAYS)}
                            where
                                household_id = ${householdId}
                                and user_id = ${userId}
                                and id = any(${tx.array(ids, "uuid")})
                            returning id
                        `,
                    );
                    return deleted.length;
                } catch (err) {
                    throw failed("delete goal days", err);
                }
            });
        },
    };
}

// A seam for tests that run the tool over memory stores.
let override: GoalDayRows | null = null;

export function setGoalDayRowsForTests(rowsStore: GoalDayRows | null): void {
    override = rowsStore;
}

/** The per-day override rows, live unless a test swapped them. */
export function goalDayRows(): GoalDayRows {
    return override ?? liveGoalDayRows();
}
