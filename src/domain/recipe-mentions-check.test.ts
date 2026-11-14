import { describe, expect, test } from "bun:test";
import type { SafeFetcher } from "../fetch-safe.js";
import {
    createMemoryFoodsStore,
    findOrCreateManualFood,
    findOrCreateManualFoodForRecipeImport,
    FoodsInputError,
    newFood,
    type FoodsStore,
} from "./foods.js";
import { importRecipeFromUrl, recheckRecipe } from "./recipe-import.js";
import {
    addMentionedIngredient,
    dismissFlaggedMention,
    dismissRecipeMention,
    recipeMentionWarnings,
} from "./recipe-mentions-check.js";
import {
    createMemoryRecipesStore,
    createRecipe,
    RecipeInputError,
    type RecipesStore,
} from "./recipes.js";

const HH = "hh-1";
const USER = "user-1";

// A recipe page shaped like a Pad See Ew that lists no egg but scrambles one.
const PAD_SEE_EW = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(
    {
        "@type": "Recipe",
        name: "Simple Pad See Ew",
        recipeYield: "2",
        recipeIngredient: [
            "8 oz wide rice noodles",
            "2 cups chopped Chinese broccoli",
            "2 tablespoons soy sauce",
            "1 tablespoon oyster sauce",
        ],
        recipeInstructions: [
            { "@type": "HowToStep", text: "Soak the noodles until pliable." },
            {
                "@type": "HowToStep",
                text: "Heat a wok, push the broccoli aside, and scramble 2 lightly beaten eggs.",
            },
            { "@type": "HowToStep", text: "Toss in the sauces and noodles." },
        ],
    },
)}</script></head></html>`;

function fetcherFor(body: string): SafeFetcher {
    return {
        async robotsAllows() {
            return true;
        },
        async fetchPage(url: string | URL) {
            return {
                ok: true as const,
                url: typeof url === "string" ? url : url.href,
                status: 200,
                contentType: "text/html",
                body,
            };
        },
    } as unknown as SafeFetcher;
}

async function importPadSeeEw() {
    const recipes = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const result = await importRecipeFromUrl(
        { recipes, foods, fetcher: fetcherFor(PAD_SEE_EW) },
        {
            householdId: HH,
            creatorId: USER,
            url: "https://www.slowfoodmama.com/pad-see-ew",
        },
    );
    expect(result.recipeId).not.toBeNull();
    return { recipes, foods, recipeId: result.recipeId! };
}

/** A recipe whose steps use `steps`, imported (or hand-made) with `lines`. */
async function recipeWith(opts: {
    steps: string;
    imported?: boolean;
    verified?: boolean;
}) {
    const recipes = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: USER,
        name: "Fried rice",
        yieldPortions: 2,
        instructions: opts.steps,
        verification: opts.verified ? "verified" : "unverified",
    });
    const rice = await findOrCreateManualFood(foods, HH, "food", "rice");
    await recipes.insertIngredient({
        id: crypto.randomUUID(),
        householdId: HH,
        recipeId: recipe.id,
        kind: "food",
        displayName: "rice",
        quantity: { amount: 200, unit: "g" },
        foodId: rice.id,
        sortOrder: 0,
        note: null,
    });
    if (opts.imported !== false) {
        await recipes.upsertImport({
            recipeId: recipe.id,
            householdId: HH,
            sourceKind: "text",
            sourceUrl: null,
            sourceText: "pasted",
            sourceTextOrigin: "pasted",
            transcript: null,
            credit: null,
            unresolvedLines: [],
            problems: [],
            dismissedMentions: [],
            importedAt: "2026-01-01T00:00:00.000Z",
        });
    }
    return { recipes, foods, recipeId: recipe.id };
}

async function ingredientNames(recipes: RecipesStore, recipeId: string) {
    return (await recipes.listIngredients(HH, recipeId)).map(
        (i) => i.displayName,
    );
}

describe("recipeMentionWarnings", () => {
    test("an imported Pad See Ew warns about the egg its steps scramble", async () => {
        const { recipes, foods, recipeId } = await importPadSeeEw();
        const warnings = await recipeMentionWarnings(
            { recipes, foods },
            HH,
            recipeId,
        );
        expect(warnings.map((w) => w.key)).toEqual(["egg"]);
    });

    test("a recipe with no import row gets no warnings", async () => {
        const { recipes, foods, recipeId } = await recipeWith({
            steps: "Fry the rice.\nScramble 2 eggs into it.",
            imported: false,
        });
        expect(
            await recipeMentionWarnings({ recipes, foods }, HH, recipeId),
        ).toEqual([]);
    });

    test("a dismissed food stops warning, and dismissing twice stores it once", async () => {
        const { recipes, foods, recipeId } = await importPadSeeEw();
        await dismissRecipeMention(recipes, HH, recipeId, "egg");
        await dismissRecipeMention(recipes, HH, recipeId, "egg");
        expect(
            await recipeMentionWarnings({ recipes, foods }, HH, recipeId),
        ).toEqual([]);
        expect(
            (await recipes.getImport(HH, recipeId))?.dismissedMentions,
        ).toEqual(["egg"]);
    });

    test("dismissing needs a key and does nothing without an import row", async () => {
        const imported = await recipeWith({ steps: "Scramble 2 eggs." });
        await expect(
            dismissRecipeMention(imported.recipes, HH, imported.recipeId, "  "),
        ).rejects.toBeInstanceOf(RecipeInputError);
        const handMade = await recipeWith({
            steps: "Scramble 2 eggs.",
            imported: false,
        });
        await dismissRecipeMention(
            handMade.recipes,
            HH,
            handMade.recipeId,
            "egg",
        );
        expect(
            await handMade.recipes.getImport(HH, handMade.recipeId),
        ).toBeNull();
    });

    test("a warning never touches verification", async () => {
        const { recipes, foods, recipeId } = await recipeWith({
            steps: "Fry the rice.\nScramble 2 eggs into it.",
            verified: true,
        });
        await recipes.setVerification(HH, recipeId, "verified", []);
        expect(
            (await recipeMentionWarnings({ recipes, foods }, HH, recipeId)).map(
                (w) => w.key,
            ),
        ).toEqual(["egg"]);
        const checked = await recheckRecipe(recipes, HH, recipeId);
        expect(checked.verified).toBe(true);
        expect(checked.problems).toEqual([]);
        expect((await recipes.getRecipe(HH, recipeId))?.verification).toBe(
            "verified",
        );
    });
});

describe("addMentionedIngredient", () => {
    test("a catalog food archived after the warning was found is an input error, not a crash", async () => {
        const { recipes, foods, recipeId } = await recipeWith({
            steps: "Fry the rice.\nScramble the egg into it.",
        });
        const egg = await findOrCreateManualFood(foods, HH, "food", "Eggs");
        const archivedLater: FoodsStore = {
            ...foods,
            getFood: async (household, id) => {
                const food = await foods.getFood(household, id);
                return food?.id === egg.id
                    ? { ...food, archivedAt: "2026-01-02T00:00:00.000Z" }
                    : food;
            },
        };
        await expect(
            addMentionedIngredient(
                { recipes, foods: archivedLater },
                HH,
                recipeId,
                "egg",
            ),
        ).rejects.toBeInstanceOf(RecipeInputError);
        expect(await ingredientNames(recipes, recipeId)).toEqual(["rice"]);
    });

    test("adds the egg the steps give an amount for, in each", async () => {
        const { recipes, foods, recipeId } = await recipeWith({
            steps: "Fry the rice.\nAdd 2 lightly beaten eggs and stir.",
        });
        const added = await addMentionedIngredient(
            { recipes, foods },
            HH,
            recipeId,
            "egg",
        );
        expect(added.ingredient.quantity).toEqual({ amount: 2, unit: "each" });
        expect(added.ingredient.note).toBe("lightly beaten");
        expect(added.foodName.toLowerCase()).toContain("egg");
        expect(added.createdFood).toBe(true);
        expect(await ingredientNames(recipes, recipeId)).toHaveLength(2);
        expect(
            await recipeMentionWarnings({ recipes, foods }, HH, recipeId),
        ).toEqual([]);
    });

    test("with no amount in the steps it adds 1 each", async () => {
        const { recipes, foods, recipeId } = await recipeWith({
            steps: "Fry the rice.\nScramble the egg into it.",
        });
        const added = await addMentionedIngredient(
            { recipes, foods },
            HH,
            recipeId,
            "egg",
        );
        expect(added.ingredient.quantity).toEqual({ amount: 1, unit: "each" });
    });

    test("with no amount and a catalog food with a pack serving it adds that serving", async () => {
        const { recipes, foods, recipeId } = await recipeWith({
            steps: "Fry the rice.\nScramble the egg into it.",
        });
        const egg = await findOrCreateManualFood(foods, HH, "food", "Eggs");
        await foods.updateFoodRow({
            ...egg,
            serving: { label: "1 egg (50 g)", amount: 50, unit: "g" },
        });
        const warnings = await recipeMentionWarnings(
            { recipes, foods },
            HH,
            recipeId,
        );
        expect(warnings[0]?.foodId).toBe(egg.id);
        const added = await addMentionedIngredient(
            { recipes, foods },
            HH,
            recipeId,
            "egg",
        );
        expect(added.ingredient.foodId).toBe(egg.id);
        expect(added.createdFood).toBe(false);
        expect(added.ingredient.quantity).toEqual({ amount: 50, unit: "g" });
    });

    test("uses the catalog food the warning matched instead of creating one", async () => {
        const { recipes, foods, recipeId } = await recipeWith({
            steps: "Fry the rice.\nAdd 2 eggs and stir.",
        });
        const egg = await findOrCreateManualFood(foods, HH, "food", "Eggs");
        const before = (await foods.listFoods(HH)).length;
        const added = await addMentionedIngredient(
            { recipes, foods },
            HH,
            recipeId,
            "egg",
        );
        expect(added.ingredient.foodId).toBe(egg.id);
        expect((await foods.listFoods(HH)).length).toBe(before);
    });

    test("an unknown or already handled key is an error", async () => {
        const { recipes, foods, recipeId } = await recipeWith({
            steps: "Fry the rice.\nAdd 2 eggs and stir.",
        });
        await expect(
            addMentionedIngredient({ recipes, foods }, HH, recipeId, "kale"),
        ).rejects.toBeInstanceOf(RecipeInputError);
        await addMentionedIngredient({ recipes, foods }, HH, recipeId, "egg");
        await expect(
            addMentionedIngredient({ recipes, foods }, HH, recipeId, "egg"),
        ).rejects.toBeInstanceOf(RecipeInputError);
    });

    test("adding the egg re-checks the recipe and a verified one stays verified", async () => {
        const { recipes, foods, recipeId } = await recipeWith({
            steps: "Fry the rice.\nAdd 2 eggs and stir.",
        });
        expect((await recheckRecipe(recipes, HH, recipeId)).verified).toBe(
            true,
        );
        expect((await recipes.getRecipe(HH, recipeId))?.verification).toBe(
            "verified",
        );
        await addMentionedIngredient({ recipes, foods }, HH, recipeId, "egg");
        expect((await recipes.getRecipe(HH, recipeId))?.verification).toBe(
            "verified",
        );
        expect((await recipes.getImport(HH, recipeId))?.problems).toEqual([]);
    });
});

/** A store whose calls are counted, to see what a function really asks for. */
function counting<T extends object>(store: T, methods: (keyof T)[]) {
    const calls = new Map<keyof T, number>();
    const wrapped = { ...store } as Record<keyof T, unknown>;
    for (const method of methods) {
        const original = store[method] as (...args: unknown[]) => unknown;
        wrapped[method] = (...args: unknown[]) => {
            calls.set(method, (calls.get(method) ?? 0) + 1);
            return original.apply(store, args);
        };
    }
    return { store: wrapped as T, count: (m: keyof T) => calls.get(m) ?? 0 };
}

describe("a key is matched however it is spelled", () => {
    test("Add finds the warning for 'Egg', 'EGGS' and ' egg '", async () => {
        for (const spelled of ["Egg", "EGGS", " egg "]) {
            const { recipes, foods, recipeId } = await recipeWith({
                steps: "Fry the rice.\nAdd 2 eggs and stir.",
            });
            const added = await addMentionedIngredient(
                { recipes, foods },
                HH,
                recipeId,
                spelled,
            );
            expect(added.foodName.toLowerCase()).toContain("egg");
        }
    });

    test("Dismiss stores the detector's key for any spelling, trimmed", async () => {
        const { recipes, foods, recipeId } = await recipeWith({
            steps: "Fry the rice.\nAdd 2 eggs and stir.",
        });
        await dismissRecipeMention(recipes, HH, recipeId, "  EGGS ");
        await dismissRecipeMention(recipes, HH, recipeId, "Egg");
        expect(
            (await recipes.getImport(HH, recipeId))?.dismissedMentions,
        ).toEqual(["egg"]);
        expect(
            await recipeMentionWarnings({ recipes, foods }, HH, recipeId),
        ).toEqual([]);
    });

    test("a household food outside the bundled words keeps its own key", async () => {
        const { recipes, recipeId } = await recipeWith({
            steps: "Fry the rice.",
        });
        await dismissRecipeMention(recipes, HH, recipeId, "Pickled  Beets");
        expect(
            (await recipes.getImport(HH, recipeId))?.dismissedMentions,
        ).toEqual(["pickled beets"]);
    });

    test("a dismissal key longer than 120 characters is cut to 120", async () => {
        const { recipes, recipeId } = await recipeWith({
            steps: "Fry the rice.",
        });
        await dismissRecipeMention(recipes, HH, recipeId, "x".repeat(300));
        const [stored] =
            (await recipes.getImport(HH, recipeId))?.dismissedMentions ?? [];
        expect(stored).toHaveLength(120);
    });
});

describe("recipeMentionWarnings with what is already loaded", () => {
    test("loaded recipe, ingredients and import row are not read again", async () => {
        const { recipes, foods, recipeId } = await importPadSeeEw();
        const recipe = (await recipes.getRecipe(HH, recipeId))!;
        const ingredients = await recipes.listIngredients(HH, recipeId);
        const importRow = await recipes.getImport(HH, recipeId);
        const watched = counting(recipes, [
            "getRecipe",
            "listIngredients",
            "getImport",
        ]);
        const warnings = await recipeMentionWarnings(
            { recipes: watched.store, foods },
            HH,
            recipeId,
            { recipe, ingredients, importRow },
        );
        expect(warnings.map((w) => w.key)).toEqual(["egg"]);
        expect(watched.count("getRecipe")).toBe(0);
        expect(watched.count("listIngredients")).toBe(0);
        expect(watched.count("getImport")).toBe(0);
    });

    test("a loaded 'no import row' means no warnings and no reads", async () => {
        const { recipes, foods, recipeId } = await importPadSeeEw();
        const watched = counting(recipes, ["getImport"]);
        expect(
            await recipeMentionWarnings(
                { recipes: watched.store, foods },
                HH,
                recipeId,
                { importRow: null },
            ),
        ).toEqual([]);
        expect(watched.count("getImport")).toBe(0);
    });
});

describe("addMentionedIngredient's own cost", () => {
    test("it does not list the catalog again to learn whether it created a food", async () => {
        const steps = "Fry the rice.\nAdd 2 eggs and stir.";
        // What finding the warning and resolving the food need on their own.
        const base = await recipeWith({ steps });
        const baseline = counting<FoodsStore>(base.foods, ["listFoods"]);
        await recipeMentionWarnings(
            { recipes: base.recipes, foods: baseline.store },
            HH,
            base.recipeId,
        );
        await findOrCreateManualFoodForRecipeImport(
            baseline.store,
            HH,
            "food",
            "egg",
        );
        const { recipes, foods, recipeId } = await recipeWith({ steps });
        const watched = counting<FoodsStore>(foods, ["listFoods"]);
        const added = await addMentionedIngredient(
            { recipes, foods: watched.store },
            HH,
            recipeId,
            "egg",
        );
        expect(added.createdFood).toBe(true);
        expect(watched.count("listFoods")).toBeLessThanOrEqual(
            baseline.count("listFoods"),
        );
    });

    test("a matched catalog food reports createdFood false", async () => {
        const { recipes, foods, recipeId } = await recipeWith({
            steps: "Fry the rice.\nAdd 2 eggs and stir.",
        });
        await findOrCreateManualFood(foods, HH, "food", "Eggs");
        const added = await addMentionedIngredient(
            { recipes, foods },
            HH,
            recipeId,
            "egg",
        );
        expect(added.createdFood).toBe(false);
    });

    test("an unverified recipe is re-checked once and a verified one is left alone", async () => {
        for (const verified of [false, true]) {
            const { recipes, foods, recipeId } = await recipeWith({
                steps: "Fry the rice.\nAdd 2 eggs and stir.",
            });
            if (verified) await recheckRecipe(recipes, HH, recipeId);
            const watched = counting(recipes, ["setVerification"]);
            await addMentionedIngredient(
                { recipes: watched.store, foods },
                HH,
                recipeId,
                "egg",
            );
            expect(watched.count("setVerification")).toBe(verified ? 0 : 1);
        }
    });

    test("adding a mentioned food keeps a verified recipe verified when another line has no amount", async () => {
        const { recipes, foods, recipeId } = await recipeWith({
            steps: "Fry the rice and the onion.\nScramble 2 eggs.",
            verified: true,
        });
        const onion = await findOrCreateManualFood(foods, HH, "food", "Onion");
        await recipes.insertIngredient({
            id: crypto.randomUUID(),
            householdId: HH,
            recipeId,
            kind: "food",
            displayName: "Onion",
            quantity: null,
            foodId: onion.id,
            sortOrder: 1,
            note: "finely chopped",
        });
        await addMentionedIngredient({ recipes, foods }, HH, recipeId, "egg");
        expect((await recipes.getRecipe(HH, recipeId))?.verification).toBe(
            "verified",
        );
        expect(await ingredientNames(recipes, recipeId)).toContain("egg");
    });

    test("two Adds of one food at once never crash: a new food's loser is an input error", async () => {
        const { recipes, foods, recipeId } = await recipeWith({
            steps: "Fry the rice.\nAdd 2 eggs and stir.",
        });
        const racing: FoodsStore = {
            ...foods,
            insertFood: async () => {
                throw new FoodsInputError("That food already exists.");
            },
        };
        await expect(
            addMentionedIngredient(
                { recipes, foods: racing },
                HH,
                recipeId,
                "egg",
            ),
        ).rejects.toBeInstanceOf(RecipeInputError);
        expect(await ingredientNames(recipes, recipeId)).toEqual(["rice"]);
    });

    test("two Adds of a catalog food at once both succeed and leave two lines (accepted: a member can delete one)", async () => {
        const { recipes, foods, recipeId } = await recipeWith({
            steps: "Fry the rice.\nAdd 2 eggs and stir.",
        });
        await findOrCreateManualFood(foods, HH, "food", "Eggs");
        const results = await Promise.allSettled([
            addMentionedIngredient({ recipes, foods }, HH, recipeId, "egg"),
            addMentionedIngredient({ recipes, foods }, HH, recipeId, "egg"),
        ]);
        expect(results.map((r) => r.status)).toEqual([
            "fulfilled",
            "fulfilled",
        ]);
    });

    test("a hand-made recipe gets a clear error", async () => {
        const { recipes, foods, recipeId } = await recipeWith({
            steps: "Fry the rice.\nAdd 2 eggs and stir.",
            imported: false,
        });
        await expect(
            addMentionedIngredient({ recipes, foods }, HH, recipeId, "egg"),
        ).rejects.toThrow("This recipe has no step check.");
    });
});

describe("an ingredient that is a brand's product covers the plain food's mention", () => {
    async function withProduct(
        plainName: string,
        productName: string,
        steps: string,
    ) {
        const { recipes, foods, recipeId } = await recipeWith({ steps });
        const plain = await findOrCreateManualFood(
            foods,
            HH,
            "food",
            plainName,
        );
        const product = await foods.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: productName,
                brand: "Brand",
                genericFoodId: plain.id,
            }),
        );
        await recipes.insertIngredient({
            id: crypto.randomUUID(),
            householdId: HH,
            recipeId,
            kind: "food",
            displayName: product.name,
            quantity: { amount: 100, unit: "g" },
            foodId: product.id,
            sortOrder: 1,
            note: null,
        });
        return { recipes, foods, recipeId };
    }

    test("a product of Cream cheese covers 'the cream cheese' though its own name lacks the words", async () => {
        const { recipes, foods, recipeId } = await withProduct(
            "Cream cheese",
            "Philadelphia Original",
            "Fry the rice.\nBeat the cream cheese until smooth.",
        );
        expect(
            await recipeMentionWarnings({ recipes, foods }, HH, recipeId),
        ).toEqual([]);
    });

    test("a product of Eggs covers a scrambled egg", async () => {
        const { recipes, foods, recipeId } = await withProduct(
            "Eggs",
            "Happy Hens Free Range",
            "Fry the rice.\nWhisk 2 eggs and pour in.",
        );
        expect(
            await recipeMentionWarnings({ recipes, foods }, HH, recipeId),
        ).toEqual([]);
    });

    test("a product of another food leaves the gap showing", async () => {
        const { recipes, foods, recipeId } = await withProduct(
            "Butter",
            "Happy Hens Free Range",
            "Fry the rice.\nWhisk 2 eggs and pour in.",
        );
        expect(
            (await recipeMentionWarnings({ recipes, foods }, HH, recipeId)).map(
                (w) => w.key,
            ),
        ).toEqual(["egg"]);
    });
});

describe("dismissFlaggedMention", () => {
    test("dismisses a catalog food whose name is longer than a raw key may be", async () => {
        const longName = `${"stone ground whole wheat ".repeat(7)}flour`;
        expect(longName.length).toBeGreaterThan(120);
        const { recipes, foods, recipeId } = await recipeWith({
            steps: `Fry the rice.\nStir in the ${longName}.`,
        });
        await findOrCreateManualFood(foods, HH, "food", longName);
        const before = await recipeMentionWarnings(
            { recipes, foods },
            HH,
            recipeId,
        );
        expect(before).toHaveLength(1);
        await dismissFlaggedMention(
            { recipes, foods },
            HH,
            recipeId,
            before[0]!.key,
        );
        expect(
            await recipeMentionWarnings({ recipes, foods }, HH, recipeId),
        ).toEqual([]);
    });

    test("dismisses a warning that is showing, in any spelling", async () => {
        const { recipes, foods, recipeId } = await recipeWith({
            steps: "Fry the rice.\nAdd 2 eggs and stir.",
        });
        await dismissFlaggedMention({ recipes, foods }, HH, recipeId, "EGGS");
        expect(
            (await recipes.getImport(HH, recipeId))?.dismissedMentions,
        ).toEqual(["egg"]);
    });

    test("a food that is not flagged, or a recipe nobody checks, is an error", async () => {
        const { recipes, foods, recipeId } = await recipeWith({
            steps: "Fry the rice.\nAdd 2 eggs and stir.",
        });
        await expect(
            dismissFlaggedMention({ recipes, foods }, HH, recipeId, "kale"),
        ).rejects.toThrow("no longer flagged");
        await dismissFlaggedMention({ recipes, foods }, HH, recipeId, "egg");
        await expect(
            dismissFlaggedMention({ recipes, foods }, HH, recipeId, "egg"),
        ).rejects.toThrow("no longer flagged");
        const handMade = await recipeWith({
            steps: "Add 2 eggs.",
            imported: false,
        });
        await expect(
            dismissFlaggedMention(
                { recipes: handMade.recipes, foods: handMade.foods },
                HH,
                handMade.recipeId,
                "egg",
            ),
        ).rejects.toThrow("This recipe has no step check.");
    });
});
