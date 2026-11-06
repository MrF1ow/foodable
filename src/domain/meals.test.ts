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
    resolveAndBuildMeal,
    sumItemNutrients,
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
