import {
    groceryLineFromRow,
    groceryLineToRow,
    type GroceryListStore,
} from "../domain/grocery.js";
import { getSupabase } from "./client.js";

const GROCERY_LINE_COLS =
    "id, household_id, store_id, section_id, kind, display_name, amount, unit, food_id, checked";

export function liveGroceryStore(): GroceryListStore {
    return {
        async listLines(householdId) {
            const { data, error } = await getSupabase()
                .from("grocery_lines")
                .select(GROCERY_LINE_COLS)
                .eq("household_id", householdId)
                .order("created_at", { ascending: true });
            if (error) {
                throw new Error(
                    `Failed to list grocery lines: ${error.message}`,
                );
            }
            return (data ?? []).map(groceryLineFromRow);
        },
        async insertLine(row) {
            const { data, error } = await getSupabase()
                .from("grocery_lines")
                .insert(groceryLineToRow(row))
                .select(GROCERY_LINE_COLS)
                .single();
            if (error) {
                throw new Error(`Failed to add grocery line: ${error.message}`);
            }
            return groceryLineFromRow(data);
        },
        async updateLine(row) {
            const { data, error } = await getSupabase()
                .from("grocery_lines")
                .update({
                    ...groceryLineToRow(row),
                    updated_at: new Date().toISOString(),
                })
                .eq("id", row.id)
                .eq("household_id", row.householdId)
                .select(GROCERY_LINE_COLS)
                .maybeSingle();
            if (error) {
                throw new Error(
                    `Failed to update grocery line: ${error.message}`,
                );
            }
            return data ? groceryLineFromRow(data) : null;
        },
        async deleteLine(householdId, id) {
            const { data, error } = await getSupabase()
                .from("grocery_lines")
                .delete()
                .eq("id", id)
                .eq("household_id", householdId)
                .select("id");
            if (error) {
                throw new Error(
                    `Failed to delete grocery line: ${error.message}`,
                );
            }
            return (data ?? []).length > 0;
        },
    };
}
