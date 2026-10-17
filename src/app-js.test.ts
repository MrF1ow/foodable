import { test, expect } from "bun:test";
import { APP_JS_SOURCES, getAppJs } from "./widgets.js";
import { comingSoonPage } from "./web/shell.js";
import { renderFridgePage } from "./web/pages/fridge.js";
import { renderGroceryPage } from "./web/pages/grocery.js";
import { renderNutritionPage } from "./web/pages/nutrition.js";
import { renderRecipesPage } from "./web/pages/recipes.js";
import type { HouseholdMember } from "./household.js";

function scriptBodies(html: string): string[] {
    return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
        .map((m) => (m[2] ?? "").trim())
        .filter((body) => body.length > 0);
}

test("getAppJs concatenates the client files as one IIFE each", async () => {
    expect([...APP_JS_SOURCES]).toEqual([
        "./src/web/client/shell.js",
        "./src/web/client/food-picker.js",
        "./src/web/client/nutrition-log.js",
        "./src/web/client/grocery.js",
        "./src/web/client/modal.js",
        "./src/web/client/arrange.js",
    ]);
    const js = await getAppJs();
    expect((js.match(/^\(function \(\) \{/gm) ?? []).length).toBe(6);
    for (const path of APP_JS_SOURCES) {
        const src = (await Bun.file(path).text()).trim();
        expect(js).toContain(`(function () {\n${src}\n})();`);
    }
    expect(js).toContain('classList.add("fx")');
    expect(js).toContain("[data-food-picker]");
    expect(js).toContain("[data-meal-items]");
    expect(js).toContain("[data-grocery-section]");
    expect(js).toContain("dialog.modal");
    expect(js).toContain(".nutrition-arrange-form");
    expect(() =>
        new Bun.Transpiler({ loader: "js" }).transformSync(js),
    ).not.toThrow();
});

test("no app page HTML contains a script with a body except widget frames", async () => {
    const fridge = renderFridgePage({
        locations: [
            {
                id: "loc-1",
                householdId: "hh-1",
                name: "Pantry",
                sortOrder: 0,
            },
            {
                id: "loc-2",
                householdId: "hh-1",
                name: "Fridge",
                sortOrder: 1,
            },
        ],
        items: [],
        chrome: { theme: "light" },
    });
    const grocery = renderGroceryPage({
        chrome: { theme: "light" },
        stores: [
            {
                id: "st-1",
                householdId: "hh-1",
                name: "Safeway",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-other",
                        householdId: "hh-1",
                        storeId: "st-1",
                        name: "Other",
                        sortOrder: 8,
                        hidden: false,
                        isOther: true,
                        lines: [],
                    },
                ],
            },
        ],
    });
    const recipes = renderRecipesPage({
        chrome: { theme: "light" },
        recipes: [],
        members: [],
        viewerId: "11111111-1111-4111-8111-111111111111",
    });
    const member: HouseholdMember = {
        householdId: "hh-1",
        userId: "11111111-1111-4111-8111-111111111111",
        role: "owner",
        displayName: "Alice",
    };
    const nutrition = await renderNutritionPage({
        access: {
            ok: true,
            mode: "self",
            viewer: member,
            subject: member,
        },
        members: [member],
        summary: { locale: "en" },
        goals: { locale: "en" },
        trends: { locale: "en" },
        weight: { locale: "en" },
        chrome: { theme: "light" },
        cardOrder: [
            "log",
            "nutrition-summary",
            "goal-progress",
            "trends",
            "weight-trends",
        ],
    });
    for (const html of [
        comingSoonPage("fridge"),
        fridge,
        grocery,
        recipes,
        nutrition,
    ]) {
        expect(html).toContain('<script src="/app.js" defer></script>');
        expect(scriptBodies(html)).toEqual([]);
    }
    expect(nutrition).toContain("widget-frame");
    expect(nutrition).toContain("&lt;script&gt;");
});

test("the Fridge page ships the picker logic once", async () => {
    const html = renderFridgePage({
        locations: [
            {
                id: "loc-1",
                householdId: "hh-1",
                name: "Pantry",
                sortOrder: 0,
            },
            {
                id: "loc-2",
                householdId: "hh-1",
                name: "Fridge",
                sortOrder: 1,
            },
        ],
        items: [],
        chrome: { theme: "light" },
    });
    expect((html.match(/data-food-picker/g) ?? []).length).toBe(2);
    expect(html).not.toContain("/api/foods/search");
    const picker = (
        await Bun.file("./src/web/client/food-picker.js").text()
    ).trim();
    const js = await getAppJs();
    expect(js.split(picker).length - 1).toBe(1);
});
