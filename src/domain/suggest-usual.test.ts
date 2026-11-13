import { expect, test } from "bun:test";
import {
    createMemoryFoodsStore,
    findOrCreateManualFood,
    newFood,
    usualProductRows,
} from "./foods.js";

const HH = "hh-suggest";

function plain(
    store: ReturnType<typeof createMemoryFoodsStore>,
    name: string,
    nutrients: Partial<ReturnType<typeof newFood>> = {},
) {
    return store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name,
            ...nutrients,
        }),
    );
}

function product(
    store: ReturnType<typeof createMemoryFoodsStore>,
    plainId: string,
    name: string,
) {
    return store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name,
            genericFoodId: plainId,
            calories: 100,
            nutritionSource: "manual",
        }),
    );
}

test("usualProductRows lists only foods with products", async () => {
    const store = createMemoryFoodsStore();
    const eggs = await plain(store, "Eggs");
    await plain(store, "Milk", { calories: 50 });
    const kirkland = await product(store, eggs.id, "Kirkland Large Eggs");
    await product(store, eggs.id, "Great Value Eggs");
    await plain(store, "Cilantro");

    // A household starts empty: plain foods without products are only
    // choices to add, whatever recipes or grocery lines use them.
    const before = usualProductRows({ foods: await store.listFoods(HH) });
    expect(before.rows.map((r) => r.food.name)).toEqual(["Eggs"]);
    expect(before.rows[0]?.usual).toBeNull();
    expect(before.rows[0]?.products.map((p) => p.name)).toEqual([
        "Great Value Eggs",
        "Kirkland Large Eggs",
    ]);
    expect(before.addable.map((f) => f.name)).toEqual(["Cilantro", "Milk"]);

    await store.updateFoodRow({
        ...(await store.getFood(HH, eggs.id))!,
        usualProductId: kirkland.id,
    });
    const after = usualProductRows({ foods: await store.listFoods(HH) });
    expect(after.rows[0]?.usual?.name).toBe("Kirkland Large Eggs");

    const empty = usualProductRows({
        foods: (await store.listFoods(HH)).filter((f) => !f.genericFoodId),
    });
    expect(empty.rows).toEqual([]);
});

test("usualProductRows skips scanned plain foods for addable", async () => {
    const store = createMemoryFoodsStore();
    const cilantro = await plain(store, "Cilantro");
    const carton = await plain(store, "Cage Free Grade A Large Eggs", {
        offSourceId: "070852010016",
    });
    const barcoded = await plain(store, "Milk");
    await store.setBarcode(HH, "1234567890123", barcoded.id);
    const barcodedIds = await store.listBarcodedFoodIds(HH);
    const { addable } = usualProductRows({
        foods: await store.listFoods(HH),
        barcodedFoodIds: barcodedIds,
    });
    expect(addable.map((f) => f.id)).toEqual([cilantro.id]);
    expect(addable.some((f) => f.id === carton.id)).toBe(false);
    expect(addable.some((f) => f.id === barcoded.id)).toBe(false);
});

test("findOrCreateManualFood still works for suggest fixtures", async () => {
    const store = createMemoryFoodsStore();
    const eggs = await findOrCreateManualFood(store, HH, "food", "Eggs");
    expect(eggs.name).toBe("Eggs");
});
