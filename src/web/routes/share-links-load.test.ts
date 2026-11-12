import { describe, expect, test } from "bun:test";
import { createMemoryGroceryStore } from "../../domain/grocery.js";
import {
    createMemoryRecipesStore,
    createRecipe,
} from "../../domain/recipes.js";
import { createMemorySettingsStore } from "../../domain/settings.js";
import type { ShareLink } from "../../domain/sharing.js";
import { loadShareView, orderGroceryLines } from "./share-links-load.js";

const HH = "11111111-1111-4111-8111-111111111111";
const OTHER_HH = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

function link(over: Partial<ShareLink>): ShareLink {
    return {
        id: crypto.randomUUID(),
        householdId: HH,
        kind: "recipe",
        targetId: null,
        createdBy: USER,
        createdAt: "2026-11-12T12:00:00.000Z",
        expiresAt: null,
        revokedAt: null,
        ...over,
    };
}

describe("orderGroceryLines", () => {
    const stores = [
        { id: "s1", householdId: HH, name: "A", sortOrder: 0 },
        { id: "s2", householdId: HH, name: "B", sortOrder: 1 },
    ];
    // The sections arrive in the store's own order, as listSections returns them.
    const sections = [
        { id: "a-produce", storeId: "s1" },
        { id: "a-dairy", storeId: "s1" },
    ];
    const line = (id: string, storeId: string, sectionId: string) => ({
        id,
        storeId,
        sectionId,
        displayName: id,
        quantity: { amount: 1, unit: "each" },
        checked: false,
    });

    test("puts lines in aisle order within a store, whatever order they arrive in", () => {
        const ordered = orderGroceryLines({
            stores,
            sections,
            lines: [
                line("milk", "s1", "a-dairy"),
                line("leek", "s1", "a-produce"),
                line("rice", "s2", "b-any"),
                line("pear", "s1", "a-produce"),
            ],
        });
        expect(ordered.map((l) => l.displayName)).toEqual([
            "leek",
            "pear",
            "milk",
            "rice",
        ]);
    });

    test("a line in a section the store no longer has still shows, after the known sections", () => {
        const ordered = orderGroceryLines({
            stores,
            sections,
            lines: [
                line("mystery", "s1", "gone"),
                line("milk", "s1", "a-dairy"),
            ],
        });
        expect(ordered.map((l) => l.displayName)).toEqual(["milk", "mystery"]);
    });
});

describe("loadShareView", () => {
    test("a recipe link shows that recipe, loaded inside the link's household", async () => {
        const recipes = createMemoryRecipesStore();
        const grocery = createMemoryGroceryStore();
        const settings = createMemorySettingsStore();
        const mine = await createRecipe(recipes, {
            householdId: HH,
            creatorId: USER,
            name: "Lentil soup",
            yieldPortions: 4,
            tags: ["dinner"],
            notes: "private note about grandma",
        });
        await recipes.insertIngredient({
            id: crypto.randomUUID(),
            householdId: HH,
            recipeId: mine.id,
            kind: "food",
            displayName: "Red lentils",
            quantity: { amount: 300, unit: "g" },
            foodId: crypto.randomUUID(),
            sortOrder: 0,
            note: null,
        });

        const view = await loadShareView(
            link({ kind: "recipe", targetId: mine.id }),
            { recipes, grocery, settings },
        );
        expect(view).toEqual({
            kind: "recipe",
            recipe: {
                name: "Lentil soup",
                portions: 4,
                instructions: null,
                tags: ["dinner"],
                ingredients: [
                    {
                        name: "Red lentils",
                        amount: 300,
                        unit: "g",
                        note: null,
                    },
                ],
            },
        });
        expect(JSON.stringify(view)).not.toContain("grandma");
    });

    test("a link cannot reach a recipe of another household, even by its id", async () => {
        const recipes = createMemoryRecipesStore();
        const theirs = await createRecipe(recipes, {
            householdId: OTHER_HH,
            creatorId: USER,
            name: "Secret stew",
            yieldPortions: 2,
        });
        const view = await loadShareView(
            link({ kind: "recipe", targetId: theirs.id }),
            {
                recipes,
                grocery: createMemoryGroceryStore(),
                settings: createMemorySettingsStore(),
            },
        );
        expect(view).toBeNull();
    });

    test("a deleted recipe has no view", async () => {
        const view = await loadShareView(
            link({ kind: "recipe", targetId: crypto.randomUUID() }),
            {
                recipes: createMemoryRecipesStore(),
                grocery: createMemoryGroceryStore(),
                settings: createMemorySettingsStore(),
            },
        );
        expect(view).toBeNull();
    });
});
