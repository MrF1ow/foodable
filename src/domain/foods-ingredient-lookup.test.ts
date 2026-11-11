import { expect, test } from "bun:test";
import {
    createMemoryFoodsStore,
    findOrCreateManualFoodForRecipeImport,
    findManualFood,
    ingredientLookupVariants,
    newFood,
} from "./foods.js";

const HH = "hh-ingredient-lookup";

test("ingredientLookupVariants strips parentheticals, size and prep", () => {
    expect(
        ingredientLookupVariants("large eggs (beaten)", { plurals: false }),
    ).toEqual(["large eggs (beaten)", "large eggs", "eggs"]);
    expect(
        ingredientLookupVariants("fresh basil, chopped", { plurals: false }),
    ).toEqual(["fresh basil, chopped", "fresh basil", "basil"]);
    expect(
        ingredientLookupVariants("extra large eggs", { plurals: false }),
    ).toEqual(["extra large eggs", "large eggs", "eggs"]);
    expect(
        ingredientLookupVariants("extra-large eggs", { plurals: false }),
    ).toEqual(["extra-large eggs", "eggs"]);
});

test("ingredientLookupVariants adds plural-free key only when plurals", () => {
    expect(ingredientLookupVariants("large egg", { plurals: false })).toEqual([
        "large egg",
        "egg",
    ]);
    expect(ingredientLookupVariants("large egg", { plurals: true })).toEqual([
        "large egg",
        "egg",
    ]);
    expect(
        ingredientLookupVariants("large tomatoes", { plurals: false }),
    ).toEqual(["large tomatoes", "tomatoes"]);
    expect(
        ingredientLookupVariants("large tomatoes", { plurals: true }),
    ).toEqual(["large tomatoes", "tomatoes", "tomato"]);
});

test("findOrCreateManualFoodForRecipeImport links stripped names without renaming the food", async () => {
    const store = createMemoryFoodsStore();
    store.setPluralsSameFood(HH, false);
    const eggs = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );

    const linked = await findOrCreateManualFoodForRecipeImport(
        store,
        HH,
        "food",
        "large eggs (beaten)",
    );
    expect(linked.id).toBe(eggs.id);
    expect(linked.name).toBe("Eggs");
    expect(
        (await store.listFoods(HH)).filter((f) => !f.archivedAt),
    ).toHaveLength(1);
});

test("singular large egg needs plurals setting to match Eggs", async () => {
    const storeOff = createMemoryFoodsStore();
    storeOff.setPluralsSameFood(HH, false);
    const eggsOff = await storeOff.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    const off = await findOrCreateManualFoodForRecipeImport(
        storeOff,
        HH,
        "food",
        "large egg (beaten)",
    );
    expect(off.id).not.toBe(eggsOff.id);
    expect(off.name).toBe("large egg (beaten)");

    const storeOn = createMemoryFoodsStore();
    storeOn.setPluralsSameFood(HH, true);
    const eggsOn = await storeOn.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    const on = await findOrCreateManualFoodForRecipeImport(
        storeOn,
        HH,
        "food",
        "large egg (beaten)",
    );
    expect(on.id).toBe(eggsOn.id);
});

test("lookup variants never create from a stripped name when the full line is new", async () => {
    const store = createMemoryFoodsStore();
    store.setPluralsSameFood(HH, false);
    const created = await findOrCreateManualFoodForRecipeImport(
        store,
        HH,
        "food",
        "large eggs (beaten)",
    );
    expect(created.name).toBe("large eggs (beaten)");
    expect(await findManualFood(store, HH, "food", "eggs")).toBeNull();
});

test("raw name match wins over a later variant", async () => {
    const store = createMemoryFoodsStore();
    store.setPluralsSameFood(HH, false);
    const large = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Large eggs" }),
    );
    const plain = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );

    const linked = await findOrCreateManualFoodForRecipeImport(
        store,
        HH,
        "food",
        "large eggs",
    );
    expect(linked.id).toBe(large.id);
    expect(linked.id).not.toBe(plain.id);
});

test("gradual prep stripping prefers longer stored names", async () => {
    const store = createMemoryFoodsStore();
    store.setPluralsSameFood(HH, false);
    const plain = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Mozzarella" }),
    );
    const fresh = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Fresh mozzarella" }),
    );

    const chopped = await findOrCreateManualFoodForRecipeImport(
        store,
        HH,
        "food",
        "chopped fresh mozzarella",
    );
    expect(chopped.id).toBe(fresh.id);
    expect(chopped.id).not.toBe(plain.id);

    const largeFresh = await findOrCreateManualFoodForRecipeImport(
        store,
        HH,
        "food",
        "large fresh mozzarella",
    );
    expect(largeFresh.id).toBe(fresh.id);

    const diced = await findOrCreateManualFoodForRecipeImport(
        store,
        HH,
        "food",
        "fresh mozzarella, diced",
    );
    expect(diced.id).toBe(fresh.id);
    expect(fresh.name).toBe("Fresh mozzarella");
});

test("gradual stripping links small batch jam before creating", async () => {
    const store = createMemoryFoodsStore();
    store.setPluralsSameFood(HH, false);
    const jam = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Small batch jam" }),
    );

    const linked = await findOrCreateManualFoodForRecipeImport(
        store,
        HH,
        "food",
        "chopped small batch jam",
    );
    expect(linked.id).toBe(jam.id);
    expect(
        (await store.listFoods(HH)).filter((f) => !f.archivedAt),
    ).toHaveLength(1);
});

test("large olive oil links unbranded Olive oil when brand Large exists", async () => {
    const store = createMemoryFoodsStore();
    store.setPluralsSameFood(HH, false);
    const plain = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Olive oil" }),
    );
    await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Olive oil",
            brand: "Large",
        }),
    );

    const linked = await findOrCreateManualFoodForRecipeImport(
        store,
        HH,
        "food",
        "large olive oil",
    );
    expect(linked.id).toBe(plain.id);
});
