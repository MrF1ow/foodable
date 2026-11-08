import { groceryLineToRow, type GroceryLine } from "../domain/grocery.js";
import type { RestockStore } from "../domain/restock.js";
import { householdTodayAt } from "../household.js";
import { getHouseholdConfig, getHouseholdOwnerProfile } from "./household.js";
import { GROCERY_LINE_COLS } from "./grocery.js";
import { insertReturning, maybeOne, rows, run, type Tx } from "./sql.js";

const HOUSEHOLDS = "households";
const GROCERY_LINES = "grocery_lines";

async function insertGroceryLineTx(tx: Tx, row: GroceryLine): Promise<void> {
    await insertReturning(
        tx,
        GROCERY_LINES,
        groceryLineToRow(row),
        GROCERY_LINE_COLS,
        "add grocery line",
    );
}

export function liveRestockStore(): RestockStore {
    return {
        async commitRestockRun(householdId, runOn, lines) {
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
                for (const line of lines) {
                    await insertGroceryLineTx(tx, line);
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
    const [config, owner] = await Promise.all([
        getHouseholdConfig(householdId),
        getHouseholdOwnerProfile(householdId),
    ]);
    return householdTodayAt(config.preferences, owner, now);
}
