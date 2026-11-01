import { type StockMovement, type StockStore } from "../domain/stock.js";
import { insertReturning, pgError, rows, run, type Tx } from "./sql.js";

const STOCK_MOVEMENTS = "stock_movements";
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

async function listMovementRows(
    tx: Tx,
    householdId: string,
    foodId: string | null | undefined,
): Promise<StockMovement[]> {
    const data = foodId
        ? await rows(
              tx,
              tx`
                  select ${tx.unsafe(STOCK_COLS)}
                  from ${tx.unsafe(STOCK_MOVEMENTS)}
                  where household_id = ${householdId}
                    and food_id = ${foodId}
                  order by created_at desc
              `,
          )
        : await rows(
              tx,
              tx`
                  select ${tx.unsafe(STOCK_COLS)}
                  from ${tx.unsafe(STOCK_MOVEMENTS)}
                  where household_id = ${householdId}
                  order by created_at desc
              `,
          );
    return data.map((row) => movementFromRow(row as never));
}

export function liveStockStore(): StockStore {
    return {
        async insertMovement(row) {
            return run(async (tx) => {
                const data = await insertReturning<Record<string, unknown>>(
                    tx,
                    STOCK_MOVEMENTS,
                    movementToRow(row),
                    STOCK_COLS,
                    "record stock movement",
                );
                return movementFromRow(data as never);
            });
        },
        async linkMeal(householdId, movementId, mealId) {
            return run(async (tx) => {
                try {
                    await tx`
                        update ${tx.unsafe(STOCK_MOVEMENTS)}
                        set meal_id = ${mealId}
                        where household_id = ${householdId}
                          and id = ${movementId}
                    `;
                } catch (err) {
                    throw pgError("link stock movement to meal", err);
                }
            });
        },
        async listMovements(householdId, foodId) {
            return run(async (tx) => {
                try {
                    return await listMovementRows(tx, householdId, foodId);
                } catch (err) {
                    throw pgError("list stock movements", err);
                }
            });
        },
    };
}
