import { describe, expect, test } from "bun:test";
import type { SharedGroceryList, SharedRecipe } from "../../domain/sharing.js";
import { renderShareViewPage } from "./share-view.js";

const recipe: SharedRecipe = {
    kind: "recipe",
    recipe: {
        name: "Lentil <soup> & bread",
        portions: 4,
        instructions: "1. Rinse the lentils.\n2. Simmer for 25 minutes.",
        tags: ["dinner", "vegan"],
        ingredients: [
            { name: "Red lentils", amount: 300, unit: "g", note: null },
            { name: "Onion", amount: 2, unit: "each", note: "diced" },
            { name: "Salt", amount: null, unit: null, note: null },
        ],
    },
};

const list: SharedGroceryList = {
    kind: "grocery_list",
    list: {
        stores: [
            {
                name: "Corner Shop",
                lines: [
                    { name: "Milk", amount: 2, unit: "l", checked: false },
                    { name: "Eggs", amount: 12, unit: "each", checked: true },
                ],
            },
            {
                name: "Market",
                lines: [
                    { name: "Leeks", amount: 3, unit: "each", checked: false },
                ],
            },
        ],
    },
};

describe("renderShareViewPage: recipe", () => {
    const html = renderShareViewPage(recipe);

    test("shows the name, portions, ingredients, steps and tags, escaped", () => {
        expect(html).toContain("Lentil &lt;soup&gt; &amp; bread");
        expect(html).not.toContain("<soup>");
        expect(html).toContain("4 servings");
        expect(html).toContain("Red lentils");
        expect(html).toContain("300 g");
        expect(html).toContain("Onion");
        expect(html).toContain("diced");
        expect(html).toContain("Rinse the lentils.");
        expect(html).toContain("Simmer for 25 minutes.");
        expect(html).toContain("dinner");
        expect(html).toContain("vegan");
    });

    test("an ingredient with no amount still shows by name", () => {
        expect(html).toContain("Salt");
    });

    test("the title is the recipe name", () => {
        expect(html).toContain("<title>Lentil &lt;soup&gt; &amp; bread");
    });
});

describe("renderShareViewPage: grocery list", () => {
    const html = renderShareViewPage(list);

    test("groups lines under their store, in the order given", () => {
        const corner = html.indexOf("Corner Shop");
        const market = html.indexOf("Market");
        expect(corner).toBeGreaterThan(-1);
        expect(market).toBeGreaterThan(corner);
        expect(html.indexOf("Milk")).toBeGreaterThan(corner);
        expect(html.indexOf("Milk")).toBeLessThan(market);
        expect(html.indexOf("Leeks")).toBeGreaterThan(market);
    });

    test("marks a checked line", () => {
        expect(html).toMatch(/Eggs/);
        expect(html).toContain("fd-share-line--checked");
    });

    test("an empty list says so", () => {
        const empty = renderShareViewPage({
            kind: "grocery_list",
            list: { stores: [] },
        });
        expect(empty).toContain("Nothing on the list");
    });
});

describe("renderShareViewPage: a bare public document", () => {
    for (const [label, view] of [
        ["recipe", recipe],
        ["list", list],
    ] as const) {
        test(`${label}: no app chrome, no session scripts, no account links`, () => {
            const html = renderShareViewPage(view);
            expect(html).not.toContain("/app.js");
            expect(html).not.toContain("/app-v2.js");
            expect(html).not.toContain("<script");
            expect(html).not.toContain("/logout");
            expect(html).not.toContain("/settings");
            expect(html).not.toContain("toast-region");
            expect(html).not.toContain("fd-tabs");
            expect(html).not.toContain("fd-sidebar");
            expect(html).not.toContain("manifest");
            expect(html).toContain('href="/app-v2.css');
            expect(html).toContain('name="robots" content="noindex');
        });
    }

    test("a chosen theme is stamped on the document", () => {
        expect(renderShareViewPage(recipe, "dark")).toContain(
            'data-theme="dark"',
        );
        expect(renderShareViewPage(recipe)).not.toContain("data-theme");
    });
});
