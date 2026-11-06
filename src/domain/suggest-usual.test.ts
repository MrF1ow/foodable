import { expect, test } from "bun:test";
import {
    createMemoryFoodsStore,
    findOrCreateManualFood,
    newFood,
    suggestFoodFor,
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

test("suggestFoodFor token matching", async () => {
    const store = createMemoryFoodsStore();
    const eggs = await plain(store, "Eggs");
    const milk = await plain(store, "Milk");
    await plain(store, "Oat milk", { calories: 40 });
    let foods = await store.listFoods(HH);

    expect(suggestFoodFor("Kirkland Large Eggs", foods)?.id).toBe(eggs.id);
    expect(suggestFoodFor("Fairlife 2% Milk", foods)?.id).toBe(milk.id);

    const largeEggs = await plain(store, "Large Eggs");
    foods = await store.listFoods(HH);
    expect(suggestFoodFor("Great Value Eggs", foods)?.id).toBe(eggs.id);
    expect(suggestFoodFor("Kirkland Large Eggs", foods)?.id).toBe(largeEggs.id);
    expect(suggestFoodFor("Random Widget", foods)).toBeNull();

    const solo = await plain(store, "Kirkland Large Eggs");
    foods = await store.listFoods(HH);
    expect(suggestFoodFor(solo.name, foods)?.id).not.toBe(solo.id);

    await store.updateFoodRow({
        ...(await store.getFood(HH, eggs.id))!,
        archivedAt: "2026-01-01T00:00:00Z",
    });
    const live = (await store.listFoods(HH)).filter((f) => !f.archivedAt);
    expect(suggestFoodFor("Farm Large Eggs", live)?.id).toBe(largeEggs.id);
});

test("usualProductRows needs-usual and listing", async () => {
    const store = createMemoryFoodsStore();
    const eggs = await plain(store, "Eggs");
    const milk = await plain(store, "Milk", { calories: 50 });
    const kirkland = await product(store, eggs.id, "Kirkland Large Eggs");
    await product(store, eggs.id, "Great Value Eggs");
    await store.updateFoodRow({
        ...(await store.getFood(HH, eggs.id))!,
        usualProductId: kirkland.id,
    });
    await plain(store, "Cilantro");

    const foods = await store.listFoods(HH);
    const recipeFoodIds = new Set([eggs.id, milk.id]);
    const groceryFoodIds = new Set<string>();

    const view = usualProductRows({ foods, recipeFoodIds, groceryFoodIds });
    expect(view.needsUsual.map((f) => f.name)).toEqual([]);
    expect(view.rows.map((r) => r.food.name)).toEqual(["Eggs", "Milk"]);
    const eggsRow = view.rows.find((r) => r.food.id === eggs.id)!;
    expect(eggsRow.usual?.name).toBe("Kirkland Large Eggs");
    expect(eggsRow.products).toHaveLength(2);
    expect(view.rows.some((r) => r.food.name === "Cilantro")).toBe(false);

    await store.updateFoodRow({
        ...(await store.getFood(HH, eggs.id))!,
        usualProductId: null,
    });
    const cleared = usualProductRows({
        foods: await store.listFoods(HH),
        recipeFoodIds,
        groceryFoodIds,
    });
    expect(cleared.needsUsual.map((f) => f.name)).toEqual(["Eggs"]);
    expect(cleared.rows.find((r) => r.food.id === eggs.id)?.usual).toBeNull();
});

test("findOrCreateManualFood still works for suggest fixtures", async () => {
    const store = createMemoryFoodsStore();
    const eggs = await findOrCreateManualFood(store, HH, "food", "Eggs");
    expect(eggs.name).toBe("Eggs");
});
