import { describe, expect, test } from "bun:test";
import {
    createMemoryFoodsStore,
    findOrCreateManualFood,
    mergeFoods,
    newFood,
    type Food,
} from "./foods.js";
import {
    clearRecipeVariant,
    createMemoryVariantsStore,
    overrideFromRow,
    overrideToRow,
    recipeNeeds,
    setRecipeVariant,
    variantCoverage,
    variantFor,
    type RecipeVariantOverride,
} from "./recipe-variants.js";
import { createMemoryGroceryStore } from "./grocery.js";
import { addLocation, createMemoryFridgeStore } from "./fridge.js";
import { createGroceryStore, createMemorySettingsStore } from "./settings.js";
import {
    applyMovement,
    cookRecipe,
    createMemoryStockStore,
    previewCookRecipe,
} from "./stock.js";
import {
    addRecipeManualIngredient,
    addRecipeToGrocery,
    createMemoryRecipesStore,
    createRecipe,
    macrosForPerson,
    RecipeInputError,
    removeRecipeIngredient,
    updateRecipeIngredient,
    type RecipeIngredient,
} from "./recipes.js";

const HH = "hh-1";
const R = "recipe-1";
const ALICE = "alice";
const BOB = "bob";

function ing(
    id: string,
    name: string,
    amount: number | null,
    unit: string,
    foodId: string,
    sortOrder: number,
): RecipeIngredient {
    return {
        id,
        householdId: HH,
        recipeId: R,
        kind: "food",
        displayName: name,
        quantity: amount == null ? null : { amount, unit },
        foodId,
        sortOrder,
        note: null,
    };
}

let tick = 0;
function over(
    userId: string,
    action: RecipeVariantOverride["action"],
    extra: Partial<RecipeVariantOverride> = {},
): RecipeVariantOverride {
    tick += 1;
    return {
        id: `o${tick}`,
        householdId: HH,
        recipeId: R,
        userId,
        ingredientId: null,
        action,
        amount: null,
        unit: null,
        foodId: null,
        displayName: null,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toISOString(),
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toISOString(),
        ...extra,
    };
}

const PASTA = ing("i1", "Pasta", 400, "g", "f-pasta", 0);
const CHEESE = ing("i2", "Cheese", 200, "g", "f-cheese", 1);
const SALT = ing("i3", "Salt", null, "g", "f-salt", 2);
const BASE = [PASTA, CHEESE, SALT];
const recipe = { id: R, ingredients: BASE };

describe("variantFor", () => {
    test("with no overrides a version is the base", () => {
        const v = variantFor(recipe, [], ALICE);
        expect(v.ingredients.map((i) => [i.displayName, i.quantity])).toEqual([
            ["Pasta", { amount: 400, unit: "g" }],
            ["Cheese", { amount: 200, unit: "g" }],
            ["Salt", null],
        ]);
        expect(v.removed).toEqual([]);
        expect(v.overrideCount).toBe(0);
        expect(v.ingredients.every((i) => i.change === null)).toBe(true);
    });

    test("an override wins over the base amount, and only for its person", () => {
        const overrides = [
            over(ALICE, "amount", {
                ingredientId: "i2",
                amount: 50,
                unit: "g",
            }),
        ];
        const alice = variantFor(recipe, overrides, ALICE);
        expect(alice.ingredients[1]?.quantity).toEqual({
            amount: 50,
            unit: "g",
        });
        expect(alice.ingredients[1]?.change).toBe("amount");
        expect(alice.overrideCount).toBe(1);
        const bob = variantFor(recipe, overrides, BOB);
        expect(bob.ingredients[1]?.quantity).toEqual({
            amount: 200,
            unit: "g",
        });
    });

    test("an amount override with no amount makes it to taste", () => {
        const v = variantFor(
            recipe,
            [over(ALICE, "amount", { ingredientId: "i2", unit: "g" })],
            ALICE,
        );
        expect(v.ingredients[1]?.quantity).toBeNull();
    });

    test("a base edit flows to a version unless that version overrides the ingredient", () => {
        const overrides = [
            over(ALICE, "amount", {
                ingredientId: "i2",
                amount: 50,
                unit: "g",
            }),
        ];
        const edited = [
            { ...PASTA, quantity: { amount: 500, unit: "g" } },
            { ...CHEESE, quantity: { amount: 300, unit: "g" } },
            SALT,
        ];
        const v = variantFor({ id: R, ingredients: edited }, overrides, ALICE);
        // Pasta follows the base edit; cheese keeps Alice's own amount.
        expect(v.ingredients[0]?.quantity).toEqual({ amount: 500, unit: "g" });
        expect(v.ingredients[1]?.quantity).toEqual({ amount: 50, unit: "g" });
    });

    test("a removed ingredient is left out and listed as removed", () => {
        const v = variantFor(
            recipe,
            [over(ALICE, "remove", { ingredientId: "i2" })],
            ALICE,
        );
        expect(v.ingredients.map((i) => i.displayName)).toEqual([
            "Pasta",
            "Salt",
        ]);
        expect(v.removed.map((i) => i.id)).toEqual(["i2"]);
        expect(v.overrideCount).toBe(1);
    });

    test("an override on an ingredient the base no longer has does nothing", () => {
        const v = variantFor(
            { id: R, ingredients: [PASTA, SALT] },
            [
                over(ALICE, "remove", { ingredientId: "i2" }),
                over(ALICE, "amount", {
                    ingredientId: "i2",
                    amount: 9,
                    unit: "g",
                }),
            ],
            ALICE,
        );
        expect(v.ingredients.map((i) => i.displayName)).toEqual([
            "Pasta",
            "Salt",
        ]);
        expect(v.removed).toEqual([]);
        expect(v.overrideCount).toBe(0);
    });

    test("a swapped food keeps its place and the base amount unless one is given", () => {
        const swapped = variantFor(
            recipe,
            [
                over(ALICE, "food", {
                    ingredientId: "i2",
                    foodId: "f-vegan",
                    displayName: "Vegan cheese",
                }),
            ],
            ALICE,
        );
        expect(swapped.ingredients[1]).toMatchObject({
            displayName: "Vegan cheese",
            foodId: "f-vegan",
            quantity: { amount: 200, unit: "g" },
            change: "food",
            baseIngredientId: "i2",
        });
        const withAmount = variantFor(
            recipe,
            [
                over(ALICE, "food", {
                    ingredientId: "i2",
                    foodId: "f-vegan",
                    displayName: "Vegan cheese",
                    amount: 100,
                    unit: "g",
                }),
            ],
            ALICE,
        );
        expect(withAmount.ingredients[1]?.quantity).toEqual({
            amount: 100,
            unit: "g",
        });
    });

    test("an added ingredient comes after the base ones, oldest first", () => {
        const v = variantFor(
            recipe,
            [
                over(ALICE, "add", {
                    foodId: "f-peas",
                    displayName: "Peas",
                    amount: 80,
                    unit: "g",
                }),
                over(ALICE, "add", {
                    foodId: "f-ham",
                    displayName: "Ham",
                    amount: 60,
                    unit: "g",
                }),
            ],
            ALICE,
        );
        expect(v.ingredients.map((i) => i.displayName)).toEqual([
            "Pasta",
            "Cheese",
            "Salt",
            "Peas",
            "Ham",
        ]);
        expect(v.ingredients[3]).toMatchObject({
            baseIngredientId: null,
            change: "add",
            foodId: "f-peas",
        });
        expect(v.overrideCount).toBe(2);
    });

    test("another recipe's overrides are ignored", () => {
        const v = variantFor(
            recipe,
            [
                over(ALICE, "remove", {
                    ingredientId: "i1",
                    recipeId: "other",
                }),
            ],
            ALICE,
        );
        expect(v.ingredients).toHaveLength(3);
    });
});

describe("macros per version", () => {
    function pastaFood(over2: Partial<Food>, id: string): Food {
        return {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: id,
                calories: 100,
                proteinG: 10,
                carbsG: 0,
                fatG: 0,
            }),
            id,
            ...over2,
        };
    }

    test("each version's macros come from its own ingredients through the base macro path", () => {
        const foods = new Map<string, Food>([
            ["f-pasta", pastaFood({ calories: 350, proteinG: 12 }, "f-pasta")],
            [
                "f-cheese",
                pastaFood({ calories: 400, proteinG: 25 }, "f-cheese"),
            ],
            ["f-salt", pastaFood({ calories: 0, proteinG: 0 }, "f-salt")],
        ]);
        const base = macrosForPerson(BASE, 4, 1, foods);
        // 100 g pasta and 50 g cheese per portion.
        expect(base.calories).toBe(550);
        const lite = variantFor(
            recipe,
            [over(ALICE, "remove", { ingredientId: "i2" })],
            ALICE,
        );
        expect(macrosForPerson(lite.ingredients, 4, 1, foods).calories).toBe(
            350,
        );
        const doubled = variantFor(
            recipe,
            [
                over(BOB, "amount", {
                    ingredientId: "i2",
                    amount: 400,
                    unit: "g",
                }),
            ],
            BOB,
        );
        expect(macrosForPerson(doubled.ingredients, 4, 1, foods).calories).toBe(
            750,
        );
    });
});

describe("coverage", () => {
    test("says who has a version, counting only overrides that still apply", () => {
        const overrides = [
            over(ALICE, "remove", { ingredientId: "i2" }),
            over(ALICE, "remove", { ingredientId: "gone" }),
        ];
        expect(variantCoverage(recipe, overrides, [ALICE, BOB])).toEqual([
            { userId: ALICE, overrideCount: 1, hasVersion: true },
            { userId: BOB, overrideCount: 0, hasVersion: false },
        ]);
    });
});

describe("recipeNeeds", () => {
    // Yield 4: portions scale the base amounts by portions / 4.
    const amount = (lines: ReturnType<typeof recipeNeeds>, name: string) =>
        lines.filter((l) => l.displayName === name).map((l) => l.quantity);

    test("with no overrides it is the base scaled to the total", () => {
        const lines = recipeNeeds({
            ingredients: BASE,
            yieldPortions: 4,
            overrides: [],
            members: [
                { userId: ALICE, portions: 1 },
                { userId: BOB, portions: 1 },
            ],
            totalPortions: 2,
        });
        expect(amount(lines, "Pasta")).toEqual([{ amount: 200, unit: "g" }]);
        expect(amount(lines, "Cheese")).toEqual([{ amount: 100, unit: "g" }]);
        expect(amount(lines, "Salt")).toEqual([null]);
    });

    test("each member's portions use that member's version", () => {
        const lines = recipeNeeds({
            ingredients: BASE,
            yieldPortions: 4,
            overrides: [
                over(ALICE, "remove", { ingredientId: "i2" }),
                over(BOB, "amount", {
                    ingredientId: "i1",
                    amount: 800,
                    unit: "g",
                }),
            ],
            members: [
                { userId: ALICE, portions: 1 },
                { userId: BOB, portions: 2 },
            ],
            totalPortions: 3,
        });
        // Pasta: Alice 1/4 of 400 = 100, Bob 2/4 of 800 = 400.
        expect(amount(lines, "Pasta")).toEqual([{ amount: 500, unit: "g" }]);
        // Cheese: Alice leaves it out, Bob has the base: 2/4 of 200.
        expect(amount(lines, "Cheese")).toEqual([{ amount: 100, unit: "g" }]);
    });

    test("portions with nobody named count at the base", () => {
        const lines = recipeNeeds({
            ingredients: BASE,
            yieldPortions: 4,
            overrides: [over(ALICE, "remove", { ingredientId: "i1" })],
            members: [{ userId: ALICE, portions: 1 }],
            totalPortions: 4,
        });
        // Alice takes 1 portion without pasta; the other 3 are the base.
        expect(amount(lines, "Pasta")).toEqual([{ amount: 300, unit: "g" }]);
        expect(amount(lines, "Cheese")).toEqual([{ amount: 200, unit: "g" }]);
    });

    test("a total below the members' sum still serves every member", () => {
        const lines = recipeNeeds({
            ingredients: BASE,
            yieldPortions: 4,
            overrides: [],
            members: [{ userId: ALICE, portions: 2 }],
            totalPortions: 1,
        });
        expect(amount(lines, "Pasta")).toEqual([{ amount: 200, unit: "g" }]);
    });

    test("a swapped food is its own line, an added food joins the same food", () => {
        const lines = recipeNeeds({
            ingredients: BASE,
            yieldPortions: 4,
            overrides: [
                over(ALICE, "food", {
                    ingredientId: "i2",
                    foodId: "f-vegan",
                    displayName: "Vegan cheese",
                }),
                over(ALICE, "add", {
                    foodId: "f-peas",
                    displayName: "Peas",
                    amount: 40,
                    unit: "g",
                }),
                over(BOB, "add", {
                    foodId: "f-peas",
                    displayName: "Peas",
                    amount: 20,
                    unit: "g",
                }),
            ],
            members: [
                { userId: ALICE, portions: 2 },
                { userId: BOB, portions: 2 },
            ],
            totalPortions: 4,
        });
        // The swapped food stays at the cheese's place.
        expect(lines.map((l) => l.displayName)).toEqual([
            "Pasta",
            "Vegan cheese",
            "Cheese",
            "Salt",
            "Peas",
        ]);
        expect(amount(lines, "Cheese")).toEqual([{ amount: 100, unit: "g" }]);
        expect(amount(lines, "Vegan cheese")).toEqual([
            { amount: 100, unit: "g" },
        ]);
        // 2/4 of 40 + 2/4 of 20.
        expect(amount(lines, "Peas")).toEqual([{ amount: 30, unit: "g" }]);
    });

    test("one ingredient in two units stays two lines", () => {
        const lines = recipeNeeds({
            ingredients: BASE,
            yieldPortions: 4,
            overrides: [
                over(BOB, "amount", {
                    ingredientId: "i2",
                    amount: 2,
                    unit: "cup",
                }),
            ],
            members: [
                { userId: ALICE, portions: 4 },
                { userId: BOB, portions: 4 },
            ],
            totalPortions: 8,
        });
        expect(amount(lines, "Cheese")).toEqual([
            { amount: 200, unit: "g" },
            { amount: 2, unit: "cup" },
        ]);
    });

    test("a to-taste line goes when another version measures it", () => {
        const lines = recipeNeeds({
            ingredients: BASE,
            yieldPortions: 4,
            overrides: [
                over(BOB, "amount", {
                    ingredientId: "i3",
                    amount: 4,
                    unit: "g",
                }),
            ],
            members: [
                { userId: ALICE, portions: 2 },
                { userId: BOB, portions: 2 },
            ],
            totalPortions: 4,
        });
        expect(amount(lines, "Salt")).toEqual([{ amount: 2, unit: "g" }]);
    });
});

describe("recipeNeeds: added to taste", () => {
    test("an added food one person leaves to taste and another measures is one measured line", () => {
        const lines = recipeNeeds({
            ingredients: BASE,
            yieldPortions: 4,
            overrides: [
                over(ALICE, "add", {
                    foodId: "f-tofu",
                    displayName: "Tofu",
                    amount: null,
                    unit: null,
                }),
                over(BOB, "add", {
                    foodId: "f-tofu",
                    displayName: "Tofu",
                    amount: 100,
                    unit: "g",
                }),
            ],
            members: [
                { userId: ALICE, portions: 2 },
                { userId: BOB, portions: 2 },
            ],
            totalPortions: 4,
        });
        expect(lines.filter((l) => l.displayName === "Tofu")).toEqual([
            {
                displayName: "Tofu",
                foodId: "f-tofu",
                quantity: { amount: 50, unit: "g" },
            },
        ]);
    });
});

describe("setRecipeVariant and clearRecipeVariant", () => {
    async function setup() {
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const variants = createMemoryVariantsStore();
        const made = await createRecipe(recipes, {
            householdId: HH,
            creatorId: ALICE,
            name: "Mac",
            yieldPortions: 4,
        });
        const pasta = await addRecipeManualIngredient(recipes, foods, {
            householdId: HH,
            recipeId: made.id,
            name: "Pasta",
            amount: 400,
            unit: "g",
        });
        const cheese = await addRecipeManualIngredient(recipes, foods, {
            householdId: HH,
            recipeId: made.id,
            name: "Cheese",
            amount: 200,
            unit: "g",
        });
        const peas = await findOrCreateManualFood(foods, HH, "food", "Peas");
        return { recipes, foods, variants, made, pasta, cheese, peas };
    }
    const base = (s: Awaited<ReturnType<typeof setup>>) => ({
        householdId: HH,
        recipeId: s.made.id,
        userId: ALICE,
    });

    test("sets, replaces and clears one change; the base is untouched", async () => {
        const s = await setup();
        await setRecipeVariant(s.recipes, s.foods, s.variants, {
            ...base(s),
            action: "amount",
            ingredientId: s.cheese.id,
            amount: 50,
            unit: "g",
        });
        await setRecipeVariant(s.recipes, s.foods, s.variants, {
            ...base(s),
            action: "amount",
            ingredientId: s.cheese.id,
            amount: 75,
            unit: "g",
        });
        const rows = await s.variants.listOverrides(HH, s.made.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ amount: 75, unit: "g", userId: ALICE });
        const ingredients = await s.recipes.listIngredients(HH, s.made.id);
        expect(ingredients[1]?.quantity).toEqual({ amount: 200, unit: "g" });
        expect(
            await clearRecipeVariant(s.recipes, s.variants, {
                ...base(s),
                ingredientId: s.cheese.id,
            }),
        ).toBe(1);
        expect(await s.variants.listOverrides(HH, s.made.id)).toEqual([]);
    });

    test("clearing with no ingredient takes the person's whole version and no one else's", async () => {
        const s = await setup();
        for (const userId of [ALICE, BOB]) {
            await setRecipeVariant(s.recipes, s.foods, s.variants, {
                ...base(s),
                userId,
                action: "remove",
                ingredientId: s.cheese.id,
            });
            await setRecipeVariant(s.recipes, s.foods, s.variants, {
                ...base(s),
                userId,
                action: "add",
                foodId: s.peas.id,
                amount: 40,
                unit: "g",
            });
        }
        expect(await clearRecipeVariant(s.recipes, s.variants, base(s))).toBe(
            2,
        );
        const left = await s.variants.listOverrides(HH, s.made.id);
        expect(left.map((row) => row.userId)).toEqual([BOB, BOB]);
    });

    test("an added line is cleared by its own id", async () => {
        const s = await setup();
        const added = await setRecipeVariant(s.recipes, s.foods, s.variants, {
            ...base(s),
            action: "add",
            foodId: s.peas.id,
            amount: 40,
            unit: "g",
        });
        expect(added.displayName).toBe("Peas");
        expect(
            await clearRecipeVariant(s.recipes, s.variants, {
                ...base(s),
                ingredientId: added.id,
            }),
        ).toBe(1);
    });

    test("refuses an unknown ingredient, a missing food, a bad amount and an add that names a base ingredient", async () => {
        const s = await setup();
        await expect(
            setRecipeVariant(s.recipes, s.foods, s.variants, {
                ...base(s),
                action: "remove",
                ingredientId: "nope",
            }),
        ).rejects.toBeInstanceOf(RecipeInputError);
        await expect(
            setRecipeVariant(s.recipes, s.foods, s.variants, {
                ...base(s),
                action: "food",
                ingredientId: s.cheese.id,
            }),
        ).rejects.toBeInstanceOf(RecipeInputError);
        await expect(
            setRecipeVariant(s.recipes, s.foods, s.variants, {
                ...base(s),
                action: "food",
                ingredientId: s.cheese.id,
                foodId: crypto.randomUUID(),
            }),
        ).rejects.toBeInstanceOf(RecipeInputError);
        await expect(
            setRecipeVariant(s.recipes, s.foods, s.variants, {
                ...base(s),
                action: "amount",
                ingredientId: s.cheese.id,
                amount: -1,
                unit: "g",
            }),
        ).rejects.toBeInstanceOf(RecipeInputError);
        await expect(
            setRecipeVariant(s.recipes, s.foods, s.variants, {
                ...base(s),
                action: "add",
                ingredientId: s.cheese.id,
                foodId: s.peas.id,
                amount: 1,
                unit: "g",
            }),
        ).rejects.toBeInstanceOf(RecipeInputError);
        expect(await s.variants.listOverrides(HH, s.made.id)).toEqual([]);
    });

    test("a base edit reaches the stored version, and deleting a base ingredient drops its effect", async () => {
        const s = await setup();
        await setRecipeVariant(s.recipes, s.foods, s.variants, {
            ...base(s),
            action: "amount",
            ingredientId: s.cheese.id,
            amount: 50,
            unit: "g",
        });
        await updateRecipeIngredient(
            s.recipes,
            HH,
            s.made.id,
            s.pasta.id,
            { amount: 500 },
            s.foods,
        );
        const editedBase = await s.recipes.listIngredients(HH, s.made.id);
        const overrides = await s.variants.listOverrides(HH, s.made.id);
        const v = variantFor(
            { id: s.made.id, ingredients: editedBase },
            overrides,
            ALICE,
        );
        expect(v.ingredients[0]?.quantity).toEqual({ amount: 500, unit: "g" });
        expect(v.ingredients[1]?.quantity).toEqual({ amount: 50, unit: "g" });
        await removeRecipeIngredient(s.recipes, HH, s.made.id, s.cheese.id);
        const afterDelete = variantFor(
            {
                id: s.made.id,
                ingredients: await s.recipes.listIngredients(HH, s.made.id),
            },
            overrides,
            ALICE,
        );
        expect(afterDelete.ingredients.map((i) => i.displayName)).toEqual([
            "Pasta",
        ]);
        expect(afterDelete.overrideCount).toBe(0);
    });
});

test("row mappers round-trip an override", () => {
    const row = over(ALICE, "food", {
        ingredientId: "i2",
        foodId: "f-vegan",
        displayName: "Vegan cheese",
        amount: 12.5,
        unit: "g",
    });
    const written = overrideToRow(row);
    expect(written).toEqual({
        household_id: HH,
        recipe_id: R,
        user_id: ALICE,
        ingredient_id: "i2",
        action: "food",
        amount: 12.5,
        unit: "g",
        food_id: "f-vegan",
        display_name: "Vegan cheese",
    });
    expect(
        overrideFromRow({
            ...written,
            id: row.id,
            amount: "12.5",
            created_at: new Date(row.createdAt),
            updated_at: row.updatedAt,
        }),
    ).toEqual(row);
});

describe("one food in convertible units is one need", () => {
    // Base 300 g flour; Bob's version says 0.3 kg. Two people, one portion
    // each: 600 g in all, whatever unit each version writes it in.
    async function bread() {
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const variants = createMemoryVariantsStore();
        const made = await createRecipe(recipes, {
            householdId: HH,
            creatorId: ALICE,
            name: "Bread",
            yieldPortions: 1,
        });
        const flour = await addRecipeManualIngredient(recipes, foods, {
            householdId: HH,
            recipeId: made.id,
            name: "Flour",
            amount: 300,
            unit: "g",
        });
        await setRecipeVariant(recipes, foods, variants, {
            householdId: HH,
            recipeId: made.id,
            userId: BOB,
            action: "amount",
            ingredientId: flour.id,
            amount: 0.3,
            unit: "kg",
        });
        return { recipes, foods, variants, made, flour };
    }

    test("recipeNeeds adds 300 g and 0.3 kg of the same ingredient into one line", async () => {
        const s = await bread();
        const lines = recipeNeeds({
            ingredients: await s.recipes.listIngredients(HH, s.made.id),
            yieldPortions: 1,
            overrides: await s.variants.listOverrides(HH, s.made.id),
            members: [
                { userId: ALICE, portions: 1 },
                { userId: BOB, portions: 1 },
            ],
            totalPortions: 2,
            recipeId: s.made.id,
        });
        expect(lines).toHaveLength(1);
        expect(lines[0]!.quantity!.unit).toBe("g");
        expect(lines[0]!.quantity!.amount).toBeCloseTo(600, 6);
    });

    test("a swap onto a food the recipe already has joins that food's line", async () => {
        const s = await bread();
        const second = await addRecipeManualIngredient(s.recipes, s.foods, {
            householdId: HH,
            recipeId: s.made.id,
            name: "Sugar",
            amount: 100,
            unit: "g",
        });
        await setRecipeVariant(s.recipes, s.foods, s.variants, {
            householdId: HH,
            recipeId: s.made.id,
            userId: BOB,
            action: "food",
            ingredientId: second.id,
            foodId: s.flour.foodId!,
            amount: 0.1,
            unit: "kg",
        });
        const lines = recipeNeeds({
            ingredients: await s.recipes.listIngredients(HH, s.made.id),
            yieldPortions: 1,
            overrides: await s.variants.listOverrides(HH, s.made.id),
            members: [{ userId: BOB, portions: 1 }],
            totalPortions: 1,
            recipeId: s.made.id,
        });
        const flourLines = lines.filter((l) => l.foodId === s.flour.foodId);
        expect(flourLines).toHaveLength(1);
        // Bob's own amount is 0.3 kg and the swap adds 0.1 kg: 0.4 kg, one line.
        expect(flourLines[0]!.quantity!.unit).toBe("kg");
        expect(flourLines[0]!.quantity!.amount).toBeCloseTo(0.4, 6);
    });

    test("add_recipe_to_grocery nets the stock once: 600 g needed, 500 g in stock, 100 g bought", async () => {
        const s = await bread();
        const grocery = createMemoryGroceryStore();
        const settings = createMemorySettingsStore();
        const store = await createGroceryStore(settings, HH, "Shop");
        const result = await addRecipeToGrocery({
            recipes: s.recipes,
            grocery,
            settings,
            foods: s.foods,
            fridgeItems: [
                {
                    foodId: s.flour.foodId,
                    quantity: { amount: 500, unit: "g" },
                },
            ],
            householdId: HH,
            recipeId: s.made.id,
            storeId: store.id,
            portionCounts: [1, 1],
            members: [
                { userId: ALICE, portions: 1 },
                { userId: BOB, portions: 1 },
            ],
            variants: s.variants,
        });
        expect(result.added).toHaveLength(1);
        expect(result.added[0]!.quantity!.unit).toBe("g");
        expect(result.added[0]!.quantity!.amount).toBeCloseTo(100, 6);
    });

    test("a cook of the same two versions reports the same 100 g shortfall", async () => {
        const s = await bread();
        const fridge = createMemoryFridgeStore();
        const stock = createMemoryStockStore();
        const loc = await addLocation(fridge, HH, "Fridge");
        await applyMovement(fridge, stock, s.foods, {
            householdId: HH,
            foodId: s.flour.foodId!,
            delta: 500,
            unit: "g",
            reason: "purchase",
            locationId: loc.id,
        });
        const input = {
            householdId: HH,
            recipeId: s.made.id,
            totalPortions: 2,
            memberPortions: [
                { userId: ALICE, portions: 1 },
                { userId: BOB, portions: 1 },
            ],
            variants: s.variants,
        };
        const preview = await previewCookRecipe(
            s.recipes,
            fridge,
            s.foods,
            input,
        );
        const result = await cookRecipe(
            s.recipes,
            fridge,
            stock,
            s.foods,
            input,
        );
        expect(result.shortfalls).toHaveLength(1);
        expect(result.shortfalls[0]!.unit).toBe("g");
        expect(result.shortfalls[0]!.amount).toBeCloseTo(100, 6);
        expect(JSON.stringify(preview)).toContain("100");
    });
});

describe("a swapped food keeps its unit", () => {
    async function tofu() {
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const variants = createMemoryVariantsStore();
        const made = await createRecipe(recipes, {
            householdId: HH,
            creatorId: ALICE,
            name: "Stir fry",
            yieldPortions: 1,
        });
        const meat = await addRecipeManualIngredient(recipes, foods, {
            householdId: HH,
            recipeId: made.id,
            name: "Chicken",
            amount: 500,
            unit: "g",
        });
        const tofuFood = await findOrCreateManualFood(
            foods,
            HH,
            "food",
            "Tofu",
        );
        return { recipes, foods, variants, made, meat, tofuFood };
    }

    test("an amount with no unit on a swap is saved in the base's unit, so a later base unit edit leaves it alone", async () => {
        const s = await tofu();
        await setRecipeVariant(s.recipes, s.foods, s.variants, {
            householdId: HH,
            recipeId: s.made.id,
            userId: BOB,
            action: "food",
            ingredientId: s.meat.id,
            foodId: s.tofuFood.id,
            amount: 300,
        });
        await updateRecipeIngredient(
            s.recipes,
            HH,
            s.made.id,
            s.meat.id,
            { amount: 1, unit: "kg" },
            s.foods,
        );
        const mine = variantFor(
            {
                id: s.made.id,
                ingredients: await s.recipes.listIngredients(HH, s.made.id),
            },
            await s.variants.listOverrides(HH, s.made.id),
            BOB,
        );
        expect(mine.ingredients[0]!.displayName).toBe("Tofu");
        expect(mine.ingredients[0]!.quantity).toEqual({
            amount: 300,
            unit: "g",
        });
    });

    test("an amount on a swapped ingredient keeps the swapped food", async () => {
        const s = await tofu();
        await setRecipeVariant(s.recipes, s.foods, s.variants, {
            householdId: HH,
            recipeId: s.made.id,
            userId: BOB,
            action: "food",
            ingredientId: s.meat.id,
            foodId: s.tofuFood.id,
        });
        await setRecipeVariant(s.recipes, s.foods, s.variants, {
            householdId: HH,
            recipeId: s.made.id,
            userId: BOB,
            action: "amount",
            ingredientId: s.meat.id,
            amount: 250,
            unit: "g",
        });
        const mine = variantFor(
            {
                id: s.made.id,
                ingredients: await s.recipes.listIngredients(HH, s.made.id),
            },
            await s.variants.listOverrides(HH, s.made.id),
            BOB,
        );
        expect(mine.ingredients[0]!.displayName).toBe("Tofu");
        expect(mine.ingredients[0]!.quantity).toEqual({
            amount: 250,
            unit: "g",
        });
        expect(s.variants.__rows()).toHaveLength(1);
    });

    test("a swap with no amount after the person's amount keeps their amount and unit", async () => {
        const s = await tofu();
        const mine = {
            householdId: HH,
            recipeId: s.made.id,
            userId: BOB,
            ingredientId: s.meat.id,
        };
        await setRecipeVariant(s.recipes, s.foods, s.variants, {
            ...mine,
            action: "amount",
            amount: 250,
            unit: "g",
        });
        await setRecipeVariant(s.recipes, s.foods, s.variants, {
            ...mine,
            action: "food",
            foodId: s.tofuFood.id,
        });
        const row = variantFor(
            {
                id: s.made.id,
                ingredients: await s.recipes.listIngredients(HH, s.made.id),
            },
            await s.variants.listOverrides(HH, s.made.id),
            BOB,
        ).ingredients[0]!;
        expect(row.displayName).toBe("Tofu");
        expect(row.quantity).toEqual({ amount: 250, unit: "g" });
        expect(s.variants.__rows()).toHaveLength(1);
    });

    async function lineOf(s: Awaited<ReturnType<typeof tofu>>) {
        return variantFor(
            {
                id: s.made.id,
                ingredients: await s.recipes.listIngredients(HH, s.made.id),
            },
            await s.variants.listOverrides(HH, s.made.id),
            BOB,
        ).ingredients[0]!;
    }

    test("a second swap with no amount keeps the amount the first swap kept", async () => {
        const s = await tofu();
        const tempeh = await findOrCreateManualFood(
            s.foods,
            HH,
            "food",
            "Tempeh",
        );
        const mine = {
            householdId: HH,
            recipeId: s.made.id,
            userId: BOB,
            ingredientId: s.meat.id,
        };
        await setRecipeVariant(s.recipes, s.foods, s.variants, {
            ...mine,
            action: "amount",
            amount: 250,
            unit: "g",
        });
        await setRecipeVariant(s.recipes, s.foods, s.variants, {
            ...mine,
            action: "food",
            foodId: s.tofuFood.id,
        });
        await setRecipeVariant(s.recipes, s.foods, s.variants, {
            ...mine,
            action: "food",
            foodId: tempeh.id,
        });
        const row = await lineOf(s);
        expect(row.displayName).toBe("Tempeh");
        expect(row.quantity).toEqual({ amount: 250, unit: "g" });
        expect(s.variants.__rows()).toHaveLength(1);
    });

    test('a swap with no amount keeps "to taste" the person set, and a swap with an amount replaces it', async () => {
        const s = await tofu();
        const mine = {
            householdId: HH,
            recipeId: s.made.id,
            userId: BOB,
            ingredientId: s.meat.id,
        };
        await setRecipeVariant(s.recipes, s.foods, s.variants, {
            ...mine,
            action: "amount",
        });
        await setRecipeVariant(s.recipes, s.foods, s.variants, {
            ...mine,
            action: "food",
            foodId: s.tofuFood.id,
        });
        const tasted = await lineOf(s);
        expect(tasted.displayName).toBe("Tofu");
        expect(tasted.quantity).toBeNull();
        // Swapped again with no amount: still to taste, not the base's 500 g.
        const tempeh = await findOrCreateManualFood(
            s.foods,
            HH,
            "food",
            "Tempeh",
        );
        await setRecipeVariant(s.recipes, s.foods, s.variants, {
            ...mine,
            action: "food",
            foodId: tempeh.id,
        });
        expect((await lineOf(s)).quantity).toBeNull();
        await setRecipeVariant(s.recipes, s.foods, s.variants, {
            ...mine,
            action: "food",
            foodId: s.tofuFood.id,
            amount: 100,
            unit: "g",
        });
        expect((await lineOf(s)).quantity).toEqual({ amount: 100, unit: "g" });
    });

    test("a swap with no earlier row reads the base amount", async () => {
        const s = await tofu();
        await setRecipeVariant(s.recipes, s.foods, s.variants, {
            householdId: HH,
            recipeId: s.made.id,
            userId: BOB,
            action: "food",
            ingredientId: s.meat.id,
            foodId: s.tofuFood.id,
        });
        expect((await lineOf(s)).quantity).toEqual({ amount: 500, unit: "g" });
    });

    test("a supply is refused in a version, as the base refuses it", async () => {
        const s = await tofu();
        const soap = await findOrCreateManualFood(
            s.foods,
            HH,
            "supply",
            "Dish soap",
        );
        const mine = { householdId: HH, recipeId: s.made.id, userId: BOB };
        await expect(
            setRecipeVariant(s.recipes, s.foods, s.variants, {
                ...mine,
                action: "add",
                foodId: soap.id,
                amount: 1,
                unit: "each",
            }),
        ).rejects.toThrow("That catalog item is a supply.");
        await expect(
            setRecipeVariant(s.recipes, s.foods, s.variants, {
                ...mine,
                action: "food",
                ingredientId: s.meat.id,
                foodId: soap.id,
            }),
        ).rejects.toThrow("That catalog item is a supply.");
        expect(s.variants.__rows()).toEqual([]);
    });

    test("an amount with no unit on an ingredient that has none is refused", async () => {
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const variants = createMemoryVariantsStore();
        const made = await createRecipe(recipes, {
            householdId: HH,
            creatorId: ALICE,
            name: "Soup",
            yieldPortions: 2,
        });
        const salt = await addRecipeManualIngredient(recipes, foods, {
            householdId: HH,
            recipeId: made.id,
            name: "Salt",
        });
        await expect(
            setRecipeVariant(recipes, foods, variants, {
                householdId: HH,
                recipeId: made.id,
                userId: BOB,
                action: "amount",
                ingredientId: salt.id,
                amount: 2,
            }),
        ).rejects.toThrow("Give a unit with the amount.");
        expect(variants.__rows()).toEqual([]);
    });
});

describe("merging foods that one person added to one recipe", () => {
    test("the two added rows become one row on the kept food, amounts summed", async () => {
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const variants = createMemoryVariantsStore();
        foods.linkRefs(variants);
        const made = await createRecipe(recipes, {
            householdId: HH,
            creatorId: ALICE,
            name: "Stew",
            yieldPortions: 2,
        });
        const peas = await findOrCreateManualFood(foods, HH, "food", "Peas");
        const green = await findOrCreateManualFood(
            foods,
            HH,
            "food",
            "Green peas",
        );
        for (const [food, amount, unit] of [
            [peas, 40, "g"],
            [green, 0.06, "kg"],
        ] as const) {
            await setRecipeVariant(recipes, foods, variants, {
                householdId: HH,
                recipeId: made.id,
                userId: BOB,
                action: "add",
                foodId: food.id,
                amount,
                unit,
            });
        }
        await mergeFoods(foods, HH, peas.id, green.id);
        expect(
            variants.__rows().map((row) => [row.foodId, row.amount, row.unit]),
        ).toEqual([[peas.id, 100, "g"]]);
    });

    test("amounts that do not convert keep the kept food's row", async () => {
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const variants = createMemoryVariantsStore();
        foods.linkRefs(variants);
        const made = await createRecipe(recipes, {
            householdId: HH,
            creatorId: ALICE,
            name: "Stew",
            yieldPortions: 2,
        });
        const peas = await findOrCreateManualFood(foods, HH, "food", "Peas");
        const green = await findOrCreateManualFood(
            foods,
            HH,
            "food",
            "Green peas",
        );
        for (const [food, amount, unit] of [
            [peas, 40, "g"],
            [green, 2, "each"],
        ] as const) {
            await setRecipeVariant(recipes, foods, variants, {
                householdId: HH,
                recipeId: made.id,
                userId: BOB,
                action: "add",
                foodId: food.id,
                amount,
                unit,
            });
        }
        await mergeFoods(foods, HH, peas.id, green.id);
        expect(
            variants.__rows().map((row) => [row.foodId, row.amount, row.unit]),
        ).toEqual([[peas.id, 40, "g"]]);
    });
});

describe("an added food is one row per person", () => {
    test("the same add twice is one row and one need", async () => {
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const variants = createMemoryVariantsStore();
        const made = await createRecipe(recipes, {
            householdId: HH,
            creatorId: ALICE,
            name: "Stew",
            yieldPortions: 1,
        });
        await addRecipeManualIngredient(recipes, foods, {
            householdId: HH,
            recipeId: made.id,
            name: "Rice",
            amount: 100,
            unit: "g",
        });
        const peas = await findOrCreateManualFood(foods, HH, "food", "Peas");
        const call = {
            householdId: HH,
            recipeId: made.id,
            userId: ALICE,
            action: "add" as const,
            foodId: peas.id,
            amount: 40,
            unit: "g",
        };
        await setRecipeVariant(recipes, foods, variants, call);
        await setRecipeVariant(recipes, foods, variants, call);
        expect(variants.__rows()).toHaveLength(1);
        // Asking again with a new amount replaces it, and another person's add
        // of the same food is theirs.
        await setRecipeVariant(recipes, foods, variants, {
            ...call,
            amount: 60,
        });
        await setRecipeVariant(recipes, foods, variants, {
            ...call,
            userId: BOB,
        });
        expect(variants.__rows()).toHaveLength(2);
        const needs = recipeNeeds({
            ingredients: await recipes.listIngredients(HH, made.id),
            yieldPortions: 1,
            overrides: await variants.listOverrides(HH, made.id),
            members: [{ userId: ALICE, portions: 1 }],
            totalPortions: 1,
            recipeId: made.id,
        });
        expect(needs.find((n) => n.displayName === "Peas")?.quantity).toEqual({
            amount: 60,
            unit: "g",
        });
    });
});

describe("a blank ingredient id clears nothing", () => {
    test("is refused, and leaving it out still clears the whole version", async () => {
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const variants = createMemoryVariantsStore();
        const made = await createRecipe(recipes, {
            householdId: HH,
            creatorId: ALICE,
            name: "Mac",
            yieldPortions: 4,
        });
        const pasta = await addRecipeManualIngredient(recipes, foods, {
            householdId: HH,
            recipeId: made.id,
            name: "Pasta",
            amount: 400,
            unit: "g",
        });
        await setRecipeVariant(recipes, foods, variants, {
            householdId: HH,
            recipeId: made.id,
            userId: ALICE,
            action: "remove",
            ingredientId: pasta.id,
        });
        for (const blank of ["", "   "]) {
            await expect(
                clearRecipeVariant(recipes, variants, {
                    householdId: HH,
                    recipeId: made.id,
                    userId: ALICE,
                    ingredientId: blank,
                }),
            ).rejects.toThrow(
                "Name the change to clear, or leave ingredient_id out to clear the whole version.",
            );
        }
        expect(variants.__rows()).toHaveLength(1);
        expect(
            await clearRecipeVariant(recipes, variants, {
                householdId: HH,
                recipeId: made.id,
                userId: ALICE,
            }),
        ).toBe(1);
    });
});

describe("member ids match in any case", () => {
    test("variantFor finds a version by an upper-case member id", () => {
        const rows = [over(ALICE, "remove", { ingredientId: "i1" })];
        const mine = variantFor(
            { id: R, ingredients: [PASTA] },
            rows,
            ALICE.toUpperCase(),
        );
        expect(mine.overrideCount).toBe(1);
        expect(mine.ingredients).toEqual([]);
    });

    test("recipeNeeds totals an upper-case member at their version", () => {
        const lines = recipeNeeds({
            ingredients: [PASTA],
            yieldPortions: 1,
            overrides: [over(ALICE, "remove", { ingredientId: "i1" })],
            members: [{ userId: ALICE.toUpperCase(), portions: 1 }],
            totalPortions: 1,
            recipeId: R,
        });
        expect(lines).toEqual([]);
    });
});
