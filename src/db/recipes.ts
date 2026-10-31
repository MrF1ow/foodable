import {
    recipeFromRow,
    recipeIngredientFromRow,
    recipeIngredientToRow,
    recipePortionFromRow,
    recipePortionToRow,
    recipeToRow,
    type RecipesStore,
} from "../domain/recipes.js";
import { getSupabase } from "./client.js";

const RECIPE_COLS =
    "id, household_id, creator_id, name, yield_portions, instructions, source_url, tags, notes, prep_minutes, cook_minutes";
const RECIPE_INGREDIENT_COLS =
    "id, household_id, recipe_id, kind, display_name, amount, unit, food_id, sort_order, note";
const RECIPE_PORTION_COLS = "recipe_id, household_id, user_id, portion_count";

export function liveRecipesStore(): RecipesStore {
    return {
        async listRecipes(householdId) {
            const { data, error } = await getSupabase()
                .from("recipes")
                .select(RECIPE_COLS)
                .eq("household_id", householdId)
                .order("name", { ascending: true });
            if (error) {
                throw new Error(`Failed to list recipes: ${error.message}`);
            }
            return (data ?? []).map(recipeFromRow);
        },
        async getRecipe(householdId, id) {
            const { data, error } = await getSupabase()
                .from("recipes")
                .select(RECIPE_COLS)
                .eq("household_id", householdId)
                .eq("id", id)
                .maybeSingle();
            if (error) {
                throw new Error(`Failed to load recipe: ${error.message}`);
            }
            return data ? recipeFromRow(data) : null;
        },
        async insertRecipe(row) {
            const { data, error } = await getSupabase()
                .from("recipes")
                .insert(recipeToRow(row))
                .select(RECIPE_COLS)
                .single();
            if (error) {
                throw new Error(`Failed to add recipe: ${error.message}`);
            }
            return recipeFromRow(data);
        },
        async updateRecipe(row) {
            const { data, error } = await getSupabase()
                .from("recipes")
                .update({
                    ...recipeToRow(row),
                    updated_at: new Date().toISOString(),
                })
                .eq("id", row.id)
                .eq("household_id", row.householdId)
                .select(RECIPE_COLS)
                .maybeSingle();
            if (error) {
                throw new Error(`Failed to update recipe: ${error.message}`);
            }
            return data ? recipeFromRow(data) : null;
        },
        async deleteRecipe(householdId, id) {
            const { data, error } = await getSupabase()
                .from("recipes")
                .delete()
                .eq("id", id)
                .eq("household_id", householdId)
                .select("id");
            if (error) {
                throw new Error(`Failed to delete recipe: ${error.message}`);
            }
            return (data ?? []).length > 0;
        },
        async listIngredients(householdId, recipeId) {
            const { data, error } = await getSupabase()
                .from("recipe_ingredients")
                .select(RECIPE_INGREDIENT_COLS)
                .eq("household_id", householdId)
                .eq("recipe_id", recipeId)
                .order("sort_order", { ascending: true });
            if (error) {
                throw new Error(
                    `Failed to list recipe ingredients: ${error.message}`,
                );
            }
            return (data ?? []).map(recipeIngredientFromRow);
        },
        async insertIngredient(row) {
            const { data, error } = await getSupabase()
                .from("recipe_ingredients")
                .insert(recipeIngredientToRow(row))
                .select(RECIPE_INGREDIENT_COLS)
                .single();
            if (error) {
                throw new Error(
                    `Failed to add recipe ingredient: ${error.message}`,
                );
            }
            return recipeIngredientFromRow(data);
        },
        async updateIngredient(row) {
            const { data, error } = await getSupabase()
                .from("recipe_ingredients")
                .update(recipeIngredientToRow(row))
                .eq("id", row.id)
                .eq("household_id", row.householdId)
                .select(RECIPE_INGREDIENT_COLS)
                .maybeSingle();
            if (error) {
                throw new Error(
                    `Failed to update recipe ingredient: ${error.message}`,
                );
            }
            return data ? recipeIngredientFromRow(data) : null;
        },
        async deleteIngredient(householdId, ingredientId) {
            const { data, error } = await getSupabase()
                .from("recipe_ingredients")
                .delete()
                .eq("id", ingredientId)
                .eq("household_id", householdId)
                .select("id");
            if (error) {
                throw new Error(
                    `Failed to delete recipe ingredient: ${error.message}`,
                );
            }
            return (data ?? []).length > 0;
        },
        async getPortion(householdId, recipeId, userId) {
            const { data, error } = await getSupabase()
                .from("recipe_portions")
                .select(RECIPE_PORTION_COLS)
                .eq("household_id", householdId)
                .eq("recipe_id", recipeId)
                .eq("user_id", userId)
                .maybeSingle();
            if (error) {
                throw new Error(
                    `Failed to load recipe portion: ${error.message}`,
                );
            }
            return data ? recipePortionFromRow(data) : null;
        },
        async upsertPortion(row) {
            const { data, error } = await getSupabase()
                .from("recipe_portions")
                .upsert(recipePortionToRow(row), {
                    onConflict: "recipe_id,user_id",
                })
                .select(RECIPE_PORTION_COLS)
                .single();
            if (error) {
                throw new Error(
                    `Failed to save recipe portion: ${error.message}`,
                );
            }
            return recipePortionFromRow(data);
        },
    };
}
