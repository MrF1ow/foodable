import { describe, expect, test } from "bun:test";
import type { SafeFetcher } from "../fetch-safe.js";
import { createMemoryFoodsStore, findOrCreateManualFood } from "./foods.js";
import { importRecipeFromUrl, recheckRecipe } from "./recipe-import.js";
import {
    addMentionedIngredient,
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
