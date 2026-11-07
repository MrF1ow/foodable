import {
    recipeFromRow,
    recipeIngredientFromRow,
    recipeIngredientToRow,
    recipePortionFromRow,
    recipePortionToRow,
    recipeToRow,
    type RecipesStore,
} from "../domain/recipes.js";
import {
    cleanupDismissalsForRecipeTx,
    cleanupDismissalsForSubjectTx,
} from "./notice-dismissals.js";
import {
    definedColumns,
    insertReturning,
    maybeOne,
    one,
    pgError,
    rows,
    run,
    type Tx,
} from "./sql.js";

const RECIPES = "recipes";
const RECIPE_INGREDIENTS = "recipe_ingredients";
const RECIPE_PORTIONS = "recipe_portions";
const RECIPE_COLS =
    "id, household_id, creator_id, name, yield_portions, instructions, source_url, tags, notes, prep_minutes, cook_minutes";
const RECIPE_INGREDIENT_COLS =
    "id, household_id, recipe_id, kind, display_name, amount, unit, food_id, sort_order, note";
const RECIPE_PORTION_COLS = "recipe_id, household_id, user_id, portion_count";

function patchKeys(keys: string[]): [string, ...string[]] {
    return keys as [string, ...string[]];
}

function recipeRowForWrite(
    tx: Tx,
    row: ReturnType<typeof recipeToRow>,
): Record<string, unknown> {
    return {
        ...row,
        tags: tx.array(Array.isArray(row.tags) ? row.tags : [], "text"),
    };
}

export function liveRecipesStore(): RecipesStore {
    return {
        async listRecipes(householdId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(RECIPE_COLS)}
                            from ${tx.unsafe(RECIPES)}
                            where household_id = ${householdId}
                            order by name asc
                        `,
                    );
                    return data.map((row) => recipeFromRow(row as never));
                } catch (err) {
                    throw pgError("list recipes", err);
                }
            });
        },
        async getRecipe(householdId, id) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            select ${tx.unsafe(RECIPE_COLS)}
                            from ${tx.unsafe(RECIPES)}
                            where household_id = ${householdId}
                              and id = ${id}
                        `,
                        "load recipe",
                    );
                    return data ? recipeFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("load recipe", err);
                }
            });
        },
        async insertRecipe(row) {
            return run(async (tx) => {
                const data = await insertReturning<Record<string, unknown>>(
                    tx,
                    RECIPES,
                    recipeRowForWrite(tx, recipeToRow(row)),
                    RECIPE_COLS,
                    "add recipe",
                );
                return recipeFromRow(data as never);
            });
        },
        async updateRecipe(row) {
            return run(async (tx) => {
                try {
                    const payload = {
                        ...recipeRowForWrite(tx, recipeToRow(row)),
                        updated_at: new Date().toISOString(),
                    };
                    const { row: patch, keys } = definedColumns(payload);
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            update ${tx.unsafe(RECIPES)} set ${tx(patch, ...patchKeys(keys))}
                            where id = ${row.id}
                              and household_id = ${row.householdId}
                            returning ${tx.unsafe(RECIPE_COLS)}
                        `,
                        "update recipe",
                    );
                    return data ? recipeFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("update recipe", err);
                }
            });
        },
        async deleteRecipe(householdId, id) {
            return run(async (tx) => {
                try {
                    await cleanupDismissalsForRecipeTx(tx, householdId, id);
                    const data = await rows<{ id: string }>(
                        tx,
                        tx`
                            delete from ${tx.unsafe(RECIPES)}
                            where id = ${id}
                              and household_id = ${householdId}
                            returning id
                        `,
                    );
                    return data.length > 0;
                } catch (err) {
                    throw pgError("delete recipe", err);
                }
            });
        },
        async listIngredients(householdId, recipeId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(RECIPE_INGREDIENT_COLS)}
                            from ${tx.unsafe(RECIPE_INGREDIENTS)}
                            where household_id = ${householdId}
                              and recipe_id = ${recipeId}
                            order by sort_order asc
                        `,
                    );
                    return data.map((row) =>
                        recipeIngredientFromRow(row as never),
                    );
                } catch (err) {
                    throw pgError("list recipe ingredients", err);
                }
            });
        },
        async listIngredientsForHousehold(householdId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(RECIPE_INGREDIENT_COLS)}
                            from ${tx.unsafe(RECIPE_INGREDIENTS)}
                            where household_id = ${householdId}
                            order by recipe_id asc, sort_order asc
                        `,
                    );
                    return data.map((row) =>
                        recipeIngredientFromRow(row as never),
                    );
                } catch (err) {
                    throw pgError("list recipe ingredients for household", err);
                }
            });
        },
        async insertIngredient(row) {
            return run(async (tx) => {
                const data = await insertReturning<Record<string, unknown>>(
                    tx,
                    RECIPE_INGREDIENTS,
                    recipeIngredientToRow(row),
                    RECIPE_INGREDIENT_COLS,
                    "add recipe ingredient",
                );
                return recipeIngredientFromRow(data as never);
            });
        },
        async updateIngredient(row) {
            return run(async (tx) => {
                try {
                    const { row: patch, keys } = definedColumns(
                        recipeIngredientToRow(row),
                    );
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            update ${tx.unsafe(RECIPE_INGREDIENTS)} set ${tx(patch, ...patchKeys(keys))}
                            where id = ${row.id}
                              and household_id = ${row.householdId}
                            returning ${tx.unsafe(RECIPE_INGREDIENT_COLS)}
                        `,
                        "update recipe ingredient",
                    );
                    return data ? recipeIngredientFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("update recipe ingredient", err);
                }
            });
        },
        async deleteIngredient(householdId, ingredientId) {
            return run(async (tx) => {
                try {
                    const data = await rows<{ id: string }>(
                        tx,
                        tx`
                            delete from ${tx.unsafe(RECIPE_INGREDIENTS)}
                            where id = ${ingredientId}
                              and household_id = ${householdId}
                            returning id
                        `,
                    );
                    if (data.length > 0) {
                        await cleanupDismissalsForSubjectTx(
                            tx,
                            householdId,
                            "recipe_ingredient",
                            ingredientId,
                        );
                    }
                    return data.length > 0;
                } catch (err) {
                    throw pgError("delete recipe ingredient", err);
                }
            });
        },
        async getPortion(householdId, recipeId, userId) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            select ${tx.unsafe(RECIPE_PORTION_COLS)}
                            from ${tx.unsafe(RECIPE_PORTIONS)}
                            where household_id = ${householdId}
                              and recipe_id = ${recipeId}
                              and user_id = ${userId}
                        `,
                        "load recipe portion",
                    );
                    return data ? recipePortionFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("load recipe portion", err);
                }
            });
        },
        async upsertPortion(row) {
            return run(async (tx) => {
                try {
                    const payload = recipePortionToRow(row);
                    const { row: patch, keys } = definedColumns(payload);
                    const data = await one<Record<string, unknown>>(
                        tx,
                        tx`
                            insert into ${tx.unsafe(RECIPE_PORTIONS)} ${tx(patch, ...patchKeys(keys))}
                            on conflict (recipe_id, user_id) do update set
                                household_id = excluded.household_id,
                                portion_count = excluded.portion_count
                            returning ${tx.unsafe(RECIPE_PORTION_COLS)}
                        `,
                        "save recipe portion",
                    );
                    return recipePortionFromRow(data as never);
                } catch (err) {
                    throw pgError("save recipe portion", err);
                }
            });
        },
        async recipeActivityMsById(householdId) {
            return run(async (tx) => {
                try {
                    const data = await rows<{
                        id: string;
                        activity_at: string;
                    }>(
                        tx,
                        tx`
                            select id, coalesce(updated_at, created_at) as activity_at
                            from ${tx.unsafe(RECIPES)}
                            where household_id = ${householdId}
                        `,
                    );
                    const map = new Map<string, number>();
                    for (const row of data) {
                        map.set(String(row.id), Date.parse(row.activity_at));
                    }
                    return map;
                } catch (err) {
                    throw pgError("list recipe activity", err);
                }
            });
        },
    };
}
