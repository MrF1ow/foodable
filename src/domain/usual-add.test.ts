import { describe, expect, test } from "bun:test";
import {
    createMemoryFoodsStore,
    effectiveFoodsFromListed,
    FoodsInputError,
    isUsualGroceryLine,
    linkProduct,
    mergeFoods,
    newFood,
    removeProduct,
    setUsualProduct,
    usualProductRows,
    type Food,
} from "./foods.js";
import {
    addUsualByHand,
    addUsualFromProduct,
    isPlainFoodRow,
    nameWithoutBrand,
    removeUsual,
    suggestUsualFoods,
    UsualInputError,
    type UsualByHandInput,
} from "./usual-add.js";
import { removeUsuals } from "./bulk.js";
import { usualsAtZeroForDigest } from "./household-digest.js";

const HH = "hh-usual-add";
const stores = {
    listStores: async () => [{ id: "store-1" }, { id: "store-2" }],
};

function setup() {
    const store = createMemoryFoodsStore();
    const plain = (name: string, over: Partial<Food> = {}) =>
        store.insertFood(
            newFood({ householdId: HH, kind: "food", name, ...over }),
        );
    const product = (name: string, over: Partial<Food> = {}) =>
        store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name,
                brand: "Brand",
                ...over,
            }),
        );
    return { store, plain, product };
}

function hand(over: Partial<UsualByHandInput> = {}): UsualByHandInput {
    return {
        name: "Half & Half",
        basis: "per_100ml",
        calories: 130,
        proteinG: 3,
        carbsG: 4,
        fatG: 11,
        stores,
        createdBy: null,
        ...over,
    };
}

async function fieldOf(promise: Promise<unknown>): Promise<string | null> {
    try {
        await promise;
    } catch (err) {
        expect(err).toBeInstanceOf(UsualInputError);
        expect(err).toBeInstanceOf(FoodsInputError);
        return (err as UsualInputError).field;
    }
    throw new Error("expected a UsualInputError");
}

describe("addUsualFromProduct", () => {
    test("links a scanned product to an existing food and makes it the usual", async () => {
        const { store, plain, product } = setup();
        const milk = await plain("Milk");
        const scanned = await product("Horizon Milk");
        const food = await addUsualFromProduct(store, HH, {
            productId: scanned.id,
            foodId: milk.id,
            purchase: {
                usualStoreId: "store-1",
                usualAmount: { amount: 2, unit: "each" },
            },
            stores,
        });
        expect(food.id).toBe(milk.id);
        expect(food.usualProductId).toBe(scanned.id);
        // The product makes it a usual; there is nothing to stamp.
        expect(food.usualAddedAt).toBeNull();
        const linked = (await store.getFood(HH, scanned.id))!;
        expect(linked.genericFoodId).toBe(milk.id);
        expect(linked.usualStoreId).toBe("store-1");
        const { rows } = usualProductRows({ foods: await store.listFoods(HH) });
        expect(rows.map((r) => r.food.id)).toEqual([milk.id]);
        expect(rows[0]!.usual?.id).toBe(scanned.id);
    });

    test("a product already linked goes to its food with no food named", async () => {
        const { store, plain, product } = setup();
        const milk = await plain("Milk");
        const scanned = await product("Horizon Milk", {
            genericFoodId: milk.id,
        });
        const food = await addUsualFromProduct(store, HH, {
            productId: scanned.id,
            stores,
        });
        expect(food.id).toBe(milk.id);
        expect(food.usualProductId).toBe(scanned.id);
        expect((await store.getFood(HH, scanned.id))!.genericFoodId).toBe(
            milk.id,
        );
    });

    test("naming the same food as the existing link is a no-op relink", async () => {
        const { store, plain, product } = setup();
        const milk = await plain("Milk");
        const scanned = await product("Horizon Milk", {
            genericFoodId: milk.id,
        });
        await addUsualFromProduct(store, HH, {
            productId: scanned.id,
            foodId: milk.id,
            stores,
        });
        const again = await addUsualFromProduct(store, HH, {
            productId: scanned.id,
            foodId: milk.id,
            stores,
        });
        expect(again.usualProductId).toBe(scanned.id);
        const products = (await store.listFoods(HH)).filter(
            (f) => f.genericFoodId === milk.id,
        );
        expect(products.map((p) => p.id)).toEqual([scanned.id]);
    });

    test("naming another food moves the product and clears the old food's usual product", async () => {
        const { store, plain, product } = setup();
        const milk = await plain("Milk");
        const cream = await plain("Cream");
        const scanned = await product("Horizon Milk");
        await addUsualFromProduct(store, HH, {
            productId: scanned.id,
            foodId: milk.id,
            stores,
        });
        const moved = await addUsualFromProduct(store, HH, {
            productId: scanned.id,
            foodId: cream.id,
            stores,
        });
        expect(moved.id).toBe(cream.id);
        expect(moved.usualProductId).toBe(scanned.id);
        expect((await store.getFood(HH, scanned.id))!.genericFoodId).toBe(
            cream.id,
        );
        expect((await store.getFood(HH, milk.id))!.usualProductId).toBeNull();
    });

    test("a new name creates the plain food", async () => {
        const { store, product } = setup();
        const scanned = await product("Horizon Milk");
        const food = await addUsualFromProduct(store, HH, {
            productId: scanned.id,
            newFoodName: "  Whole milk ",
            stores,
            createdBy: "user-1",
        });
        expect(food.name).toBe("Whole milk");
        expect(food.genericFoodId).toBeNull();
        expect(food.createdBy).toBe("user-1");
        expect(food.usualProductId).toBe(scanned.id);
    });

    test("a new name has its inner spaces collapsed", async () => {
        const { store, product } = setup();
        const scanned = await product("Horizon Milk");
        const food = await addUsualFromProduct(store, HH, {
            productId: scanned.id,
            newFoodName: "  Whole   milk ",
            stores,
        });
        expect(food.name).toBe("Whole milk");
        expect(food.normalizedName).toBe("whole milk");
    });

    test("a new name that matches an existing plain food reuses it", async () => {
        const { store, plain, product } = setup();
        const existing = await plain("Half & Half");
        const scanned = await product("Organic Valley Half & Half");
        const food = await addUsualFromProduct(store, HH, {
            productId: scanned.id,
            newFoodName: "half &  half",
            stores,
        });
        expect(food.id).toBe(existing.id);
        const plains = (await store.listFoods(HH)).filter(
            (f) => !f.genericFoodId,
        );
        expect(plains).toHaveLength(1);
    });

    test("naming neither a food nor a new name for an unlinked product is refused", async () => {
        const { store, product } = setup();
        const scanned = await product("Horizon Milk");
        expect(
            await fieldOf(
                addUsualFromProduct(store, HH, {
                    productId: scanned.id,
                    stores,
                }),
            ),
        ).toBe("food");
    });

    test("scanning the barcode of a plain food typed by hand adds that food as the usual, with no link", async () => {
        const { store } = setup();
        const oat = await addUsualByHand(
            store,
            HH,
            hand({ name: "Oat milk", barcode: "0123456789012" }),
        );
        await removeUsual(store, HH, oat.id);
        expect(
            usualProductRows({ foods: await store.listFoods(HH) }).rows,
        ).toEqual([]);
        const owner = await store.getBarcodeFoodId(HH, "0123456789012");
        expect(owner).toBe(oat.id);
        const food = await addUsualFromProduct(store, HH, {
            productId: owner!,
            purchase: {
                usualStoreId: "store-2",
                usualAmount: { amount: 3, unit: "each" },
            },
            stores,
        });
        expect(food.id).toBe(oat.id);
        expect(food.usualAddedAt).not.toBeNull();
        expect(food.genericFoodId).toBeNull();
        expect(food.usualProductId).toBeNull();
        expect(food.usualStoreId).toBe("store-2");
        expect(food.usualAmount).toEqual({ amount: 3, unit: "each" });
        const { rows } = usualProductRows({ foods: await store.listFoods(HH) });
        expect(rows.map((r) => [r.food.id, r.products.length])).toEqual([
            [oat.id, 0],
        ]);
    });

    test("naming the scanned plain food itself, by id or by name, is the same self add", async () => {
        const { store, plain } = setup();
        const oat = await plain("Oat milk");
        const byId = await addUsualFromProduct(store, HH, {
            productId: oat.id,
            foodId: oat.id,
            stores,
        });
        expect(byId.id).toBe(oat.id);
        expect(byId.genericFoodId).toBeNull();
        await removeUsual(store, HH, oat.id);
        const byName = await addUsualFromProduct(store, HH, {
            productId: oat.id,
            newFoodName: "oat MILK",
            stores,
        });
        expect(byName.id).toBe(oat.id);
        expect(byName.usualAddedAt).not.toBeNull();
        expect(
            (await store.listFoods(HH)).filter((f) => !f.archivedAt),
        ).toHaveLength(1);
    });

    test("naming a different food for a plain row still links it under that food", async () => {
        const { store, plain } = setup();
        const oat = await plain("Oat milk");
        const plant = await plain("Plant milk");
        const food = await addUsualFromProduct(store, HH, {
            productId: oat.id,
            foodId: plant.id,
            stores,
        });
        expect(food.id).toBe(plant.id);
        expect(food.usualProductId).toBe(oat.id);
        expect((await store.getFood(HH, oat.id))!.genericFoodId).toBe(plant.id);
    });

    test("a refusal from the link rules names the food field", async () => {
        const { store, plain, product } = setup();
        const milk = await plain("Milk");
        const other = await product("Other milk", { genericFoodId: milk.id });
        const scanned = await product("Horizon Milk");
        // The named food is itself a product of another food.
        expect(
            await fieldOf(
                addUsualFromProduct(store, HH, {
                    productId: scanned.id,
                    foodId: other.id,
                    stores,
                }),
            ),
        ).toBe("food");
        // The scanned row is a product that cannot be its own food.
        expect(
            await fieldOf(
                addUsualFromProduct(store, HH, {
                    productId: other.id,
                    foodId: other.id,
                    stores,
                }),
            ),
        ).toBe("food");
        // The named food does not exist.
        expect(
            await fieldOf(
                addUsualFromProduct(store, HH, {
                    productId: scanned.id,
                    foodId: "no-such-food",
                    stores,
                }),
            ),
        ).toBe("food");
    });

    test("an unknown usual store is refused before anything is written", async () => {
        const { store, plain, product } = setup();
        const milk = await plain("Milk");
        const scanned = await product("Horizon Milk");
        await expect(
            addUsualFromProduct(store, HH, {
                productId: scanned.id,
                foodId: milk.id,
                purchase: { usualStoreId: "nope" },
                stores,
            }),
        ).rejects.toThrow("Unknown store.");
        expect((await store.getFood(HH, scanned.id))!.genericFoodId).toBeNull();
        expect((await store.getFood(HH, milk.id))!.usualAddedAt).toBeNull();
    });

    test("a failed link leaves no new food behind", async () => {
        const { store, plain, product } = setup();
        const eggs = await plain("Eggs");
        // A plain food with a product of its own cannot become a product.
        await product("Kirkland Eggs", { genericFoodId: eggs.id });
        await expect(
            addUsualFromProduct(store, HH, {
                productId: eggs.id,
                newFoodName: "Dozen eggs",
                stores,
            }),
        ).rejects.toThrow(FoodsInputError);
        const live = (await store.listFoods(HH)).filter((f) => !f.archivedAt);
        expect(live.map((f) => f.name).sort()).toEqual([
            "Eggs",
            "Kirkland Eggs",
        ]);
    });

    test("re-adding a scanned plain food re-stamps the usual", async () => {
        const { store, plain } = setup();
        const oat = await plain("Oat milk");
        const first = await addUsualFromProduct(store, HH, {
            productId: oat.id,
            stores,
        });
        await store.updateFoodRow({
            ...first,
            usualAddedAt: "2020-01-01T00:00:00.000Z",
        });
        const second = await addUsualFromProduct(store, HH, {
            productId: oat.id,
            stores,
        });
        expect(second.usualAddedAt! > "2020-01-01T00:00:00.000Z").toBe(true);
    });

    test("filing a product under a food does not stamp it, and re-filing it elsewhere leaves no ghost usual", async () => {
        const { store, plain, product } = setup();
        const milk = await plain("Milk");
        const oat = await plain("Oat milk");
        const oatly = await product("Oatly Barista", { brand: "Oatly" });
        await addUsualFromProduct(store, HH, {
            productId: oatly.id,
            foodId: milk.id,
            stores,
        });
        await addUsualFromProduct(store, HH, {
            productId: oatly.id,
            foodId: oat.id,
            stores,
        });
        expect((await store.getFood(HH, milk.id))!.usualAddedAt).toBeNull();
        const listed = await store.listFoods(HH);
        const { rows, addable } = usualProductRows({ foods: listed });
        expect(rows.map((r) => r.food.name)).toEqual(["Oat milk"]);
        expect(addable.map((f) => f.name)).toContain("Milk");
        const atZero = usualsAtZeroForDigest({
            items: [],
            foods: listed,
            foodsById: effectiveFoodsFromListed(listed),
            stores: [{ id: "s1", name: "S", sortOrder: 0 }] as never,
        });
        expect(atZero.map((o) => o.displayName)).toEqual(["Oat milk"]);
    });

    test("a new food with a blank name is refused instead of falling back to the product's own food", async () => {
        const { store, plain, product } = setup();
        const milk = await plain("Milk");
        const scanned = await product("Horizon Milk", {
            genericFoodId: milk.id,
        });
        for (const newFoodName of ["", "   ", null]) {
            let err: unknown;
            try {
                await addUsualFromProduct(store, HH, {
                    productId: scanned.id,
                    newFood: true,
                    newFoodName,
                    stores,
                });
            } catch (e) {
                err = e;
            }
            expect(err).toBeInstanceOf(UsualInputError);
            expect((err as UsualInputError).field).toBe("food");
            expect((err as UsualInputError).message).toBe("Name the new food.");
        }
        expect((await store.getFood(HH, milk.id))!.usualProductId).toBeNull();
    });
});

describe("addUsualByHand", () => {
    test("creates the food with per-100 ml macros and lists it as a usual with no products", async () => {
        const { store } = setup();
        const food = await addUsualByHand(
            store,
            HH,
            hand({
                purchase: {
                    usualStoreId: "store-2",
                    usualAmount: { amount: 1, unit: "each" },
                },
                createdBy: "user-1",
            }),
        );
        expect(food).toMatchObject({
            name: "Half & Half",
            kind: "food",
            nutritionBasis: "100ml",
            calories: 130,
            proteinG: 3,
            carbsG: 4,
            fatG: 11,
            nutritionSource: "manual",
            usualStoreId: "store-2",
            usualAmount: { amount: 1, unit: "each" },
            createdBy: "user-1",
        });
        expect(food.usualAddedAt).not.toBeNull();
        const listed = await store.listFoods(HH);
        const { rows, addable } = usualProductRows({ foods: listed });
        expect(rows).toHaveLength(1);
        expect(rows[0]!.food.id).toBe(food.id);
        expect(rows[0]!.products).toEqual([]);
        expect(rows[0]!.usual).toBeNull();
        expect(addable.map((f) => f.id)).not.toContain(food.id);
    });

    test("collapses the spaces inside the name", async () => {
        const { store } = setup();
        const food = await addUsualByHand(
            store,
            HH,
            hand({ name: "  Oat   milk " }),
        );
        expect(food.name).toBe("Oat milk");
    });

    test("per 100 g stores the 100g basis", async () => {
        const { store } = setup();
        const food = await addUsualByHand(
            store,
            HH,
            hand({ name: "Oats", basis: "per_100g", calories: 380 }),
        );
        expect(food.nutritionBasis).toBe("100g");
        expect(food.calories).toBe(380);
    });

    test("a per-serving entry in grams converts to per 100 g and keeps the serving", async () => {
        const { store } = setup();
        const food = await addUsualByHand(
            store,
            HH,
            hand({
                name: "Granola",
                basis: "per_serving",
                serving: { amount: 40, unit: "g" },
                calories: 180,
                proteinG: 4,
                carbsG: 28,
                fatG: 6,
            }),
        );
        expect(food.nutritionBasis).toBe("100g");
        expect(food.calories).toBe(450);
        expect(food.proteinG).toBe(10);
        expect(food.carbsG).toBe(70);
        expect(food.fatG).toBe(15);
        expect(food.serving).toEqual({ label: "40 g", amount: 40, unit: "g" });
    });

    test("a per-serving entry in ml converts to per 100 ml", async () => {
        const { store } = setup();
        const food = await addUsualByHand(
            store,
            HH,
            hand({
                basis: "per_serving",
                serving: { amount: 30, unit: "ml" },
                calories: 39,
                proteinG: 0.9,
                carbsG: 1.2,
                fatG: 3.3,
            }),
        );
        expect(food.nutritionBasis).toBe("100ml");
        expect(food.calories).toBe(130);
        expect(food.proteinG).toBe(3);
        expect(food.carbsG).toBe(4);
        expect(food.fatG).toBe(11);
        expect(food.serving?.unit).toBe("ml");
    });

    test("a serving in each or cups is refused, naming the serving unit", async () => {
        const { store } = setup();
        for (const unit of ["each", "cup"]) {
            expect(
                await fieldOf(
                    addUsualByHand(
                        store,
                        HH,
                        hand({
                            basis: "per_serving",
                            serving: { amount: 1, unit },
                        }),
                    ),
                ),
            ).toBe("serving_unit");
        }
        expect((await store.listFoods(HH)).length).toBe(0);
    });

    test("a per-serving entry needs an amount above zero", async () => {
        const { store } = setup();
        expect(
            await fieldOf(
                addUsualByHand(
                    store,
                    HH,
                    hand({
                        basis: "per_serving",
                        serving: { amount: 0, unit: "g" },
                    }),
                ),
            ),
        ).toBe("serving_amount");
        expect(
            await fieldOf(
                addUsualByHand(store, HH, hand({ basis: "per_serving" })),
            ),
        ).toBe("serving_amount");
    });

    test("each missing or invalid macro is refused naming its field", async () => {
        const { store } = setup();
        const cases: [Partial<UsualByHandInput>, string][] = [
            [{ calories: null }, "calories"],
            [{ proteinG: "" }, "protein_g"],
            [{ carbsG: "abc" }, "carbs_g"],
            [{ fatG: -1 }, "fat_g"],
            [{ calories: Number.NaN }, "calories"],
        ];
        for (const [over, field] of cases) {
            expect(await fieldOf(addUsualByHand(store, HH, hand(over)))).toBe(
                field,
            );
        }
        expect((await store.listFoods(HH)).length).toBe(0);
    });

    test("zero is a valid macro, a missing name and basis are refused", async () => {
        const { store } = setup();
        const food = await addUsualByHand(
            store,
            HH,
            hand({
                name: "Water",
                calories: 0,
                proteinG: "0",
                carbsG: 0,
                fatG: 0,
            }),
        );
        expect(food.calories).toBe(0);
        expect(
            await fieldOf(addUsualByHand(store, HH, hand({ name: " " }))),
        ).toBe("name");
        expect(
            await fieldOf(
                addUsualByHand(store, HH, hand({ basis: "per_cup" as never })),
            ),
        ).toBe("basis");
    });

    test("an existing food with the same normalized name and no macros is filled", async () => {
        const { store, plain } = setup();
        const existing = await plain("Half & Half", { defaultUnit: "ml" });
        const food = await addUsualByHand(
            store,
            HH,
            hand({ name: "half & half" }),
        );
        expect(food.id).toBe(existing.id);
        expect(food.name).toBe("Half & Half");
        expect(food.calories).toBe(130);
        expect(food.nutritionBasis).toBe("100ml");
        expect(food.usualAddedAt).not.toBeNull();
        expect(
            (await store.listFoods(HH)).filter((f) => !f.genericFoodId),
        ).toHaveLength(1);
    });

    test("an existing food with equal macros is reused as is", async () => {
        const { store, plain } = setup();
        const existing = await plain("Half & Half", {
            nutritionBasis: "100ml",
            calories: 130.004,
            proteinG: 3,
            carbsG: 4,
            fatG: 11,
            nutritionSource: "openfoodfacts",
        });
        const food = await addUsualByHand(store, HH, hand());
        expect(food.id).toBe(existing.id);
        expect(food.calories).toBe(130.004);
        expect(food.nutritionSource).toBe("openfoodfacts");
        expect(food.usualAddedAt).not.toBeNull();
    });

    test("an existing food with different macros is refused naming the food and left unchanged", async () => {
        const { store, plain } = setup();
        const existing = await plain("Half & Half", {
            nutritionBasis: "100ml",
            calories: 300,
            proteinG: 3,
            carbsG: 4,
            fatG: 11,
        });
        let message = "";
        try {
            await addUsualByHand(store, HH, hand());
        } catch (err) {
            expect(err).toBeInstanceOf(UsualInputError);
            message = (err as Error).message;
        }
        expect(message).toContain("Half & Half");
        const after = (await store.getFood(HH, existing.id))!;
        expect(after.calories).toBe(300);
        expect(after.usualAddedAt).toBeNull();
    });

    test("an existing food on another basis is refused rather than compared", async () => {
        const { store, plain } = setup();
        await plain("Half & Half", {
            nutritionBasis: "100g",
            calories: 130,
            proteinG: 3,
            carbsG: 4,
            fatG: 11,
        });
        expect(await fieldOf(addUsualByHand(store, HH, hand()))).toBeNull();
    });

    test("a product with the same name is not reused", async () => {
        const { store, product } = setup();
        await product("Half & Half", { brand: null, genericFoodId: "other" });
        expect(await fieldOf(addUsualByHand(store, HH, hand()))).toBe("name");
    });

    test("a barcode is attached to a new food", async () => {
        const { store } = setup();
        const food = await addUsualByHand(
            store,
            HH,
            hand({ barcode: "0 12345 67890 5" }),
        );
        expect(await store.listBarcodes(HH, food.id)).toEqual(["012345678905"]);
        expect(await store.getBarcodeFoodId(HH, "012345678905")).toBe(food.id);
    });

    test("a barcode is attached to a reused food, and one it already has is fine", async () => {
        const { store, plain } = setup();
        const existing = await plain("Half & Half");
        await store.setBarcode(HH, "012345678905", existing.id);
        const food = await addUsualByHand(
            store,
            HH,
            hand({ barcode: "012345678905" }),
        );
        expect(food.id).toBe(existing.id);
        expect(await store.listBarcodes(HH, existing.id)).toEqual([
            "012345678905",
        ]);
    });

    test("a barcode that belongs to another food is refused and nothing is written", async () => {
        const { store, plain } = setup();
        const other = await plain("Cream");
        await store.setBarcode(HH, "012345678905", other.id);
        let message = "";
        let field: string | null = "unset";
        try {
            await addUsualByHand(store, HH, hand({ barcode: "012345678905" }));
        } catch (err) {
            message = (err as Error).message;
            field = (err as UsualInputError).field;
        }
        expect(message).toContain("Cream");
        expect(field).toBe("barcode");
        expect((await store.listFoods(HH)).map((f) => f.name)).toEqual([
            "Cream",
        ]);
    });

    test("a barcode that is not a barcode is refused", async () => {
        const { store } = setup();
        expect(
            await fieldOf(addUsualByHand(store, HH, hand({ barcode: "12" }))),
        ).toBe("barcode");
    });

    test("an unknown store is refused before the food is created", async () => {
        const { store } = setup();
        await expect(
            addUsualByHand(
                store,
                HH,
                hand({ purchase: { usualStoreId: "nope" } }),
            ),
        ).rejects.toThrow("Unknown store.");
        expect((await store.listFoods(HH)).length).toBe(0);
    });

    test("re-adding re-stamps the usual", async () => {
        const { store } = setup();
        const first = await addUsualByHand(store, HH, hand());
        await store.updateFoodRow({
            ...first,
            usualAddedAt: "2020-01-01T00:00:00.000Z",
        });
        const second = await addUsualByHand(store, HH, hand());
        expect(second.id).toBe(first.id);
        expect(second.usualAddedAt! > "2020-01-01T00:00:00.000Z").toBe(true);
    });
});

describe("usual membership", () => {
    test("a food with products is unaffected by usualAddedAt", async () => {
        const { store, plain, product } = setup();
        const eggs = await plain("Eggs");
        await product("Kirkland Eggs", { genericFoodId: eggs.id });
        const { rows } = usualProductRows({ foods: await store.listFoods(HH) });
        expect(rows.map((r) => r.food.id)).toEqual([eggs.id]);
        expect(rows[0]!.food.usualAddedAt).toBeNull();
    });

    test("a plain food with neither products nor a stamp stays addable", async () => {
        const { store, plain } = setup();
        const salt = await plain("Salt");
        const { rows, addable } = usualProductRows({
            foods: await store.listFoods(HH),
        });
        expect(rows).toEqual([]);
        expect(addable.map((f) => f.id)).toEqual([salt.id]);
    });

    test("removing the only product of a scanned usual takes it off the list", async () => {
        const { store, plain, product } = setup();
        const milk = await plain("Milk");
        const scanned = await product("Horizon Milk");
        await addUsualFromProduct(store, HH, {
            productId: scanned.id,
            foodId: milk.id,
            stores,
        });
        await removeProduct(store, HH, milk.id, scanned.id);
        const after = (await store.getFood(HH, milk.id))!;
        expect(after.usualAddedAt).toBeNull();
        expect(after.usualProductId).toBeNull();
        const listed = usualProductRows({ foods: await store.listFoods(HH) });
        expect(listed.rows).toEqual([]);
        expect(listed.addable.map((f) => f.id)).toContain(milk.id);
    });

    test("removing a scanned plain food's only stamp is removeUsual", async () => {
        const { store, plain } = setup();
        const oat = await plain("Oat milk");
        await addUsualFromProduct(store, HH, { productId: oat.id, stores });
        expect(
            usualProductRows({ foods: await store.listFoods(HH) }).rows.map(
                (r) => r.food.id,
            ),
        ).toEqual([oat.id]);
        await removeUsual(store, HH, oat.id);
        expect((await store.getFood(HH, oat.id))!.usualAddedAt).toBeNull();
        expect(
            usualProductRows({ foods: await store.listFoods(HH) }).rows,
        ).toEqual([]);
    });

    test("moving the product to another food through linkProduct moves the usual with it", async () => {
        const { store, plain, product } = setup();
        const milk = await plain("Milk");
        const other = await plain("Whole milk");
        const scanned = await product("Horizon Milk");
        await addUsualFromProduct(store, HH, {
            productId: scanned.id,
            foodId: milk.id,
            stores,
        });
        await linkProduct(store, HH, scanned.id, other.id);
        const { rows } = usualProductRows({ foods: await store.listFoods(HH) });
        expect(rows.map((r) => [r.food.id, r.products.length])).toEqual([
            [other.id, 1],
        ]);
    });

    test("filing a typed usual under another food drops its stamp, so removing that food leaves nothing behind", async () => {
        const { store, plain } = setup();
        const milk = await plain("Milk");
        const oat = await addUsualByHand(store, HH, hand({ name: "Oat milk" }));
        const filed = await linkProduct(store, HH, oat.id, milk.id);
        expect(filed.usualAddedAt).toBeNull();
        expect((await store.getFood(HH, oat.id))!.genericFoodId).toBe(milk.id);
        const names = async () =>
            usualProductRows({
                foods: await store.listFoods(HH),
            }).rows.map((r) => r.food.name);
        expect(await names()).toEqual(["Milk"]);
        await removeUsual(store, HH, milk.id);
        expect(await names()).toEqual([]);
    });

    test("linking a food to the food it already belongs to still drops its stamp", async () => {
        const { store, plain } = setup();
        const milk = await plain("Milk");
        const oat = await addUsualByHand(store, HH, hand({ name: "Oat milk" }));
        await store.updateFoodRow({ ...oat, genericFoodId: milk.id });
        const same = await linkProduct(store, HH, oat.id, milk.id);
        expect(same.usualAddedAt).toBeNull();
        expect((await store.getFood(HH, oat.id))!.usualAddedAt).toBeNull();
    });

    test("a typed usual that gains and loses a product stays listed", async () => {
        const { store, product } = setup();
        const oat = await addUsualByHand(store, HH, hand({ name: "Oat milk" }));
        const oatly = await product("Oatly");
        await linkProduct(store, HH, oatly.id, oat.id);
        await removeProduct(store, HH, oat.id, oatly.id);
        const { rows } = usualProductRows({ foods: await store.listFoods(HH) });
        expect(rows.map((r) => [r.food.id, r.products.length])).toEqual([
            [oat.id, 0],
        ]);
        expect((await store.getFood(HH, oat.id))!.usualAddedAt).not.toBeNull();
    });

    test("Remove on one of two products keeps the food listed", async () => {
        const { store, plain, product } = setup();
        const milk = await plain("Milk");
        const a = await product("A milk");
        const b = await product("B milk");
        await addUsualFromProduct(store, HH, {
            productId: a.id,
            foodId: milk.id,
            stores,
        });
        await setUsualProduct(store, HH, milk.id, b.id);
        await removeProduct(store, HH, milk.id, a.id);
        expect(
            usualProductRows({ foods: await store.listFoods(HH) }).rows.map(
                (r) => [r.food.id, r.products.map((p) => p.id)],
            ),
        ).toEqual([[milk.id, [b.id]]]);
    });

    test("a usual that is one only through its products behaves as before", async () => {
        const { store, plain, product } = setup();
        const eggs = await plain("Eggs");
        const kirkland = await product("Kirkland Eggs", {
            genericFoodId: eggs.id,
        });
        await removeProduct(store, HH, eggs.id, kirkland.id);
        const { rows, addable } = usualProductRows({
            foods: await store.listFoods(HH),
        });
        expect(rows).toEqual([]);
        expect(addable.map((f) => f.id)).toContain(eggs.id);
    });

    test("removeUsual takes a typed usual off the list and clears its stamp and schedule", async () => {
        const { store } = setup();
        const food = await addUsualByHand(store, HH, hand());
        await removeUsual(store, HH, food.id);
        const after = (await store.getFood(HH, food.id))!;
        expect(after.usualAddedAt).toBeNull();
        expect(
            usualProductRows({ foods: await store.listFoods(HH) }).rows,
        ).toEqual([]);
    });

    test("bulk removeUsuals handles a typed usual and a food with products", async () => {
        const { store, plain, product } = setup();
        const typed = await addUsualByHand(store, HH, hand());
        const eggs = await plain("Eggs");
        const kirkland = await product("Kirkland Eggs");
        await addUsualFromProduct(store, HH, {
            productId: kirkland.id,
            foodId: eggs.id,
            stores,
        });
        const result = await removeUsuals(store, {
            householdId: HH,
            foodIds: [typed.id, eggs.id],
        });
        expect(result).toEqual({ status: "applied", count: 2 });
        const listed = await store.listFoods(HH);
        expect(usualProductRows({ foods: listed }).rows).toEqual([]);
        expect(listed.every((f) => f.usualAddedAt == null)).toBe(true);
        expect(
            (await store.getFood(HH, kirkland.id))!.genericFoodId,
        ).toBeNull();
        expect(
            await removeUsuals(store, { householdId: HH, foodIds: [typed.id] }),
        ).toEqual({
            status: "already",
            count: 0,
        });
    });

    test("merging keeps the stamp from either side", async () => {
        const { store } = setup();
        const stamped = await addUsualByHand(store, HH, hand());
        const other = await store.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Cream" }),
        );
        const merged = await mergeFoods(store, HH, other.id, stamped.id);
        expect(merged.usualAddedAt).toBe(stamped.usualAddedAt);
    });

    test("the digest counts a typed usual at zero stock", async () => {
        const { store } = setup();
        const food = await addUsualByHand(store, HH, hand());
        const foods = await store.listFoods(HH);
        const out = usualsAtZeroForDigest({
            items: [],
            foods,
            foodsById: effectiveFoodsFromListed(foods),
            stores: [{ id: "s1" }],
        } as never);
        expect(out.map((row) => row.foodId)).toEqual([food.id]);
    });
});

describe("nameWithoutBrand", () => {
    test("drops the brand at either end, and only there", () => {
        expect(nameWithoutBrand("Kirkland Large Eggs", "Kirkland")).toBe(
            "Large Eggs",
        );
        expect(
            nameWithoutBrand("Half & Half - Member's Mark", "Member's Mark"),
        ).toBe("Half & Half");
        expect(
            nameWithoutBrand("Kirkland Signature Kirkland", "Kirkland"),
        ).toBe("Signature");
        expect(nameWithoutBrand("Eggs", null)).toBe("Eggs");
    });

    test("collapses the spaces inside a name", () => {
        expect(nameWithoutBrand("Kirkland  Large   Eggs", "Kirkland")).toBe(
            "Large Eggs",
        );
        expect(nameWithoutBrand("  Large   Eggs ", null)).toBe("Large Eggs");
    });

    test("keeps the whole name when the brand is all there is", () => {
        expect(nameWithoutBrand("Kirkland", "Kirkland")).toBe("Kirkland");
    });
});

describe("isPlainFoodRow", () => {
    test("is true only for an unfiled, unbranded, unscanned food", () => {
        expect(
            isPlainFoodRow({
                genericFoodId: null,
                brand: null,
                offSourceId: null,
            }),
        ).toBe(true);
        expect(
            isPlainFoodRow({
                genericFoodId: "x",
                brand: null,
                offSourceId: null,
            }),
        ).toBe(false);
        expect(
            isPlainFoodRow({
                genericFoodId: null,
                brand: "Kirkland",
                offSourceId: null,
            }),
        ).toBe(false);
        expect(
            isPlainFoodRow({
                genericFoodId: null,
                brand: null,
                offSourceId: "123",
            }),
        ).toBe(false);
    });
});

describe("suggestUsualFoods", () => {
    const none = new Map<string, string[]>();

    test("offers only plain foods, never another brand's product", async () => {
        const { plain, product } = setup();
        const eggs = await plain("Eggs");
        const organic = await product("Eggs", { offSourceId: "0093966000016" });
        const scanned = await product("Large Eggs", {
            brand: "Kirkland",
            offSourceId: "0096619000000",
        });
        const result = suggestUsualFoods(
            scanned,
            [eggs, organic, scanned],
            none,
        );
        expect(result.filed).toBeNull();
        expect(result.matches.map((f) => f.id)).toEqual([eggs.id]);
    });

    test("puts the food a product is filed under first, and not again in the matches", async () => {
        const { plain, product } = setup();
        const eggs = await plain("Eggs");
        const scanned = await product("Large Eggs", {
            brand: "Kirkland",
            genericFoodId: eggs.id,
        });
        const result = suggestUsualFoods(scanned, [eggs, scanned], none);
        expect(result.filed?.id).toBe(eggs.id);
        expect(result.matches).toEqual([]);
    });

    test("a search replaces the name match", async () => {
        const { plain, product } = setup();
        const eggs = await plain("Eggs");
        const flour = await plain("Flour");
        const scanned = await product("Large Eggs", { brand: "Kirkland" });
        const result = suggestUsualFoods(
            scanned,
            [eggs, flour, scanned],
            none,
            "flo",
        );
        expect(result.matches.map((f) => f.id)).toEqual([flour.id]);
    });
});

describe("a typed usual's grocery line", () => {
    test("is tagged usual once it is on Usuals, and not before", async () => {
        const { store, plain } = setup();
        const cream = await plain("Cream");
        const typed = await addUsualByHand(store, HH, hand());
        const listed = await store.listFoods(HH);
        const effective = effectiveFoodsFromListed(listed);
        const tagged = (id: string) => {
            const eff = effective.get(id)!;
            return isUsualGroceryLine({
                lineFoodId: id,
                effectiveProductId: eff.product?.id,
                food: eff,
                genericOf: () => null,
            });
        };
        expect(tagged(typed.id)).toBe(true);
        expect(tagged(cream.id)).toBe(false);
    });
});

describe("addUsualFromProduct from Search", () => {
    test("a branded plain food named as its own food is added as it is", async () => {
        const { store, product } = setup();
        const butter = await product("Butter", { brand: "Kerrygold" });
        const food = await addUsualFromProduct(store, HH, {
            productId: butter.id,
            foodId: butter.id,
            stores,
        });
        expect(food.id).toBe(butter.id);
        expect(food.usualAddedAt).not.toBeNull();
        expect(food.genericFoodId).toBeNull();
    });
});

describe("the stamp never rides a merge onto a product", () => {
    async function milkWithTypedOat() {
        const store = createMemoryFoodsStore();
        const milk = await store.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Milk" }),
        );
        const silk = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Silk Oat",
                brand: "Silk",
            }),
        );
        await linkProduct(store, HH, silk.id, milk.id);
        const oat = await addUsualByHand(store, HH, {
            name: "Oat milk",
            basis: "per_100ml",
            calories: 45,
            proteinG: 1,
            carbsG: 6,
            fatG: 1.5,
            stores,
        });
        const listed = async () =>
            usualProductRows({ foods: await store.listFoods(HH) }).rows.map(
                (row) => row.food.name,
            );
        return { store, milk, silk, oat, listed };
    }

    test("merging a typed usual into a product leaves no stamp on the product", async () => {
        const { store, milk, silk, oat, listed } = await milkWithTypedOat();
        const kept = await mergeFoods(store, HH, silk.id, oat.id);
        expect(kept.genericFoodId).toBe(milk.id);
        expect(kept.usualAddedAt).toBeNull();
        await removeUsual(store, HH, milk.id);
        expect(await listed()).toEqual([]);
    });

    test("merging a product into a typed usual leaves the kept product unstamped", async () => {
        const { store, milk, silk, oat, listed } = await milkWithTypedOat();
        const kept = await mergeFoods(store, HH, oat.id, silk.id);
        expect(kept.genericFoodId).toBe(milk.id);
        expect(kept.usualAddedAt).toBeNull();
        await removeUsual(store, HH, milk.id);
        expect(await listed()).toEqual([]);
    });
});

test("a scanned catalog product is never added as its own usual", async () => {
    const store = createMemoryFoodsStore();
    const off = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Nutella",
            brand: "Ferrero",
            offSourceId: "3017620422003",
        }),
    );
    const err = await addUsualFromProduct(store, HH, {
        productId: off.id,
        foodId: off.id,
        stores,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsualInputError);
    expect((err as UsualInputError).field).toBe("food");
    const { rows } = usualProductRows({ foods: await store.listFoods(HH) });
    expect(rows).toEqual([]);
});
