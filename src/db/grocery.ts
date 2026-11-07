import {
    groceryLineFromRow,
    groceryLineToRow,
    type GroceryLine,
    type GroceryListStore,
} from "../domain/grocery.js";
import { cleanupDismissalsForSubjectTx } from "./notice-dismissals.js";
import {
    definedColumns,
    insertReturning,
    maybeOne,
    pgError,
    rows,
    run,
    type Tx,
} from "./sql.js";

const GROCERY_LINES = "grocery_lines";
export const GROCERY_LINE_COLS =
    "id, household_id, store_id, section_id, kind, display_name, amount, unit, food_id, checked, source, source_fridge_item_id, note";

async function selectLines(
    tx: Tx,
    householdId: string,
): Promise<GroceryLine[]> {
    const data = await rows(
        tx,
        tx`
            select ${tx.unsafe(GROCERY_LINE_COLS)}
            from ${tx.unsafe(GROCERY_LINES)}
            where household_id = ${householdId}
            order by created_at asc
        `,
    );
    return data.map((row) => groceryLineFromRow(row as never));
}

export function liveGroceryStore(): GroceryListStore {
    return {
        async listLines(householdId) {
            return run(async (tx) => {
                try {
                    return await selectLines(tx, householdId);
                } catch (err) {
                    throw pgError("list grocery lines", err);
                }
            });
        },
        async insertLine(row) {
            return run(async (tx) => {
                const data = await insertReturning<Record<string, unknown>>(
                    tx,
                    GROCERY_LINES,
                    groceryLineToRow(row),
                    GROCERY_LINE_COLS,
                    "add grocery line",
                );
                return groceryLineFromRow(data as never);
            });
        },
        async updateLine(row) {
            return run(async (tx) => {
                try {
                    const payload = {
                        ...groceryLineToRow(row),
                        updated_at: new Date().toISOString(),
                    };
                    const { row: patch, keys } = definedColumns(payload);
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            update ${tx.unsafe(GROCERY_LINES)} set ${tx(patch, ...(keys as [string, ...string[]]))}
                            where id = ${row.id}
                              and household_id = ${row.householdId}
                            returning ${tx.unsafe(GROCERY_LINE_COLS)}
                        `,
                        "update grocery line",
                    );
                    return data ? groceryLineFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("update grocery line", err);
                }
            });
        },
        async deleteLine(householdId, id) {
            return run(async (tx) => {
                try {
                    const data = await rows<{ id: string }>(
                        tx,
                        tx`
                            delete from ${tx.unsafe(GROCERY_LINES)}
                            where id = ${id}
                              and household_id = ${householdId}
                            returning id
                        `,
                    );
                    if (data.length > 0) {
                        await cleanupDismissalsForSubjectTx(
                            tx,
                            householdId,
                            "grocery_line",
                            id,
                        );
                    }
                    return data.length > 0;
                } catch (err) {
                    throw pgError("delete grocery line", err);
                }
            });
        },
    };
}
