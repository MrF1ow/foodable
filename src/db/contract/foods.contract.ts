import { describe, expect, test } from "bun:test";
import { removeUsuals } from "../../domain/bulk.js";
import {
    addUsualByHand,
    addUsualFromProduct,
    removeUsual,
} from "../../domain/usual-add.js";
import {
    linkProduct,
    markUsualRestocked,
    mergeFoods,
    NO_USUAL_SCHEDULE,
    removeProduct,
    setUsualPurchase,
    setUsualSchedule,
    updateFood,
    usualProductRows,
    type Food,
    type FoodsStore,
    type MemoryFoodsStore,
    type UsualScheduleFields,
} from "../../domain/foods.js";
import { sampleFood, type StoreContractCtx } from "./helpers.js";
import {
    seedFridgeLocation,
    seedGrocerySection,
    seedGroceryStore,
} from "../testing/fixtures.js";

// A row elsewhere that names `foodId` (a dislike on the live side, the memory
// store's own ref list otherwise); returns a reader for its current food_id.
async function trackFoodRef(
    store: FoodsStore,
    c: StoreContractCtx,
    foodId: string,
): Promise<() => Promise<string | null>> {
    if ("trackRef" in store) {
        const row = (store as MemoryFoodsStore).trackRef(foodId);
        return async () => row.foodId;
    }
    const sql = c.sql;
    if (!sql) throw new Error("live foods contract needs ctx.sql");
    const id = crypto.randomUUID();
    await sql`
        insert into public.member_dislikes (id, household_id, user_id, display_name, food_id)
        values (${id}, ${c.householdId}, ${c.userId}, 'ref', ${foodId})
    `;
    return async () => {
        const [row] = await sql`
            select food_id from public.member_dislikes where id = ${id}
        `;
        return row?.food_id ?? null;
    };
}

type MealItemSnap = {
    foodId: string | null;
    calories: number | null;
    proteinG: number | null;
    grams: number | null;
};

async function trackStockMovementFoodRef(
    store: FoodsStore,
    c: StoreContractCtx,
    foodId: string,
    householdId: string,
): Promise<() => Promise<string | null>> {
    if ("trackRef" in store) {
        const row = (store as MemoryFoodsStore).trackRef(foodId, householdId);
        return async () => row.foodId;
    }
    const sql = c.sql;
    if (!sql) throw new Error("live foods contract needs ctx.sql");
    const id = crypto.randomUUID();
    await sql`
        insert into public.stock_movements (
            id,
            household_id,
            food_id,
            delta,
            unit,
            reason
        )
        values (${id}, ${householdId}, ${foodId}, ${100}, ${"g"}, ${"adjust"})
    `;
    return async () => {
        const [row] = await sql`
            select food_id::text as food_id from public.stock_movements where id = ${id}
        `;
        return row?.food_id ?? null;
    };
}

async function trackMealItemFoodRef(
    store: FoodsStore,
    c: StoreContractCtx,
    foodId: string,
    householdId: string,
    userId: string,
): Promise<() => Promise<MealItemSnap>> {
    if ("trackRef" in store) {
        const row = (store as MemoryFoodsStore).trackRef(foodId, householdId, {
            calories: 123,
            proteinG: 4.5,
            grams: 80,
        });
        return async () => ({
            foodId: row.foodId,
            calories: row.calories as number,
            proteinG: row.proteinG as number,
            grams: row.grams as number,
        });
    }
    const sql = c.sql;
    if (!sql) throw new Error("live foods contract needs ctx.sql");
    const mealId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    await sql`
        insert into public.meals (
            id,
            user_id,
            description,
            meal_type,
            logged_at,
            idempotency_key
        )
        values (
            ${mealId},
            ${userId},
            ${"contract meal"},
            ${"lunch"},
            now(),
            ${`contract:${itemId}`}
        )
    `;
    await sql`
        insert into public.meal_items (
            id,
            meal_id,
            user_id,
            household_id,
            food_id,
            label,
            calories,
            protein_g,
            grams
        )
        values (
            ${itemId},
            ${mealId},
            ${userId},
            ${householdId},
            ${foodId},
            ${"snap"},
            ${123},
            ${4.5},
            ${80}
        )
    `;
    return async () => {
        const [row] = await sql`
            select
                food_id::text as food_id,
                calories,
                protein_g,
                grams
            from public.meal_items
            where id = ${itemId}
        `;
        return {
            foodId: row?.food_id ?? null,
            calories: row?.calories != null ? Number(row.calories) : null,
            proteinG: row?.protein_g != null ? Number(row.protein_g) : null,
            grams: row?.grams != null ? Number(row.grams) : null,
        };
    };
}

async function trackFridgeItemFoodRef(
    store: FoodsStore,
    c: StoreContractCtx,
    foodId: string,
    householdId: string,
): Promise<() => Promise<string | null>> {
    if ("trackRef" in store) {
        const row = (store as MemoryFoodsStore).trackRef(foodId, householdId);
        return async () => row.foodId;
    }
    const sql = c.sql;
    if (!sql) throw new Error("live foods contract needs ctx.sql");
    const locTag = crypto.randomUUID().slice(0, 8);
    const locId = await seedFridgeLocation(
        sql,
        householdId,
        `Contract loc ${locTag}`,
    );
    const [inserted] = await sql`
        insert into public.fridge_items (
            household_id,
            location_id,
            kind,
            display_name,
            amount,
            unit,
            food_id
        )
        values (
            ${householdId},
            ${locId},
            ${"food"},
            ${"Contract item"},
            ${1},
            ${"g"},
            ${foodId}
        )
        returning id
    `;
    const id = String(inserted.id);
    return async () => {
        const [row] = await sql`
            select food_id::text as food_id from public.fridge_items where id = ${id}
        `;
        return row?.food_id ?? null;
    };
}

async function trackGroceryLineFoodRef(
    store: FoodsStore,
    c: StoreContractCtx,
    foodId: string,
    householdId: string,
): Promise<() => Promise<string | null>> {
    if ("trackRef" in store) {
        const row = (store as MemoryFoodsStore).trackRef(foodId, householdId);
        return async () => row.foodId;
    }
    const sql = c.sql;
    if (!sql) throw new Error("live foods contract needs ctx.sql");
    const tag = crypto.randomUUID().slice(0, 8);
    const storeId = await seedGroceryStore(
        sql,
        householdId,
        `Contract store ${tag}`,
    );
    const sectionId = await seedGrocerySection(
        sql,
        householdId,
        storeId,
        `Contract section ${tag}`,
    );
    const id = crypto.randomUUID();
    await sql`
        insert into public.grocery_lines (
            id,
            household_id,
            store_id,
            section_id,
            kind,
            display_name,
            amount,
            unit,
            food_id
        )
        values (
            ${id},
            ${householdId},
            ${storeId},
            ${sectionId},
            ${"food"},
            ${"Line"},
            ${1},
            ${"g"},
            ${foodId}
        )
    `;
    return async () => {
        const [row] = await sql`
            select food_id::text as food_id from public.grocery_lines where id = ${id}
        `;
        return row?.food_id ?? null;
    };
}

async function trackRecipeIngredientFoodRef(
    store: FoodsStore,
    c: StoreContractCtx,
    foodId: string,
    householdId: string,
    userId: string,
): Promise<() => Promise<string | null>> {
    if ("trackRef" in store) {
        const row = (store as MemoryFoodsStore).trackRef(foodId, householdId);
        return async () => row.foodId;
    }
    const sql = c.sql;
    if (!sql) throw new Error("live foods contract needs ctx.sql");
    const recipeId = crypto.randomUUID();
    await sql`
        insert into public.recipes (
            id,
            household_id,
            creator_id,
            name,
            yield_portions
        )
        values (${recipeId}, ${householdId}, ${userId}, ${"Contract recipe"}, ${2})
    `;
    const id = crypto.randomUUID();
    await sql`
        insert into public.recipe_ingredients (
            id,
            household_id,
            recipe_id,
            kind,
            display_name,
            amount,
            unit,
            food_id,
            sort_order
        )
        values (
            ${id},
            ${householdId},
            ${recipeId},
            ${"food"},
            ${"Ingredient"},
            ${100},
            ${"g"},
            ${foodId},
            ${0}
        )
    `;
    return async () => {
        const [row] = await sql`
            select food_id::text as food_id
            from public.recipe_ingredients
            where id = ${id}
        `;
        return row?.food_id ?? null;
    };
}

export function runFoodsStoreContract(
    label: string,
    createStore: () => FoodsStore,
    reset: () => Promise<void>,
    ctx: () => StoreContractCtx,
): void {
    describe(`${label} foods store`, () => {
        test("listFoods, getFood, insertFood, updateFoodRow", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const zebra = sampleFood(c.householdId, {
                name: "Zebra fruit",
                normalizedName: "zebra",
            });
            const apple = sampleFood(c.householdId, {
                name: "Apple",
                normalizedName: "apple",
            });
            await store.insertFood(zebra);
            await store.insertFood(apple);
            const listed = (await store.listFoods(c.householdId)).filter(
                (f) => f.id === apple.id || f.id === zebra.id,
            );
            expect(listed.map((f) => f.name)).toEqual(["Apple", "Zebra fruit"]);

            expect((await store.getFood(c.householdId, apple.id))?.name).toBe(
                "Apple",
            );
            expect(
                await store.getFood(c.householdId, crypto.randomUUID()),
            ).toBeNull();

            const updated = await store.updateFoodRow({
                ...apple,
                brand: "Orchard",
                gramsPerEach: 55.5,
                allergens: ["peanut"],
            });
            expect(updated?.brand).toBe("Orchard");
            expect(updated?.gramsPerEach).toBe(55.5);
            expect(updated?.allergens).toEqual(["peanut"]);
            expect(
                await store.updateFoodRow({
                    ...apple,
                    id: crypto.randomUUID(),
                }),
            ).toBeNull();
        });

        test("getByNormalizedName and getByOffSourceId", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const food = sampleFood(c.householdId, {
                offSourceId: "off:123",
            });
            await store.insertFood(food);
            expect(
                await store.getByNormalizedName(
                    c.householdId,
                    "food",
                    food.normalizedName,
                ),
            ).not.toBeNull();
            expect(
                await store.getByNormalizedName(
                    c.otherHouseholdId,
                    "food",
                    food.normalizedName,
                ),
            ).toBeNull();
            expect(
                await store.getByOffSourceId(c.householdId, "off:123"),
            ).not.toBeNull();
            expect(await store.getByOffSourceId(c.householdId, "missing")).toBe(
                null,
            );
        });

        test("getByNormalizedName prefers unbranded then oldest", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const normalized = "duck eggs";
            const brandedFirst = sampleFood(c.householdId, {
                name: "Duck eggs",
                normalizedName: normalized,
                brand: "Farm A",
                createdAt: "2020-01-01T00:00:00.000Z",
                updatedAt: "2020-01-01T00:00:00.000Z",
            });
            const plain = sampleFood(c.householdId, {
                name: "Duck eggs",
                normalizedName: normalized,
                brand: null,
                createdAt: "2021-01-01T00:00:00.000Z",
                updatedAt: "2021-01-01T00:00:00.000Z",
            });
            await store.insertFood(brandedFirst);
            await store.insertFood(plain);
            const picked = await store.getByNormalizedName(
                c.householdId,
                "food",
                normalized,
            );
            expect(picked?.id).toBe(plain.id);
            expect(picked?.brand).toBeNull();

            await store.updateFoodRow({
                ...plain,
                archivedAt: new Date().toISOString(),
            });
            const brandedSecond = sampleFood(c.householdId, {
                name: "Duck eggs",
                normalizedName: normalized,
                brand: "Farm B",
                createdAt: "2022-01-01T00:00:00.000Z",
                updatedAt: "2022-01-01T00:00:00.000Z",
            });
            await store.insertFood(brandedSecond);
            const oldestBranded = await store.getByNormalizedName(
                c.householdId,
                "food",
                normalized,
            );
            expect(oldestBranded?.id).toBe(brandedFirst.id);
        });

        test("barcode upsert retargets food_id only", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const a = sampleFood(c.householdId, {
                name: "Barcode A",
                normalizedName: "barcode-a",
            });
            const b = sampleFood(c.householdId, {
                name: "Barcode B",
                normalizedName: "barcode-b",
            });
            await store.insertFood(a);
            await store.insertFood(b);
            await store.setBarcode(c.householdId, "1234567890123", a.id);
            await store.setBarcode(c.householdId, "1234567890123", b.id);
            expect(
                await store.getBarcodeFoodId(c.householdId, "1234567890123"),
            ).toBe(b.id);
            expect(await store.listBarcodes(c.householdId, b.id)).toEqual([
                "1234567890123",
            ]);
            expect(
                await store.deleteBarcodesForFood(c.householdId, b.id),
            ).toEqual(["1234567890123"]);
        });

        test("listBarcodesForFoods and getBarcodeFoodIds batch paths", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const otherHousehold = c.otherHouseholdId;
            const a = sampleFood(c.householdId, {
                name: "Batch A",
                normalizedName: "batch-a",
            });
            const b = sampleFood(c.householdId, {
                name: "Batch B",
                normalizedName: "batch-b",
            });
            const bare = sampleFood(c.householdId, {
                name: "Batch bare",
                normalizedName: "batch-bare",
            });
            await store.insertFood(a);
            await store.insertFood(b);
            await store.insertFood(bare);
            await store.setBarcode(c.householdId, "bc-a1", a.id);
            await store.setBarcode(c.householdId, "bc-a2", a.id);
            await store.setBarcode(c.householdId, "bc-b1", b.id);
            expect(await store.listBarcodesForFoods(c.householdId, [])).toEqual(
                new Map(),
            );
            expect(await store.getBarcodeFoodIds(c.householdId, [])).toEqual(
                new Map(),
            );
            const unknownId = crypto.randomUUID();
            const batched = await store.listBarcodesForFoods(c.householdId, [
                a.id,
                b.id,
                bare.id,
                unknownId,
                a.id,
            ]);
            expect(batched.get(a.id)).toEqual(
                await store.listBarcodes(c.householdId, a.id),
            );
            expect(batched.get(b.id)).toEqual(
                await store.listBarcodes(c.householdId, b.id),
            );
            expect(batched.has(bare.id)).toBe(false);
            expect(batched.has(unknownId)).toBe(false);
            const byBarcode = await store.getBarcodeFoodIds(c.householdId, [
                "bc-a1",
                "bc-b1",
                "bc-missing",
                "bc-a1",
            ]);
            expect(byBarcode.get("bc-a1")).toBe(a.id);
            expect(byBarcode.get("bc-b1")).toBe(b.id);
            expect(byBarcode.has("bc-missing")).toBe(false);
            expect(
                await store.getBarcodeFoodIds(otherHousehold, ["bc-a1"]),
            ).toEqual(new Map());
            if ("trackRef" in store) {
                const foreign = sampleFood(otherHousehold, {
                    name: "Foreign",
                    normalizedName: "foreign",
                });
                await store.insertFood(foreign);
                await store.setBarcode(otherHousehold, "bc-other", foreign.id);
                expect(
                    (
                        await store.getBarcodeFoodIds(otherHousehold, [
                            "bc-other",
                        ])
                    ).get("bc-other"),
                ).toBe(foreign.id);
                expect(
                    await store.getBarcodeFoodIds(c.householdId, ["bc-other"]),
                ).toEqual(new Map());
            }
            expect(
                await store.getBarcodeFoodIds(c.householdId, ["bc-a1"]),
            ).toEqual(new Map([["bc-a1", a.id]]));
        });

        test("alias upsert, listAliases, listAllAliases, delete paths", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const a = sampleFood(c.householdId, {
                name: "Barcode A",
                normalizedName: "barcode-a",
            });
            const b = sampleFood(c.householdId, {
                name: "Barcode B",
                normalizedName: "barcode-b",
            });
            await store.insertFood(a);
            await store.insertFood(b);
            await store.setAlias(c.householdId, "fruit", a.id);
            await store.setAlias(c.householdId, "zest", a.id);
            await store.setAlias(c.householdId, "apple", a.id);
            // Inserted fruit, zest, apple: only `order by alias` gives this.
            expect(await store.listAliases(c.householdId, a.id)).toEqual([
                "apple",
                "fruit",
                "zest",
            ]);
            await store.setAlias(c.householdId, "fruit", b.id);
            expect(await store.getAliasFoodId(c.householdId, "fruit")).toBe(
                b.id,
            );
            expect(await store.listAliases(c.householdId, a.id)).toEqual([
                "apple",
                "zest",
            ]);
            expect(
                await store
                    .listAllAliases(c.householdId)
                    .then((m) => m.get(b.id)),
            ).toEqual(["fruit"]);
            await store.deleteAlias(c.householdId, "zest");
            expect(
                await store.deleteAliasesForFood(c.householdId, b.id),
            ).toEqual(["fruit"]);
        });

        test("listBarcodedFoodIds", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const a = sampleFood(c.householdId, {
                name: "Barcoded A",
                normalizedName: "barcoded a",
            });
            const b = sampleFood(c.householdId, {
                name: "Barcoded B",
                normalizedName: "barcoded b",
            });
            await store.insertFood(a);
            await store.insertFood(b);
            expect(await store.listBarcodedFoodIds(c.householdId)).toEqual(
                new Set(),
            );
            await store.setBarcode(c.householdId, "1111111111111", a.id);
            await store.setBarcode(c.householdId, "2222222222222", a.id);
            await store.setBarcode(c.householdId, "3333333333333", b.id);
            expect(await store.listBarcodedFoodIds(c.householdId)).toEqual(
                new Set([a.id, b.id]),
            );
        });

        test("searchFoods and repointFoodRefs", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const from = sampleFood(c.householdId, {
                name: "Merge me",
                normalizedName: "merge-me",
            });
            const to = sampleFood(c.householdId, {
                name: "Keep",
                normalizedName: "keep",
            });
            await store.insertFood(from);
            await store.insertFood(to);
            await store.setAlias(c.householdId, "merged", from.id);
            const hits = await store.searchFoods(c.householdId, "merge");
            expect(hits.some((f) => f.id === from.id)).toBe(true);
            // Inner whitespace is not collapsed, matching the old PostgREST code.
            expect(await store.searchFoods(c.householdId, "merge  me")).toEqual(
                [],
            );
            const refFoodId = await trackFoodRef(store, c, from.id);
            await store.repointFoodRefs(c.householdId, from.id, to.id);
            expect(await refFoodId()).toBe(to.id);
            expect(await store.getFood(c.householdId, from.id)).toBeTruthy();
        });

        test("repointFoodRefs moves stock_movements and meal_items in the household only", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const from = sampleFood(c.householdId, {
                name: "From ledger",
                normalizedName: "from-ledger",
            });
            const to = sampleFood(c.householdId, {
                name: "To ledger",
                normalizedName: "to-ledger",
            });
            const untouched = sampleFood(c.householdId, {
                name: "Other food id",
                normalizedName: "other-food-id",
            });
            await store.insertFood(from);
            await store.insertFood(to);
            await store.insertFood(untouched);

            const readPrimaryStock = await trackStockMovementFoodRef(
                store,
                c,
                from.id,
                c.householdId,
            );
            const readPrimaryMeal = await trackMealItemFoodRef(
                store,
                c,
                from.id,
                c.householdId,
                c.userId,
            );
            const readControlStock = await trackStockMovementFoodRef(
                store,
                c,
                untouched.id,
                c.householdId,
            );
            const readControlMeal = await trackMealItemFoodRef(
                store,
                c,
                untouched.id,
                c.householdId,
                c.userId,
            );

            const primaryMealBefore = await readPrimaryMeal();

            if (!c.sql) {
                const otherHouseholdRef = (store as MemoryFoodsStore).trackRef(
                    from.id,
                    c.otherHouseholdId,
                );
                await store.repointFoodRefs(c.householdId, from.id, to.id);
                expect(otherHouseholdRef.foodId).toBe(from.id);
            } else {
                await store.repointFoodRefs(c.householdId, from.id, to.id);
            }

            expect(await readPrimaryStock()).toBe(to.id);
            const primaryMealAfter = await readPrimaryMeal();
            expect(primaryMealAfter.foodId).toBe(to.id);
            expect(primaryMealAfter.calories).toBe(primaryMealBefore.calories);
            expect(primaryMealAfter.proteinG).toBe(primaryMealBefore.proteinG);
            expect(primaryMealAfter.grams).toBe(primaryMealBefore.grams);

            expect(await readControlStock()).toBe(untouched.id);
            const controlMealAfter = await readControlMeal();
            expect(controlMealAfter.foodId).toBe(untouched.id);
        });

        test("listAllAliases pages past 1000 rows", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const food = sampleFood(c.householdId);
            await store.insertFood(food);
            if (c.sql) {
                for (let i = 0; i < 1001; i++) {
                    await c.sql`
                        insert into public.food_aliases (household_id, alias, food_id)
                        values (${c.householdId}, ${`alias-${String(i).padStart(4, "0")}`}, ${food.id})
                    `;
                }
            } else {
                for (let i = 0; i < 1001; i++) {
                    await store.setAlias(
                        c.householdId,
                        `alias-${String(i).padStart(4, "0")}`,
                        food.id,
                    );
                }
            }
            const map = await store.listAllAliases(c.householdId);
            expect(map.get(food.id)?.length).toBe(1001);
        });

        test("generic_food_id and usual_product_id round trip", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const plain = sampleFood(c.householdId, {
                name: "Plain eggs",
                normalizedName: "plain-eggs",
            });
            await store.insertFood(plain);
            const product = sampleFood(c.householdId, {
                name: "Brand eggs",
                normalizedName: "brand-eggs",
                genericFoodId: plain.id,
            });
            await store.insertFood(product);
            const linkedPlain = await store.updateFoodRow({
                ...plain,
                usualProductId: product.id,
            });
            expect(linkedPlain?.usualProductId).toBe(product.id);
            expect(
                (await store.getFood(c.householdId, product.id))?.genericFoodId,
            ).toBe(plain.id);
            expect(
                (await store.listFoods(c.householdId)).find(
                    (f) => f.id === plain.id,
                )?.usualProductId,
            ).toBe(product.id);
            await store.updateFoodRow({
                ...plain,
                usualProductId: null,
            });
            await store.updateFoodRow({
                ...product,
                genericFoodId: null,
            });
            expect(
                (await store.getFood(c.householdId, plain.id))?.usualProductId,
            ).toBeNull();
            expect(
                (await store.getFood(c.householdId, product.id))?.genericFoodId,
            ).toBeNull();
        });

        test("usual_store_id, usual_amount, usual_unit round trip", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const food = sampleFood(c.householdId, {
                name: "Milk",
                normalizedName: "milk",
                usualStoreId: c.storeId,
                usualAmount: { amount: 2000, unit: "ml" },
            });
            await store.insertFood(food);
            const read = await store.getFood(c.householdId, food.id);
            expect(read?.usualStoreId).toBe(c.storeId);
            expect(read?.usualAmount).toEqual({ amount: 2000, unit: "ml" });

            const cleared = await store.updateFoodRow({
                ...read!,
                usualStoreId: null,
                usualAmount: null,
            });
            expect(cleared?.usualStoreId).toBeNull();
            expect(cleared?.usualAmount).toBeNull();

            const restored = await store.updateFoodRow({
                ...cleared!,
                usualStoreId: c.storeId,
                usualAmount: { amount: 500, unit: "ml" },
            });
            expect(restored?.usualStoreId).toBe(c.storeId);
            expect(restored?.usualAmount).toEqual({ amount: 500, unit: "ml" });
        });

        describe("usual added by scan or by hand", () => {
            const lookup = async (c: StoreContractCtx) => [{ id: c.storeId }];
            const msOf = (iso: string | null | undefined) =>
                iso == null ? null : new Date(iso).getTime();

            test("usualAddedAt starts null and round trips through insert, read, list and update", async () => {
                await reset();
                const c = ctx();
                const store = createStore();
                const plain = await store.insertFood(
                    sampleFood(c.householdId, {
                        name: "Plain",
                        normalizedName: "plain",
                    }),
                );
                expect(plain.usualAddedAt).toBeNull();
                const stamp = "2026-11-13T12:34:56.000Z";
                const saved = await store.updateFoodRow({
                    ...plain,
                    usualAddedAt: stamp,
                });
                expect(msOf(saved?.usualAddedAt)).toBe(msOf(stamp));
                expect(
                    msOf(
                        (await store.getFood(c.householdId, plain.id))
                            ?.usualAddedAt,
                    ),
                ).toBe(msOf(stamp));
                expect(
                    msOf(
                        (await store.listFoods(c.householdId)).find(
                            (f) => f.id === plain.id,
                        )?.usualAddedAt,
                    ),
                ).toBe(msOf(stamp));
                const cleared = await store.updateFoodRow({
                    ...saved!,
                    usualAddedAt: null,
                });
                expect(cleared?.usualAddedAt).toBeNull();
                const inserted = await store.insertFood(
                    sampleFood(c.householdId, {
                        name: "Stamped",
                        normalizedName: "stamped",
                        usualAddedAt: stamp,
                    }),
                );
                expect(msOf(inserted.usualAddedAt)).toBe(msOf(stamp));
            });

            test("a typed usual lists with no products and is not addable", async () => {
                await reset();
                const c = ctx();
                const store = createStore();
                const typed = await addUsualByHand(store, c.householdId, {
                    name: "Half & Half",
                    basis: "per_serving",
                    serving: { amount: 30, unit: "ml" },
                    calories: 39,
                    proteinG: 0.9,
                    carbsG: 1.2,
                    fatG: 3.3,
                    purchase: {
                        usualStoreId: c.storeId,
                        usualAmount: { amount: 1, unit: "each" },
                    },
                    stores: { listStores: () => lookup(c) },
                    createdBy: c.userId,
                });
                const read = (await store.getFood(c.householdId, typed.id))!;
                expect(read).toMatchObject({
                    nutritionBasis: "100ml",
                    calories: 130,
                    proteinG: 3,
                    carbsG: 4,
                    fatG: 11,
                    nutritionSource: "manual",
                    usualStoreId: c.storeId,
                    usualAmount: { amount: 1, unit: "each" },
                    serving: { amount: 30, unit: "ml" },
                });
                expect(read.usualAddedAt).not.toBeNull();
                const { rows, addable } = usualProductRows({
                    foods: await store.listFoods(c.householdId),
                });
                const row = rows.find((r) => r.food.id === typed.id);
                expect(row?.products).toEqual([]);
                expect(row?.usual).toBeNull();
                expect(addable.map((f) => f.id)).not.toContain(typed.id);
            });

            test("by hand reuses an equal food, fills an empty one, and refuses different macros", async () => {
                await reset();
                const c = ctx();
                const store = createStore();
                const stores = { listStores: () => lookup(c) };
                const macros = {
                    calories: 52,
                    proteinG: 0.3,
                    carbsG: 14,
                    fatG: 0.2,
                };
                const empty = await store.insertFood(
                    sampleFood(c.householdId, {
                        name: "Fuji apple",
                        normalizedName: "fuji apple",
                    }),
                );
                const filled = await addUsualByHand(store, c.householdId, {
                    name: "fuji  APPLE",
                    basis: "per_100g",
                    ...macros,
                    stores,
                });
                expect(filled.id).toBe(empty.id);
                expect(filled.calories).toBe(52);
                expect(filled.nutritionBasis).toBe("100g");
                const again = await addUsualByHand(store, c.householdId, {
                    name: "Fuji apple",
                    basis: "per_100g",
                    ...macros,
                    stores,
                });
                expect(again.id).toBe(empty.id);
                await expect(
                    addUsualByHand(store, c.householdId, {
                        name: "Fuji apple",
                        basis: "per_100g",
                        ...macros,
                        calories: 80,
                        stores,
                    }),
                ).rejects.toThrow("Fuji apple");
                expect(
                    (await store.getFood(c.householdId, empty.id))?.calories,
                ).toBe(52);
            });

            test("by hand attaches a barcode and refuses one another food holds", async () => {
                await reset();
                const c = ctx();
                const store = createStore();
                const stores = { listStores: () => lookup(c) };
                const macros = {
                    calories: 100,
                    proteinG: 1,
                    carbsG: 2,
                    fatG: 3,
                };
                const first = await addUsualByHand(store, c.householdId, {
                    name: "Scanned miss",
                    basis: "per_100g",
                    ...macros,
                    barcode: "0123456789012",
                    stores,
                });
                expect(
                    await store.listBarcodes(c.householdId, first.id),
                ).toEqual(["0123456789012"]);
                await expect(
                    addUsualByHand(store, c.householdId, {
                        name: "Another",
                        basis: "per_100g",
                        ...macros,
                        barcode: "0123456789012",
                        stores,
                    }),
                ).rejects.toThrow("Scanned miss");
                expect(
                    (await store.listFoods(c.householdId)).filter(
                        (f) => f.name === "Another",
                    ),
                ).toHaveLength(0);
            });

            test("from a product links it, makes it usual, and Remove clears the stamp", async () => {
                await reset();
                const c = ctx();
                const store = createStore();
                const stores = { listStores: () => lookup(c) };
                const product = await store.insertFood(
                    sampleFood(c.householdId, {
                        name: "Horizon Milk",
                        normalizedName: "horizon milk",
                        brand: "Horizon",
                    }),
                );
                const food = await addUsualFromProduct(store, c.householdId, {
                    productId: product.id,
                    newFoodName: "Milk",
                    purchase: { usualStoreId: c.storeId },
                    stores,
                    createdBy: c.userId,
                });
                expect(food.name).toBe("Milk");
                expect(food.usualProductId).toBe(product.id);
                expect(food.usualAddedAt).not.toBeNull();
                const linked = (await store.getFood(
                    c.householdId,
                    product.id,
                ))!;
                expect(linked.genericFoodId).toBe(food.id);
                expect(linked.usualStoreId).toBe(c.storeId);
                const again = await addUsualFromProduct(store, c.householdId, {
                    productId: product.id,
                    newFoodName: "milk",
                    stores,
                });
                expect(again.id).toBe(food.id);
                expect(
                    msOf(again.usualAddedAt)! >= msOf(food.usualAddedAt)!,
                ).toBe(true);
                await removeUsual(store, c.householdId, food.id);
                const after = (await store.getFood(c.householdId, food.id))!;
                expect(after.usualAddedAt).toBeNull();
                expect(after.usualProductId).toBeNull();
                expect(
                    (await store.getFood(c.householdId, product.id))
                        ?.genericFoodId,
                ).toBeNull();
                expect(
                    usualProductRows({
                        foods: await store.listFoods(c.householdId),
                    }).rows,
                ).toEqual([]);
            });

            test("a typed usual's own barcode re-adds it, and losing a product leaves it listed", async () => {
                await reset();
                const c = ctx();
                const store = createStore();
                const stores = { listStores: () => lookup(c) };
                const typed = await addUsualByHand(store, c.householdId, {
                    name: "Oat milk",
                    basis: "per_100ml",
                    calories: 45,
                    proteinG: 1,
                    carbsG: 6,
                    fatG: 1.5,
                    barcode: "0123456789012",
                    stores,
                });
                await removeUsual(store, c.householdId, typed.id);
                const owner = await store.getBarcodeFoodId(
                    c.householdId,
                    "0123456789012",
                );
                expect(owner).toBe(typed.id);
                const again = await addUsualFromProduct(store, c.householdId, {
                    productId: owner!,
                    stores,
                });
                expect(again.id).toBe(typed.id);
                expect(again.genericFoodId).toBeNull();
                expect(again.usualAddedAt).not.toBeNull();
                const product = await store.insertFood(
                    sampleFood(c.householdId, {
                        name: "Oatly",
                        normalizedName: "oatly",
                        brand: "Oatly",
                    }),
                );
                await linkProduct(store, c.householdId, product.id, typed.id);
                await removeProduct(store, c.householdId, typed.id, product.id);
                const { rows } = usualProductRows({
                    foods: await store.listFoods(c.householdId),
                });
                expect(rows.map((r) => r.food.id)).toEqual([typed.id]);
                expect(rows[0]?.products).toEqual([]);
            });

            test("bulk remove clears a typed usual's stamp", async () => {
                await reset();
                const c = ctx();
                const store = createStore();
                const typed = await addUsualByHand(store, c.householdId, {
                    name: "Typed one",
                    basis: "per_100g",
                    calories: 1,
                    proteinG: 1,
                    carbsG: 1,
                    fatG: 1,
                    stores: { listStores: () => lookup(c) },
                });
                const result = await removeUsuals(store, {
                    householdId: c.householdId,
                    foodIds: [typed.id],
                });
                expect(result).toEqual({ status: "applied", count: 1 });
                expect(
                    (await store.getFood(c.householdId, typed.id))
                        ?.usualAddedAt,
                ).toBeNull();
            });
        });

        describe("restock schedule on the usual record", () => {
            const SCHEDULED: UsualScheduleFields = {
                restockSchedule: "every_n_weeks",
                restockEveryWeeks: 3,
                restockPaused: true,
                restockWhenLow: true,
                restockLowLevel: 6.5,
                lastRestockedOn: "2026-11-02",
            };
            const scheduleOf = (food: Food | null | undefined) =>
                food == null
                    ? null
                    : ({
                          restockSchedule: food.restockSchedule,
                          restockEveryWeeks: food.restockEveryWeeks,
                          restockPaused: food.restockPaused,
                          restockWhenLow: food.restockWhenLow,
                          restockLowLevel: food.restockLowLevel,
                          lastRestockedOn: food.lastRestockedOn,
                      } satisfies UsualScheduleFields);

            test("a new food starts with no schedule", async () => {
                await reset();
                const c = ctx();
                const store = createStore();
                const food = await store.insertFood(
                    sampleFood(c.householdId, { name: "Rice" }),
                );
                expect(scheduleOf(food)).toEqual(NO_USUAL_SCHEDULE);
                expect(
                    scheduleOf(await store.getFood(c.householdId, food.id)),
                ).toEqual(NO_USUAL_SCHEDULE);
            });

            test("every field round trips through insert, read, list and update", async () => {
                await reset();
                const c = ctx();
                const store = createStore();
                const food = sampleFood(c.householdId, {
                    name: "sched 2 eggs",
                    normalizedName: "sched 2 eggs",
                    ...SCHEDULED,
                });
                const inserted = await store.insertFood(food);
                expect(scheduleOf(inserted)).toEqual(SCHEDULED);
                expect(
                    scheduleOf(await store.getFood(c.householdId, food.id)),
                ).toEqual(SCHEDULED);
                expect(
                    scheduleOf(
                        (await store.listFoods(c.householdId)).find(
                            (f) => f.id === food.id,
                        ),
                    ),
                ).toEqual(SCHEDULED);
                expect(
                    scheduleOf(
                        (
                            await store.getFoodsByIds(c.householdId, [food.id])
                        ).get(food.id),
                    ),
                ).toEqual(SCHEDULED);

                const changed: UsualScheduleFields = {
                    restockSchedule: "monthly",
                    restockEveryWeeks: null,
                    restockPaused: false,
                    restockWhenLow: false,
                    restockLowLevel: 0,
                    lastRestockedOn: "2026-12-31",
                };
                const updated = await store.updateFoodRow({
                    ...inserted,
                    ...changed,
                });
                expect(scheduleOf(updated)).toEqual(changed);

                const cleared = await store.updateFoodRow({
                    ...updated!,
                    ...NO_USUAL_SCHEDULE,
                });
                expect(scheduleOf(cleared)).toEqual(NO_USUAL_SCHEDULE);
            });

            test("an unrelated update keeps the schedule", async () => {
                await reset();
                const c = ctx();
                const store = createStore();
                const food = await store.insertFood(
                    sampleFood(c.householdId, {
                        name: "sched 3 eggs",
                        normalizedName: "sched 3 eggs",
                        ...SCHEDULED,
                    }),
                );
                const renamed = await updateFood(
                    store,
                    c.householdId,
                    food.id,
                    { name: "sched 3 free range", allergens: ["egg"] },
                );
                expect(renamed.name).toBe("sched 3 free range");
                expect(scheduleOf(renamed)).toEqual(SCHEDULED);
                expect(
                    scheduleOf(await store.getFood(c.householdId, food.id)),
                ).toEqual(SCHEDULED);
            });

            test("setUsualPurchase keeps the schedule", async () => {
                await reset();
                const c = ctx();
                const store = createStore();
                const food = await store.insertFood(
                    sampleFood(c.householdId, {
                        name: "sched 4 eggs",
                        normalizedName: "sched 4 eggs",
                        ...SCHEDULED,
                    }),
                );
                const lookup = {
                    listStores: async () => [{ id: c.storeId }],
                };
                const set = await setUsualPurchase(
                    store,
                    c.householdId,
                    food.id,
                    {
                        usualStoreId: c.storeId,
                        usualAmount: { amount: 24, unit: "each" },
                    },
                    { stores: lookup },
                );
                expect(set.usualStoreId).toBe(c.storeId);
                expect(scheduleOf(set)).toEqual(SCHEDULED);
                const cleared = await setUsualPurchase(
                    store,
                    c.householdId,
                    food.id,
                    { usualStoreId: null, usualAmount: null },
                    { stores: lookup },
                );
                expect(cleared.usualAmount).toBeNull();
                expect(
                    scheduleOf(await store.getFood(c.householdId, food.id)),
                ).toEqual(SCHEDULED);
            });

            test("setUsualSchedule and markUsualRestocked write only their fields", async () => {
                await reset();
                const c = ctx();
                const store = createStore();
                const food = await store.insertFood(
                    sampleFood(c.householdId, {
                        name: "sched 5 eggs",
                        normalizedName: "sched 5 eggs",
                        usualStoreId: c.storeId,
                        usualAmount: { amount: 24, unit: "each" },
                    }),
                );
                const set = await setUsualSchedule(
                    store,
                    c.householdId,
                    food.id,
                    { restockSchedule: "weekly", restockWhenLow: true },
                );
                expect(set.restockSchedule).toBe("weekly");
                expect(set.restockWhenLow).toBe(true);
                expect(set.usualStoreId).toBe(c.storeId);
                expect(set.usualAmount).toEqual({ amount: 24, unit: "each" });

                const stamped = await markUsualRestocked(
                    store,
                    c.householdId,
                    food.id,
                    "2026-11-10",
                );
                expect(stamped?.lastRestockedOn).toBe("2026-11-10");
                expect(
                    scheduleOf(await store.getFood(c.householdId, food.id)),
                ).toEqual({
                    ...NO_USUAL_SCHEDULE,
                    restockSchedule: "weekly",
                    restockWhenLow: true,
                    lastRestockedOn: "2026-11-10",
                });
            });

            test("mergeFoods carries the dropped food's schedule to a kept food without one", async () => {
                await reset();
                const c = ctx();
                const store = createStore();
                const keep = await store.insertFood(
                    sampleFood(c.householdId, {
                        name: "sched 6 eggs",
                        normalizedName: "sched 6 eggs",
                    }),
                );
                const drop = await store.insertFood(
                    sampleFood(c.householdId, {
                        name: "sched 6 egg",
                        normalizedName: "sched 6 egg",
                        ...SCHEDULED,
                    }),
                );
                const merged = await mergeFoods(
                    store,
                    c.householdId,
                    keep.id,
                    drop.id,
                );
                expect(scheduleOf(merged)).toEqual(SCHEDULED);
                expect(
                    scheduleOf(await store.getFood(c.householdId, keep.id)),
                ).toEqual(SCHEDULED);
            });
        });

        test("updateFood with two live foods sharing a name", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const plain = sampleFood(c.householdId, {
                name: "Duck eggs",
                normalizedName: "duck eggs",
            });
            const branded = sampleFood(c.householdId, {
                name: "Duck eggs",
                normalizedName: "duck eggs",
                brand: "Kirkland",
            });
            await store.insertFood(plain);
            await store.insertFood(branded);
            await updateFood(store, c.householdId, plain.id, { calories: 143 });
            await updateFood(store, c.householdId, branded.id, {
                calories: 140,
            });
            await expect(
                updateFood(store, c.householdId, plain.id, {
                    brand: "Kirkland",
                }),
            ).rejects.toThrow("That food already exists.");
            expect(
                (await store.getFood(c.householdId, plain.id))?.brand,
            ).toBeNull();
            await updateFood(store, c.householdId, plain.id, {
                archived: true,
            });
        });

        test("household scoping on listFoods", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            await store.insertFood(sampleFood(c.householdId));
            expect(await store.listFoods(c.otherHouseholdId)).toEqual([]);
        });

        test("countFoodRefs aggregates five tables per household", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const foodA = sampleFood(c.householdId, {
                name: "Ref A",
                normalizedName: "ref a",
            });
            const foodB = sampleFood(c.householdId, {
                name: "Ref B",
                normalizedName: "ref b",
            });
            const foodOrphan = sampleFood(c.householdId, {
                name: "No refs",
                normalizedName: "no refs",
            });
            await store.insertFood(foodA);
            await store.insertFood(foodB);
            await store.insertFood(foodOrphan);

            if ("trackRef" in store) {
                const mem = store as MemoryFoodsStore;
                mem.trackRef(foodA.id, c.householdId);
                mem.trackRef(foodA.id, c.householdId);
                mem.trackRef(foodA.id, c.householdId);
                mem.trackRef(foodA.id, c.householdId);
                mem.trackRef(foodA.id, c.householdId);
                mem.trackRef(foodB.id, c.householdId);
                mem.trackRef(foodB.id, c.householdId);
                mem.trackRef(foodA.id, c.otherHouseholdId);
            } else {
                const sql = c.sql;
                if (!sql) throw new Error("live foods contract needs ctx.sql");
                await (
                    await trackFridgeItemFoodRef(
                        store,
                        c,
                        foodA.id,
                        c.householdId,
                    )
                )();
                await (
                    await trackGroceryLineFoodRef(
                        store,
                        c,
                        foodA.id,
                        c.householdId,
                    )
                )();
                await (
                    await trackRecipeIngredientFoodRef(
                        store,
                        c,
                        foodA.id,
                        c.householdId,
                        c.userId,
                    )
                )();
                await (
                    await trackMealItemFoodRef(
                        store,
                        c,
                        foodA.id,
                        c.householdId,
                        c.userId,
                    )
                )();
                await (
                    await trackStockMovementFoodRef(
                        store,
                        c,
                        foodA.id,
                        c.householdId,
                    )
                )();
                await (
                    await trackFridgeItemFoodRef(
                        store,
                        c,
                        foodB.id,
                        c.householdId,
                    )
                )();
                await (
                    await trackStockMovementFoodRef(
                        store,
                        c,
                        foodB.id,
                        c.householdId,
                    )
                )();
            }

            const primary = await store.countFoodRefs(c.householdId);
            expect(primary.get(foodA.id)).toBe(5);
            expect(primary.get(foodB.id)).toBe(2);
            expect(primary.get(foodOrphan.id)).toBeUndefined();

            const other = await store.countFoodRefs(c.otherHouseholdId);
            if (c.sql) {
                expect(other.size).toBe(0);
            } else {
                expect(other.get(foodA.id)).toBe(1);
            }
        });
    });
}
