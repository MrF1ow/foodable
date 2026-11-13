import { test, expect } from "bun:test";
import {
    addRecipeIngredientByBarcode,
    createMemoryRecipesStore,
    createRecipe,
} from "./recipes.js";
import {
    createMemoryFoodsStore,
    findOrCreateManualFood,
    updateFood,
    type Food,
} from "./foods.js";
import {
    buildMealFromItems,
    descriptionFromItems,
    itemListDigest,
    MealItemsError,
    recentLogDistinctKey,
    relogMeal,
    relogSlotMeals,
    resolveAndBuildMeal,
    sumItemNutrients,
    type RelogStoredItem,
} from "./meals.js";
import type { FoodResult } from "../foods.js";

const HH = "hh-1";

async function catalogFood(
    foods: ReturnType<typeof createMemoryFoodsStore>,
    name: string,
    patch: Parameters<typeof updateFood>[3] & { defaultUnit?: string },
): Promise<Food> {
    const created = await findOrCreateManualFood(foods, HH, "food", name);
    return updateFood(foods, HH, created.id, patch);
}

test("totals equal the sum of item snapshots", async () => {
    const foods = createMemoryFoodsStore();
    const eggs = await catalogFood(foods, "Eggs", {
        defaultUnit: "each",
        gramsPerEach: 50,
        calories: 155,
        proteinG: 13,
        carbsG: 1.1,
        fatG: 11,
        fiberG: 0,
        sugarG: 1.1,
        caffeineMg: 0,
    });
    const toast = await catalogFood(foods, "Toast", {
        defaultUnit: "each",
        gramsPerEach: 30,
        calories: 265,
        proteinG: 9,
        carbsG: 49,
        fatG: 3.2,
        fiberG: 2.7,
        sugarG: 5,
        caffeineMg: 0,
    });
    const built = buildMealFromItems(
        [
            { foodId: eggs.id, amount: 2, unit: "each" },
            { foodId: toast.id, amount: 1, unit: "each" },
        ],
        new Map([
            [eggs.id, eggs],
            [toast.id, toast],
        ]),
    );
    expect(built.items).toHaveLength(2);
    expect(built.items[0]!.grams).toBe(100);
    expect(built.items[1]!.grams).toBe(30);
    expect(built.totals).toEqual(sumItemNutrients(built.items));
    expect(built.totals.calories).toBe(
        (built.items[0]!.calories ?? 0) + (built.items[1]!.calories ?? 0),
    );
    expect(descriptionFromItems(built.items)).toBe(
        "2 each Eggs + 1 each Toast",
    );
});

test("a food without nutrition makes that item's nutrients null without zeroing the meal", async () => {
    const foods = createMemoryFoodsStore();
    const eggs = await catalogFood(foods, "Eggs", {
        defaultUnit: "each",
        gramsPerEach: 50,
        calories: 155,
        proteinG: 13,
        carbsG: 1.1,
        fatG: 11,
        fiberG: 0,
        sugarG: 1.1,
    });
    const mystery = await catalogFood(foods, "Mystery", {
        defaultUnit: "g",
    });
    const built = buildMealFromItems(
        [
            { foodId: eggs.id, amount: 2, unit: "each" },
            { foodId: mystery.id, amount: 40, unit: "g" },
        ],
        new Map([
            [eggs.id, eggs],
            [mystery.id, mystery],
        ]),
    );
    expect(built.items[1]!.calories).toBeNull();
    expect(built.items[1]!.protein_g).toBeNull();
    expect(built.items[1]!.unknown).toBe(true);
    expect(built.unknownItems).toContain("Mystery");
    expect(built.totals.calories).toBe(built.items[0]!.calories);
    expect(built.totals.protein_g).toBe(built.items[0]!.protein_g);
    expect(built.totals.calories).not.toBe(0);
});

test("later food edits do not change logged meal snapshots", async () => {
    const foods = createMemoryFoodsStore();
    const eggs = await catalogFood(foods, "Eggs", {
        defaultUnit: "each",
        gramsPerEach: 50,
        calories: 155,
        proteinG: 13,
        carbsG: 1,
        fatG: 11,
    });
    const built = buildMealFromItems(
        [{ foodId: eggs.id, amount: 2, unit: "each" }],
        new Map([[eggs.id, eggs]]),
    );
    const loggedCalories = built.items[0]!.calories;
    const edited = await updateFood(foods, HH, eggs.id, { calories: 999 });
    expect(edited.calories).toBe(999);
    expect(built.items[0]!.calories).toBe(loggedCalories);
    expect(built.totals.calories).toBe(loggedCalories);
});

test("recipe items snapshot macrosForPerson for the requested portions", async () => {
    const recipes = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "alice",
        name: "Mac",
        yieldPortions: 4,
    });
    await addRecipeIngredientByBarcode(
        recipes,
        foods,
        {
            householdId: HH,
            recipeId: recipe.id,
            barcode: "070852010016",
            amount: 400,
        },
        {
            lookup: async () =>
                ({
                    name: "Cottage Cheese",
                    brand: null,
                    serving: "100 g",
                    calories: 98,
                    protein_g: 11,
                    carbs_g: 3,
                    fat_g: 4.3,
                    fiber_g: 0,
                    sugar_g: 3,
                    alcohol_g: null,
                    nutriscore_grade: null,
                    nova_group: null,
                    source: "off:070852010016",
                    source_name: "openfoodfacts",
                    barcode: "070852010016",
                }) satisfies FoodResult,
        },
    );
    const result = await resolveAndBuildMeal({
        householdId: HH,
        foods,
        recipes,
        items: [{ recipeId: recipe.id, portions: 1 }],
    });
    expect(result.built.items[0]!.recipeId).toBe(recipe.id);
    expect(result.built.items[0]!.portions).toBe(1);
    expect(result.built.totals.calories).toBe(98);
    expect(result.built.totals.protein_g).toBe(11);
});

test("resolveAndBuildMeal find-or-creates a named food", async () => {
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const first = await resolveAndBuildMeal({
        householdId: HH,
        foods,
        recipes,
        items: [{ name: "Eggs", amount: 2, unit: "each" }],
    });
    const again = await resolveAndBuildMeal({
        householdId: HH,
        foods,
        recipes,
        items: [{ name: "eggs ", amount: 1, unit: "each" }],
    });
    expect(first.specs[0]!.foodId).toBe(again.specs[0]!.foodId);
    expect(await foods.listFoods(HH)).toHaveLength(1);
});

test("itemListDigest is stable and changes when the item list changes", () => {
    const a = itemListDigest([
        { foodId: "f1", amount: 2, unit: "each" },
        { foodId: "f2", amount: 1, unit: "each" },
    ]);
    const b = itemListDigest([
        { foodId: "f1", amount: 2, unit: "each" },
        { foodId: "f2", amount: 1, unit: "each" },
    ]);
    const c = itemListDigest([
        { foodId: "f1", amount: 3, unit: "each" },
        { foodId: "f2", amount: 1, unit: "each" },
    ]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
});

test("recipe portion with unmeasured ingredient marks nutrition unknown", async () => {
    const recipes = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const flour = await findOrCreateManualFood(foods, HH, "food", "Flour");
    await updateFood(foods, HH, flour.id, {
        calories: 364,
        proteinG: 10,
        carbsG: 76,
        fatG: 1,
    });
    const salt = await findOrCreateManualFood(foods, HH, "food", "Salt");
    await updateFood(foods, HH, salt.id, {
        calories: 9999,
        proteinG: 999,
        carbsG: 999,
        fatG: 999,
    });
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "alice",
        name: "Bread",
        yieldPortions: 1,
    });
    await recipes.insertIngredient({
        id: "i-flour",
        householdId: HH,
        recipeId: recipe.id,
        kind: "food",
        displayName: "Flour",
        quantity: { amount: 100, unit: "g" },
        foodId: flour.id,
        sortOrder: 0,
        note: null,
    });
    await recipes.insertIngredient({
        id: "i-salt",
        householdId: HH,
        recipeId: recipe.id,
        kind: "food",
        displayName: "Salt",
        quantity: null,
        foodId: salt.id,
        sortOrder: 1,
        note: "to taste",
    });
    const result = await resolveAndBuildMeal({
        householdId: HH,
        foods,
        recipes,
        items: [{ recipeId: recipe.id, portions: 1 }],
    });
    expect(result.built.items[0]!.unknown).toBe(true);
    expect(result.built.totals.calories).toBe(364);
    expect(result.built.totals.protein_g).toBe(10);
    expect(result.built.totals.carbs_g).toBe(76);
    expect(result.built.totals.fat_g).toBe(1);
});

test("relogMeal re-snapshots when catalog nutrition changed", async () => {
    const foods = createMemoryFoodsStore();
    const eggs = await catalogFood(foods, "Eggs", {
        defaultUnit: "each",
        gramsPerEach: 50,
        calories: 80,
        proteinG: 6,
        carbsG: 0,
        fatG: 5,
        fiberG: 0,
        sugarG: 0,
    });
    const built = buildMealFromItems(
        [{ foodId: eggs.id, amount: 2, unit: "each" }],
        new Map([[eggs.id, eggs]]),
    );
    const snap = built.items[0]!;
    const row: RelogStoredItem = {
        food_id: eggs.id,
        recipe_id: null,
        label: snap.label,
        amount: 2,
        unit: "each",
        grams: snap.grams,
        portions: null,
        calories: snap.calories,
        protein_g: snap.protein_g,
        carbs_g: snap.carbs_g,
        fat_g: snap.fat_g,
        fiber_g: snap.fiber_g,
        sugar_g: snap.sugar_g,
        alcohol_g: snap.alcohol_g,
        caffeine_mg: snap.caffeine_mg,
    };
    const edited = await catalogFood(foods, "Eggs", {
        defaultUnit: "each",
        gramsPerEach: 50,
        calories: 100,
        proteinG: 8,
        carbsG: 0,
        fatG: 5,
        fiberG: 0,
        sugarG: 0,
    });
    const again = relogMeal(
        {
            meal_type: "breakfast",
            description: built.items.map((i) => i.label).join(""),
            calories: built.totals.calories,
            protein_g: built.totals.protein_g,
            carbs_g: built.totals.carbs_g,
            fat_g: built.totals.fat_g,
            fiber_g: built.totals.fiber_g,
            sugar_g: built.totals.sugar_g,
            alcohol_g: built.totals.alcohol_g,
            caffeine_mg: built.totals.caffeine_mg,
        },
        [row],
        new Map([[edited.id, edited]]),
        "2026-03-02T12:00:00.000Z",
    );
    expect(again.calories).toBe(100);
    expect(again.protein_g).toBe(8);
});

test("relogMeal keeps snapshot when the food was deleted", async () => {
    const foods = createMemoryFoodsStore();
    const eggs = await catalogFood(foods, "Eggs", {
        defaultUnit: "each",
        gramsPerEach: 50,
        calories: 80,
        proteinG: 6,
        carbsG: 0,
        fatG: 5,
        fiberG: 0,
        sugarG: 0,
    });
    const built = buildMealFromItems(
        [{ foodId: eggs.id, amount: 1, unit: "each" }],
        new Map([[eggs.id, eggs]]),
    );
    const snap = built.items[0]!;
    const row: RelogStoredItem = {
        food_id: eggs.id,
        recipe_id: null,
        label: snap.label,
        amount: 1,
        unit: "each",
        grams: snap.grams,
        portions: null,
        calories: snap.calories,
        protein_g: snap.protein_g,
        carbs_g: snap.carbs_g,
        fat_g: snap.fat_g,
        fiber_g: snap.fiber_g,
        sugar_g: snap.sugar_g,
        alcohol_g: snap.alcohol_g,
        caffeine_mg: snap.caffeine_mg,
    };
    const again = relogMeal(
        {
            meal_type: "lunch",
            description: snap.label,
            calories: snap.calories,
            protein_g: snap.protein_g,
            carbs_g: snap.carbs_g,
            fat_g: snap.fat_g,
            fiber_g: snap.fiber_g,
            sugar_g: snap.sugar_g,
            alcohol_g: snap.alcohol_g,
            caffeine_mg: snap.caffeine_mg,
        },
        [row],
        new Map(),
        "2026-03-02T12:00:00.000Z",
    );
    expect(again.items).toHaveLength(1);
    expect(again.items![0]!.unknown).toBe(true);
    expect(again.items![0]!.calories).toBe(snap.calories ?? null);
    expect(again.calories).toBe(snap.calories ?? undefined);
});

test("relogMeal keeps snapshot when the food was archived", async () => {
    const foods = createMemoryFoodsStore();
    const eggs = await catalogFood(foods, "Eggs", {
        defaultUnit: "each",
        gramsPerEach: 50,
        calories: 80,
        proteinG: 6,
        carbsG: 0,
        fatG: 5,
        fiberG: 0,
        sugarG: 0,
    });
    const built = buildMealFromItems(
        [{ foodId: eggs.id, amount: 1, unit: "each" }],
        new Map([[eggs.id, eggs]]),
    );
    const snap = built.items[0]!;
    const row: RelogStoredItem = {
        food_id: eggs.id,
        recipe_id: null,
        label: snap.label,
        amount: 1,
        unit: "each",
        grams: snap.grams,
        portions: null,
        calories: snap.calories,
        protein_g: snap.protein_g,
        carbs_g: snap.carbs_g,
        fat_g: snap.fat_g,
        fiber_g: snap.fiber_g,
        sugar_g: snap.sugar_g,
        alcohol_g: snap.alcohol_g,
        caffeine_mg: snap.caffeine_mg,
    };
    const archived = await updateFood(foods, HH, eggs.id, { archived: true });
    const again = relogMeal(
        {
            meal_type: "lunch",
            description: snap.label,
            calories: snap.calories,
            protein_g: snap.protein_g,
            carbs_g: snap.carbs_g,
            fat_g: snap.fat_g,
            fiber_g: snap.fiber_g,
            sugar_g: snap.sugar_g,
            alcohol_g: snap.alcohol_g,
            caffeine_mg: snap.caffeine_mg,
        },
        [row],
        new Map([[archived.id, archived]]),
        "2026-03-02T12:00:00.000Z",
    );
    expect(again.items![0]!.unknown).toBe(true);
    expect(again.items![0]!.calories).toBe(snap.calories ?? null);
});

test("relogMeal copies free-text totals unchanged", () => {
    const again = relogMeal(
        {
            meal_type: "dinner",
            description: "Pizza night",
            calories: 800,
            protein_g: 30,
            carbs_g: 90,
            fat_g: 40,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            caffeine_mg: null,
            notes: "shared",
        },
        [],
        new Map(),
        "2026-03-02T18:00:00.000Z",
    );
    expect(again.description).toBe("Pizza night");
    expect(again.calories).toBe(800);
    expect(again.notes).toBe("shared");
    expect(again.items).toBeUndefined();
});

test("relogSlotMeals merges yesterday slot items into one meal", async () => {
    const foods = createMemoryFoodsStore();
    const eggs = await catalogFood(foods, "Eggs", {
        defaultUnit: "each",
        gramsPerEach: 50,
        calories: 80,
        proteinG: 6,
        carbsG: 0,
        fatG: 5,
        fiberG: 0,
        sugarG: 0,
    });
    const toast = await catalogFood(foods, "Toast", {
        defaultUnit: "each",
        gramsPerEach: 30,
        calories: 100,
        proteinG: 3,
        carbsG: 18,
        fatG: 2,
        fiberG: 1,
        sugarG: 2,
    });
    const catalog = new Map([
        [eggs.id, eggs],
        [toast.id, toast],
    ]);
    const line = (foodId: string, amount: number): RelogStoredItem => {
        const built = buildMealFromItems(
            [{ foodId, amount, unit: "each" }],
            catalog,
        );
        const snap = built.items[0]!;
        return {
            food_id: foodId,
            recipe_id: null,
            label: snap.label,
            amount,
            unit: "each",
            grams: snap.grams,
            portions: null,
            calories: snap.calories,
            protein_g: snap.protein_g,
            carbs_g: snap.carbs_g,
            fat_g: snap.fat_g,
            fiber_g: snap.fiber_g,
            sugar_g: snap.sugar_g,
            alcohol_g: snap.alcohol_g,
            caffeine_mg: snap.caffeine_mg,
        };
    };
    const merged = relogSlotMeals(
        [
            {
                meal_type: "breakfast",
                description: "Eggs",
                calories: 80,
                protein_g: 6,
                carbs_g: 0,
                fat_g: 5,
                fiber_g: 0,
                sugar_g: 0,
                alcohol_g: null,
                caffeine_mg: null,
                items: [line(eggs.id, 1)],
            },
            {
                meal_type: "breakfast",
                description: "Toast",
                calories: 100,
                protein_g: 3,
                carbs_g: 18,
                fat_g: 2,
                fiber_g: 1,
                sugar_g: 2,
                alcohol_g: null,
                caffeine_mg: null,
                items: [line(toast.id, 1)],
            },
        ],
        "breakfast",
        catalog,
        "2026-03-02T08:00:00.000Z",
    );
    expect(merged?.items).toHaveLength(2);
    expect(merged?.calories).toBe(70);
});

test("relogSlotMeals includes free-text meals when the slot has item logs", async () => {
    const foods = createMemoryFoodsStore();
    const eggs = await catalogFood(foods, "Eggs", {
        defaultUnit: "each",
        gramsPerEach: 50,
        calories: 80,
        proteinG: 6,
        carbsG: 0,
        fatG: 5,
        fiberG: 0,
        sugarG: 0,
    });
    const catalog = new Map([[eggs.id, eggs]]);
    const built = buildMealFromItems(
        [{ foodId: eggs.id, amount: 1, unit: "each" }],
        catalog,
    );
    const snap = built.items[0]!;
    const row: RelogStoredItem = {
        food_id: eggs.id,
        recipe_id: null,
        label: snap.label,
        amount: 1,
        unit: "each",
        grams: snap.grams,
        portions: null,
        calories: snap.calories,
        protein_g: snap.protein_g,
        carbs_g: snap.carbs_g,
        fat_g: snap.fat_g,
        fiber_g: snap.fiber_g,
        sugar_g: snap.sugar_g,
        alcohol_g: snap.alcohol_g,
        caffeine_mg: snap.caffeine_mg,
    };
    const merged = relogSlotMeals(
        [
            {
                meal_type: "breakfast",
                description: "Coffee",
                calories: 5,
                protein_g: 0,
                carbs_g: 1,
                fat_g: 0,
                fiber_g: 0,
                sugar_g: 0,
                alcohol_g: null,
                caffeine_mg: 95,
            },
            {
                meal_type: "breakfast",
                description: "Eggs",
                calories: snap.calories,
                protein_g: snap.protein_g,
                carbs_g: snap.carbs_g,
                fat_g: snap.fat_g,
                fiber_g: snap.fiber_g,
                sugar_g: snap.sugar_g,
                alcohol_g: snap.alcohol_g,
                caffeine_mg: snap.caffeine_mg,
                items: [row],
            },
        ],
        "breakfast",
        catalog,
        "2026-03-02T08:00:00.000Z",
    );
    expect(merged?.description).toContain("Coffee");
    expect(merged?.description).toContain("Eggs");
    expect(merged?.calories).toBe((snap.calories ?? 0) + 5);
    expect(merged?.caffeine_mg).toBe((snap.caffeine_mg ?? 0) + 95);
    // The free-text log rides along as a label-only item, so the meal's
    // totals stay the sum of its items (an amount edit re-sums them).
    expect(merged?.items?.map((item) => item.label)).toContain("Coffee");
    expect(sumItemNutrients(merged?.items ?? []).calories).toBe(
        merged?.calories ?? null,
    );
});

test("relogMeal keeps a recipe line's logged name and counts archived ingredients", async () => {
    const recipes = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const beans = await catalogFood(foods, "Beans", {
        calories: 100,
        proteinG: 7,
        carbsG: 15,
        fatG: 1,
        fiberG: 6,
        sugarG: 1,
    });
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "alice",
        name: "Chili",
        yieldPortions: 1,
    });
    await recipes.insertIngredient({
        id: "i-beans",
        householdId: HH,
        recipeId: recipe.id,
        kind: "food",
        displayName: "Beans",
        quantity: { amount: 100, unit: "g" },
        foodId: beans.id,
        sortOrder: 0,
        note: null,
    });
    const ingredients = await recipes.listIngredients(HH, recipe.id);
    const source = new Map([[recipe.id, { recipe, ingredients }]]);
    const archived = { ...beans, archivedAt: "2026-03-01T00:00:00.000Z" };
    const again = relogMeal(
        {
            meal_type: "dinner",
            description: "1 portion Chili night",
            calories: 100,
            protein_g: 7,
            carbs_g: 15,
            fat_g: 1,
            fiber_g: 6,
            sugar_g: 1,
            alcohol_g: null,
            caffeine_mg: null,
        },
        [
            {
                food_id: null,
                recipe_id: recipe.id,
                label: "Chili night",
                amount: null,
                unit: null,
                grams: null,
                portions: 1,
                calories: 100,
                protein_g: 7,
                carbs_g: 15,
                fat_g: 1,
                fiber_g: 6,
                sugar_g: 1,
                alcohol_g: null,
                caffeine_mg: null,
            },
        ],
        new Map([[beans.id, archived]]),
        "2026-03-02T19:00:00.000Z",
        source,
    );
    expect(again.calories).toBe(100);
    expect(again.items?.[0]?.label).toBe("Chili night");
});

test("recentLogDistinctKey treats identical food sets as one", async () => {
    const foods = createMemoryFoodsStore();
    const eggs = await catalogFood(foods, "Eggs", {
        defaultUnit: "each",
        gramsPerEach: 50,
        calories: 80,
        proteinG: 6,
        carbsG: 0,
        fatG: 5,
        fiberG: 0,
        sugarG: 0,
    });
    const spec = { foodId: eggs.id, amount: 2, unit: "each" as const };
    const items = buildMealFromItems([spec], new Map([[eggs.id, eggs]])).items;
    const row: RelogStoredItem = {
        food_id: eggs.id,
        recipe_id: null,
        label: items[0]!.label,
        amount: 2,
        unit: "each",
        grams: items[0]!.grams,
        portions: null,
        calories: items[0]!.calories,
        protein_g: items[0]!.protein_g,
        carbs_g: items[0]!.carbs_g,
        fat_g: items[0]!.fat_g,
        fiber_g: items[0]!.fiber_g,
        sugar_g: items[0]!.sugar_g,
        alcohol_g: items[0]!.alcohol_g,
        caffeine_mg: items[0]!.caffeine_mg,
    };
    const keyA = recentLogDistinctKey({
        description: "A",
        items: [row],
    });
    const keyB = recentLogDistinctKey({
        description: "B",
        items: [row],
    });
    expect(keyA).toBe(keyB);
    const keyText = recentLogDistinctKey({ description: "  Pizza  Night " });
    expect(keyText).toBe("text:pizza night");
});

test("recentLogDistinctKey is order-insensitive for items", async () => {
    const foods = createMemoryFoodsStore();
    const eggs = await catalogFood(foods, "Eggs", {
        defaultUnit: "each",
        gramsPerEach: 50,
        calories: 80,
        proteinG: 6,
        carbsG: 0,
        fatG: 5,
        fiberG: 0,
        sugarG: 0,
    });
    const toast = await catalogFood(foods, "Toast", {
        defaultUnit: "each",
        gramsPerEach: 30,
        calories: 100,
        proteinG: 3,
        carbsG: 18,
        fatG: 2,
        fiberG: 1,
        sugarG: 2,
    });
    const catalog = new Map([
        [eggs.id, eggs],
        [toast.id, toast],
    ]);
    const storedLine = (foodId: string, amount: number): RelogStoredItem => {
        const snap = buildMealFromItems(
            [{ foodId, amount, unit: "each" }],
            catalog,
        ).items[0]!;
        return {
            food_id: foodId,
            recipe_id: null,
            label: snap.label,
            amount,
            unit: "each",
            grams: snap.grams,
            portions: null,
            calories: snap.calories,
            protein_g: snap.protein_g,
            carbs_g: snap.carbs_g,
            fat_g: snap.fat_g,
            fiber_g: snap.fiber_g,
            sugar_g: snap.sugar_g,
            alcohol_g: snap.alcohol_g,
            caffeine_mg: snap.caffeine_mg,
        };
    };
    const a = storedLine(eggs.id, 1);
    const b = storedLine(toast.id, 1);
    expect(recentLogDistinctKey({ description: "A", items: [a, b] })).toBe(
        recentLogDistinctKey({ description: "B", items: [b, a] }),
    );
});

test("unknown food or recipe ids fail closed", () => {
    expect(() =>
        buildMealFromItems(
            [{ foodId: "missing", amount: 1, unit: "g" }],
            new Map(),
        ),
    ).toThrow(MealItemsError);
    expect(() =>
        buildMealFromItems(
            [{ recipeId: "missing", portions: 1 }],
            new Map(),
            new Map(),
        ),
    ).toThrow(MealItemsError);
});

/** The columns are per 100 ml, as OFF reports a liquid (updateFood has no basis field). */
async function perMl(
    foods: ReturnType<typeof createMemoryFoodsStore>,
    food: Food,
    serving: Food["serving"],
): Promise<Food> {
    const saved = await foods.updateFoodRow({
        ...food,
        nutritionBasis: "100ml",
        serving,
    });
    return saved!;
}

test("a per-100 ml food logged in ml scales by the amount, with no density", async () => {
    const foods = createMemoryFoodsStore();
    // 40 kcal in a 30 ml serving is 133.3 kcal per 100 ml.
    const halfAndHalf = await perMl(
        foods,
        await catalogFood(foods, "Half & Half", {
            calories: (40 / 30) * 100,
            fatG: 10,
        }),
        { label: "1 tbsp (30 ml)", amount: 30, unit: "ml" },
    );
    const built = buildMealFromItems(
        [{ foodId: halfAndHalf.id, amount: 30, unit: "ml" }],
        new Map([[halfAndHalf.id, halfAndHalf]]),
    );
    const item = built.items[0]!;
    expect(item.calories).toBe(40);
    expect(item.fat_g).toBe(3);
    expect(item.amount).toBe(30);
    expect(item.unit).toBe("ml");
    // No density, so no grams were guessed.
    expect(item.grams).toBeNull();
    expect(item.unknown).toBe(false);
    expect(built.totals.calories).toBe(40);
    expect(built.unknownItems).toEqual([]);
});

test("a per-100 ml food with a density still scales by ml, not by guessed grams", async () => {
    const foods = createMemoryFoodsStore();
    const cream = await perMl(
        foods,
        await catalogFood(foods, "Cream", { calories: 200, gramsPerMl: 1.2 }),
        null,
    );
    const built = buildMealFromItems(
        [{ foodId: cream.id, amount: 50, unit: "ml" }],
        new Map([[cream.id, cream]]),
    );
    expect(built.items[0]!.calories).toBe(100);
    expect(built.items[0]!.grams).toBe(60);
});

test("a per-100 g food in ml still needs a density", async () => {
    const foods = createMemoryFoodsStore();
    const honey = await catalogFood(foods, "Honey", {
        calories: 300,
        gramsPerMl: 1.4,
    });
    const noDensity = await catalogFood(foods, "Syrup", { calories: 300 });
    const byDensity = buildMealFromItems(
        [{ foodId: honey.id, amount: 10, unit: "ml" }],
        new Map([[honey.id, honey]]),
    );
    expect(byDensity.items[0]!.calories).toBe(42);
    const unknown = buildMealFromItems(
        [{ foodId: noDensity.id, amount: 10, unit: "ml" }],
        new Map([[noDensity.id, noDensity]]),
    );
    expect(unknown.items[0]!.unknown).toBe(true);
    expect(unknown.items[0]!.calories).toBeNull();
});

/** What the old log sheet stored for 30 g of a per-100 ml food: grams, with the kcal it showed. */
function loggedGramItem(foodId: string): RelogStoredItem {
    return {
        food_id: foodId,
        recipe_id: null,
        label: "Half & Half",
        amount: 30,
        unit: "g",
        grams: 30,
        portions: null,
        calories: 39,
        protein_g: null,
        carbs_g: null,
        fat_g: 3.3,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        caffeine_mg: null,
    };
}

async function perMlHalfAndHalf(): Promise<Food> {
    const foods = createMemoryFoodsStore();
    return perMl(
        foods,
        await catalogFood(foods, "Half & Half", { calories: 130, fatG: 11 }),
        null,
    );
}

function relogOf(item: RelogStoredItem, food: Food) {
    return relogMeal(
        {
            meal_type: "breakfast",
            description: "30 g Half & Half",
            calories: item.calories,
            protein_g: null,
            carbs_g: null,
            fat_g: item.fat_g,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            caffeine_mg: null,
            items: [item],
        },
        [item],
        new Map([[food.id, food]]),
        "2026-11-13T12:00:00.000Z",
    );
}

test("Again on a gram item of a per-100 ml food keeps the figures it was logged with", async () => {
    const food = await perMlHalfAndHalf();
    const out = relogOf(loggedGramItem(food.id), food);
    expect(out.calories).toBe(39);
    expect(out.fat_g).toBe(3.3);
    const item = out.items![0]!;
    expect(item.calories).toBe(39);
    expect(item.amount).toBe(30);
    expect(item.unit).toBe("g");
    expect(item.grams).toBe(30);
    expect(item.unknown).toBe(false);
});

test("copying a slot keeps a gram item of a per-100 ml food at its logged figures", async () => {
    const food = await perMlHalfAndHalf();
    const item = loggedGramItem(food.id);
    const out = relogSlotMeals(
        [
            {
                meal_type: "breakfast",
                description: "30 g Half & Half",
                calories: 39,
                protein_g: null,
                carbs_g: null,
                fat_g: 3.3,
                fiber_g: null,
                sugar_g: null,
                alcohol_g: null,
                caffeine_mg: null,
                items: [item],
            },
        ],
        "breakfast",
        new Map([[food.id, food]]),
        "2026-11-13T12:00:00.000Z",
    );
    expect(out?.calories).toBe(39);
    expect(out?.items?.[0]?.calories).toBe(39);
});

test("a logged item whose unit the food cannot scale rescales its own snapshot by the amount ratio", async () => {
    const food = await perMlHalfAndHalf();
    const logged = loggedGramItem(food.id);
    const at = (amount: number, unit = "g") =>
        buildMealFromItems(
            [
                {
                    foodId: food.id,
                    amount,
                    unit,
                    logged: { ...logged, amount: 30, unit: "g" },
                },
            ],
            new Map([[food.id, food]]),
        );
    const doubled = at(60).items[0]!;
    expect(doubled.calories).toBe(78);
    expect(doubled.fat_g).toBe(6.6);
    expect(doubled.grams).toBe(60);
    expect(doubled.unknown).toBe(false);
    // A null nutrient stays unknown, never zero.
    expect(doubled.protein_g).toBeNull();
    // Another unit is a different quantity, and the snapshot says nothing about it.
    expect(at(1, "each").items[0]!.unknown).toBe(true);
});

test("a per-100 ml food logged with no unit is measured in ml, not guessed grams", async () => {
    const food = await perMlHalfAndHalf();
    expect(food.defaultUnit).toBe("g");
    const built = buildMealFromItems(
        [{ foodId: food.id, amount: 30 }],
        new Map([[food.id, food]]),
    );
    const item = built.items[0]!;
    expect(item.unit).toBe("ml");
    expect(item.calories).toBe(39);
    expect(item.unknown).toBe(false);
    expect(built.unknownItems).toEqual([]);
});

test("a per-100 ml food keeps a volume default unit and a per-100 g food keeps grams", async () => {
    const foods = createMemoryFoodsStore();
    const cups = await perMl(
        foods,
        await catalogFood(foods, "Milk", { calories: 60, defaultUnit: "cup" }),
        null,
    );
    const bread = await catalogFood(foods, "Bread", { calories: 250 });
    const built = buildMealFromItems(
        [
            { foodId: cups.id, amount: 1 },
            { foodId: bread.id, amount: 40 },
        ],
        new Map([
            [cups.id, cups],
            [bread.id, bread],
        ]),
    );
    expect(built.items.map((i) => i.unit)).toEqual(["cup", "g"]);
    expect(built.items[1]!.calories).toBe(100);
});

test("grams of a per-100 ml food with no density stay unknown and the note says to log it in ml", async () => {
    const food = await perMlHalfAndHalf();
    const built = buildMealFromItems(
        [{ foodId: food.id, amount: 30, unit: "g" }],
        new Map([[food.id, food]]),
    );
    expect(built.items[0]!.unknown).toBe(true);
    expect(built.items[0]!.calories).toBeNull();
    expect(built.unknownItems).toHaveLength(1);
    expect(built.unknownItems[0]).toContain("Half & Half");
    expect(built.unknownItems[0]).toContain("ml");
});
