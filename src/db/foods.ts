import { foodFromRow, foodToRow, type FoodsStore } from "../domain/foods.js";
import { getSupabase } from "./client.js";

const FOOD_COLS =
    "id, household_id, kind, name, normalized_name, brand, default_unit, grams_per_each, grams_per_ml, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, alcohol_g, caffeine_mg, nutrition_source, allergens, off_source_id, created_by, archived_at, created_at, updated_at";

export function liveFoodsStore(): FoodsStore {
    const store: FoodsStore = {
        async listFoods(householdId) {
            const { data, error } = await getSupabase()
                .from("foods")
                .select(FOOD_COLS)
                .eq("household_id", householdId)
                .is("archived_at", null)
                .order("name", { ascending: true });
            if (error) {
                throw new Error(`Failed to list foods: ${error.message}`);
            }
            return (data ?? []).map(foodFromRow);
        },
        async getFood(householdId, id) {
            const { data, error } = await getSupabase()
                .from("foods")
                .select(FOOD_COLS)
                .eq("household_id", householdId)
                .eq("id", id)
                .maybeSingle();
            if (error) {
                throw new Error(`Failed to load food: ${error.message}`);
            }
            return data ? foodFromRow(data) : null;
        },
        async insertFood(row) {
            const { data, error } = await getSupabase()
                .from("foods")
                .insert(foodToRow(row))
                .select(FOOD_COLS)
                .single();
            if (error) {
                throw new Error(`Failed to add food: ${error.message}`);
            }
            return foodFromRow(data);
        },
        async updateFoodRow(row) {
            const { data, error } = await getSupabase()
                .from("foods")
                .update(foodToRow(row))
                .eq("id", row.id)
                .eq("household_id", row.householdId)
                .select(FOOD_COLS)
                .maybeSingle();
            if (error) {
                throw new Error(`Failed to update food: ${error.message}`);
            }
            return data ? foodFromRow(data) : null;
        },
        async getByNormalizedName(householdId, kind, normalizedName) {
            const { data, error } = await getSupabase()
                .from("foods")
                .select(FOOD_COLS)
                .eq("household_id", householdId)
                .eq("kind", kind)
                .eq("normalized_name", normalizedName)
                .is("archived_at", null)
                .maybeSingle();
            if (error) {
                throw new Error(`Failed to match food name: ${error.message}`);
            }
            return data ? foodFromRow(data) : null;
        },
        async getByOffSourceId(householdId, offSourceId) {
            const { data, error } = await getSupabase()
                .from("foods")
                .select(FOOD_COLS)
                .eq("household_id", householdId)
                .eq("off_source_id", offSourceId)
                .is("archived_at", null)
                .maybeSingle();
            if (error) {
                throw new Error(
                    `Failed to match food source: ${error.message}`,
                );
            }
            return data ? foodFromRow(data) : null;
        },
        async getBarcodeFoodId(householdId, barcode) {
            const { data, error } = await getSupabase()
                .from("food_barcodes")
                .select("food_id")
                .eq("household_id", householdId)
                .eq("barcode", barcode)
                .maybeSingle();
            if (error) {
                throw new Error(`Failed to match barcode: ${error.message}`);
            }
            return data ? String(data.food_id) : null;
        },
        async listBarcodes(householdId, foodId) {
            const { data, error } = await getSupabase()
                .from("food_barcodes")
                .select("barcode")
                .eq("household_id", householdId)
                .eq("food_id", foodId);
            if (error) {
                throw new Error(`Failed to list barcodes: ${error.message}`);
            }
            return (data ?? []).map((row) => String(row.barcode));
        },
        async setBarcode(householdId, barcode, foodId) {
            const { error } = await getSupabase().from("food_barcodes").upsert(
                {
                    household_id: householdId,
                    barcode,
                    food_id: foodId,
                },
                { onConflict: "household_id,barcode" },
            );
            if (error) {
                throw new Error(`Failed to save barcode: ${error.message}`);
            }
        },
        async deleteBarcodesForFood(householdId, foodId) {
            const { data, error } = await getSupabase()
                .from("food_barcodes")
                .delete()
                .eq("household_id", householdId)
                .eq("food_id", foodId)
                .select("barcode");
            if (error) {
                throw new Error(`Failed to move barcodes: ${error.message}`);
            }
            return (data ?? []).map((row) => String(row.barcode));
        },
        async getAliasFoodId(householdId, alias) {
            const { data, error } = await getSupabase()
                .from("food_aliases")
                .select("food_id")
                .eq("household_id", householdId)
                .eq("alias", alias)
                .maybeSingle();
            if (error) {
                throw new Error(`Failed to match alias: ${error.message}`);
            }
            return data ? String(data.food_id) : null;
        },
        async listAliases(householdId, foodId) {
            const { data, error } = await getSupabase()
                .from("food_aliases")
                .select("alias")
                .eq("household_id", householdId)
                .eq("food_id", foodId)
                .order("alias", { ascending: true });
            if (error) {
                throw new Error(`Failed to list aliases: ${error.message}`);
            }
            return (data ?? []).map((row) => String(row.alias));
        },
        async listAllAliases(householdId) {
            const sb = getSupabase();
            const { count, error: countError } = await sb
                .from("food_aliases")
                .select("alias", { count: "exact", head: true })
                .eq("household_id", householdId);
            if (countError) {
                throw new Error(
                    `Failed to list aliases: ${countError.message}`,
                );
            }
            // A missing count still pages; only a reported count is checked.
            const expected = count ?? null;
            const grouped = new Map<string, string[]>();
            if (expected === 0) return grouped;
            // PostgREST caps an unbounded select at 1000 rows. Page on a
            // stable (food_id, alias) order and refuse a short read.
            const pageSize = 1000;
            const rows: { food_id: string; alias: string }[] = [];
            for (let from = 0; ; from += pageSize) {
                const { data, error } = await sb
                    .from("food_aliases")
                    .select("food_id, alias")
                    .eq("household_id", householdId)
                    .order("food_id", { ascending: true })
                    .order("alias", { ascending: true })
                    .range(from, from + pageSize - 1);
                if (error) {
                    throw new Error(`Failed to list aliases: ${error.message}`);
                }
                const page = data ?? [];
                for (const row of page) {
                    rows.push({
                        food_id: String(row.food_id),
                        alias: String(row.alias),
                    });
                }
                if (page.length < pageSize) break;
            }
            if (expected != null && rows.length < expected) {
                throw new Error(
                    `listAllAliases: fetched ${rows.length} aliases but count reported ${expected}`,
                );
            }
            for (const row of rows) {
                const list = grouped.get(row.food_id);
                if (list) list.push(row.alias);
                else grouped.set(row.food_id, [row.alias]);
            }
            return grouped;
        },
        async setAlias(householdId, alias, foodId) {
            const { error } = await getSupabase().from("food_aliases").upsert(
                {
                    household_id: householdId,
                    alias,
                    food_id: foodId,
                },
                { onConflict: "household_id,alias" },
            );
            if (error) {
                throw new Error(`Failed to save alias: ${error.message}`);
            }
        },
        async deleteAlias(householdId, alias) {
            const { error } = await getSupabase()
                .from("food_aliases")
                .delete()
                .eq("household_id", householdId)
                .eq("alias", alias);
            if (error) {
                throw new Error(`Failed to delete alias: ${error.message}`);
            }
        },
        async deleteAliasesForFood(householdId, foodId) {
            const { data, error } = await getSupabase()
                .from("food_aliases")
                .delete()
                .eq("household_id", householdId)
                .eq("food_id", foodId)
                .select("alias");
            if (error) {
                throw new Error(`Failed to move aliases: ${error.message}`);
            }
            return (data ?? []).map((row) => String(row.alias));
        },
        async searchFoods(householdId, query) {
            const listed = await store.listFoods(householdId);
            const needle = query.trim().toLowerCase();
            if (!needle) return [];
            const aliasMap = await store.listAllAliases(householdId);
            const hits = [];
            for (const food of listed) {
                const aliases = aliasMap.get(food.id) ?? [];
                const hay = [
                    food.name,
                    food.normalizedName,
                    food.brand ?? "",
                    ...aliases,
                ]
                    .join(" ")
                    .toLowerCase();
                if (hay.includes(needle)) hits.push(food);
            }
            return hits;
        },
        async repointFoodRefs(householdId, fromId, toId) {
            const sb = getSupabase();
            for (const table of [
                "fridge_items",
                "grocery_lines",
                "recipe_ingredients",
                "member_dislikes",
            ] as const) {
                const { error } = await sb
                    .from(table)
                    .update({ food_id: toId })
                    .eq("household_id", householdId)
                    .eq("food_id", fromId);
                if (error) {
                    throw new Error(
                        `Failed to repoint ${table}: ${error.message}`,
                    );
                }
            }
        },
    };
    return store;
}
