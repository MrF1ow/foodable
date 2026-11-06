import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, describe } from "bun:test";
import {
    isNumberedStepLine,
    parseRecipeText,
    stripStepPrefix,
} from "./recipe-text.js";

const FIXTURE_DIR = join(import.meta.dir, "fixtures/captions");

function loadFixture(name: string): string {
    return readFileSync(join(FIXTURE_DIR, `${name}.txt`), "utf8");
}

type FixtureExpect = {
    name: string | null;
    hasRecipe: boolean;
    ingredientNames: string[];
    steps: string[];
    unresolved: string[];
    sections?: string[];
};

const FIXTURES: Record<string, FixtureExpect> = {
    "clean-headers": {
        name: "Garlic Butter Pasta",
        hasRecipe: true,
        ingredientNames: ["butter", "garlic", "spaghetti"],
        steps: [
            "Boil the pasta in salted water.",
            "Melt butter and cook garlic until fragrant.",
            "Toss pasta with the garlic butter.",
        ],
        unresolved: [],
    },
    "emoji-numbered": {
        name: "Lemon Bars",
        hasRecipe: true,
        ingredientNames: ["flour", "sugar", "eggs"],
        steps: ["Mix dry ingredients.", "Add eggs and bake at 350°F."],
        unresolved: [],
    },
    "run-together": {
        name: "Weeknight Stir Fry",
        hasRecipe: true,
        ingredientNames: ["oil", "bell pepper"],
        steps: ["Heat oil in a wok.", "Stir fry chicken and vegetables."],
        unresolved: ["Chicken Coating: 1.5 lb chicken breast 50 g cornstarch"],
    },
    prose: {
        name: "Simple Oatmeal",
        hasRecipe: true,
        ingredientNames: ["rolled oats", "water", "salt"],
        steps: [
            "Bring water and salt to a boil.",
            "Stir in oats and cook 5 minutes.",
        ],
        unresolved: [],
    },
    "no-recipe": {
        name: "Recipe in my bio",
        hasRecipe: false,
        ingredientNames: [],
        steps: [],
        unresolved: [],
    },
    "to-taste": {
        name: "Sesame Noodles",
        hasRecipe: true,
        ingredientNames: [
            "noodles",
            "soy sauce",
            "salt and pepper",
            "sesame seeds",
        ],
        steps: ["Cook noodles.", "Toss with sauce and seeds."],
        unresolved: [],
    },
    sections: {
        name: "Hand Pies",
        hasRecipe: true,
        ingredientNames: ["flour", "butter", "apples", "sugar"],
        steps: ["Make dough and chill.", "Fill and bake."],
        unresolved: [],
        sections: ["For the dough", "For the filling"],
    },
};

describe("parseRecipeText fixtures", () => {
    for (const [file, expectRow] of Object.entries(FIXTURES)) {
        test(file, () => {
            const result = parseRecipeText(loadFixture(file));
            expect(result.name).toBe(expectRow.name);
            expect(result.hasRecipe).toBe(expectRow.hasRecipe);
            expect(result.ingredients.map((row) => row.name)).toEqual(
                expectRow.ingredientNames,
            );
            expect(result.steps).toEqual(expectRow.steps);
            expect(result.unresolved).toEqual(expectRow.unresolved);
            if (expectRow.sections) {
                expect([
                    ...new Set(result.ingredients.map((row) => row.section)),
                ]).toEqual(expectRow.sections);
            }
            for (const item of result.ingredients) {
                if (item.quantity != null) {
                    expect(item.quantity.amount).toBeGreaterThan(0);
                }
            }
        });
    }
});

test("stripStepPrefix handles keycap numbers and hashtags on lines", () => {
    expect(stripStepPrefix("1️⃣ Mix dry ingredients. #baking")).toBe(
        "Mix dry ingredients. #baking",
    );
    expect(isNumberedStepLine("2. Stir well")).toBe(true);
    expect(parseRecipeText("Title\n1 cup flour\n1. Mix").steps).toEqual([
        "Mix",
    ]);
});

test("hashtags-only lines are dropped", () => {
    const result = parseRecipeText("#food #recipe @chef\n1 cup flour\n1. Mix");
    expect(result.ingredients.map((row) => row.name)).toEqual(["flour"]);
});

test("Serves 4 alone is not a recipe", () => {
    const result = parseRecipeText("Serves 4");
    expect(result.hasRecipe).toBe(false);
    expect(result.yieldPortions).toBe(4);
});

test("caption yield line and structured headers", () => {
    const text = [
        "Sunday cake",
        "Serves 8",
        "Ingredients:",
        "2 eggs",
        "Method:",
        "Mix",
    ].join("\n");
    const result = parseRecipeText(text);
    expect(result.hasRecipe).toBe(true);
    expect(result.name).toBe("Sunday cake");
    expect(result.yieldPortions).toBe(8);
    expect(result.ingredients.map((row) => row.name)).toEqual(["eggs"]);
    expect(result.steps).toEqual(["Mix"]);
});

test("duration and boast lines are never ingredients", () => {
    for (const line of ["Ready in 20 minutes", "I've made this 100 times"]) {
        const result = parseRecipeText(`${line}\n1 cup flour\n1. Mix`);
        expect(result.ingredients.map((row) => row.name)).toEqual(["flour"]);
        expect(
            result.ingredients.some((row) =>
                row.name.toLowerCase().includes("ready"),
            ),
        ).toBe(false);
    }
});

test("headers with trailing emoji are recognized", () => {
    const text = [
        "Cake",
        "Ingredients 👇",
        "1 cup flour",
        "Method 👇",
        "1. Bake",
    ].join("\n");
    const result = parseRecipeText(text);
    expect(result.name).toBe("Cake");
    expect(result.ingredients.map((row) => row.name)).toEqual(["flour"]);
    expect(result.steps).toEqual(["Bake"]);
});

test("notes section after steps is not saved as instructions", () => {
    const text = [
        "Soup",
        "Ingredients:",
        "1 cup broth",
        "Method:",
        "Simmer",
        "Notes:",
        "Keeps 3 days",
    ].join("\n");
    const result = parseRecipeText(text);
    expect(result.steps).toEqual(["Simmer"]);
});

test("strips emoji from ingredient names", () => {
    const result = parseRecipeText("Dish\n2 eggs 🥚\n1. Cook");
    expect(result.ingredients.map((row) => row.name)).toEqual(["eggs"]);
});

test("does not invent quantities", () => {
    const result = parseRecipeText(
        "Soup\nIngredients:\nsalt to taste\n1. Simmer",
    );
    expect(
        result.ingredients.every(
            (row) => row.quantity == null || row.quantity.amount > 0,
        ),
    ).toBe(true);
    const salt = result.ingredients.find((row) =>
        row.name.toLowerCase().includes("salt"),
    );
    expect(salt?.quantity ?? null).toBe(null);
});

describe("parseRecipeText review round 2", () => {
    const parse = (text: string) =>
        parseRecipeText(text, { fallbackName: "Instagram recipe" });
    const names = (text: string) => parse(text).ingredients.map((i) => i.name);

    test("a boast line inside a list neither counts nor breaks the run", () => {
        expect(
            names(
                "Cookies\n2 cups flour\n1 cup sugar\nI've made this 100 times\n2 eggs\n1 tsp vanilla\n1. Mix",
            ),
        ).toEqual(["flour", "sugar", "eggs", "vanilla"]);
    });

    test("real lines that mention ready, minutes or hours are kept", () => {
        expect(
            names(
                "Tart\nIngredients:\nReady-made pastry, 1 sheet\n2 tbsp jam\nMethod:\nBake",
            ),
        ).toEqual(["Ready-made pastry", "jam"]);
    });

    test("short titles starting with This or I are kept", () => {
        expect(
            parse("This garlic pasta\nIngredients:\n200g pasta\nMethod:\nCook")
                .name,
        ).toBe("This garlic pasta");
        expect(
            parse("I love this cake\nIngredients:\n2 eggs\nMethod:\nMix").name,
        ).toBe("I love this cake");
    });

    test("yield accepts yields and filler words", () => {
        expect(parse("Yields 4\n1 cup flour\n1. Mix").yieldPortions).toBe(4);
        expect(parse("Makes about 12\n1 cup flour\n1. Mix").yieldPortions).toBe(
            12,
        );
        expect(parse("Serves up to 6\n1 cup flour\n1. Mix").yieldPortions).toBe(
            6,
        );
        expect(names("Yields 4\n1 cup flour\n1. Mix")).toEqual(["flour"]);
    });

    test("singular Note/Tip end the steps, and a later numbered step resumes", () => {
        expect(
            parse(
                "Soup\nIngredients:\n1 cup stock\nMethod:\n1. Mix\nTips:\nUse fresh\n2. Bake\nNote: keeps 3 days",
            ).steps,
        ).toEqual(["Mix", "Bake"]);
    });

    test("a header sharing its line with the first ingredient is split", () => {
        const noodles = parse(
            "Noodles\n200g noodles\nMake the sauce: 2 tbsp soy sauce\n1. Cook",
        );
        expect(noodles.ingredients.map((i) => [i.name, i.section])).toEqual([
            ["noodles", null],
            ["soy sauce", "Make the sauce"],
        ]);
        expect(noodles.steps).toEqual(["Cook"]);
        const need = parse("You'll need 2 eggs\n1. Mix");
        expect(need.ingredients.map((i) => i.name)).toEqual(["eggs"]);
        expect(need.steps).toEqual(["Mix"]);
    });

    test("a numbered ingredient list stays ingredients", () => {
        const bread = parse(
            "Bread\nIngredients:\n1. 2 cups flour\n2. 1 tsp salt\nMethod:\n1. Mix",
        );
        expect(bread.ingredients.map((i) => i.name)).toEqual(["flour", "salt"]);
        expect(bread.steps).toEqual(["Mix"]);
    });
});
