import {
    foodFromRow,
    foodToRow,
    mergeFoods,
    type Food,
    type FoodsStore,
} from "../domain/foods.js";
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
const FOOD_BARCODES = "food_barcodes";
const FOOD_ALIASES = "food_aliases";
const FOOD_COLS =
    "id, household_id, kind, name, normalized_name, brand, default_unit, grams_per_each, grams_per_ml, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, alcohol_g, caffeine_mg, nutrition_source, allergens, off_source_id, generic_food_id, usual_product_id, usual_store_id, usual_amount, usual_unit, created_by, archived_at, created_at, updated_at";

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

function foodRowForWrite(
    tx: Tx,
    row: ReturnType<typeof foodToRow>,
): Record<string, unknown> {
    return {
        ...row,
        allergens: tx.array(
            Array.isArray(row.allergens) ? row.allergens : [],
            "text",
        ),
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
                    return data ? foodFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("update food", err);
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
