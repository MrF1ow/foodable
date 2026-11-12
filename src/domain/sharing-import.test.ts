import { describe, expect, test } from "bun:test";
import {
    createMemoryFoodsStore,
    newFood,
    type Food,
    type FoodsStore,
} from "./foods.js";
import {
    createMemoryRecipesStore,
    createRecipe,
    getRecipeView,
    ingredientGaps,
    macrosForPerson,
    type RecipesStore,
} from "./recipes.js";
import {
    parseShareDocument,
    recipeShareDocument,
    type ShareDocument,
} from "./sharing-document.js";
import {
    applySharedImport,
    importSharedRecipe,
    planSharedImport,
    uniqueRecipeName,
} from "./sharing-import.js";

const HH_A = "11111111-1111-4111-8111-111111111111";
const HH_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "33333333-3333-4333-8333-333333333333";
const USER_B = "44444444-4444-4444-8444-444444444444";

type Stores = { foods: FoodsStore; recipes: RecipesStore };

function stores(): Stores & {
    foods: ReturnType<typeof createMemoryFoodsStore>;
} {
    return {
        foods: createMemoryFoodsStore(),
        recipes: createMemoryRecipesStore(),
    };
}

const NO_NUTRITION = {
    calories: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    fiber_g: null,
    sugar_g: null,
    saturated_fat_g: null,
    alcohol_g: null,
    caffeine_mg: null,
    grams_per_ml: null,
    grams_per_each: null,
};

function doc(over: Partial<ShareDocument> = {}): ShareDocument {
    return {
        version: 1,
        name: "Lentil soup",
        portions: 4,
        instructions: "1. Rinse.\n2. Simmer.",
        tags: ["dinner", "soup"],
        ingredients: [
            {
                food_name: "Red lentils",
                amount: 300,
                unit: "g",
                food: {
                    ...NO_NUTRITION,
                    calories: 352,
                    protein_g: 24.6,
                    carbs_g: 63,
                    fat_g: 1.1,
                    fiber_g: 10.7,
                    sugar_g: 2,
                    saturated_fat_g: 0.2,
                    grams_per_ml: 0.85,
                },
            },
            {
                food_name: "Olive oil",
                amount: 2,
                unit: "tbsp",
                food: {
                    ...NO_NUTRITION,
                    calories: 884,
                    protein_g: 0,
                    carbs_g: 0,
                    fat_g: 100,
                    grams_per_ml: 0.91,
                },
            },
            {
                food_name: "Salt",
                amount: null,
                unit: null,
                food: { ...NO_NUTRITION },
            },
        ],
        ...over,
    };
}

async function insertFood(
    foods: FoodsStore,
    householdId: string,
    over: Omit<Parameters<typeof newFood>[0], "householdId" | "kind">,
): Promise<Food> {
    return foods.insertFood(newFood({ householdId, kind: "food", ...over }));
}

async function snapshotFoods(foods: FoodsStore, householdId: string) {
    return JSON.stringify(await foods.listFoods(householdId));
}

describe("planSharedImport", () => {
    test("an ingredient whose name matches a household food is matched, whatever the case or spacing", async () => {
        const s = stores();
        const lentils = await insertFood(s.foods, HH_B, {
            name: "red lentils",
            calories: 340,
        });
        const plan = await planSharedImport(
            s,
            HH_B,
            doc({
                ingredients: [
                    {
                        food_name: "  RED   Lentils ",
                        amount: 300,
                        unit: "g",
                        food: { ...NO_NUTRITION, calories: 352 },
                    },
                ],
            }),
        );
        expect(plan.ingredients).toHaveLength(1);
        expect(plan.ingredients[0]!.food).toEqual({
            kind: "matched",
            foodId: lentils.id,
            name: "red lentils",
        });
        expect(plan.newFoods).toEqual([]);
    });

    test("an alias of a household food matches", async () => {
        const s = stores();
        const scallion = await insertFood(s.foods, HH_B, {
            name: "Spring onion",
        });
        await s.foods.setAlias(HH_B, "green onion", scallion.id);
        const plan = await planSharedImport(
            s,
            HH_B,
            doc({
                ingredients: [
                    {
                        food_name: "Green onion",
                        amount: 2,
                        unit: "each",
                        food: { ...NO_NUTRITION },
                    },
                ],
            }),
        );
        expect(plan.ingredients[0]!.food).toMatchObject({
            kind: "matched",
            foodId: scallion.id,
        });
    });

    test("singular and plural are one food only when the household says so", async () => {
        const one = (plural: boolean) => async () => {
            const s = stores();
            s.foods.setPluralsSameFood(HH_B, plural);
            const egg = await insertFood(s.foods, HH_B, { name: "Egg" });
            const plan = await planSharedImport(
                s,
                HH_B,
                doc({
                    ingredients: [
                        {
                            food_name: "Eggs",
                            amount: 3,
                            unit: "each",
                            food: { ...NO_NUTRITION },
                        },
                    ],
                }),
            );
            return { plan, egg };
        };
        const on = await one(true)();
        expect(on.plan.ingredients[0]!.food).toMatchObject({
            kind: "matched",
            foodId: on.egg.id,
        });
        const off = await one(false)();
        expect(off.plan.ingredients[0]!.food).toMatchObject({
            kind: "create",
        });
        expect(off.plan.newFoods.map((f) => f.name)).toEqual(["Eggs"]);
    });

    test("a missing food is planned for creation with the shipped nutrition, nulls kept", async () => {
        const s = stores();
        const plan = await planSharedImport(s, HH_B, doc());
        expect(plan.ingredients.map((i) => i.food.kind)).toEqual([
            "create",
            "create",
            "create",
        ]);
        const [lentils, oil, salt] = plan.newFoods;
        expect(lentils).toMatchObject({
            name: "Red lentils",
            nutrition: {
                calories: 352,
                protein_g: 24.6,
                fat_g: 1.1,
                grams_per_ml: 0.85,
                grams_per_each: null,
                alcohol_g: null,
                caffeine_mg: null,
            },
        });
        // A shipped zero is a real zero; it is not confused with unknown.
        expect(oil!.nutrition.protein_g).toBe(0);
        expect(oil!.nutrition.fiber_g).toBeNull();
        expect(salt!.nutrition).toEqual(NO_NUTRITION);
    });

    test("the same name twice in one document is one new food", async () => {
        const s = stores();
        const one = doc().ingredients[0]!;
        const plan = await planSharedImport(
            s,
            HH_B,
            doc({
                ingredients: [
                    one,
                    { ...one, food_name: " red LENTILS", amount: 50 },
                ],
            }),
        );
        expect(plan.newFoods).toHaveLength(1);
        const keys = plan.ingredients.map((i) =>
            i.food.kind === "create" ? i.food.key : null,
        );
        expect(keys[0]).not.toBeNull();
        expect(keys[0]).toBe(keys[1]);
    });

    test("Egg and Eggs in one document are one new food only when the household treats plurals as one", async () => {
        const plan = async (plural: boolean) => {
            const s = stores();
            s.foods.setPluralsSameFood(HH_B, plural);
            const lines = ["Egg", "Eggs", "egg yolks"].map(
                (food_name, index) => ({
                    food_name,
                    amount: index + 1,
                    unit: "each",
                    food: { ...NO_NUTRITION, calories: 143 + index },
                }),
            );
            return planSharedImport(s, HH_B, doc({ ingredients: lines }));
        };
        const on = await plan(true);
        expect(on.newFoods.map((f) => f.name)).toEqual(["Egg", "egg yolks"]);
        const keys = on.ingredients.map((i) =>
            i.food.kind === "create" ? i.food.key : null,
        );
        expect(keys[0]).toBe(keys[1]);
        expect(keys[2]).not.toBe(keys[0]);
        // The first line's nutrition is the one the food is made from.
        expect(on.newFoods[0]!.nutrition.calories).toBe(143);

        const off = await plan(false);
        expect(off.newFoods.map((f) => f.name)).toEqual([
            "Egg",
            "Eggs",
            "egg yolks",
        ]);
    });

    test("written, Egg and Eggs with plurals on make one food shared by both lines", async () => {
        const s = stores();
        s.foods.setPluralsSameFood(HH_B, true);
        const lines = ["Egg", "Eggs"].map((food_name) => ({
            food_name,
            amount: 1,
            unit: "each",
            food: { ...NO_NUTRITION },
        }));
        const result = await importSharedRecipe(s, {
            householdId: HH_B,
            creatorId: USER_B,
            document: doc({ ingredients: lines }),
        });
        expect(result.created).toBe(2);
        expect(new Set(result.ingredients.map((i) => i.foodId)).size).toBe(1);
        expect(await s.foods.listFoods(HH_B)).toHaveLength(1);
    });

    test("a supply or an archived food of the same name is not a match", async () => {
        const s = stores();
        await s.foods.insertFood(
            newFood({ householdId: HH_B, kind: "supply", name: "Salt" }),
        );
        const archived = await insertFood(s.foods, HH_B, {
            name: "Olive oil",
        });
        await s.foods.updateFoodRow({
            ...archived,
            archivedAt: new Date().toISOString(),
        });
        const plan = await planSharedImport(s, HH_B, doc());
        expect(plan.ingredients.map((i) => i.food.kind)).toEqual([
            "create",
            "create",
            "create",
        ]);
    });

    test("another household's food of the same name is not a match", async () => {
        const s = stores();
        await insertFood(s.foods, HH_A, { name: "Red lentils" });
        const plan = await planSharedImport(s, HH_B, doc());
        expect(plan.ingredients[0]!.food.kind).toBe("create");
    });

    test("planning writes nothing", async () => {
        const s = stores();
        await insertFood(s.foods, HH_B, { name: "Red lentils" });
        const before = await snapshotFoods(s.foods, HH_B);
        await planSharedImport(s, HH_B, doc());
        expect(await snapshotFoods(s.foods, HH_B)).toBe(before);
        expect(await s.recipes.listRecipes(HH_B)).toEqual([]);
    });

    test("the recipe keeps its own name unless the household already has one by it", async () => {
        const s = stores();
        expect((await planSharedImport(s, HH_B, doc())).recipe.name).toBe(
            "Lentil soup",
        );
        await createRecipe(s.recipes, {
            householdId: HH_B,
            creatorId: USER_B,
            name: "lentil SOUP ",
            yieldPortions: 2,
        });
        const plan = await planSharedImport(s, HH_B, doc());
        expect(plan.recipe.name).toBe("Lentil soup (2)");
        expect(plan.recipe.renamedFrom).toBe("Lentil soup");
    });
});

describe("uniqueRecipeName", () => {
    test("counts up past every taken suffix, ignoring case and spacing", () => {
        expect(uniqueRecipeName("Soup", [])).toBe("Soup");
        expect(uniqueRecipeName("Soup", ["Other"])).toBe("Soup");
        expect(uniqueRecipeName("Soup", ["soup"])).toBe("Soup (2)");
        expect(uniqueRecipeName("Soup", ["Soup", "  soup (2) "])).toBe(
            "Soup (3)",
        );
        expect(uniqueRecipeName("Soup", ["Soup", "Soup (3)"])).toBe("Soup (2)");
    });

    test("a long name is cut so the suffix still fits in 200 characters", () => {
        const long = "x".repeat(200);
        const next = uniqueRecipeName(long, [long]);
        expect(next).toHaveLength(200);
        expect(next.endsWith(" (2)")).toBe(true);
        expect(next).not.toBe(long);
    });
});

describe("applySharedImport", () => {
    test("writes the recipe, its new foods and its ingredients into the household", async () => {
        const s = stores();
        const lentils = await insertFood(s.foods, HH_B, {
            name: "Red lentils",
            calories: 340,
            proteinG: 20,
        });
        const plan = await planSharedImport(s, HH_B, doc());
        const result = await applySharedImport(s, {
            householdId: HH_B,
            creatorId: USER_B,
            plan,
        });

        expect(result.recipe).toMatchObject({
            householdId: HH_B,
            creatorId: USER_B,
            name: "Lentil soup",
            yieldPortions: 4,
            instructions: "1. Rinse.\n2. Simmer.",
            tags: ["dinner", "soup"],
            verification: "verified",
            sourceUrl: null,
            notes: null,
        });
        const saved = await s.recipes.getRecipe(HH_B, result.recipe.id);
        expect(saved?.name).toBe("Lentil soup");

        const rows = await s.recipes.listIngredients(HH_B, result.recipe.id);
        expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
        expect(rows.map((r) => r.displayName)).toEqual([
            "Red lentils",
            "Olive oil",
            "Salt",
        ]);
        expect(rows.map((r) => r.quantity)).toEqual([
            { amount: 300, unit: "g" },
            { amount: 2, unit: "tbsp" },
            null,
        ]);
        expect(rows[0]!.foodId).toBe(lentils.id);
        expect(rows[2]!.note).toBe("to taste");
        for (const row of rows) {
            expect(row.householdId).toBe(HH_B);
            expect(row.recipeId).toBe(result.recipe.id);
            expect(row.foodId).not.toBeNull();
        }

        expect(result.ingredients).toEqual([
            { name: "Red lentils", foodId: lentils.id, status: "matched" },
            {
                name: "Olive oil",
                foodId: rows[1]!.foodId!,
                status: "created",
            },
            { name: "Salt", foodId: rows[2]!.foodId!, status: "created" },
        ]);
        expect(result.matched).toBe(1);
        expect(result.created).toBe(2);
        expect(result.renamedFrom).toBeNull();
    });

    test("a matched food is never modified and its own nutrition is what the recipe uses", async () => {
        const s = stores();
        const lentils = await insertFood(s.foods, HH_B, {
            name: "Red lentils",
            calories: 100,
            proteinG: 4,
            carbsG: 2,
            fatG: 3,
            gramsPerMl: 0.5,
        });
        const before = JSON.stringify(await s.foods.getFood(HH_B, lentils.id));
        const result = await importSharedRecipe(s, {
            householdId: HH_B,
            creatorId: USER_B,
            document: doc(),
        });
        expect(JSON.stringify(await s.foods.getFood(HH_B, lentils.id))).toBe(
            before,
        );
        const view = await getRecipeView(
            s.recipes,
            HH_B,
            result.recipe.id,
            USER_B,
        );
        const foodsById = await s.foods.getFoodsByIds(
            HH_B,
            view.ingredients.map((i) => i.foodId!),
        );
        // 300 g of the household's lentils at 100 kcal per 100 g: 300 kcal in
        // the pot, 4 portions. The shipped 352 kcal is not used.
        const macros = macrosForPerson(
            view.ingredients.slice(0, 1),
            4,
            1,
            foodsById,
        );
        expect(macros.calories).toBe(75);
        expect(macros.protein_g).toBe(3);
    });

    test("a created food carries the shipped nutrition and unit factors, and nothing else", async () => {
        const s = stores();
        await importSharedRecipe(s, {
            householdId: HH_B,
            creatorId: USER_B,
            document: doc(),
        });
        const foods = await s.foods.listFoods(HH_B);
        const byName = new Map(foods.map((f) => [f.name, f]));
        const lentils = byName.get("Red lentils")!;
        expect(lentils).toMatchObject({
            householdId: HH_B,
            kind: "food",
            normalizedName: "red lentils",
            brand: null,
            calories: 352,
            proteinG: 24.6,
            carbsG: 63,
            fatG: 1.1,
            fiberG: 10.7,
            sugarG: 2,
            saturatedFatG: 0.2,
            alcoholG: null,
            caffeineMg: null,
            gramsPerMl: 0.85,
            gramsPerEach: null,
            nutritionSource: "manual",
            createdBy: USER_B,
            archivedAt: null,
            offSourceId: null,
            allergens: [],
        });
        expect(byName.get("Olive oil")!.proteinG).toBe(0);
        const salt = byName.get("Salt")!;
        expect(salt.calories).toBeNull();
        expect(salt.proteinG).toBeNull();
        expect(salt.nutritionSource).toBeNull();
    });

    test("a missing unit factor stays null, so the recipe shows the gap", async () => {
        const s = stores();
        const result = await importSharedRecipe(s, {
            householdId: HH_B,
            creatorId: USER_B,
            document: doc({
                ingredients: [
                    {
                        food_name: "Egg",
                        amount: 3,
                        unit: "each",
                        food: {
                            ...NO_NUTRITION,
                            calories: 143,
                            protein_g: 12.6,
                            carbs_g: 0.7,
                            fat_g: 9.5,
                        },
                    },
                ],
            }),
        });
        const [row] = await s.recipes.listIngredients(HH_B, result.recipe.id);
        const food = (await s.foods.getFood(HH_B, row!.foodId!))!;
        expect(food.gramsPerEach).toBeNull();
        expect(ingredientGaps(row!, food)).toContain("grams_per_each");
    });

    test("one new food is shared by every line that names it", async () => {
        const s = stores();
        const one = doc().ingredients[0]!;
        const result = await importSharedRecipe(s, {
            householdId: HH_B,
            creatorId: USER_B,
            document: doc({
                ingredients: [one, { ...one, food_name: "RED LENTILS" }],
            }),
        });
        const rows = await s.recipes.listIngredients(HH_B, result.recipe.id);
        expect(rows[0]!.foodId).toBe(rows[1]!.foodId);
        expect(await s.foods.listFoods(HH_B)).toHaveLength(1);
        expect(result.created).toBe(2);
    });

    test("importing twice makes two recipes, the second named apart, and no second food", async () => {
        const s = stores();
        const first = await importSharedRecipe(s, {
            householdId: HH_B,
            creatorId: USER_B,
            document: doc(),
        });
        const foodsAfterFirst = (await s.foods.listFoods(HH_B)).length;
        const second = await importSharedRecipe(s, {
            householdId: HH_B,
            creatorId: USER_B,
            document: doc(),
        });
        const third = await importSharedRecipe(s, {
            householdId: HH_B,
            creatorId: USER_B,
            document: doc(),
        });
        expect(first.recipe.name).toBe("Lentil soup");
        expect(second.recipe.name).toBe("Lentil soup (2)");
        expect(third.recipe.name).toBe("Lentil soup (3)");
        expect(second.renamedFrom).toBe("Lentil soup");
        expect(second.created).toBe(0);
        expect(second.matched).toBe(3);
        expect((await s.foods.listFoods(HH_B)).length).toBe(foodsAfterFirst);
        expect(await s.recipes.listRecipes(HH_B)).toHaveLength(3);
    });

    test("it is household-scoped: another household's recipes and foods are untouched", async () => {
        const s = stores();
        const theirFood = await insertFood(s.foods, HH_A, {
            name: "Red lentils",
            calories: 1,
        });
        const theirRecipe = await createRecipe(s.recipes, {
            householdId: HH_A,
            creatorId: USER_A,
            name: "Lentil soup",
            yieldPortions: 2,
        });
        const beforeFoods = await snapshotFoods(s.foods, HH_A);
        const result = await importSharedRecipe(s, {
            householdId: HH_B,
            creatorId: USER_B,
            document: doc(),
        });
        expect(await snapshotFoods(s.foods, HH_A)).toBe(beforeFoods);
        expect(await s.recipes.listRecipes(HH_A)).toEqual([theirRecipe]);
        expect(result.recipe.name).toBe("Lentil soup");
        const rows = await s.recipes.listIngredients(HH_B, result.recipe.id);
        expect(rows.every((r) => r.foodId !== theirFood.id)).toBe(true);
        expect(await s.recipes.listIngredients(HH_A, result.recipe.id)).toEqual(
            [],
        );
    });

    test("the whole import runs in the transaction it is given", async () => {
        const s = stores();
        let opened = 0;
        let closed = 0;
        await importSharedRecipe(
            s,
            { householdId: HH_B, creatorId: USER_B, document: doc() },
            {
                transaction: async (fn) => {
                    opened += 1;
                    const out = await fn();
                    closed += 1;
                    return out;
                },
            },
        );
        expect([opened, closed]).toEqual([1, 1]);
    });
});

describe("round trip between two households", () => {
    test("a recipe exported from one store and imported into another has the same ingredients and amounts", async () => {
        const a = stores();
        const lentils = await insertFood(a.foods, HH_A, {
            name: "Red lentils",
            brand: "Brand A",
            calories: 352,
            proteinG: 24.6,
            carbsG: 63,
            fatG: 1.1,
            gramsPerMl: 0.85,
        });
        const egg = await insertFood(a.foods, HH_A, {
            name: "Egg",
            calories: 143,
            proteinG: 12.6,
            carbsG: 0.7,
            fatG: 9.5,
            gramsPerEach: 50,
        });
        const recipe = await createRecipe(a.recipes, {
            householdId: HH_A,
            creatorId: USER_A,
            name: "Lentil soup",
            yieldPortions: 4,
            instructions: "Simmer.",
            tags: ["soup"],
            notes: "private note",
            sourceUrl: "https://example.com/private",
        });
        for (const [i, [food, amount, unit]] of (
            [
                [lentils, 300, "g"],
                [egg, 3, "each"],
            ] as const
        ).entries()) {
            await a.recipes.insertIngredient({
                id: crypto.randomUUID(),
                householdId: HH_A,
                recipeId: recipe.id,
                kind: "food",
                displayName: food.name,
                quantity: { amount, unit },
                foodId: food.id,
                sortOrder: i,
                note: null,
            });
        }
        await a.recipes.insertIngredient({
            id: crypto.randomUUID(),
            householdId: HH_A,
            recipeId: recipe.id,
            kind: "food",
            displayName: "Mystery spice",
            quantity: null,
            foodId: null,
            sortOrder: 2,
            note: "to taste",
        });

        const exported = recipeShareDocument(
            {
                ...recipe,
                ingredients: await a.recipes.listIngredients(HH_A, recipe.id),
            },
            await a.foods.getFoodsByIds(HH_A, [lentils.id, egg.id]),
        );
        expect(exported).not.toBeNull();
        // Over the wire as text, as the importer reads it.
        const received = parseShareDocument(JSON.stringify(exported));

        const b = stores();
        // Household B already has eggs, with its own (different) numbers.
        const theirEgg = await insertFood(b.foods, HH_B, {
            name: "egg",
            calories: 150,
            gramsPerEach: 60,
        });
        const eggBefore = JSON.stringify(
            await b.foods.getFood(HH_B, theirEgg.id),
        );
        const imported = await importSharedRecipe(b, {
            householdId: HH_B,
            creatorId: USER_B,
            document: received,
        });

        expect(imported.ingredients.map((i) => [i.name, i.status])).toEqual([
            ["Red lentils", "created"],
            ["egg", "matched"],
            ["Mystery spice", "created"],
        ]);
        expect(JSON.stringify(await b.foods.getFood(HH_B, theirEgg.id))).toBe(
            eggBefore,
        );

        const rows = await b.recipes.listIngredients(HH_B, imported.recipe.id);
        expect(
            rows.map((r) => [
                r.displayName,
                r.quantity?.amount ?? null,
                r.quantity?.unit ?? null,
            ]),
        ).toEqual([
            ["Red lentils", 300, "g"],
            ["egg", 3, "each"],
            ["Mystery spice", null, null],
        ]);
        expect(imported.recipe).toMatchObject({
            name: "Lentil soup",
            yieldPortions: 4,
            instructions: "Simmer.",
            tags: ["soup"],
            notes: null,
            sourceUrl: null,
        });

        // The created lentils are the shipped ones, without the sharer's brand.
        const newLentils = (await b.foods.getFood(HH_B, rows[0]!.foodId!))!;
        expect(newLentils).toMatchObject({
            name: "Red lentils",
            brand: null,
            calories: 352,
            proteinG: 24.6,
            gramsPerMl: 0.85,
            gramsPerEach: null,
        });

        // Exporting the copy from B yields what A sent, except where B's own
        // food (the egg) wins: that is the point of "never overwrite".
        const reExported = recipeShareDocument(
            {
                ...imported.recipe,
                ingredients: rows,
            },
            await b.foods.getFoodsByIds(
                HH_B,
                rows.map((r) => r.foodId!),
            ),
        )!;
        expect({ ...reExported, ingredients: [] }).toEqual({
            ...exported!,
            ingredients: [],
        });
        expect(reExported.ingredients[0]).toEqual(exported!.ingredients[0]);
        expect(reExported.ingredients[2]).toEqual(exported!.ingredients[2]);
        expect(reExported.ingredients[1]).toMatchObject({
            food_name: "egg",
            amount: 3,
            unit: "each",
        });
        expect(reExported.ingredients[1]!.food.calories).toBe(150);
        expect(reExported.ingredients[1]!.food.grams_per_each).toBe(60);
    });
});

describe("nutrition basis on import", () => {
    function creamDoc(basis?: "100g" | "100ml"): ShareDocument {
        return doc({
            ingredients: [
                {
                    food_name: "Half & Half",
                    amount: 60,
                    unit: "ml",
                    food: {
                        ...NO_NUTRITION,
                        calories: 133.33,
                        fat_g: 10,
                        ...(basis ? { nutrition_basis: basis } : {}),
                    },
                },
            ],
        });
    }

    test("a shipped per-100 ml basis becomes the new food's basis", async () => {
        const s = stores();
        const plan = await planSharedImport(s, HH_B, creamDoc("100ml"));
        await applySharedImport(s, {
            householdId: HH_B,
            creatorId: USER_B,
            plan,
        });
        const [created] = await s.foods.listFoods(HH_B);
        expect(created?.nutritionBasis).toBe("100ml");
        expect(created?.calories).toBe(133.33);
    });

    test("a document without a basis imports with none, as before", async () => {
        const s = stores();
        const plan = await planSharedImport(s, HH_B, creamDoc());
        await applySharedImport(s, {
            householdId: HH_B,
            creatorId: USER_B,
            plan,
        });
        const [created] = await s.foods.listFoods(HH_B);
        expect(created?.nutritionBasis).toBeNull();
    });

    test("a basis on a food that ships no nutrition is ignored", async () => {
        const s = stores();
        const d = creamDoc("100ml");
        d.ingredients[0]!.food = {
            ...NO_NUTRITION,
            nutrition_basis: "100ml",
        };
        const plan = await planSharedImport(s, HH_B, d);
        await applySharedImport(s, {
            householdId: HH_B,
            creatorId: USER_B,
            plan,
        });
        const [created] = await s.foods.listFoods(HH_B);
        expect(created?.nutritionBasis).toBeNull();
    });
});
