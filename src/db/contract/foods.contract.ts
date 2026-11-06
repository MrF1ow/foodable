import { describe, expect, test } from "bun:test";
import {
    updateFood,
    type FoodsStore,
    type MemoryFoodsStore,
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
