import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderQuantityField } from "./quantity-field.js";
import {
    renderFoodPicker,
    searchPickerFoods,
    runBarcodeLookupAction,
} from "./food-picker.js";
import type { FoodResult } from "../../foods.js";

const appDir = join(import.meta.dir, "..");
const PICKER_JS = readFileSync(join(appDir, "client/food-picker.js"), "utf8");

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
    expect(eachHtml).toContain(">count</option>");

    const supplyHtml = renderQuantityField({ kind: "supply" });
    expect(supplyHtml).toContain('data-kind="supply"');
    for (const unit of ["g", "oz", "lb", "ml", "fl oz", "cup", "each"]) {
        expect(supplyHtml).toContain(`value="${unit}"`);
    }
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
        action: "/kitchen/fridge/items",
        method: "post",
        hiddenFields: { kind: "food", location_id: "loc-1" },
        includeQuantity: true,
    });
    const form = searchFormHtml(html);
    expect(form).toContain('method="post"');
    expect(form).toContain('action="/kitchen/fridge/items"');
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
        action: "/kitchen/fridge/items",
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
