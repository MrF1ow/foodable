import { groceryLineToRow, type GroceryLine } from "../domain/grocery.js";
import type { RestockStore } from "../domain/restock.js";
import { householdTimezone } from "../household.js";
import { todayInTz } from "../domain/tz.js";
import { getHouseholdConfig, getHouseholdOwnerProfile } from "./household.js";
import { insertReturning, maybeOne, rows, run, type Tx } from "./sql.js";

const HOUSEHOLDS = "households";
const GROCERY_LINES = "grocery_lines";
export const GROCERY_LINE_COLS =
    "id, household_id, store_id, section_id, kind, display_name, amount, unit, food_id, checked, source, source_fridge_item_id";

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

export async function listRestockEnabledHouseholds(): Promise<
    Array<{ id: string; household_preferences: unknown }>
> {
    return run(async (tx) => {
        return rows(
            tx,
            tx`
                select id, household_preferences
                from ${tx.unsafe(HOUSEHOLDS)}
                where household_preferences->'restock'->>'enabled' = 'true'
            `,
        ) as Promise<Array<{ id: string; household_preferences: unknown }>>;
    });
}

export async function householdToday(householdId: string): Promise<string> {
    const [config, owner] = await Promise.all([
        getHouseholdConfig(householdId),
        getHouseholdOwnerProfile(householdId),
    ]);
    const tz = householdTimezone(config.preferences, owner);
    return todayInTz(tz);
}
