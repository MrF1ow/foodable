import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readRecipeJsonLd } from "./recipe-jsonld.js";

const FIXTURE_DIR = join(import.meta.dir, "fixtures/recipe-pages");

function loadFixture(name: string): string {
    return readFileSync(join(FIXTURE_DIR, `${name}.html`), "utf8");
}

describe("readRecipeJsonLd fixtures", () => {
    test("yoast-graph.html", () => {
        const recipe = readRecipeJsonLd(loadFixture("yoast-graph"));
        expect(recipe?.name).toBe("Test Soup");
        expect(recipe?.yieldPortions).toBe(4);
        expect(recipe?.yieldText).toBe("4 servings");
        expect(recipe?.prepMinutes).toBe(15);
        expect(recipe?.cookMinutes).toBe(90);
        expect(recipe?.totalMinutes).toBe(30);
        expect(recipe?.ingredients[1]).toBe("1' onion");
        expect(recipe?.ingredients[2]).toContain("Salt & pepper");
        expect(recipe?.instructions.length).toBe(2);
        expect(recipe).not.toHaveProperty("description");
        expect(recipe).not.toHaveProperty("image");
    });

    test("array-top-level.html", () => {
        const recipe = readRecipeJsonLd(loadFixture("array-top-level"));
        expect(recipe?.name).toBe("Array Recipe");
        expect(recipe?.yieldPortions).toBe(4);
        expect(recipe?.instructions).toEqual(["Rinse rice.", "Cook rice."]);
    });

    test("howto-sections.html", () => {
        const recipe = readRecipeJsonLd(loadFixture("howto-sections"));
        expect(recipe?.yieldPortions).toBe(6);
        expect(recipe?.sections?.map((s) => s.name)).toEqual([
            "Sauce",
            "Pasta",
        ]);
        expect(recipe?.instructions.length).toBe(3);
    });

    test("two-recipes.html picks recipe with ingredients", () => {
        const recipe = readRecipeJsonLd(loadFixture("two-recipes"));
        expect(recipe?.name).toBe("Second With Ingredients");
        expect(recipe?.ingredients).toEqual(["2 eggs"]);
    });

    test("broken-and-good.html skips invalid block", () => {
        const recipe = readRecipeJsonLd(loadFixture("broken-and-good"));
        expect(recipe?.name).toBe("After Broken Block");
    });

    test("no-recipe.html returns null", () => {
        expect(readRecipeJsonLd(loadFixture("no-recipe"))).toBeNull();
    });

    test("typed-array-newsarticle.html accepts schema: prefix", () => {
        const recipe = readRecipeJsonLd(loadFixture("typed-array-newsarticle"));
        expect(recipe?.name).toBe("Prefixed Types");
        expect(recipe?.ingredients).toEqual(["3 tbsp oil"]);
    });
});

describe("readRecipeJsonLd durations and yield", () => {
    test("parses ISO duration variants", () => {
        const html = `<script type="application/ld+json">${JSON.stringify({
            "@type": "Recipe",
            name: "Durations",
            recipeIngredient: ["1 cup water"],
            recipeInstructions: ["Mix"],
            prepTime: "PT90M",
            cookTime: "P0DT0H20M",
            totalTime: "PT1H",
        })}</script>`;
        const recipe = readRecipeJsonLd(html);
        expect(recipe?.prepMinutes).toBe(90);
        expect(recipe?.cookMinutes).toBe(20);
        expect(recipe?.totalMinutes).toBe(60);
    });

    test("invalid duration becomes null", () => {
        const html = `<script type="application/ld+json">${JSON.stringify({
            "@type": "Recipe",
            name: "Bad time",
            recipeIngredient: ["1 cup water"],
            recipeInstructions: ["Mix"],
            totalTime: "not-a-duration",
        })}</script>`;
        expect(readRecipeJsonLd(html)?.totalMinutes).toBeNull();
    });
});
