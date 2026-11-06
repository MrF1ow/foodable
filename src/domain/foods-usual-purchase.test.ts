import { describe, expect, test } from "bun:test";
import {
    buildFoodUpdate,
    createMemoryFoodsStore,
    effectiveFood,
    FoodsInputError,
    mergeFoods,
    newFood,
    parseUsualPurchase,
    setUsualProduct,
    setUsualPurchase,
    updateFood,
} from "./foods.js";
import { createMemorySettingsStore } from "./settings.js";

const HH = "hh-usual";

describe("parseUsualPurchase / effectiveFood / merge usual purchase", () => {
    test("effectiveFood merges usual store and amount as whole pair from product", async () => {
        const store = createMemoryFoodsStore();
        const plain = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                usualStoreId: "store-plain",
                usualAmount: { amount: 6, unit: "each" },
            }),
        );
        const product = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Kirkland Eggs",
                brand: "Kirkland",
                genericFoodId: plain.id,
                usualStoreId: "store-k",
                usualAmount: { amount: 24, unit: "each" },
            }),
        );
        await store.updateFoodRow({
            ...plain,
            usualProductId: product.id,
        });
        const refreshed = (await store.getFood(HH, plain.id))!;
        const catalog = new Map(
            (await store.listFoods(HH)).map((f) => [f.id, f]),
        );
        const eff = effectiveFood(refreshed, catalog);
        expect(eff.usualStoreId).toBe("store-k");
        expect(eff.usualAmount).toEqual({ amount: 24, unit: "each" });
    });

    test("effectiveFood falls back field by field: product amount only uses food store", async () => {
        const store = createMemoryFoodsStore();
        const plain = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                usualStoreId: "s-fallback",
                usualAmount: null,
            }),
        );
        const product = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Dozen",
                genericFoodId: plain.id,
                usualStoreId: null,
                usualAmount: { amount: 12, unit: "each" },
            }),
        );
        await store.updateFoodRow({ ...plain, usualProductId: product.id });
        const p = (await store.getFood(HH, plain.id))!;
        const catalog = new Map(
            (await store.listFoods(HH)).map((f) => [f.id, f]),
        );
        const eff = effectiveFood(p, catalog);
        expect(eff.usualStoreId).toBe("s-fallback");
        expect(eff.usualAmount).toEqual({ amount: 12, unit: "each" });
    });

    test("effectiveFood product store only: uses plain's whole usual amount pair", async () => {
        const store = createMemoryFoodsStore();
        const plain = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                usualStoreId: "s-p",
                usualAmount: { amount: 6, unit: "each" },
            }),
        );
        const product = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Loose",
                genericFoodId: plain.id,
                usualStoreId: "s-prod",
                usualAmount: null,
            }),
        );
        await store.updateFoodRow({ ...plain, usualProductId: product.id });
        const p = (await store.getFood(HH, plain.id))!;
        const catalog = new Map(
            (await store.listFoods(HH)).map((f) => [f.id, f]),
        );
        const eff = effectiveFood(p, catalog);
        expect(eff.usualStoreId).toBe("s-prod");
        expect(eff.usualAmount).toEqual({ amount: 6, unit: "each" });
    });

    test("effectiveFood product store and plain grams pair {6,g}", async () => {
        const store = createMemoryFoodsStore();
        const plain = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                usualAmount: { amount: 6, unit: "g" },
            }),
        );
        const product = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Kirkland",
                genericFoodId: plain.id,
                usualStoreId: "s-b",
                usualAmount: null,
            }),
        );
        await store.updateFoodRow({ ...plain, usualProductId: product.id });
        const p = (await store.getFood(HH, plain.id))!;
        const catalog = new Map(
            (await store.listFoods(HH)).map((f) => [f.id, f]),
        );
        const eff = effectiveFood(p, catalog);
        expect(eff.usualStoreId).toBe("s-b");
        expect(eff.usualAmount).toEqual({ amount: 6, unit: "g" });
    });

    test("effectiveFood: standalone food reads own usual fields", async () => {
        const store = createMemoryFoodsStore();
        const solo = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Solo",
                usualStoreId: "s-s",
                usualAmount: { amount: 3, unit: "L" },
            }),
        );
        const catalog = new Map(
            (await store.listFoods(HH)).map((f) => [f.id, f]),
        );
        const eff = effectiveFood(solo, catalog);
        expect(eff.usualStoreId).toBe("s-s");
        expect(eff.usualAmount).toEqual({ amount: 3, unit: "L" });
    });

    test("effectiveFood: product row reads own row only", async () => {
        const store = createMemoryFoodsStore();
        const plain = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                usualAmount: { amount: 1, unit: "each" },
            }),
        );
        const product = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Brand",
                genericFoodId: plain.id,
                usualAmount: { amount: 2, unit: "each" },
            }),
        );
        const catalog = new Map(
            (await store.listFoods(HH)).map((f) => [f.id, f]),
        );
        const eff = effectiveFood(product, catalog);
        expect(eff.usualAmount).toEqual({ amount: 2, unit: "each" });
        expect(eff.usualStoreId).toBeNull();
    });

    test("archived usual product falls back to plain's own fields", async () => {
        const store = createMemoryFoodsStore();
        const plain = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                usualStoreId: "s-plain",
                usualAmount: { amount: 6, unit: "g" },
            }),
        );
        const product = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Old brand",
                genericFoodId: plain.id,
                usualStoreId: "s-arch",
                usualAmount: { amount: 99, unit: "each" },
            }),
        );
        await store.updateFoodRow({
            ...plain,
            usualProductId: product.id,
        });
        await store.updateFoodRow({
            ...product,
            archivedAt: new Date().toISOString(),
        });
        const p = (await store.getFood(HH, plain.id))!;
        const catalog = new Map(
            (await store.listFoods(HH)).map((f) => [f.id, f]),
        );
        const eff = effectiveFood(p, catalog);
        expect(eff.usualStoreId).toBe("s-plain");
        expect(eff.usualAmount).toEqual({ amount: 6, unit: "g" });
    });

    test("usual product of another food falls back to plain's own fields", async () => {
        const store = createMemoryFoodsStore();
        const otherPlain = await store.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Milk" }),
        );
        const alienProduct = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Alien milk",
                genericFoodId: otherPlain.id,
                usualAmount: { amount: 1, unit: "L" },
            }),
        );
        const eggs = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                usualAmount: { amount: 6, unit: "each" },
            }),
        );
        await store.updateFoodRow({
            ...eggs,
            usualProductId: alienProduct.id,
        });
        const p = (await store.getFood(HH, eggs.id))!;
        const catalog = new Map(
            (await store.listFoods(HH)).map((f) => [f.id, f]),
        );
        const eff = effectiveFood(p, catalog);
        expect(eff.usualAmount).toEqual({ amount: 6, unit: "each" });
    });

    test("invalid usual product id keeps plain food's own usual fields", async () => {
        const store = createMemoryFoodsStore();
        const plain = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                usualStoreId: "s1",
                usualAmount: { amount: 1, unit: "each" },
            }),
        );
        await store.updateFoodRow({
            ...plain,
            usualProductId: crypto.randomUUID(),
        });
        const p = (await store.getFood(HH, plain.id))!;
        const catalog = new Map(
            (await store.listFoods(HH)).map((f) => [f.id, f]),
        );
        const eff = effectiveFood(p, catalog);
        expect(eff.usualStoreId).toBe("s1");
        expect(eff.usualAmount).toEqual({ amount: 1, unit: "each" });
    });

    test("mergeFoods: keeps usual pair from keep, else drop", async () => {
        const store = createMemoryFoodsStore();
        const keep = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Keep",
                usualStoreId: null,
                usualAmount: null,
            }),
        );
        const drop = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Drop",
                usualStoreId: "s-d",
                usualAmount: { amount: 2, unit: "lb" },
            }),
        );
        const merged = await mergeFoods(store, HH, keep.id, drop.id);
        expect(merged.usualStoreId).toBe("s-d");
        expect(merged.usualAmount).toEqual({ amount: 2, unit: "lb" });
    });

    test("mergeFoods prefers keep's usual pair over drop's", async () => {
        const store = createMemoryFoodsStore();
        const keep = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Keep",
                usualStoreId: "s-k",
                usualAmount: { amount: 1, unit: "each" },
            }),
        );
        const drop = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Drop",
                usualStoreId: "s-d",
                usualAmount: { amount: 9, unit: "g" },
            }),
        );
        const merged = await mergeFoods(store, HH, keep.id, drop.id);
        expect(merged.usualStoreId).toBe("s-k");
        expect(merged.usualAmount).toEqual({ amount: 1, unit: "each" });
    });
});

describe("rejected usual purchase leaves rows unchanged", () => {
    async function seed() {
        const foods = createMemoryFoodsStore();
        const settings = createMemorySettingsStore();
        const s = await settings.insertStore({
            id: "g1",
            householdId: HH,
            name: "A",
            sortOrder: 0,
        });
        await settings.listSections(s.id);
        const plain = await foods.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Eggs" }),
        );
        const product = await foods.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Brand",
                brand: "B",
                genericFoodId: plain.id,
            }),
        );
        await foods.updateFoodRow({ ...plain, usualProductId: product.id });
        return { foods, settings, plain, product };
    }

    test("buildFoodUpdate bad unit", async () => {
        const { foods, settings, plain } = await seed();
        await expect(
            buildFoodUpdate(
                foods,
                HH,
                plain.id,
                {
                    usualAmount: { amount: 1, unit: "nope" },
                },
                { stores: settings },
            ),
        ).rejects.toThrow(FoodsInputError);
    });

    test("updateFood rejects unknown store from other household", async () => {
        const foods = createMemoryFoodsStore();
        const hh2 = "hh-2";
        const settings = createMemorySettingsStore();
        await settings.insertStore({
            id: "other-store",
            householdId: hh2,
            name: "Elsewhere",
            sortOrder: 0,
        });
        const food = await foods.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Milk" }),
        );
        const before = await foods.getFood(HH, food.id);
        await expect(
            updateFood(
                foods,
                HH,
                food.id,
                { usualStoreId: "other-store" },
                { stores: settings },
            ),
        ).rejects.toThrow("Unknown store.");
        expect(await foods.getFood(HH, food.id)).toEqual(before);
    });

    test("setUsualPurchase rejects zero amount", async () => {
        const { foods, settings, plain } = await seed();
        const before = await foods.listFoods(HH);
        await expect(
            setUsualPurchase(
                foods,
                HH,
                plain.id,
                { usualAmount: { amount: 0, unit: "g" } },
                { stores: settings },
            ),
        ).rejects.toThrow(FoodsInputError);
        const after = await foods.listFoods(HH);
        expect(after).toEqual(before);
    });

    test("setUsualProduct with bad purchase does not set usual or write purchase", async () => {
        const { foods, settings, plain, product } = await seed();
        await foods.updateFoodRow({ ...plain, usualProductId: null });
        const beforePlain = await foods.getFood(HH, plain.id);
        const beforeProd = await foods.getFood(HH, product.id);
        await expect(
            setUsualProduct(foods, HH, plain.id, product.id, {
                purchase: { usualAmount: { amount: 3, unit: null } },
                stores: settings,
            }),
        ).rejects.toThrow(FoodsInputError);
        expect(await foods.getFood(HH, plain.id)).toEqual(beforePlain);
        expect(await foods.getFood(HH, product.id)).toEqual(beforeProd);
    });
});

describe("parseUsualPurchase invalid unit before bad amount", () => {
    test("unknown unit is reported before non-positive amount", async () => {
        const settings = createMemorySettingsStore();
        await expect(
            parseUsualPurchase(
                HH,
                { usualAmount: { amount: 0, unit: "nope" } },
                settings,
            ),
        ).rejects.toThrow("Pick a known unit for the usual amount.");
        await expect(
            parseUsualPurchase(
                HH,
                { usualAmount: { amount: -1, unit: "badu" } },
                settings,
            ),
        ).rejects.toThrow("Pick a known unit for the usual amount.");
    });
});

describe("usual purchase rejections: exact message and listFoods unchanged", () => {
    async function baseline() {
        const foods = createMemoryFoodsStore();
        const settings = createMemorySettingsStore();
        await settings.insertStore({
            id: "g1",
            householdId: HH,
            name: "A",
            sortOrder: 0,
        });
        await settings.listSections("g1");
        const plain = await foods.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Eggs" }),
        );
        const product = await foods.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Brand",
                genericFoodId: plain.id,
            }),
        );
        await foods.updateFoodRow({ ...plain, usualProductId: product.id });
        return { foods, settings, plain, product };
    }

    test("buildFoodUpdate", async () => {
        const { foods, settings, plain } = await baseline();
        const before = await foods.listFoods(HH);
        await expect(
            buildFoodUpdate(
                foods,
                HH,
                plain.id,
                { usualAmount: { amount: 1, unit: "nope" } },
                { stores: settings },
            ),
        ).rejects.toThrow("Pick a known unit for the usual amount.");
        await expect(
            buildFoodUpdate(
                foods,
                HH,
                plain.id,
                { usualAmount: { amount: 0, unit: "g" } },
                { stores: settings },
            ),
        ).rejects.toThrow("The usual amount must be greater than zero.");
        await expect(
            buildFoodUpdate(
                foods,
                HH,
                plain.id,
                { usualAmount: { amount: -2, unit: "g" } },
                { stores: settings },
            ),
        ).rejects.toThrow("The usual amount must be greater than zero.");
        await expect(
            buildFoodUpdate(
                foods,
                HH,
                plain.id,
                { usualAmount: { amount: 2, unit: "" } },
                { stores: settings },
            ),
        ).rejects.toThrow("Enter a usual amount with its unit.");
        await expect(
            buildFoodUpdate(
                foods,
                HH,
                plain.id,
                { usualAmount: { amount: null, unit: "g" } },
                { stores: settings },
            ),
        ).rejects.toThrow("Enter a usual amount with its unit.");
        expect(await foods.listFoods(HH)).toEqual(before);
    });

    test("updateFood", async () => {
        const { foods, settings, plain } = await baseline();
        const before = await foods.listFoods(HH);
        await expect(
            updateFood(
                foods,
                HH,
                plain.id,
                { usualAmount: { amount: 1, unit: "nope" } },
                { stores: settings },
            ),
        ).rejects.toThrow("Pick a known unit for the usual amount.");
        expect(await foods.listFoods(HH)).toEqual(before);
    });

    test("setUsualPurchase", async () => {
        const { foods, settings, plain } = await baseline();
        const before = await foods.listFoods(HH);
        await expect(
            setUsualPurchase(
                foods,
                HH,
                plain.id,
                { usualAmount: { amount: 0, unit: "g" } },
                { stores: settings },
            ),
        ).rejects.toThrow("The usual amount must be greater than zero.");
        expect(await foods.listFoods(HH)).toEqual(before);
    });

    test("setUsualProduct with purchase", async () => {
        const { foods, settings, plain, product } = await baseline();
        const before = await foods.listFoods(HH);
        await expect(
            setUsualProduct(foods, HH, plain.id, product.id, {
                purchase: { usualAmount: { amount: 1, unit: "nope" } },
                stores: settings,
            }),
        ).rejects.toThrow("Pick a known unit for the usual amount.");
        expect(await foods.listFoods(HH)).toEqual(before);
        const plainRow = await foods.getFood(HH, plain.id);
        expect(plainRow?.usualProductId).toBe(product.id);
    });

    test("unknown store in another household", async () => {
        const foods = createMemoryFoodsStore();
        const hh2 = "hh-other";
        const settings = createMemorySettingsStore();
        await settings.insertStore({
            id: "foreign",
            householdId: hh2,
            name: "Far",
            sortOrder: 0,
        });
        const plain = await foods.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Eggs" }),
        );
        const before = await foods.listFoods(HH);
        await expect(
            buildFoodUpdate(
                foods,
                HH,
                plain.id,
                { usualStoreId: "foreign" },
                { stores: settings },
            ),
        ).rejects.toThrow("Unknown store.");
        expect(await foods.listFoods(HH)).toEqual(before);
    });
});

describe("setUsualProduct writes purchase after link", () => {
    test("writes store and amount on product row", async () => {
        const foods = createMemoryFoodsStore();
        const settings = createMemorySettingsStore();
        const st = await settings.insertStore({
            id: "costco",
            householdId: HH,
            name: "Costco",
            sortOrder: 0,
        });
        const plain = await foods.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Eggs" }),
        );
        const solo = await foods.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Kirkland Eggs",
                brand: "K",
            }),
        );
        await setUsualProduct(foods, HH, plain.id, solo.id, {
            purchase: {
                usualStoreId: st.id,
                usualAmount: { amount: 18, unit: "each" },
            },
            stores: settings,
        });
        const p = (await foods.getFood(HH, solo.id))!;
        expect(p.genericFoodId).toBe(plain.id);
        expect(p.usualStoreId).toBe(st.id);
        expect(p.usualAmount).toEqual({ amount: 18, unit: "each" });
    });
});
