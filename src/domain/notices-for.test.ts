import { describe, expect, test } from "bun:test";
import { createMemoryFoodsStore, newFood } from "./foods.js";
import { createMemoryFridgeStore } from "./fridge.js";
import { createMemoryGroceryStore } from "./grocery.js";
import { createMemoryNoticeDismissalsStore } from "./notice-dismissals.js";
import { createMemoryWeighInStore } from "./notices-actionable.js";
import { noticesFor } from "./notices-for.js";
import { createMemoryPlansStore } from "./plan.js";
import { createMemoryRecipesStore, createRecipe } from "./recipes.js";

const HH = "hh-drafts";
const TODAY = "2026-11-12";

describe("noticesFor and drafts", () => {
    test("a draft raises no notice, for itself or for a plan of it; saved, it does", async () => {
        const foods = createMemoryFoodsStore();
        const recipes = createMemoryRecipesStore();
        const plans = createMemoryPlansStore();
        const deps = {
            foods,
            fridge: createMemoryFridgeStore(),
            recipes,
            dismissals: createMemoryNoticeDismissalsStore(),
            grocery: createMemoryGroceryStore(),
            plans,
            weighIns: createMemoryWeighInStore([]),
        };
        const eggs = await foods.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                defaultUnit: "each",
            }),
        );
        const draft = await createRecipe(recipes, {
            householdId: HH,
            creatorId: "u",
            name: "Imported omelette",
            yieldPortions: 2,
            verification: "unverified",
            draftExpiresAt: "2026-11-19T00:00:00.000Z",
        });
        // An ingredient with no nutrition (a recipe notice) and none in the
        // fridge (a plan notice), on a plan made before drafts existed.
        await recipes.insertIngredient({
            id: crypto.randomUUID(),
            householdId: HH,
            recipeId: draft.id,
            kind: "food",
            displayName: "Eggs",
            quantity: { amount: 4, unit: "each" },
            foodId: eggs.id,
            sortOrder: 0,
            note: null,
        });
        await plans.addPlan({
            householdId: HH,
            recipeId: draft.id,
            date: "2026-11-13",
            slot: "dinner",
            servings: 2,
        });
        const opts = { today: TODAY, actionable: true, timezone: "UTC" };
        const about = async () =>
            (await noticesFor(deps, HH, opts)).notices.filter(
                (n) =>
                    n.code.startsWith("recipe.") || n.code.startsWith("plan."),
            );
        expect(await about()).toEqual([]);
        await recipes.promoteDraft(HH, draft.id);
        const codes = (await about()).map((n) => n.code);
        expect(codes).toContain("plan.missing_ingredient");
        expect(codes.some((c) => c.startsWith("recipe."))).toBe(true);
    });
});
