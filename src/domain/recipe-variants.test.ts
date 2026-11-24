import { describe, expect, test } from "bun:test";
import {
    createMemoryFoodsStore,
    findOrCreateManualFood,
    mergeFoods,
    newFood,
    type Food,
} from "./foods.js";
import {
    alignChange,
    clearRecipeVariant,
    compareVersions,
    createMemoryVariantsStore,
    overrideFromRow,
    overrideKey,
    overrideToRow,
    previewReset,
    recipeNeeds,
    resetVariant,
    setRecipeVariant,
    versionDifferences,
    variantCoverage,
    variantFor,
    type RecipeVariantOverride,
    type RecipeVariantsStore,
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

/** The key the compare read gives one person's change, read from the store. */
async function keyFor(
    s: { variants: RecipeVariantsStore; made: { id: string } },
    userId: string,
    ref: string,
) {
    const row = (await s.variants.listOverrides(HH, s.made.id)).find(
        (r) => r.userId === userId && (r.id === ref || r.ingredientId === ref),
    );
    return row ? overrideKey(row) : "";
}
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

describe("comparing versions", () => {
    const CAROL = "carol";
    const overrides = [
        over(ALICE, "remove", { ingredientId: "i1" }),
        over(ALICE, "amount", { ingredientId: "i2", amount: 50, unit: "g" }),
        over(ALICE, "food", {
            ingredientId: "i3",
            foodId: "f-sea-salt",
            displayName: "Sea salt",
            amount: 2,
            unit: "g",
        }),
        over(ALICE, "add", {
            foodId: "f-peas",
            displayName: "Peas",
            amount: 40,
            unit: "g",
        }),
        over(BOB, "amount", { ingredientId: "i1", amount: 300, unit: "g" }),
    ];

    test("lists each kind of difference per person, against the base lines", () => {
        const view = compareVersions(recipe, overrides, [ALICE, BOB, CAROL]);
        expect(view.recipeId).toBe(R);
        expect(view.base.map((line) => line.displayName)).toEqual([
            "Pasta",
            "Cheese",
            "Salt",
        ]);
        const alice = view.versions.find((v) => v.userId === ALICE)!;
        expect(alice.differences.map((d) => d.kind)).toEqual([
            "removed",
            "amount",
            "swapped",
            "added",
        ]);
        expect(alice.differences[0]).toMatchObject({
            ref: "i1",
            ingredientId: "i1",
            displayName: "Pasta",
            base: { amount: 400, unit: "g" },
        });
        expect(alice.differences[1]).toMatchObject({
            ref: "i2",
            base: { amount: 200, unit: "g" },
            version: { amount: 50, unit: "g" },
        });
        expect(alice.differences[2]).toMatchObject({
            ref: "i3",
            displayName: "Salt",
            foodId: "f-sea-salt",
            foodName: "Sea salt",
            base: null,
            version: { amount: 2, unit: "g" },
        });
        expect(alice.differences[3]).toMatchObject({
            ingredientId: null,
            displayName: "Peas",
            foodId: "f-peas",
            version: { amount: 40, unit: "g" },
        });
        // An added line is named by its own id.
        expect(alice.differences[3]!.ref).toBe(overrides[3]!.id);
        expect(alice.overrideCount).toBe(4);
    });

    test("each difference carries the key of the stored row it shows", () => {
        const view = compareVersions(recipe, overrides, [ALICE]);
        expect(view.versions[0]!.differences.map((d) => d.rowKey)).toEqual(
            [overrides[0]!, overrides[1]!, overrides[2]!, overrides[3]!].map(
                overrideKey,
            ),
        );
    });

    test("says who has a version and who uses the base", () => {
        const view = compareVersions(recipe, overrides, [ALICE, BOB, CAROL]);
        expect(view.versions.map((v) => v.userId)).toEqual([ALICE, BOB]);
        expect(view.usingBase).toEqual([CAROL]);
    });

    test("ignores people who are not members, and a row on a deleted ingredient", () => {
        const view = compareVersions(
            recipe,
            [
                ...overrides,
                over("stranger", "remove", { ingredientId: "i1" }),
                over(CAROL, "remove", { ingredientId: "gone" }),
            ],
            [ALICE, BOB, CAROL],
        );
        expect(view.versions.map((v) => v.userId)).toEqual([ALICE, BOB]);
        expect(view.usingBase).toEqual([CAROL]);
    });

    test("versionDifferences is one person's list, and empty for the base", () => {
        expect(
            versionDifferences(recipe, overrides, BOB).map((d) => d.kind),
        ).toEqual(["amount"]);
        expect(versionDifferences(recipe, overrides, CAROL)).toEqual([]);
    });
});

describe("aligning one person's change into the base", () => {
    const CAROL = "carol";
    async function setup() {
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const variants = createMemoryVariantsStore();
        const made = await createRecipe(recipes, {
            householdId: HH,
            creatorId: ALICE,
            name: "Mac",
            yieldPortions: 4,
            instructions: "Boil. Mix.",
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
        const gouda = await findOrCreateManualFood(foods, HH, "food", "Gouda");
        return { recipes, foods, variants, made, pasta, cheese, peas, gouda };
    }
    type S = Awaited<ReturnType<typeof setup>>;
    const deps = (s: S) => ({
        recipes: s.recipes,
        foods: s.foods,
        variants: s.variants,
    });
    const set = (s: S, userId: string, rest: Record<string, unknown>) =>
        setRecipeVariant(s.recipes, s.foods, s.variants, {
            householdId: HH,
            recipeId: s.made.id,
            userId,
            ...rest,
        } as never);
    const align = async (s: S, userId: string, ref: string) =>
        alignChange(deps(s), {
            householdId: HH,
            recipeId: s.made.id,
            userId,
            ref,
            rowKey: await keyFor(s, userId, ref),
        });
    const baseOf = async (s: S, id: string) =>
        (await s.recipes.listIngredients(HH, s.made.id)).find(
            (row) => row.id === id,
        )!;

    test("what the admin saw is what is pushed: a row the person saved again since is refused, and the base stays", async () => {
        const s = await setup();
        const peas = await findOrCreateManualFood(s.foods, HH, "food", "Peas");
        await set(s, ALICE, {
            action: "amount",
            ingredientId: s.cheese.id,
            amount: 50,
            unit: "g",
        });
        const seen = compareVersions(
            {
                id: s.made.id,
                ingredients: await s.recipes.listIngredients(HH, s.made.id),
            },
            await s.variants.listOverrides(HH, s.made.id),
            [ALICE, BOB],
        ).versions[0]!.differences[0]!;
        // Alice re-saves the ingredient as a swap to peas, 500 g.
        await set(s, ALICE, {
            action: "food",
            ingredientId: s.cheese.id,
            foodId: peas.id,
            amount: 500,
            unit: "g",
        });
        await expect(
            alignChange(deps(s), {
                householdId: HH,
                recipeId: s.made.id,
                userId: ALICE,
                ref: seen.ref,
                rowKey: seen.rowKey,
            }),
        ).rejects.toThrow("Their change changed; look again.");
        expect((await baseOf(s, s.cheese.id)).quantity).toEqual({
            amount: 200,
            unit: "g",
        });
        expect(await s.variants.listOverrides(HH, s.made.id)).toHaveLength(1);
        // The key of what is stored now goes through.
        await align(s, ALICE, s.cheese.id);
        expect((await baseOf(s, s.cheese.id)).foodId).toBe(peas.id);
    });

    test("an added line the person saved again since is refused too", async () => {
        const s = await setup();
        const peas = await findOrCreateManualFood(s.foods, HH, "food", "Peas");
        const added = await set(s, ALICE, {
            action: "add",
            foodId: peas.id,
            amount: 40,
            unit: "g",
        });
        const rowKey = await keyFor(s, ALICE, added.id);
        const before = await s.recipes.listIngredients(HH, s.made.id);
        await set(s, ALICE, {
            action: "add",
            foodId: peas.id,
            amount: 400,
            unit: "g",
        });
        await expect(
            alignChange(deps(s), {
                householdId: HH,
                recipeId: s.made.id,
                userId: ALICE,
                ref: added.id,
                rowKey,
            }),
        ).rejects.toThrow("Their change changed; look again.");
        expect(await s.recipes.listIngredients(HH, s.made.id)).toEqual(before);
    });

    test("an amount becomes the base amount, for everyone who did not override it", async () => {
        const s = await setup();
        await set(s, ALICE, {
            action: "amount",
            ingredientId: s.cheese.id,
            amount: 50,
            unit: "g",
        });
        const result = await align(s, ALICE, s.cheese.id);
        expect(result).toMatchObject({
            kind: "amount",
            ingredientId: s.cheese.id,
            removed: 1,
            kept: [],
        });
        expect((await baseOf(s, s.cheese.id)).quantity).toEqual({
            amount: 50,
            unit: "g",
        });
        // Alice's own row is redundant now and is gone.
        expect(await s.variants.listOverrides(HH, s.made.id)).toEqual([]);
        // Carol, who had no change, now reads 50 g: the base edit flowed.
        const rows = await s.variants.listOverrides(HH, s.made.id);
        const carol = variantFor(
            {
                id: s.made.id,
                ingredients: await s.recipes.listIngredients(HH, s.made.id),
            },
            rows,
            CAROL,
        );
        expect(carol.ingredients[1]?.quantity).toEqual({
            amount: 50,
            unit: "g",
        });
    });

    test("another person's identical amount is removed, a different one is kept", async () => {
        const s = await setup();
        await set(s, ALICE, {
            action: "amount",
            ingredientId: s.cheese.id,
            amount: 0.05,
            unit: "kg",
        });
        await set(s, BOB, {
            action: "amount",
            ingredientId: s.cheese.id,
            amount: 50,
            unit: "g",
        });
        await set(s, CAROL, {
            action: "amount",
            ingredientId: s.cheese.id,
            amount: 120,
            unit: "g",
        });
        const result = await align(s, ALICE, s.cheese.id);
        // Alice's own and Bob's (0.05 kg is 50 g) go; Carol's still differs.
        expect(result.removed).toBe(2);
        expect(result.kept).toEqual([{ userId: CAROL, action: "amount" }]);
        const left = await s.variants.listOverrides(HH, s.made.id);
        expect(left.map((row) => [row.userId, row.amount])).toEqual([
            [CAROL, 120],
        ]);
    });

    test("a swap changes the base food and amount; matching swaps go, a person who removed the ingredient keeps that", async () => {
        const s = await setup();
        await set(s, ALICE, {
            action: "food",
            ingredientId: s.cheese.id,
            foodId: s.gouda.id,
            amount: 150,
            unit: "g",
        });
        await set(s, BOB, {
            action: "food",
            ingredientId: s.cheese.id,
            foodId: s.gouda.id,
            amount: 150,
            unit: "g",
        });
        await set(s, CAROL, { action: "remove", ingredientId: s.cheese.id });
        const result = await align(s, ALICE, s.cheese.id);
        expect(result).toMatchObject({ kind: "swapped", removed: 2 });
        expect(result.kept).toEqual([{ userId: CAROL, action: "remove" }]);
        const cheese = await baseOf(s, s.cheese.id);
        expect(cheese).toMatchObject({
            foodId: s.gouda.id,
            displayName: "Gouda",
            quantity: { amount: 150, unit: "g" },
        });
    });

    test("another person's swap to the same food with a different amount is kept", async () => {
        const s = await setup();
        await set(s, ALICE, {
            action: "food",
            ingredientId: s.cheese.id,
            foodId: s.gouda.id,
            amount: 150,
            unit: "g",
        });
        await set(s, BOB, {
            action: "food",
            ingredientId: s.cheese.id,
            foodId: s.gouda.id,
            amount: 90,
            unit: "g",
        });
        const result = await align(s, ALICE, s.cheese.id);
        expect(result.removed).toBe(1);
        expect(result.kept).toEqual([{ userId: BOB, action: "food" }]);
    });

    test("aligning a swap leaves another person's amount on the old food, not on the new one", async () => {
        const s = await setup();
        const eggs = await addRecipeManualIngredient(s.recipes, s.foods, {
            householdId: HH,
            recipeId: s.made.id,
            name: "Eggs",
            amount: 2,
            unit: "each",
        });
        const tofu = await findOrCreateManualFood(s.foods, HH, "food", "Tofu");
        await set(s, ALICE, {
            action: "food",
            ingredientId: eggs.id,
            foodId: tofu.id,
            amount: 200,
            unit: "g",
        });
        await set(s, BOB, {
            action: "amount",
            ingredientId: eggs.id,
            amount: 3,
            unit: "each",
        });
        // A to-taste amount is a statement about the food too.
        await set(s, CAROL, {
            action: "amount",
            ingredientId: eggs.id,
            amount: null,
        });
        const result = await align(s, ALICE, eggs.id);
        expect(await baseOf(s, eggs.id)).toMatchObject({
            foodId: tofu.id,
            displayName: "Tofu",
            quantity: { amount: 200, unit: "g" },
        });
        const base = await s.recipes.listIngredients(HH, s.made.id);
        const bob = variantFor(
            { id: s.made.id, ingredients: base },
            await s.variants.listOverrides(HH, s.made.id),
            BOB,
        ).ingredients.find((row) => row.baseIngredientId === eggs.id)!;
        expect(bob).toMatchObject({
            foodId: eggs.foodId,
            displayName: "Eggs",
            quantity: { amount: 3, unit: "each" },
        });
        const carol = variantFor(
            { id: s.made.id, ingredients: base },
            await s.variants.listOverrides(HH, s.made.id),
            CAROL,
        ).ingredients.find((row) => row.baseIngredientId === eggs.id)!;
        expect(carol).toMatchObject({
            foodId: eggs.foodId,
            displayName: "Eggs",
            quantity: null,
        });
        expect(result.kept).toEqual(
            expect.arrayContaining([
                { userId: BOB, action: "food" },
                { userId: CAROL, action: "food" },
            ]),
        );
    });

    test("an align that finds another person's row changed since it read it is refused and leaves that row", async () => {
        const s = await setup();
        for (const who of [ALICE, BOB]) {
            await set(s, who, {
                action: "amount",
                ingredientId: s.cheese.id,
                amount: 3,
                unit: "each",
            });
        }
        // Bob saves 5 after align has read his 3 and before it deletes it.
        const racing = {
            ...s.variants,
            async listOverrides(householdId: string, recipeId: string) {
                const snapshot = await s.variants.listOverrides(
                    householdId,
                    recipeId,
                );
                await set(s, BOB, {
                    action: "amount",
                    ingredientId: s.cheese.id,
                    amount: 5,
                    unit: "each",
                });
                return snapshot;
            },
        };
        await expect(
            alignChange(
                { ...deps(s), variants: racing },
                {
                    householdId: HH,
                    recipeId: s.made.id,
                    userId: ALICE,
                    ref: s.cheese.id,
                    rowKey: await keyFor(s, ALICE, s.cheese.id),
                },
            ),
        ).rejects.toThrow("changed while");
        const left = await s.variants.listOverrides(HH, s.made.id);
        expect(
            left.filter((row) => row.userId === BOB).map((row) => row.amount),
        ).toEqual([5]);
    });

    test("an align of a change the person has since edited is refused and leaves the base alone", async () => {
        const s = await setup();
        await set(s, ALICE, {
            action: "amount",
            ingredientId: s.cheese.id,
            amount: 50,
            unit: "g",
        });
        const racing = {
            ...s.variants,
            async listOverrides(householdId: string, recipeId: string) {
                const snapshot = await s.variants.listOverrides(
                    householdId,
                    recipeId,
                );
                await set(s, ALICE, {
                    action: "amount",
                    ingredientId: s.cheese.id,
                    amount: 70,
                    unit: "g",
                });
                return snapshot;
            },
        };
        await expect(
            alignChange(
                { ...deps(s), variants: racing },
                {
                    householdId: HH,
                    recipeId: s.made.id,
                    userId: ALICE,
                    ref: s.cheese.id,
                    rowKey: await keyFor(s, ALICE, s.cheese.id),
                },
            ),
        ).rejects.toThrow("changed while");
        expect((await baseOf(s, s.cheese.id)).quantity).toEqual({
            amount: 200,
            unit: "g",
        });
        expect(
            (await s.variants.listOverrides(HH, s.made.id)).map(
                (row) => row.amount,
            ),
        ).toEqual([70]);
    });

    test("an added line becomes a base ingredient; the same add elsewhere goes, a different amount becomes an amount on the new line", async () => {
        const s = await setup();
        await set(s, ALICE, {
            action: "add",
            foodId: s.peas.id,
            amount: 40,
            unit: "g",
        });
        await set(s, BOB, {
            action: "add",
            foodId: s.peas.id,
            amount: 40,
            unit: "g",
        });
        await set(s, CAROL, {
            action: "add",
            foodId: s.peas.id,
            amount: 90,
            unit: "g",
        });
        const aliceRow = (await s.variants.listOverrides(HH, s.made.id)).find(
            (row) => row.userId === ALICE,
        )!;
        const result = await align(s, ALICE, aliceRow.id);
        expect(result).toMatchObject({
            kind: "added",
            removed: 2,
            converted: 1,
        });
        const ingredients = await s.recipes.listIngredients(HH, s.made.id);
        expect(ingredients).toHaveLength(3);
        const peas = ingredients.find((row) => row.foodId === s.peas.id)!;
        expect(peas).toMatchObject({
            displayName: "Peas",
            quantity: { amount: 40, unit: "g" },
            sortOrder: 2,
        });
        expect(result.ingredientId).toBe(peas.id);
        // Carol keeps her 90 g, now as an amount on the base line, never as a
        // second line of peas.
        const left = await s.variants.listOverrides(HH, s.made.id);
        expect(left).toHaveLength(1);
        expect(left[0]).toMatchObject({
            userId: CAROL,
            action: "amount",
            ingredientId: peas.id,
            amount: 90,
            unit: "g",
        });
        const carol = variantFor({ id: s.made.id, ingredients }, left, CAROL);
        expect(
            carol.ingredients.filter((row) => row.foodId === s.peas.id),
        ).toHaveLength(1);
    });

    test("a removal is not aligned", async () => {
        const s = await setup();
        await set(s, ALICE, { action: "remove", ingredientId: s.cheese.id });
        await expect(align(s, ALICE, s.cheese.id)).rejects.toThrow(
            "A removed ingredient can't be aligned",
        );
        expect(await s.variants.listOverrides(HH, s.made.id)).toHaveLength(1);
        expect(await s.recipes.listIngredients(HH, s.made.id)).toHaveLength(2);
    });

    test("a change that no longer exists is refused and nothing changes", async () => {
        const s = await setup();
        await set(s, ALICE, {
            action: "amount",
            ingredientId: s.cheese.id,
            amount: 50,
            unit: "g",
        });
        await expect(align(s, BOB, s.cheese.id)).rejects.toThrow(
            "That change no longer exists",
        );
        await expect(align(s, ALICE, "no-such-ingredient")).rejects.toThrow(
            "That change no longer exists",
        );
        expect((await baseOf(s, s.cheese.id)).quantity).toEqual({
            amount: 200,
            unit: "g",
        });
        expect(await s.variants.listOverrides(HH, s.made.id)).toHaveLength(1);
    });

    test("a recipe or person of another household is refused", async () => {
        const s = await setup();
        await set(s, ALICE, {
            action: "amount",
            ingredientId: s.cheese.id,
            amount: 50,
            unit: "g",
        });
        await expect(
            alignChange(deps(s), {
                householdId: "hh-2",
                recipeId: s.made.id,
                userId: ALICE,
                ref: s.cheese.id,
                rowKey: "",
            }),
        ).rejects.toThrow("Unknown recipe");
        expect(await s.variants.listOverrides(HH, s.made.id)).toHaveLength(1);
    });

    test("a base change that would break a verified recipe is refused with what is wrong", async () => {
        const s = await setup();
        // A row that names no food cannot become a base line: the recipe
        // would no longer pass its check.
        const row = await s.variants.saveOverride({
            householdId: HH,
            recipeId: s.made.id,
            userId: ALICE,
            ingredientId: null,
            action: "add",
            amount: 40,
            unit: "g",
            foodId: null,
            displayName: "Mystery",
        });
        await expect(align(s, ALICE, row.id)).rejects.toThrow(
            "Mystery is not linked to a food.",
        );
        expect(await s.recipes.listIngredients(HH, s.made.id)).toHaveLength(2);
        expect(await s.variants.listOverrides(HH, s.made.id)).toHaveLength(1);
    });

    test("runs inside the transaction it is given", async () => {
        const s = await setup();
        await set(s, ALICE, {
            action: "amount",
            ingredientId: s.cheese.id,
            amount: 50,
            unit: "g",
        });
        let wrapped = 0;
        await alignChange(
            {
                ...deps(s),
                transaction: (fn) => {
                    wrapped++;
                    return fn();
                },
            },
            {
                householdId: HH,
                recipeId: s.made.id,
                userId: ALICE,
                ref: s.cheese.id,
                rowKey: await keyFor(s, ALICE, s.cheese.id),
            },
        );
        expect(wrapped).toBe(1);
    });

    test("an unverified recipe is checked again after the base changes", async () => {
        const s = await setup();
        await s.recipes.setVerification(HH, s.made.id, "unverified", []);
        await set(s, ALICE, {
            action: "amount",
            ingredientId: s.cheese.id,
            amount: 50,
            unit: "g",
        });
        await align(s, ALICE, s.cheese.id);
        expect((await s.recipes.getRecipe(HH, s.made.id))?.verification).toBe(
            "verified",
        );
    });
});

describe("resetting a person's version", () => {
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
        const cheese = await addRecipeManualIngredient(recipes, foods, {
            householdId: HH,
            recipeId: made.id,
            name: "Cheese",
            amount: 200,
            unit: "g",
        });
        const peas = await findOrCreateManualFood(foods, HH, "food", "Peas");
        for (const userId of [ALICE, BOB]) {
            await setRecipeVariant(recipes, foods, variants, {
                householdId: HH,
                recipeId: made.id,
                userId,
                action: "amount",
                ingredientId: cheese.id,
                amount: 50,
                unit: "g",
            });
            await setRecipeVariant(recipes, foods, variants, {
                householdId: HH,
                recipeId: made.id,
                userId,
                action: "add",
                foodId: peas.id,
                amount: 40,
                unit: "g",
            });
        }
        return { recipes, variants, made };
    }

    const shown = async (
        s: Awaited<ReturnType<typeof setup>>,
        userId: string,
    ) =>
        (
            await previewReset(s.recipes, s.variants, {
                householdId: HH,
                recipeId: s.made.id,
                userId,
            })
        ).rowKeys;

    test("removes every row of that person on the recipe and no one else's", async () => {
        const s = await setup();
        expect(
            await resetVariant(s.recipes, s.variants, {
                householdId: HH,
                recipeId: s.made.id,
                userId: ALICE,
                rowKeys: await shown(s, ALICE),
            }),
        ).toBe(2);
        const left = await s.variants.listOverrides(HH, s.made.id);
        expect(left.map((row) => row.userId)).toEqual([BOB, BOB]);
    });

    test("previewReset says what would go and changes nothing", async () => {
        const s = await setup();
        const preview = await previewReset(s.recipes, s.variants, {
            householdId: HH,
            recipeId: s.made.id,
            userId: ALICE,
        });
        expect(preview.overrideCount).toBe(2);
        expect(preview.rowKeys).toHaveLength(2);
        expect(preview.differences.map((d) => d.kind)).toEqual([
            "amount",
            "added",
        ]);
        expect(await s.variants.listOverrides(HH, s.made.id)).toHaveLength(4);
        await expect(
            previewReset(s.recipes, s.variants, {
                householdId: HH,
                recipeId: s.made.id,
                userId: "carol",
            }),
        ).rejects.toThrow("has no version");
    });

    test("refuses a person with no version, and another household's recipe", async () => {
        const s = await setup();
        await expect(
            resetVariant(s.recipes, s.variants, {
                householdId: HH,
                recipeId: s.made.id,
                userId: "carol",
                rowKeys: [],
            }),
        ).rejects.toThrow("has no version");
        await expect(
            resetVariant(s.recipes, s.variants, {
                householdId: "hh-2",
                recipeId: s.made.id,
                userId: ALICE,
                rowKeys: await shown(s, ALICE),
            }),
        ).rejects.toThrow("Unknown recipe");
        expect(await s.variants.listOverrides(HH, s.made.id)).toHaveLength(4);
    });
    test("a confirm takes the rows the admin was shown, not ones saved since", async () => {
        const s = await setup();
        const keys = await shown(s, BOB);
        const ghee = await findOrCreateManualFood(
            createMemoryFoodsStore(),
            HH,
            "food",
            "Ghee",
        );
        // Bob adds a line after the admin opened the confirm.
        await s.variants.saveOverride({
            householdId: HH,
            recipeId: s.made.id,
            userId: BOB,
            ingredientId: null,
            action: "add",
            amount: 10,
            unit: "g",
            foodId: ghee.id,
            displayName: "Ghee",
        });
        await expect(
            resetVariant(s.recipes, s.variants, {
                householdId: HH,
                recipeId: s.made.id,
                userId: BOB,
                rowKeys: keys,
            }),
        ).rejects.toThrow("Their version changed; look again.");
        expect(await s.variants.listOverrides(HH, s.made.id)).toHaveLength(5);
    });

    test("a confirm refuses a row saved again since the preview, and one that is gone", async () => {
        const s = await setup();
        const keys = await shown(s, ALICE);
        const [first] = (await s.variants.listOverrides(HH, s.made.id)).filter(
            (row) => row.userId === ALICE && row.action === "amount",
        );
        await s.variants.saveOverride({
            householdId: HH,
            recipeId: s.made.id,
            userId: ALICE,
            ingredientId: first!.ingredientId,
            action: "amount",
            amount: 60,
            unit: "g",
        });
        await expect(
            resetVariant(s.recipes, s.variants, {
                householdId: HH,
                recipeId: s.made.id,
                userId: ALICE,
                rowKeys: keys,
            }),
        ).rejects.toThrow("Their version changed; look again.");
        // One of the shown rows was cleared by the person themselves.
        const now = await shown(s, ALICE);
        await s.variants.deleteOverride(HH, s.made.id, ALICE, first!.id);
        await expect(
            resetVariant(s.recipes, s.variants, {
                householdId: HH,
                recipeId: s.made.id,
                userId: ALICE,
                rowKeys: now,
            }),
        ).rejects.toThrow("Their version changed; look again.");
        // No keys at all is not "everything".
        await expect(
            resetVariant(s.recipes, s.variants, {
                householdId: HH,
                recipeId: s.made.id,
                userId: BOB,
                rowKeys: [],
            }),
        ).rejects.toThrow("Their version changed; look again.");
        expect(await s.variants.listOverrides(HH, s.made.id)).toHaveLength(3);
    });
});

describe("aligning never changes what another person cooks", () => {
    // Everyone here has a row on the cheese line; `added` has no row on it, so
    // they follow the base like anyone else (checked on its own).
    const PEOPLE = {
        amountSame: "p-amount-same",
        amountOther: "p-amount-other",
        amountTaste: "p-amount-taste",
        foodWithAmount: "p-food-amount",
        foodNoAmount: "p-food-no-amount",
        foodTaste: "p-food-taste",
        foodTargetNoAmount: "p-food-target-no-amount",
        removed: "p-removed",
    };
    const ADDED = "p-added";
    async function setup() {
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const variants = createMemoryVariantsStore();
        const made = await createRecipe(recipes, {
            householdId: HH,
            creatorId: ALICE,
            name: "Mac",
            yieldPortions: 4,
            instructions: "Boil. Mix.",
        });
        const cheese = await addRecipeManualIngredient(recipes, foods, {
            householdId: HH,
            recipeId: made.id,
            name: "Cheese",
            amount: 200,
            unit: "g",
        });
        const pasta = await addRecipeManualIngredient(recipes, foods, {
            householdId: HH,
            recipeId: made.id,
            name: "Pasta",
            amount: 400,
            unit: "g",
        });
        const peas = await findOrCreateManualFood(foods, HH, "food", "Peas");
        const gouda = await findOrCreateManualFood(foods, HH, "food", "Gouda");
        return { recipes, foods, variants, made, cheese, pasta, peas, gouda };
    }
    type S = Awaited<ReturnType<typeof setup>>;
    const set = (s: S, userId: string, rest: Record<string, unknown>) =>
        setRecipeVariant(s.recipes, s.foods, s.variants, {
            householdId: HH,
            recipeId: s.made.id,
            userId,
            ...rest,
        } as never);
    const align = async (s: S, userId: string, ref: string) =>
        alignChange(
            { recipes: s.recipes, foods: s.foods, variants: s.variants },
            {
                householdId: HH,
                recipeId: s.made.id,
                userId,
                ref,
                rowKey: await keyFor(s, userId, ref),
            },
        );
    /** Everything one person cooks from the recipe, whatever rows make it so. */
    const cooked = async (s: S, userId: string) => {
        const base = await s.recipes.listIngredients(HH, s.made.id);
        const all = await s.variants.listOverrides(HH, s.made.id);
        return variantFor({ id: s.made.id, ingredients: base }, all, userId)
            .ingredients.map((line) => ({
                name: line.displayName,
                foodId: line.foodId,
                quantity: line.quantity,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    };

    /** One person per kind of row on the cheese line, and an added line. */
    async function everyKindOfRow(s: S) {
        await set(s, PEOPLE.amountSame, {
            action: "amount",
            ingredientId: s.cheese.id,
            amount: 150,
            unit: "g",
        });
        await set(s, PEOPLE.amountOther, {
            action: "amount",
            ingredientId: s.cheese.id,
            amount: 120,
            unit: "g",
        });
        await set(s, PEOPLE.amountTaste, {
            action: "amount",
            ingredientId: s.cheese.id,
            amount: null,
        });
        await set(s, PEOPLE.foodWithAmount, {
            action: "food",
            ingredientId: s.cheese.id,
            foodId: s.peas.id,
            amount: 50,
            unit: "g",
        });
        await set(s, PEOPLE.foodNoAmount, {
            action: "food",
            ingredientId: s.cheese.id,
            foodId: s.peas.id,
        });
        await set(s, PEOPLE.foodTaste, {
            action: "food",
            ingredientId: s.cheese.id,
            foodId: s.peas.id,
            amount: null,
            unit: "g",
        });
        await set(s, PEOPLE.foodTargetNoAmount, {
            action: "food",
            ingredientId: s.cheese.id,
            foodId: s.gouda.id,
        });
        await set(s, PEOPLE.removed, {
            action: "remove",
            ingredientId: s.cheese.id,
        });
        await set(s, ADDED, {
            action: "add",
            foodId: s.peas.id,
            amount: 40,
            unit: "g",
        });
    }

    test("a swap align leaves every other person cooking what they cooked", async () => {
        const s = await setup();
        await everyKindOfRow(s);
        // Alice swaps the cheese for 150 g of gouda; one person's amount
        // happens to be 150 g too.
        await set(s, ALICE, {
            action: "food",
            ingredientId: s.cheese.id,
            foodId: s.gouda.id,
            amount: 150,
            unit: "g",
        });
        const before = new Map<string, Awaited<ReturnType<typeof cooked>>>();
        for (const who of Object.values(PEOPLE)) {
            before.set(who, await cooked(s, who));
        }
        await align(s, ALICE, s.cheese.id);
        for (const who of Object.values(PEOPLE)) {
            expect({ who, line: await cooked(s, who) }).toEqual({
                who,
                line: before.get(who)!,
            });
        }
        // The amount that equalled the swap's is a swap back to the old food,
        // not a row dropped as "the same as the base".
        expect(await cooked(s, PEOPLE.amountSame)).toContainEqual({
            name: "Cheese",
            foodId: s.cheese.foodId,
            quantity: { amount: 150, unit: "g" },
        });
        // Someone who followed the base amount keeps the amount they had: 200 g.
        expect(await cooked(s, PEOPLE.foodNoAmount)).toContainEqual({
            name: "Peas",
            foodId: s.peas.id,
            quantity: { amount: 200, unit: "g" },
        });
        expect(await cooked(s, PEOPLE.foodTargetNoAmount)).toContainEqual({
            name: "Gouda",
            foodId: s.gouda.id,
            quantity: { amount: 200, unit: "g" },
        });
        // A person with no row on it follows the base, and keeps their own
        // added line.
        expect(await cooked(s, ADDED)).toEqual(
            expect.arrayContaining([
                {
                    name: "Gouda",
                    foodId: s.gouda.id,
                    quantity: { amount: 150, unit: "g" },
                },
                {
                    name: "Peas",
                    foodId: s.peas.id,
                    quantity: { amount: 40, unit: "g" },
                },
            ]),
        );
        expect(await cooked(s, ALICE)).toContainEqual({
            name: "Gouda",
            foodId: s.gouda.id,
            quantity: { amount: 150, unit: "g" },
        });
    });

    test("an amount align leaves every other person cooking what they cooked", async () => {
        const s = await setup();
        await everyKindOfRow(s);
        await set(s, ALICE, {
            action: "amount",
            ingredientId: s.cheese.id,
            amount: 150,
            unit: "g",
        });
        const before = new Map<string, Awaited<ReturnType<typeof cooked>>>();
        for (const who of Object.values(PEOPLE)) {
            before.set(who, await cooked(s, who));
        }
        const result = await align(s, ALICE, s.cheese.id);
        for (const who of Object.values(PEOPLE)) {
            expect({ who, line: await cooked(s, who) }).toEqual({
                who,
                line: before.get(who)!,
            });
        }
        // The identical amount is the only row that goes (and Alice's own).
        expect(result.removed).toBe(2);
        // Someone who followed the base amount of a swap keeps the old 200 g.
        expect(await cooked(s, PEOPLE.foodNoAmount)).toContainEqual({
            name: "Peas",
            foodId: s.peas.id,
            quantity: { amount: 200, unit: "g" },
        });
    });

    test("a base left to taste stays to taste for someone who swapped it and gave no amount", async () => {
        const s = await setup();
        const salt = await addRecipeManualIngredient(s.recipes, s.foods, {
            householdId: HH,
            recipeId: s.made.id,
            name: "Salt",
        });
        await set(s, BOB, {
            action: "food",
            ingredientId: salt.id,
            foodId: s.peas.id,
        });
        await set(s, ALICE, {
            action: "amount",
            ingredientId: salt.id,
            amount: 5,
            unit: "g",
        });
        const before = await cooked(s, BOB);
        await align(s, ALICE, salt.id);
        expect(await cooked(s, BOB)).toEqual(before);
        expect(await cooked(s, BOB)).toContainEqual({
            name: "Peas",
            foodId: s.peas.id,
            quantity: null,
        });
    });
});
