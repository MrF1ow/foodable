import { describe, expect, test } from "bun:test";
import type { FoodsStore } from "../../domain/foods.js";
import { sampleFood, type StoreContractCtx } from "./helpers.js";

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
            await store.setAlias(c.householdId, "fruit", b.id);
            expect(await store.getAliasFoodId(c.householdId, "fruit")).toBe(
                b.id,
            );
            expect(await store.listAliases(c.householdId, a.id)).toEqual([
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
            await store.repointFoodRefs(c.householdId, from.id, to.id);
            expect(await store.getFood(c.householdId, from.id)).toBeTruthy();
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

        test("household scoping on listFoods", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            await store.insertFood(sampleFood(c.householdId));
            expect(await store.listFoods(c.otherHouseholdId)).toEqual([]);
        });
    });
}
