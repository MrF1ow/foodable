import { test, expect } from "bun:test";
import {
    createMemoryFoodsStore,
    findOrCreateManualFood,
    newFood,
    similarFoods,
    similarFoodsForNames,
    similarFoodsForNewName,
    SimilarFoodsError,
    findUpsertFoodByName,
    updateFood,
} from "./foods.js";
import {
    addLocation,
    addManualFood,
    addSupply,
    createMemoryFridgeStore,
} from "./fridge.js";
import {
    addGroceryManualFood,
    addGrocerySupply,
    createMemoryGroceryStore,
} from "./grocery.js";
import {
    addRecipeManualIngredient,
    createMemoryRecipesStore,
    createRecipe,
    importRecipeFromText,
} from "./recipes.js";
import { createGroceryStore, createMemorySettingsStore } from "./settings.js";
import { resolveAndBuildMeal, type MealItemSpec } from "./meals.js";

const HH = "hh-similar";

function offLookup() {
    return async () => null;
}

test("similarFoods egg matches Eggs by same_words", () => {
    const foods = [newFood({ householdId: HH, kind: "food", name: "Eggs" })];
    const hits = similarFoods("egg", foods, new Map(), { kind: "food" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.food.name).toBe("Eggs");
    expect(hits[0]!.why).toBe("same_words");
});

test("similarFoods green onion matches Green onions", () => {
    const foods = [
        newFood({ householdId: HH, kind: "food", name: "Green onions" }),
    ];
    const hits = similarFoods("green onion", foods, new Map(), {
        kind: "food",
    });
    expect(hits[0]?.why).toBe("same_words");
});

test("similarFoods chicken egg uses contains_words", () => {
    const foods = [newFood({ householdId: HH, kind: "food", name: "Eggs" })];
    const hits = similarFoods("chicken egg", foods, new Map(), {
        kind: "food",
    });
    expect(hits.some((h) => h.why === "contains_words")).toBe(true);
});

test("similarFoods branded skips contains_words", () => {
    const foods = [newFood({ householdId: HH, kind: "food", name: "Eggs" })];
    const hits = similarFoods("chicken egg", foods, new Map(), {
        kind: "food",
        branded: true,
    });
    expect(hits.every((h) => h.why !== "contains_words")).toBe(true);
});

test("similarFoods different kind never suggested", () => {
    const foods = [newFood({ householdId: HH, kind: "supply", name: "Eggs" })];
    expect(similarFoods("egg", foods, new Map(), { kind: "food" })).toEqual([]);
});

test("similarFoods archived and product rows never suggested", async () => {
    const store = createMemoryFoodsStore();
    const live = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    const archived = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Old eggs" }),
    );
    await updateFood(store, HH, archived.id, { archived: true });
    const plain = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Generic base" }),
    );
    const product = await store.insertFood({
        ...newFood({
            householdId: HH,
            kind: "food",
            name: "Brand eggs",
            brand: "Co",
        }),
        genericFoodId: plain.id,
    });
    const foods = await store.listFoods(HH);
    const hits = similarFoods("egg", foods, new Map(), { kind: "food" });
    expect(hits.map((h) => h.food.id)).toEqual([live.id]);
    expect(hits.some((h) => h.food.id === archived.id)).toBe(false);
    expect(hits.some((h) => h.food.id === product.id)).toBe(false);
});

test("similarFoods caps at three", () => {
    const foods = ["Egg foo", "Egg bar", "Egg baz", "Egg qux"].map((name) =>
        newFood({ householdId: HH, kind: "food", name }),
    );
    const hits = similarFoods("egg", foods, new Map(), { kind: "food" });
    expect(hits.length).toBeLessThanOrEqual(3);
});

test("similarFoods never returns exact, normalized alias, or own loose match", async () => {
    const store = createMemoryFoodsStore();
    const eggs = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    const flour = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "All-purpose flour" }),
    );
    await store.setAlias(HH, "Oeufs", eggs.id);
    const foods = await store.listFoods(HH);
    const aliases = await store.listAllAliases(HH);
    expect(similarFoods("Eggs", foods, aliases, { kind: "food" })).toEqual([]);
    expect(similarFoods("Oeufs", foods, aliases, { kind: "food" })).toEqual([]);
    expect(
        similarFoods("all purpose flour", foods, aliases, { kind: "food" }),
    ).toEqual([]);
});

test("similarFoods alias loose key hit is returned", async () => {
    const store = createMemoryFoodsStore();
    const flour = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Flour" }),
    );
    await store.setAlias(HH, "all-purpose flour", flour.id);
    const foods = await store.listFoods(HH);
    const aliases = await store.listAllAliases(HH);
    const hits = similarFoods("all purpose flour", foods, aliases, {
        kind: "food",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.food.id).toBe(flour.id);
});

test("similarFoods rule order same_words before contains_words before word_match", () => {
    const eggs = newFood({ householdId: HH, kind: "food", name: "Eggs" });
    const eggWhites = newFood({
        householdId: HH,
        kind: "food",
        name: "Egg whites",
    });
    const hits = similarFoods("chicken egg", [eggs, eggWhites], new Map(), {
        kind: "food",
    });
    const why = hits.map((h) => h.why);
    const sameIdx = why.indexOf("same_words");
    const containsIdx = why.indexOf("contains_words");
    const wordIdx = why.indexOf("word_match");
    if (sameIdx >= 0 && containsIdx >= 0)
        expect(sameIdx).toBeLessThan(containsIdx);
    if (containsIdx >= 0 && wordIdx >= 0) {
        expect(containsIdx).toBeLessThan(wordIdx);
    }
    expect(hits[0]!.food.name).toBe("Eggs");
});

test("similarFoods alias token sets count for rules 1 and 2", async () => {
    const store = createMemoryFoodsStore();
    const onions = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Scallions" }),
    );
    await store.setAlias(HH, "green onions", onions.id);
    const foods = await store.listFoods(HH);
    const aliases = await store.listAllAliases(HH);
    const hits = similarFoods("green onion", foods, aliases, { kind: "food" });
    expect(hits[0]?.why).toBe("same_words");
});

test("similarFoodsForNames dedupes, skips resolves, keeps order", async () => {
    const store = createMemoryFoodsStore();
    await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Milk" }),
    );
    const entries = await similarFoodsForNames(store, HH, "food", [
        "egg",
        " EGGS ",
        "whole milk",
        "Eggs",
    ]);
    expect(entries.map((e) => e.name)).toEqual(["egg", "whole milk"]);
});

test("findOrCreateManualFood ask throws without creating", async () => {
    const store = createMemoryFoodsStore();
    await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    const before = (await store.listFoods(HH)).length;
    await expect(
        findOrCreateManualFood(store, HH, "food", "egg", {
            onSimilar: "ask",
        }),
    ).rejects.toThrow(SimilarFoodsError);
    expect((await store.listFoods(HH)).length).toBe(before);
});

test("findOrCreateManualFood create and default insert", async () => {
    const store = createMemoryFoodsStore();
    await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    const food = await findOrCreateManualFood(store, HH, "food", "egg salad", {
        onSimilar: "create",
    });
    expect(food.name).toBe("egg salad");
    const again = await findOrCreateManualFood(store, HH, "food", "Spinach");
    expect(again.name).toBe("Spinach");
});

test("findOrCreateManualFood ask returns exact or alias match", async () => {
    const store = createMemoryFoodsStore();
    const eggs = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    await store.setAlias(HH, "oeufs", eggs.id);
    const byName = await findOrCreateManualFood(store, HH, "food", "eggs", {
        onSimilar: "ask",
    });
    expect(byName.id).toBe(eggs.id);
    const byAlias = await findOrCreateManualFood(store, HH, "food", "oeufs", {
        onSimilar: "ask",
    });
    expect(byAlias.id).toBe(eggs.id);
});

test("findOrCreateManualFood ask throws on alias-loose scenario", async () => {
    const store = createMemoryFoodsStore();
    const flour = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Flour" }),
    );
    await store.setAlias(HH, "all-purpose flour", flour.id);
    const before = (await store.listFoods(HH)).length;
    await expect(
        findOrCreateManualFood(store, HH, "food", "all purpose flour", {
            onSimilar: "ask",
        }),
    ).rejects.toThrow(SimilarFoodsError);
    expect((await store.listFoods(HH)).length).toBe(before);
});

test("fridge addManualFood and addSupply ask throw without writes", async () => {
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    await foods.insertFood(
        newFood({ householdId: HH, kind: "supply", name: "Foil" }),
    );
    const loc = await addLocation(fridge, HH, "Fridge");
    const foodBefore = (await foods.listFoods(HH)).length;
    const itemsBefore = (await fridge.listItems(HH)).length;
    await expect(
        addManualFood(fridge, foods, {
            householdId: HH,
            locationId: loc.id,
            name: "egg",
            amount: 1,
            onSimilar: "ask",
        }),
    ).rejects.toThrow(SimilarFoodsError);
    await expect(
        addSupply(fridge, foods, {
            householdId: HH,
            locationId: loc.id,
            name: "foi",
            amount: 1,
            unit: "roll",
            onSimilar: "ask",
        }),
    ).rejects.toThrow(SimilarFoodsError);
    expect((await foods.listFoods(HH)).length).toBe(foodBefore);
    expect((await fridge.listItems(HH)).length).toBe(itemsBefore);
});

test("grocery manual and supply ask throw without writes", async () => {
    const foods = createMemoryFoodsStore();
    const grocery = createMemoryGroceryStore();
    const settings = createMemorySettingsStore();
    await createGroceryStore(settings, HH, "Store");
    await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    await foods.insertFood(
        newFood({ householdId: HH, kind: "supply", name: "Foil" }),
    );
    const foodBefore = (await foods.listFoods(HH)).length;
    const linesBefore = (await grocery.listLines(HH)).length;
    await expect(
        addGroceryManualFood(grocery, settings, foods, {
            householdId: HH,
            name: "egg",
            onSimilar: "ask",
        }),
    ).rejects.toThrow(SimilarFoodsError);
    await expect(
        addGrocerySupply(grocery, settings, foods, {
            householdId: HH,
            name: "foi",
            unit: "roll",
            onSimilar: "ask",
        }),
    ).rejects.toThrow(SimilarFoodsError);
    expect((await foods.listFoods(HH)).length).toBe(foodBefore);
    expect((await grocery.listLines(HH)).length).toBe(linesBefore);
});

test("addRecipeManualIngredient ask throws without writes", async () => {
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u1",
        name: "Test",
        yieldPortions: 1,
    });
    const foodBefore = (await foods.listFoods(HH)).length;
    const ingBefore = (await recipes.listIngredients(HH, recipe.id)).length;
    await expect(
        addRecipeManualIngredient(recipes, foods, {
            householdId: HH,
            recipeId: recipe.id,
            name: "egg",
            onSimilar: "ask",
        }),
    ).rejects.toThrow(SimilarFoodsError);
    expect((await foods.listFoods(HH)).length).toBe(foodBefore);
    expect((await recipes.listIngredients(HH, recipe.id)).length).toBe(
        ingBefore,
    );
});

test("importRecipeFromText ask lists every similar ingredient", async () => {
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Milk" }),
    );
    await expect(
        importRecipeFromText(
            recipes,
            foods,
            {
                householdId: HH,
                creatorId: "u1",
                text: "Test",
                name: "Test",
                ingredients: [{ name: "egg" }, { name: "whole milk" }],
                onSimilar: "ask",
            },
            { lookup: offLookup() },
        ),
    ).rejects.toThrow(SimilarFoodsError);
    const err = await importRecipeFromText(
        recipes,
        foods,
        {
            householdId: HH,
            creatorId: "u1",
            text: "Test",
            name: "Test",
            ingredients: [{ name: "egg" }, { name: "whole milk" }],
            onSimilar: "ask",
        },
        { lookup: offLookup() },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SimilarFoodsError);
    expect((err as SimilarFoodsError).entries.map((e) => e.name)).toEqual([
        "egg",
        "whole milk",
    ]);
    expect(
        (err as SimilarFoodsError).entries.map(
            (e) => e.candidates[0]?.food.name,
        ),
    ).toEqual(["Eggs", "Milk"]);
    expect((await recipes.listRecipes(HH)).length).toBe(0);
    expect((await foods.listFoods(HH)).length).toBe(2);
});

test("importRecipeFromText ask empty catalog egg and eggs imports", async () => {
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const out = await importRecipeFromText(
        recipes,
        foods,
        {
            householdId: HH,
            creatorId: "u1",
            text: "Omelet",
            name: "Omelet",
            ingredients: [{ name: "egg" }, { name: "eggs" }],
            onSimilar: "ask",
        },
        { lookup: offLookup() },
    );
    expect(out.recipe.name).toBe("Omelet");
    expect((await foods.listFoods(HH)).length).toBe(2);
});

test("importRecipeFromText newFood and foodId mix", async () => {
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const milk = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Milk" }),
    );
    const out = await importRecipeFromText(
        recipes,
        foods,
        {
            householdId: HH,
            creatorId: "u1",
            text: "Shake",
            name: "Shake",
            ingredients: [
                { name: "milk", foodId: milk.id },
                { name: "protein powder", newFood: true },
            ],
            onSimilar: "ask",
        },
        { lookup: offLookup() },
    );
    expect(out.ingredients).toHaveLength(2);
    expect((await foods.listFoods(HH)).length).toBe(2);
});

test("resolveAndBuildMeal ask throws for similar item names", async () => {
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    const items: MealItemSpec[] = [{ name: "egg" }];
    const before = (await foods.listFoods(HH)).length;
    await expect(
        resolveAndBuildMeal({
            householdId: HH,
            foods,
            recipes,
            items,
            onSimilar: "ask",
        }),
    ).rejects.toThrow(SimilarFoodsError);
    expect((await foods.listFoods(HH)).length).toBe(before);
});

test("resolveAndBuildMeal newFood creates", async () => {
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    const out = await resolveAndBuildMeal({
        householdId: HH,
        foods,
        recipes,
        items: [{ name: "egg", newFood: true }],
        onSimilar: "ask",
    });
    const all = await foods.listFoods(HH);
    expect(all).toHaveLength(2);
    const created = all.find((f) => f.name === "egg");
    expect(created).toBeDefined();
    expect(out.built.items[0]?.foodId).toBe(created!.id);
});

test("resolveAndBuildMeal ask empty catalog egg and eggs", async () => {
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const out = await resolveAndBuildMeal({
        householdId: HH,
        foods,
        recipes,
        items: [{ name: "egg" }, { name: "eggs" }],
        onSimilar: "ask",
    });
    expect(out.built.items).toHaveLength(2);
    expect((await foods.listFoods(HH)).length).toBe(2);
});

test("similarFoodsForNewName upsert branded loose-name scenario", async () => {
    const store = createMemoryFoodsStore();
    await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "All-purpose flour",
            brand: "King Arthur",
        }),
    );
    await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Flour" }),
    );
    const entries = await similarFoodsForNewName(
        store,
        HH,
        "food",
        "all purpose flour",
    );
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.candidates.some((c) => c.food.name === "Flour")).toBe(
        true,
    );
});

test("similarFoodsForNewName offers the branded row upsert will not reuse", async () => {
    const store = createMemoryFoodsStore();
    const branded = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "All-purpose flour",
            brand: "King Arthur",
        }),
    );
    const resolved = await findUpsertFoodByName(
        store,
        HH,
        "food",
        "all purpose flour",
        null,
    );
    expect(resolved.kind).toBe("create");
    const entries = await similarFoodsForNewName(
        store,
        HH,
        "food",
        "all purpose flour",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.candidates.map((c) => c.food.id)).toEqual([branded.id]);
    expect(entries[0]!.candidates[0]!.why).toBe("same_words");
    expect(await store.listFoods(HH)).toHaveLength(1);
});

test("similarFoodsForNewName offers a branded row found by alias", async () => {
    const store = createMemoryFoodsStore();
    const branded = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "King Arthur Flour",
            brand: "King Arthur",
        }),
    );
    await store.setAlias(HH, "all purpose flour", branded.id);
    const resolved = await findUpsertFoodByName(
        store,
        HH,
        "food",
        "all purpose flour",
        null,
    );
    expect(resolved.kind).toBe("create");
    const entries = await similarFoodsForNewName(
        store,
        HH,
        "food",
        "all purpose flour",
    );
    expect(entries[0]?.candidates.map((c) => c.food.id)).toEqual([branded.id]);
});
