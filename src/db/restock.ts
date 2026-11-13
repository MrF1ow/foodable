import {
    groceryLineToRow,
    type GroceryFamily,
    type GroceryLine,
} from "../domain/grocery.js";
import type { RestockStore } from "../domain/restock.js";
import { householdTimezone, householdTodayAt } from "../household.js";
import { getHouseholdConfig, getHouseholdOwnerProfile } from "./household.js";
import { liveGroceryStore } from "./grocery.js";
import { maybeOne, rows, run } from "./sql.js";

const HOUSEHOLDS = "households";

export function liveRestockStore(): RestockStore {
    return {
        async commitRestockRun(householdId, runOn, lines, families) {
            return run(async (tx) => {
                const updated = await maybeOne<{ id: string }>(
                    tx,
                    tx`
                        update ${tx.unsafe(HOUSEHOLDS)}
                        set household_preferences = jsonb_set(
                            jsonb_set(
                                coalesce(household_preferences, '{}'::jsonb),
                                '{restock}',
                                coalesce(
                                    household_preferences->'restock',
                                    '{}'::jsonb
                                ),
                                true
                            ),
                            '{restock,lastRunOn}',
                            to_jsonb(${runOn}::text),
                            true
                        )
                        where id = ${householdId}
                          and coalesce(
                              household_preferences->'restock'->>'lastRunOn',
                              ''
                          ) < ${runOn}
                        returning id
                    `,
                    "restock last run",
                );
                if (!updated) return false;
                // Inside this transaction: the same lock and check a card add
                // takes, so the two cannot both miss the other's line.
                const grocery = liveGroceryStore();
                for (const line of lines) {
                    const family = families?.get(line.id);
                    if (family) {
                        await grocery.insertLineUnlessListed(line, family);
                    } else {
                        await grocery.insertLine(line);
                    }
                }
                return true;
            });
        },
    };
}

export type RestockEnabledHouseholdRow = {
    id: string;
    name: unknown;
    recipe_search_places: unknown;
    household_preferences: unknown;
};

export async function listRestockEnabledHouseholds(): Promise<
    RestockEnabledHouseholdRow[]
> {
    return run(async (tx) => {
        return rows(
            tx,
            tx`
                select id, name, recipe_search_places, household_preferences
                from ${tx.unsafe(HOUSEHOLDS)}
                where household_preferences->'restock'->>'enabled' = 'true'
            `,
        ) as Promise<RestockEnabledHouseholdRow[]>;
    });
}

export async function householdToday(
    householdId: string,
    now = new Date(),
): Promise<string> {
    return (await householdClock(householdId, now)).today;
}

/** The household's calendar date and the time zone it is counted in. */
export async function householdClock(
    householdId: string,
    now = new Date(),
): Promise<{ today: string; timezone: string }> {
    const [config, owner] = await Promise.all([
        getHouseholdConfig(householdId),
        getHouseholdOwnerProfile(householdId),
    ]);
    return {
        today: householdTodayAt(config.preferences, owner, now),
        timezone: householdTimezone(config.preferences, owner),
    };
}
