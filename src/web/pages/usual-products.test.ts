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
    expect(html).toContain('name="q"');
    expect(html).toContain('type="search"');
    expect(html).not.toContain('name="food"');
    expect(html).not.toContain("<select");
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
        prefillStoreId: eggs.usualStoreId,
        prefillAmount: eggs.usualAmount,
        stores: [],
        from: "/recipes/r1",
    });
    expect(html).toContain("Add a product");
    expect(html).toContain("Add product by hand");
    expect(html).toContain('action="/household/usual-products/');
    expect(html).not.toContain('name="food_name"');
    expect(html).not.toContain('data-tab="manual"');
});

test("picker explains the list and gives each product a Remove that submits its own form", () => {
    const eggs = newFood({ householdId: "hh", kind: "food", name: "Eggs" });
    const kirkland = newFood({
        householdId: "hh",
        kind: "food",
        name: "Kirkland Large Eggs",
        genericFoodId: eggs.id,
    });
    const html = renderUsualProductsPickerPage({
        chrome: { theme: "light" },
        food: eggs,
        products: [kirkland],
        usualProductId: null,
        prefillStoreId: null,
        prefillAmount: null,
        stores: [],
        from: "/grocery",
    } as never);
    expect(html).toContain("Products of Eggs");
    expect(html).toContain(
        "Any of these counts as Eggs in the fridge, recipes and the grocery list.",
    );
    const formId = `remove-product-${kirkland.id}`;
    expect(html).toContain(`form="${formId}">Remove</button>`);
    expect(html).toContain(
        `<form id="${formId}" method="post" action="/household/usual-products/${eggs.id}/products/${kirkland.id}/remove" hidden>`,
    );
    // The remove form is not nested inside the Set usual form.
    const setUsual = html.indexOf("data-usual-buy-follow");
    const setUsualEnd = html.indexOf("</form>", setUsual);
    expect(html.indexOf(`<form id="${formId}"`)).toBeGreaterThan(setUsualEnd);
});
