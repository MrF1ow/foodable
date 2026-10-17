import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bottomNav as shellBottomNav } from "../shell.js";
import { bottomNav as componentBottomNav } from "./bottom-nav.js";
import { renderQuantityField } from "./quantity-field.js";
import {
    renderFoodPicker,
    searchPickerFoods,
    runBarcodeLookupAction,
} from "./food-picker.js";
import { renderFridgePage } from "../pages/fridge.js";
import { renderGroceryPage } from "../pages/grocery.js";
import { renderRecipeDetailPage, renderRecipesPage } from "../pages/recipes.js";
import { renderMemberMultiSelect } from "./member-multi-select.js";
import { renderStoreSectionList } from "./store-section-list.js";
import type { FoodResult } from "../../foods.js";

const FIXTURE_MEMBERS = [
    {
        userId: "11111111-1111-4111-8111-111111111111",
        displayName: "Alice",
    },
    {
        userId: "22222222-2222-4222-8222-222222222222",
        displayName: "Bob",
    },
] as const;

const appDir = join(import.meta.dir, "..");
const PICKER_JS = readFileSync(join(appDir, "client/food-picker.js"), "utf8");

function stubSource(file: string): string {
    return readFileSync(join(appDir, file), "utf8");
}

function food(
    over: Partial<FoodResult> & Pick<FoodResult, "name" | "barcode">,
): FoodResult {
    return {
        brand: null,
        serving: "100 g",
        calories: 80,
        protein_g: 11,
        carbs_g: 3,
        fat_g: 2,
        fiber_g: 0,
        sugar_g: 3,
        alcohol_g: null,
        nutriscore_grade: null,
        nova_group: null,
        source: `off:${over.barcode}`,
        source_name: "openfoodfacts",
        ...over,
    };
}

test("fridge page and grocery page import the same quantity-field and food-picker modules", () => {
    const fridgeSrc = stubSource("pages/fridge.ts");
    const grocerySrc = stubSource("pages/grocery.ts");
    const recipesSrc = stubSource("pages/recipes.ts");
    expect(fridgeSrc).toContain('from "../components/quantity-field.js"');
    expect(grocerySrc).not.toContain('from "../components/quantity-field.js"');
    expect(fridgeSrc).toContain('from "../components/food-picker.js"');
    expect(grocerySrc).toContain('from "../components/food-picker.js"');
    expect(recipesSrc).toContain('from "../components/food-picker.js"');
    expect(recipesSrc).toContain('from "../components/member-multi-select.js"');

    const fridge = renderFridgePage({
        locations: [
            {
                id: "loc-1",
                householdId: "hh-1",
                name: "Pantry",
                sortOrder: 0,
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
    expect(fridge).toContain('class="quantity-field"');
    expect(grocery).toContain('class="quantity-field"');
    expect(fridge).toContain('class="food-picker"');
    expect(grocery).toContain('class="food-picker"');
    expect(grocery).toContain("<h3>Add food</h3>");
    expect(grocery).not.toContain("<h3>Add supply</h3>");
    expect(grocery).not.toContain("grocery-add-supply");
    expect(grocery).not.toContain('name="kind" value="supply"');
    expect(fridge).toContain("<h3>Add supply</h3>");
    expect(fridge).toContain("fridge-add-supply");
    const recipes = renderRecipeDetailPage({
        chrome: { theme: "light" },
        recipe: {
            id: "r1",
            householdId: "hh-1",
            creatorId: "11111111-1111-4111-8111-111111111111",
            name: "Mac",
            yieldPortions: 4,
            instructions: null,
            sourceUrl: null,
            tags: [],
            notes: null,
            prepMinutes: null,
            cookMinutes: null,
        },
        ingredients: [],
        members: FIXTURE_MEMBERS.map((member) => ({
            userId: member.userId,
            displayName: member.displayName,
        })),
        stores: [{ id: "st-1", name: "Safeway" }],
        viewerId: FIXTURE_MEMBERS[0]!.userId,
        filterUserId: FIXTURE_MEMBERS[0]!.userId,
        portionCount: 1,
        macros: {
            calories: null,
            protein_g: null,
            carbs_g: null,
            fat_g: null,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            incomplete: true,
            incompleteReasons: [],
        },
        isOwner: true,
    });
    expect(recipes).toContain('class="quantity-field"');
    expect(recipes).toContain('class="food-picker"');
    expect(recipes).toContain('class="member-multi-select"');
});

test("household pages call shared markup helpers for banners, empty states, and item rows", () => {
    const uiSrc = stubSource("components/ui.ts");
    const helperSrc = stubSource("components/page-markup.ts");
    const fridgeSrc = stubSource("pages/fridge.ts");
    const grocerySrc = stubSource("pages/grocery.ts");
    const recipesSrc = stubSource("pages/recipes.ts");
    const nutritionSrc = stubSource("pages/nutrition.ts");
    const settingsSrc = stubSource("pages/settings.ts");

    expect(uiSrc).toContain('class="error-banner"');
    expect(uiSrc).toContain('class="${className}"');
    expect(helperSrc).toContain('class="grocery-line');
    expect(helperSrc).toContain('class="fridge-item"');
    expect((uiSrc.match(/class="error-banner"/g) ?? []).length).toBe(1);
    expect(helperSrc).not.toContain('class="error-banner"');
    expect(settingsSrc).toContain("errorBanner");
    expect(settingsSrc).not.toContain('class="error-banner"');

    for (const src of [fridgeSrc, grocerySrc, recipesSrc, nutritionSrc]) {
        expect(src).toContain("ui.js");
        expect(src).not.toContain('class="error-banner"');
        expect(src).not.toContain('class="empty-grocery"');
        expect(src).not.toContain('class="empty-fridge"');
        expect(src).not.toContain('class="empty-recipes"');
        expect(src).not.toContain('class="empty-recipe-store"');
        expect(src).not.toContain('class="add-item-prompt"');
        expect(src).not.toContain('class="fridge-item"');
        expect(src).not.toContain('class="recipe-card"');
        expect(src).not.toContain('class="recipe-ingredient"');
        expect(src).not.toMatch(/class="grocery-line[^s]/);
    }
    expect(fridgeSrc).toContain("page-markup.js");
    expect(grocerySrc).toContain("page-markup.js");
    expect(recipesSrc).toContain("page-markup.js");
    expect(nutritionSrc).not.toContain("page-markup.js");

    const fridge = renderFridgePage({
        locations: [
            {
                id: "loc-1",
                householdId: "hh-1",
                name: "Pantry",
                sortOrder: 0,
            },
        ],
        items: [
            {
                id: "item-1",
                householdId: "hh-1",
                locationId: "loc-1",
                kind: "food",
                displayName: "Cottage Cheese",
                quantity: { amount: 1360.8, unit: "g" },
                identity: {
                    kind: "food",
                    via: "barcode",
                    barcode: "070852010016",
                    displayName: "Cottage Cheese",
                },
                foodId: null,
            },
        ],
        chrome: { theme: "light" },
        error: "Enter a location name.",
    });
    expect(fridge).toContain('class="error-banner"');
    expect(fridge).toContain("Enter a location name.");
    expect(fridge).toContain('class="fridge-item"');
    expect(fridge).toContain("Cottage Cheese");
    expect(fridge).not.toContain('class="empty-fridge"');

    const emptyFridge = renderFridgePage({
        locations: [],
        items: [],
        chrome: { theme: "light" },
    });
    expect(emptyFridge).toContain(
        '<p class="empty-fridge">Add a location, then add an item.</p>',
    );

    const grocery = renderGroceryPage({
        chrome: { theme: "light" },
        stores: [],
        isOwner: true,
        error: "Enter a store name.",
    });
    expect(grocery).toContain('class="error-banner"');
    expect(grocery).toContain("Enter a store name.");
    expect(grocery).toContain(
        '<p class="empty-grocery">Add a grocery store in Settings, then add a line.</p>',
    );
    expect(grocery).toContain('class="grocery-add-store"');
    expect(grocery).not.toContain("<h3>Add supply</h3>");

    const groceryWithLine = renderGroceryPage({
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
                        lines: [
                            {
                                id: "line-1",
                                householdId: "hh-1",
                                storeId: "st-1",
                                sectionId: "sec-other",
                                kind: "food",
                                displayName: "Cottage Cheese",
                                quantity: { amount: 100, unit: "g" },
                                identity: {
                                    kind: "food",
                                    via: "barcode",
                                    barcode: "070852010016",
                                    displayName: "Cottage Cheese",
                                },
                                foodId: null,
                                checked: false,
                                alreadyHave: null,
                            },
                        ],
                    },
                ],
            },
        ],
    });
    expect(groceryWithLine).toContain('class="grocery-line"');
    expect(groceryWithLine).toContain("Cottage Cheese");

    const recipes = renderRecipesPage({
        chrome: { theme: "light" },
        recipes: [],
        members: [],
        viewerId: "11111111-1111-4111-8111-111111111111",
        error: "Enter a recipe name.",
    });
    expect(recipes).toContain('class="error-banner"');
    expect(recipes).toContain("Enter a recipe name.");
    expect(recipes).toContain('<p class="empty-recipes">Add a recipe.</p>');
});

test("quantity field food kind lists food units and preselects an explicit unit", () => {
    const foodHtml = renderQuantityField({ kind: "food" });
    expect(foodHtml).toContain('class="quantity-field"');
    expect(foodHtml).toContain('data-kind="food"');
    expect(foodHtml).toMatch(/<option value="g"[^>]*selected/);
    for (const unit of [
        "g",
        "oz",
        "lb",
        "ml",
        "fl oz",
        "cup",
        "tbsp",
        "tsp",
        "each",
    ]) {
        expect(foodHtml).toContain(`value="${unit}"`);
    }

    const eachHtml = renderQuantityField({ kind: "food", unit: "each" });
    expect(eachHtml).toMatch(/<option value="each"[^>]*selected/);

    const supplyHtml = renderQuantityField({ kind: "supply" });
    expect(supplyHtml).toContain('data-kind="supply"');
    for (const unit of ["g", "oz", "lb", "ml", "fl oz", "cup", "each"]) {
        expect(supplyHtml).toContain(`value="${unit}"`);
    }
});

test("shell re-exports the bottom-nav helper", () => {
    expect(componentBottomNav).toBe(shellBottomNav);
});

function searchFormHtml(html: string): string {
    const match = html.match(
        /<form class="food-picker-search"[\s\S]*?<\/form>/,
    );
    if (!match) throw new Error("search form missing");
    return match[0];
}

function hitHtml(
    method: "get" | "post",
    food: {
        food_id: string | null;
        name: string;
        brand: string | null;
        barcode: string | null;
        default_unit?: string | null;
    },
): string {
    const esc = (s: string) =>
        String(s)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    const label = food.brand ? food.brand + " · " + food.name : food.name;
    if (method !== "post") return "<li>" + esc(label) + "</li>";
    if (food.food_id) {
        return (
            '<li><button type="submit" name="food_id" value="' +
            esc(food.food_id) +
            '" data-default-unit="' +
            esc(food.default_unit || "") +
            '">' +
            esc(label) +
            "</button></li>"
        );
    }
    return (
        '<li><button type="submit" name="barcode" value="' +
        esc(food.barcode || "") +
        '" data-default-unit="' +
        esc(food.default_unit || "") +
        '">' +
        esc(label) +
        "</button></li>"
    );
}

test("food picker HTML has barcode, search, and manual tabs", () => {
    const html = renderFoodPicker();
    expect(html).toContain('class="food-picker"');
    expect(html).toContain('data-tab="barcode"');
    expect(html).toContain('data-tab="search"');
    expect(html).toContain('data-tab="manual"');
    expect(html).toContain('class="quantity-field"');
    expect(html).toContain('data-lookup-path="lookupBarcode"');
    expect(html).toContain("data-food-picker");
    expect(html).toContain('data-hit="text"');
    expect(html).not.toContain("data-demo-foods");
    expect(html).not.toContain("<script>");
});

test("post picker search hits submit food_id or barcode with hidden fields and qty", () => {
    const html = renderFoodPicker({
        action: "/fridge/items",
        method: "post",
        hiddenFields: { kind: "food", location_id: "loc-1" },
        includeQuantity: true,
    });
    const form = searchFormHtml(html);
    expect(form).toContain('method="post"');
    expect(form).toContain('action="/fridge/items"');
    expect(form).toContain('name="kind" value="food"');
    expect(form).toContain('name="location_id" value="loc-1"');
    expect(form).toContain('name="qty_amount"');
    expect(form).toContain('name="qty_unit"');
    expect(form).toContain("data-search-results");
    expect(form).not.toContain("data-search-input");
    expect(html).toContain('data-hit="submit"');
    expect(html).not.toContain("<script>");

    expect(PICKER_JS).toContain("/api/foods/search");
    expect(PICKER_JS).toContain('type="submit"');
    expect(PICKER_JS).toContain('name="food_id"');
    expect(PICKER_JS).toContain("data-default-unit");
    expect(PICKER_JS).toContain('name="barcode"');
    expect(PICKER_JS).not.toContain('name="food_name"');
    expect(PICKER_JS).toContain('searchResults.innerHTML = ""');
    expect(PICKER_JS).toContain("[data-food-picker]");

    const household = hitHtml("post", {
        food_id: "food-1",
        name: "Eggs",
        brand: null,
        barcode: null,
    });
    expect(household).toContain('name="food_id"');
    expect(household).toContain('value="food-1"');
    expect(household).toContain("Eggs");
    expect(household).not.toContain('name="barcode"');

    const off = hitHtml("post", {
        food_id: null,
        name: "Nutella",
        brand: "Ferrero",
        barcode: "3017620422003",
    });
    expect(off).toContain('name="barcode"');
    expect(off).toContain('value="3017620422003"');
    expect(off).toContain("Ferrero · Nutella");
    expect(off).not.toContain('name="food_id"');
});

test("get picker search hits stay non-submitting text", () => {
    const html = renderFoodPicker();
    expect(html).not.toContain('class="food-picker-search"');
    expect(html).not.toContain("data-search-form");
    expect(html).toContain('data-hit="text"');
    expect(html).not.toContain('data-hit="submit"');
    expect(html).not.toContain("<script>");
    expect(PICKER_JS).toContain("/api/foods/search");
    expect(PICKER_JS).toContain('return "<li>" + esc(label) + "</li>"');
    expect(PICKER_JS).not.toContain('name="food_name"');

    expect(
        hitHtml("get", {
            food_id: "food-1",
            name: "Nutella",
            brand: "Ferrero",
            barcode: "3017620422003",
        }),
    ).toBe("<li>Ferrero · Nutella</li>");
});

test("post picker without quantity still posts food_id and hidden fields", () => {
    const html = renderFoodPicker({
        action: "/fridge/items",
        method: "post",
        hiddenFields: { kind: "food", location_id: "loc-1" },
    });
    const form = searchFormHtml(html);
    expect(form).toContain('name="kind" value="food"');
    expect(form).toContain('name="location_id" value="loc-1"');
    expect(form).not.toContain("qty_amount");
    expect(form).not.toContain("qty_unit");
    expect(html).toContain('data-hit="submit"');
    expect(PICKER_JS).toContain('name="food_id"');
});

test("member multi-select, already-have, and store sections still render", () => {
    const members = renderMemberMultiSelect(FIXTURE_MEMBERS, [
        FIXTURE_MEMBERS[0]!.userId,
    ]);
    expect(members).toContain('class="member-multi-select"');
    expect(members).toContain('type="checkbox"');
    expect(members).toContain("Alice");
    expect(members).toContain("Bob");
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
                        id: "sec-produce",
                        householdId: "hh-1",
                        storeId: "st-1",
                        name: "Produce",
                        sortOrder: 0,
                        hidden: false,
                        isOther: false,
                        lines: [
                            {
                                id: "line-1",
                                householdId: "hh-1",
                                storeId: "st-1",
                                sectionId: "sec-produce",
                                kind: "food",
                                displayName: "Cottage Cheese",
                                quantity: { amount: 1360.8, unit: "g" },
                                identity: {
                                    kind: "food",
                                    via: "barcode",
                                    barcode: "070852010016",
                                    displayName: "Cottage Cheese",
                                },
                                foodId: null,
                                checked: false,
                                alreadyHave: {
                                    cover: "partial",
                                    have: { amount: 24, unit: "oz" },
                                    need: { amount: 24, unit: "oz" },
                                },
                            },
                        ],
                    },
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
    expect(grocery).toContain('class="already-have-tag"');
    expect(grocery.toLowerCase()).toMatch(/have .+ need /);
    expect(grocery).toContain("Produce");
    expect(grocery).toContain("Other");
    const sections = renderStoreSectionList();
    expect(sections).toContain('class="store-section-list"');
    expect(sections).toContain("Produce");
    expect(sections).toContain("Other");
});

test("searchPickerFoods uses searchFoodsByName hooks", async () => {
    const hit = food({
        name: "Good Culture Cottage Cheese",
        barcode: "070852010016",
    });
    const results = await searchPickerFoods("cottage", [], {
        searchCache: async () => [],
        searchOff: async () => [hit],
        remember: async () => {},
    });
    expect(results).toEqual([hit]);
});

test("runBarcodeLookupAction normalizes digits then calls lookupBarcode", async () => {
    const hit = food({ name: "Nutella", barcode: "3017620422003" });
    const seen: string[] = [];
    const result = await runBarcodeLookupAction(" 3017-6204 22003 ", {
        lookup: async (barcode) => {
            seen.push(barcode);
            return hit;
        },
    });
    expect(seen).toEqual(["3017620422003"]);
    expect(result).toEqual({ barcode: "3017620422003", food: hit });
});

test("food picker tabs are a segmented control driven by aria-selected", () => {
    const html = renderFoodPicker();
    expect(html).toContain('class="food-picker-tabs seg" role="tablist"');
    expect(html).toContain(
        'class="seg-btn" id="food-picker-tab-barcode" data-tab="barcode"',
    );
    expect(html).toContain(
        '<button type="submit" class="btn-primary">Look up</button>',
    );
});
