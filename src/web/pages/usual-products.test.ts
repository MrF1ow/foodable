import { expect, test } from "bun:test";
import { newFood } from "../../domain/foods.js";
import {
    renderUsualProductsListPage,
    renderUsualProductsPickerPage,
} from "./usual-products.js";

const HH = "hh-web";

test("usual products list starts empty with an add action", () => {
    const eggs = newFood({ householdId: HH, kind: "food", name: "Eggs" });
    const html = renderUsualProductsListPage({
        chrome: { theme: "light" },
        rows: [],
        addable: [eggs],
    });
    expect(html).toContain("No usual products yet.");
    expect(html).not.toContain("Needs a usual product");
    expect(html).toContain("Add usual product");
    expect(html).toContain('action="/household/usual-products"');
    expect(html).toContain('name="food"');
    expect(html).toContain(`value="${eggs.id}"`);
});

test("usual products list shows foods with products", () => {
    const eggs = newFood({ householdId: HH, kind: "food", name: "Eggs" });
    const kirkland = newFood({
        householdId: HH,
        kind: "food",
        name: "Kirkland Large Eggs",
        brand: "Kirkland",
        genericFoodId: eggs.id,
    });
    const html = renderUsualProductsListPage({
        chrome: { theme: "light" },
        rows: [{ food: eggs, products: [kirkland], usual: kirkland }],
        addable: [],
    });
    expect(html).toContain(">Eggs<");
    expect(html).toContain("Kirkland Large Eggs · Kirkland");
    expect(html).toContain("Change");
    expect(html).not.toContain("No usual products yet.");
    expect(html).not.toContain("Add usual product");
});

test("picker page includes search and manual product panels", () => {
    const eggs = newFood({ householdId: HH, kind: "food", name: "Eggs" });
    const html = renderUsualProductsPickerPage({
        chrome: { theme: "light" },
        food: eggs,
        products: [],
        usualProductId: null,
        from: "/recipes/r1",
    });
    expect(html).toContain("Search or scan");
    expect(html).toContain("Add product by hand");
    expect(html).toContain('action="/household/usual-products/');
    expect(html).not.toContain('name="food_name"');
    expect(html).not.toContain('data-tab="manual"');
});
