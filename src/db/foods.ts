import {
    foodFromRow,
    foodToRow,
    mergeFoods,
    mergeFoodPair,
    offQualityToRowFields,
    type MergeFoodPairInput,
    type Food,
    type FoodOffNutritionPatch,
    type FoodQuality,
    type FoodsStore,
} from "../domain/foods.js";
import { cleanupDismissalsForFoodTx } from "./notice-dismissals.js";
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

const FOODS = "foods";
/** Mirrors `basisAdoptable` in the domain: the row's per-100 values are OFF's or absent. */
const BASIS_ADOPTABLE = `(nutrition_source = 'openfoodfacts' or (
    saturated_fat_g is null and calories is null and protein_g is null
    and carbs_g is null and fat_g is null and fiber_g is null
    and sugar_g is null and alcohol_g is null))`;
const HOUSEHOLDS = "households";
const FOOD_BARCODES = "food_barcodes";
const FOOD_ALIASES = "food_aliases";
const FOOD_COLS =
    "id, household_id, kind, name, normalized_name, brand, default_unit, grams_per_each, grams_per_ml, serving_label, serving_amount, serving_unit, nutrition_basis, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, saturated_fat_g, alcohol_g, caffeine_mg, nutrition_source, off_nutrient_levels, allergens, off_source_id, generic_food_id, usual_product_id, usual_store_id, usual_amount, usual_unit, restock_schedule, restock_every_weeks, restock_paused, restock_when_low, restock_low_level, last_restocked_on::text as last_restocked_on, nutriscore_grade, nova_group, ecoscore_grade, additives_tags, allergens_tags, traces_tags, ingredients_analysis_tags, labels_tags, off_quality_fetched_at, created_by, archived_at, created_at, updated_at";

const REF_TABLES = [
    "fridge_items",
    "grocery_lines",
    "recipe_ingredients",
    "member_dislikes",
    "stock_movements",
    "meal_items",
] as const;

function patchKeys(keys: string[]): [string, ...string[]] {
    return keys as [string, ...string[]];
}

function bindTextArray(
    tx: Tx,
    value: string[] | null | undefined,
): string[] | unknown {
    if (value == null) return null;
    return tx.array(value, "text");
}

function foodRowForWrite(
    tx: Tx,
    row: ReturnType<typeof foodToRow>,
): Record<string, unknown> {
    const levels = row.off_nutrient_levels;
    return {
        ...row,
        allergens: tx.array(
            Array.isArray(row.allergens) ? row.allergens : [],
            "text",
        ),
        off_nutrient_levels: levels == null ? null : JSON.stringify(levels),
        additives_tags: bindTextArray(tx, row.additives_tags),
        allergens_tags: bindTextArray(tx, row.allergens_tags),
        traces_tags: bindTextArray(tx, row.traces_tags),
        ingredients_analysis_tags: bindTextArray(
            tx,
            row.ingredients_analysis_tags,
        ),
        labels_tags: bindTextArray(tx, row.labels_tags),
    };
}

async function listAllAliasesInTx(
    tx: Tx,
    householdId: string,
): Promise<Map<string, string[]>> {
    const [countRow] = await rows<{ count: number }>(
        tx,
        tx`
            select count(*)::int as count
            from ${tx.unsafe(FOOD_ALIASES)}
            where household_id = ${householdId}
        `,
    );
    const expected = countRow?.count ?? 0;
    const grouped = new Map<string, string[]>();
    if (expected === 0) return grouped;

    const pageSize = 1000;
    const aliasRows: { food_id: string; alias: string }[] = [];
    for (let from = 0; ; from += pageSize) {
        const limit = pageSize;
        const page = await rows<{ food_id: string; alias: string }>(
            tx,
            tx`
                select food_id, alias
                from ${tx.unsafe(FOOD_ALIASES)}
                where household_id = ${householdId}
                order by food_id asc, alias asc
                offset ${from}
                limit ${limit}
            `,
        );
        for (const row of page) {
            aliasRows.push({
                food_id: String(row.food_id),
                alias: String(row.alias),
            });
        }
        if (page.length < pageSize) break;
    }
    if (aliasRows.length < expected) {
        throw new Error(
            `listAllAliases: fetched ${aliasRows.length} aliases but count reported ${expected}`,
        );
    }
    for (const row of aliasRows) {
        const list = grouped.get(row.food_id);
        if (list) list.push(row.alias);
        else grouped.set(row.food_id, [row.alias]);
    }
    return grouped;
}

export function liveFoodsStore(): FoodsStore {
    const store: FoodsStore = {
        async listFoods(householdId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(FOOD_COLS)}
                            from ${tx.unsafe(FOODS)}
                            where household_id = ${householdId}
                              and archived_at is null
                            order by name asc
                        `,
                    );
                    return data.map((row) => foodFromRow(row as never));
                } catch (err) {
                    throw pgError("list foods", err);
                }
            });
        },
        async getFood(householdId, id) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            select ${tx.unsafe(FOOD_COLS)}
                            from ${tx.unsafe(FOODS)}
                            where household_id = ${householdId}
                              and id = ${id}
                        `,
                        "load food",
                    );
                    return data ? foodFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("load food", err);
                }
            });
        },
        async getFoodsByIds(householdId, ids) {
            const unique = [...new Set(ids)];
            if (unique.length === 0) return new Map();
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(FOOD_COLS)}
                            from ${tx.unsafe(FOODS)}
                            where household_id = ${householdId}
                              and id = any(${tx.array(unique, "uuid")})
                        `,
                    );
                    const out = new Map<string, Food>();
                    for (const row of data) {
                        const food = foodFromRow(row as never);
                        out.set(food.id, food);
                    }
                    return out;
                } catch (err) {
                    throw pgError("load foods by ids", err);
                }
            });
        },
        async insertFood(row) {
            return run(async (tx) => {
                const data = await insertReturning<Record<string, unknown>>(
                    tx,
                    FOODS,
                    foodRowForWrite(tx, foodToRow(row)),
                    FOOD_COLS,
                    "add food",
                );
                return foodFromRow(data as never);
            });
        },
        async updateFoodRow(row) {
            return run(async (tx) => {
                try {
                    const prior = await maybeOne<{ archived_at: unknown }>(
                        tx,
                        tx`
                            select archived_at
                            from ${tx.unsafe(FOODS)}
                            where id = ${row.id}
                              and household_id = ${row.householdId}
                        `,
                        "read food archive state",
                    );
                    const { row: patch, keys } = definedColumns(
                        foodRowForWrite(tx, foodToRow(row)),
                    );
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            update ${tx.unsafe(FOODS)} set ${tx(patch, ...patchKeys(keys))}
                            where id = ${row.id}
                              and household_id = ${row.householdId}
                            returning ${tx.unsafe(FOOD_COLS)}
                        `,
                        "update food",
                    );
                    const archiving =
                        prior?.archived_at == null &&
                        row.archivedAt != null &&
                        data != null;
                    if (archiving) {
                        await cleanupDismissalsForFoodTx(
                            tx,
                            row.householdId,
                            row.id,
                        );
                    }
                    return data ? foodFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("update food", err);
                }
            });
        },
        async setFoodQuality(householdId, foodId, quality: FoodQuality, opts) {
            const onlyIfUnset = opts?.onlyIfUnset === true;
            return run(async (tx) => {
                try {
                    const fields = offQualityToRowFields(quality);
                    const fetchedAt = quality.fetchedAt;
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            update ${tx.unsafe(FOODS)}
                            set nutriscore_grade = ${fields.nutriscore_grade},
                                nova_group = ${fields.nova_group},
                                ecoscore_grade = ${fields.ecoscore_grade},
                                additives_tags = ${bindTextArray(
                                    tx,
                                    fields.additives_tags,
                                )},
                                allergens_tags = ${bindTextArray(
                                    tx,
                                    fields.allergens_tags,
                                )},
                                traces_tags = ${bindTextArray(
                                    tx,
                                    fields.traces_tags,
                                )},
                                ingredients_analysis_tags = ${bindTextArray(
                                    tx,
                                    fields.ingredients_analysis_tags,
                                )},
                                labels_tags = ${bindTextArray(
                                    tx,
                                    fields.labels_tags,
                                )},
                                off_quality_fetched_at = ${fetchedAt}::timestamptz,
                                updated_at = now()
                            where household_id = ${householdId}
                              and id = ${foodId}
                              and archived_at is null
                              and (
                                  off_quality_fetched_at is null
                                  or (
                                      not ${onlyIfUnset}::boolean
                                      and off_quality_fetched_at < ${fetchedAt}::timestamptz
                                  )
                              )
                            returning ${tx.unsafe(FOOD_COLS)}
                        `,
                        "set food quality",
                    );
                    return data ? foodFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("set food quality", err);
                }
            });
        },
        async setFoodOffNutrition(
            householdId,
            foodId,
            patch: FoodOffNutritionPatch,
        ) {
            const nonNegative = (value: number | undefined): number | null =>
                value != null && value >= 0 ? value : null;
            const sat = nonNegative(patch.saturatedFatG);
            const cal = nonNegative(patch.calories);
            const protein = nonNegative(patch.proteinG);
            const carbs = nonNegative(patch.carbsG);
            const fat = nonNegative(patch.fatG);
            const fiber = nonNegative(patch.fiberG);
            const sugar = nonNegative(patch.sugarG);
            const alcohol = nonNegative(patch.alcoholG);
            const serving = patch.serving ?? null;
            const basis = patch.nutritionBasis ?? null;
            const hasLevels = patch.offNutrientLevels != null;
            if (
                sat == null &&
                cal == null &&
                protein == null &&
                carbs == null &&
                fat == null &&
                fiber == null &&
                sugar == null &&
                alcohol == null &&
                serving == null &&
                basis == null &&
                !hasLevels
            ) {
                return null;
            }
            const levelsJson = hasLevels
                ? JSON.stringify(patch.offNutrientLevels)
                : null;
            const servingLabel = serving?.label ?? null;
            const servingAmount = serving?.amount ?? null;
            const servingUnit = serving?.unit ?? null;
            return run(async (tx) => {
                try {
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            update ${tx.unsafe(FOODS)}
                            set saturated_fat_g = coalesce(saturated_fat_g, ${sat}::numeric),
                                calories = coalesce(calories, ${cal}::numeric),
                                protein_g = coalesce(protein_g, ${protein}::numeric),
                                carbs_g = coalesce(carbs_g, ${carbs}::numeric),
                                fat_g = coalesce(fat_g, ${fat}::numeric),
                                fiber_g = coalesce(fiber_g, ${fiber}::numeric),
                                sugar_g = coalesce(sugar_g, ${sugar}::numeric),
                                alcohol_g = coalesce(alcohol_g, ${alcohol}::numeric),
                                nutrition_basis = case when nutrition_basis is null and ${tx.unsafe(BASIS_ADOPTABLE)} then ${basis}::text else nutrition_basis end,
                                serving_label = case when serving_amount is null then ${servingLabel}::text else serving_label end,
                                serving_unit = case when serving_amount is null then ${servingUnit}::text else serving_unit end,
                                serving_amount = coalesce(serving_amount, ${servingAmount}::numeric),
                                off_nutrient_levels = coalesce(${levelsJson}::jsonb, off_nutrient_levels),
                                updated_at = now()
                            where household_id = ${householdId}
                              and id = ${foodId}
                              and archived_at is null
                              and (
                                  (${sat}::numeric is not null and saturated_fat_g is null)
                                  or (${cal}::numeric is not null and calories is null)
                                  or (${protein}::numeric is not null and protein_g is null)
                                  or (${carbs}::numeric is not null and carbs_g is null)
                                  or (${fat}::numeric is not null and fat_g is null)
                                  or (${fiber}::numeric is not null and fiber_g is null)
                                  or (${sugar}::numeric is not null and sugar_g is null)
                                  or (${alcohol}::numeric is not null and alcohol_g is null)
                                  or (${basis}::text is not null and nutrition_basis is null and ${tx.unsafe(BASIS_ADOPTABLE)})
                                  or (${servingAmount}::numeric is not null and serving_amount is null)
                                  or ${levelsJson}::jsonb is not null
                              )
                            returning ${tx.unsafe(FOOD_COLS)}
                        `,
                        "set food off nutrition",
                    );
                    return data ? foodFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("set food off nutrition", err);
                }
            });
        },
        async pluralsSameFood(householdId) {
            // The same column `getPluralsSameFood` in ./household.ts reads,
            // queried here so this module does not import that one (several
            // route tests replace it with a mock that lacks the export).
            return run(async (tx) => {
                try {
                    const data = await maybeOne<{ plurals_same_food: unknown }>(
                        tx,
                        tx`
                            select plurals_same_food
                            from ${tx.unsafe(HOUSEHOLDS)}
                            where id = ${householdId}
                        `,
                        "load plurals_same_food",
                    );
                    return data?.plurals_same_food === true;
                } catch (err) {
                    throw pgError("load plurals_same_food", err);
                }
            });
        },
        async getByNormalizedName(householdId, kind, normalizedName) {
            return run(async (tx) => {
                try {
                    const data = await rows<Record<string, unknown>>(
                        tx,
                        tx`
                            select ${tx.unsafe(FOOD_COLS)}
                            from ${tx.unsafe(FOODS)}
                            where household_id = ${householdId}
                              and kind = ${kind}
                              and normalized_name = ${normalizedName}
                              and archived_at is null
                            order by (brand is null) desc, created_at asc, id asc
                            limit 1
                        `,
                    );
                    const row = data[0];
                    return row ? foodFromRow(row as never) : null;
                } catch (err) {
                    throw pgError("match food name", err);
                }
            });
        },
        async getByOffSourceId(householdId, offSourceId) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            select ${tx.unsafe(FOOD_COLS)}
                            from ${tx.unsafe(FOODS)}
                            where household_id = ${householdId}
                              and off_source_id = ${offSourceId}
                              and archived_at is null
                        `,
                        "match food source",
                    );
                    return data ? foodFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("match food source", err);
                }
            });
        },
        async getBarcodeFoodId(householdId, barcode) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<{ food_id: unknown }>(
                        tx,
                        tx`
                            select food_id
                            from ${tx.unsafe(FOOD_BARCODES)}
                            where household_id = ${householdId}
                              and barcode = ${barcode}
                        `,
                        "match barcode",
                    );
                    return data ? String(data.food_id) : null;
                } catch (err) {
                    throw pgError("match barcode", err);
                }
            });
        },
        async listBarcodes(householdId, foodId) {
            return run(async (tx) => {
                try {
                    const data = await rows<{ barcode: unknown }>(
                        tx,
                        tx`
                            select barcode
                            from ${tx.unsafe(FOOD_BARCODES)}
                            where household_id = ${householdId}
                              and food_id = ${foodId}
                        `,
                    );
                    return data.map((row) => String(row.barcode));
                } catch (err) {
                    throw pgError("list barcodes", err);
                }
            });
        },
        async listBarcodesForFoods(householdId, foodIds) {
            const ids = [...new Set(foodIds)];
            if (ids.length === 0) return new Map();
            return run(async (tx) => {
                try {
                    const data = await rows<{
                        food_id: unknown;
                        barcode: unknown;
                    }>(
                        tx,
                        tx`
                            select food_id, barcode
                            from ${tx.unsafe(FOOD_BARCODES)}
                            where household_id = ${householdId}
                              and food_id = any(${tx.array(ids, "uuid")})
                        `,
                    );
                    const grouped = new Map<string, string[]>();
                    for (const row of data) {
                        const foodId = String(row.food_id);
                        const barcode = String(row.barcode);
                        const list = grouped.get(foodId);
                        if (list) list.push(barcode);
                        else grouped.set(foodId, [barcode]);
                    }
                    return grouped;
                } catch (err) {
                    throw pgError("list barcodes for foods", err);
                }
            });
        },
        async getBarcodeFoodIds(householdId, barcodesIn) {
            const barcodes = [...new Set(barcodesIn)];
            if (barcodes.length === 0) return new Map();
            return run(async (tx) => {
                try {
                    const data = await rows<{
                        barcode: unknown;
                        food_id: unknown;
                    }>(
                        tx,
                        tx`
                            select barcode, food_id
                            from ${tx.unsafe(FOOD_BARCODES)}
                            where household_id = ${householdId}
                              and barcode = any(${tx.array(barcodes, "text")})
                        `,
                    );
                    const out = new Map<string, string>();
                    for (const row of data) {
                        const barcode = String(row.barcode);
                        if (!out.has(barcode)) {
                            out.set(barcode, String(row.food_id));
                        }
                    }
                    return out;
                } catch (err) {
                    throw pgError("match barcodes", err);
                }
            });
        },
        async setBarcode(householdId, barcode, foodId) {
            return run(async (tx) => {
                try {
                    await tx`
                        insert into ${tx.unsafe(FOOD_BARCODES)} (
                            household_id,
                            barcode,
                            food_id
                        )
                        values (${householdId}, ${barcode}, ${foodId})
                        on conflict (household_id, barcode) do update set
                            food_id = excluded.food_id
                    `;
                } catch (err) {
                    throw pgError("save barcode", err);
                }
            });
        },
        async deleteBarcodesForFood(householdId, foodId) {
            return run(async (tx) => {
                try {
                    const data = await rows<{ barcode: unknown }>(
                        tx,
                        tx`
                            delete from ${tx.unsafe(FOOD_BARCODES)}
                            where household_id = ${householdId}
                              and food_id = ${foodId}
                            returning barcode
                        `,
                    );
                    return data.map((row) => String(row.barcode));
                } catch (err) {
                    throw pgError("move barcodes", err);
                }
            });
        },
        async getAliasFoodId(householdId, alias) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<{ food_id: unknown }>(
                        tx,
                        tx`
                            select food_id
                            from ${tx.unsafe(FOOD_ALIASES)}
                            where household_id = ${householdId}
                              and alias = ${alias}
                        `,
                        "match alias",
                    );
                    return data ? String(data.food_id) : null;
                } catch (err) {
                    throw pgError("match alias", err);
                }
            });
        },
        async listAliases(householdId, foodId) {
            return run(async (tx) => {
                try {
                    const data = await rows<{ alias: unknown }>(
                        tx,
                        tx`
                            select alias
                            from ${tx.unsafe(FOOD_ALIASES)}
                            where household_id = ${householdId}
                              and food_id = ${foodId}
                            order by alias asc
                        `,
                    );
                    return data.map((row) => String(row.alias));
                } catch (err) {
                    throw pgError("list aliases", err);
                }
            });
        },
        async listAllAliases(householdId) {
            return run(async (tx) => {
                try {
                    return await listAllAliasesInTx(tx, householdId);
                } catch (err) {
                    if (
                        err instanceof Error &&
                        err.message.startsWith("listAllAliases:")
                    ) {
                        throw err;
                    }
                    throw pgError("list aliases", err);
                }
            });
        },
        async setAlias(householdId, alias, foodId) {
            return run(async (tx) => {
                try {
                    await tx`
                        insert into ${tx.unsafe(FOOD_ALIASES)} (
                            household_id,
                            alias,
                            food_id
                        )
                        values (${householdId}, ${alias}, ${foodId})
                        on conflict (household_id, alias) do update set
                            food_id = excluded.food_id
                    `;
                } catch (err) {
                    throw pgError("save alias", err);
                }
            });
        },
        async deleteAlias(householdId, alias) {
            return run(async (tx) => {
                try {
                    await tx`
                        delete from ${tx.unsafe(FOOD_ALIASES)}
                        where household_id = ${householdId}
                          and alias = ${alias}
                    `;
                } catch (err) {
                    throw pgError("delete alias", err);
                }
            });
        },
        async deleteAliasesForFood(householdId, foodId) {
            return run(async (tx) => {
                try {
                    const data = await rows<{ alias: unknown }>(
                        tx,
                        tx`
                            delete from ${tx.unsafe(FOOD_ALIASES)}
                            where household_id = ${householdId}
                              and food_id = ${foodId}
                            returning alias
                        `,
                    );
                    return data.map((row) => String(row.alias));
                } catch (err) {
                    throw pgError("move aliases", err);
                }
            });
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
        async listBarcodedFoodIds(householdId) {
            return run(async (tx) => {
                try {
                    const data = await rows<{ food_id: unknown }>(
                        tx,
                        tx`
                            select distinct food_id
                            from ${tx.unsafe(FOOD_BARCODES)}
                            where household_id = ${householdId}
                        `,
                    );
                    return new Set(data.map((row) => String(row.food_id)));
                } catch (err) {
                    throw pgError("list barcoded food ids", err);
                }
            });
        },
        async repointFoodRefs(householdId, fromId, toId) {
            return run(async (tx) => {
                for (const table of REF_TABLES) {
                    try {
                        await tx`
                            update ${tx.unsafe(table)}
                            set food_id = ${toId}
                            where household_id = ${householdId}
                              and food_id = ${fromId}
                        `;
                    } catch (err) {
                        throw pgError(`repoint ${table}`, err);
                    }
                }
            });
        },
        async countFoodRefs(householdId) {
            return run(async (tx) => {
                try {
                    const data = await rows<{ food_id: string; count: number }>(
                        tx,
                        tx`
                            select food_id::text, count(*)::int as count
                            from (
                                select food_id from ${tx.unsafe("fridge_items")}
                                where household_id = ${householdId}
                                union all
                                select food_id from ${tx.unsafe("grocery_lines")}
                                where household_id = ${householdId}
                                union all
                                select food_id from ${tx.unsafe("recipe_ingredients")}
                                where household_id = ${householdId}
                                union all
                                select food_id from ${tx.unsafe("meal_items")}
                                where household_id = ${householdId}
                                union all
                                select food_id from ${tx.unsafe("stock_movements")}
                                where household_id = ${householdId}
                            ) r
                            where food_id is not null
                            group by food_id
                        `,
                    );
                    const map = new Map<string, number>();
                    for (const row of data) {
                        map.set(row.food_id, row.count);
                    }
                    return map;
                } catch (err) {
                    throw pgError("count food references", err);
                }
            });
        },
    };
    return store;
}

/**
 * `mergeFoods` against Postgres as one transaction. The merge is a series of
 * store calls (barcodes, aliases, references, the kept row, products, then
 * archiving the dropped row); each opens its own `run`, which joins this
 * outer one, so a failure at any step rolls the whole merge back instead of
 * leaving barcodes deleted or references moved onto a food whose duplicate
 * is still live. `store` is only overridden by tests.
 */
export function mergeLiveFoods(
    householdId: string,
    keepId: string,
    dropId: string,
    store: FoodsStore = liveFoodsStore(),
): Promise<Food> {
    return run(() => mergeFoods(store, householdId, keepId, dropId));
}

export function mergeLiveFoodPair(
    householdId: string,
    input: MergeFoodPairInput,
    store: FoodsStore = liveFoodsStore(),
): Promise<Food> {
    return run(() => mergeFoodPair(store, householdId, input));
}
