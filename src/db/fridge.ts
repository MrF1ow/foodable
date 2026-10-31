import {
    fridgeItemFromRow,
    fridgeItemToRow,
    fridgeLocationFromRow,
    fridgeLocationToRow,
    type FridgeStore,
} from "../domain/fridge.js";
import { getSupabase } from "./client.js";

const FRIDGE_LOCATION_COLS = "id, household_id, name, sort_order";
const FRIDGE_ITEM_COLS =
    "id, household_id, location_id, kind, display_name, amount, unit, food_id, purchased_on, opened_on, expires_on";

export function liveFridgeStore(): FridgeStore {
    return {
        async listLocations(householdId) {
            const { data, error } = await getSupabase()
                .from("fridge_locations")
                .select(FRIDGE_LOCATION_COLS)
                .eq("household_id", householdId)
                .order("sort_order", { ascending: true })
                .order("name", { ascending: true });
            if (error) {
                throw new Error(
                    `Failed to list fridge locations: ${error.message}`,
                );
            }
            return (data ?? []).map(fridgeLocationFromRow);
        },
        async insertLocation(row) {
            const { data, error } = await getSupabase()
                .from("fridge_locations")
                .insert(fridgeLocationToRow(row))
                .select(FRIDGE_LOCATION_COLS)
                .single();
            if (error) {
                throw new Error(
                    `Failed to add fridge location: ${error.message}`,
                );
            }
            return fridgeLocationFromRow(data);
        },
        async updateLocation(row) {
            const { data, error } = await getSupabase()
                .from("fridge_locations")
                .update(fridgeLocationToRow(row))
                .eq("id", row.id)
                .eq("household_id", row.householdId)
                .select(FRIDGE_LOCATION_COLS)
                .maybeSingle();
            if (error) {
                throw new Error(
                    `Failed to update fridge location: ${error.message}`,
                );
            }
            return data ? fridgeLocationFromRow(data) : null;
        },
        async deleteLocation(householdId, id) {
            const { data, error } = await getSupabase()
                .from("fridge_locations")
                .delete()
                .eq("id", id)
                .eq("household_id", householdId)
                .select("id");
            if (error) {
                throw new Error(
                    `Failed to delete fridge location: ${error.message}`,
                );
            }
            return (data ?? []).length > 0;
        },
        async listItems(householdId) {
            const { data, error } = await getSupabase()
                .from("fridge_items")
                .select(FRIDGE_ITEM_COLS)
                .eq("household_id", householdId)
                .order("created_at", { ascending: true });
            if (error) {
                throw new Error(
                    `Failed to list fridge items: ${error.message}`,
                );
            }
            return (data ?? []).map(fridgeItemFromRow);
        },
        async insertItem(row) {
            const { data, error } = await getSupabase()
                .from("fridge_items")
                .insert(fridgeItemToRow(row))
                .select(FRIDGE_ITEM_COLS)
                .single();
            if (error) {
                throw new Error(`Failed to add fridge item: ${error.message}`);
            }
            return fridgeItemFromRow(data);
        },
        async updateItem(row) {
            const { data, error } = await getSupabase()
                .from("fridge_items")
                .update({
                    ...fridgeItemToRow(row),
                    updated_at: new Date().toISOString(),
                })
                .eq("id", row.id)
                .eq("household_id", row.householdId)
                .select(FRIDGE_ITEM_COLS)
                .maybeSingle();
            if (error) {
                throw new Error(
                    `Failed to update fridge item: ${error.message}`,
                );
            }
            return data ? fridgeItemFromRow(data) : null;
        },
        async deleteItem(householdId, id) {
            const { data, error } = await getSupabase()
                .from("fridge_items")
                .delete()
                .eq("id", id)
                .eq("household_id", householdId)
                .select("id");
            if (error) {
                throw new Error(
                    `Failed to delete fridge item: ${error.message}`,
                );
            }
            return (data ?? []).length > 0;
        },
    };
}

export type { FridgeStore };
