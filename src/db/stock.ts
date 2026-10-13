import { type StockMovement, type StockStore } from "../domain/stock.js";
import { getSupabase } from "./client.js";

const STOCK_COLS =
    "id, household_id, food_id, fridge_item_id, delta, unit, reason, grocery_line_id, recipe_id, meal_id, actor_user_id, created_at";

export function movementFromRow(row: {
    id: unknown;
    household_id: unknown;
    food_id: unknown;
    fridge_item_id: unknown;
    delta: unknown;
    unit: unknown;
    reason: unknown;
    grocery_line_id: unknown;
    recipe_id: unknown;
    meal_id: unknown;
    actor_user_id: unknown;
    created_at: unknown;
}): StockMovement {
    const reason = row.reason;
    const allowed =
        reason === "purchase" ||
        reason === "cook" ||
        reason === "eat" ||
        reason === "discard" ||
        reason === "adjust"
            ? reason
            : "adjust";
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        foodId: String(row.food_id),
        fridgeItemId:
            row.fridge_item_id == null ? null : String(row.fridge_item_id),
        delta: Number(row.delta),
        unit: String(row.unit),
        reason: allowed,
        groceryLineId:
            row.grocery_line_id == null ? null : String(row.grocery_line_id),
        recipeId: row.recipe_id == null ? null : String(row.recipe_id),
        mealId: row.meal_id == null ? null : String(row.meal_id),
        actorUserId:
            row.actor_user_id == null ? null : String(row.actor_user_id),
        createdAt: String(row.created_at),
    };
}

function movementToRow(row: StockMovement) {
    return {
        id: row.id,
        household_id: row.householdId,
        food_id: row.foodId,
        fridge_item_id: row.fridgeItemId,
        delta: row.delta,
        unit: row.unit,
        reason: row.reason,
        grocery_line_id: row.groceryLineId,
        recipe_id: row.recipeId,
        meal_id: row.mealId,
        actor_user_id: row.actorUserId,
        created_at: row.createdAt,
    };
}

export function liveStockStore(): StockStore {
    return {
        async insertMovement(row) {
            const { data, error } = await getSupabase()
                .from("stock_movements")
                .insert(movementToRow(row))
                .select(STOCK_COLS)
                .single();
            if (error) {
                throw new Error(
                    `Failed to record stock movement: ${error.message}`,
                );
            }
            return movementFromRow(data);
        },
        async linkMeal(householdId, movementId, mealId) {
            const { error } = await getSupabase()
                .from("stock_movements")
                .update({ meal_id: mealId })
                .eq("household_id", householdId)
                .eq("id", movementId);
            if (error) {
                throw new Error(
                    `Failed to link stock movement to meal: ${error.message}`,
                );
            }
        },
        async listMovements(householdId, foodId) {
            let query = getSupabase()
                .from("stock_movements")
                .select(STOCK_COLS)
                .eq("household_id", householdId)
                .order("created_at", { ascending: false });
            if (foodId) query = query.eq("food_id", foodId);
            const { data, error } = await query;
            if (error) {
                throw new Error(
                    `Failed to list stock movements: ${error.message}`,
                );
            }
            return (data ?? []).map(movementFromRow);
        },
    };
}
