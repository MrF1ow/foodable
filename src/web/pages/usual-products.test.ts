import { expect, test } from "bun:test";
import { newFood } from "../../domain/foods.js";
import {
    renderUsualProductsListPage,
    renderUsualProductsPickerPage,
} from "./usual-products.js";

const HH = "hh-web";

test("usual products list puts needs-usual first", () => {
    const eggs = newFood({ householdId: HH, kind: "food", name: "Eggs" });
    const milk = newFood({
        householdId: HH,
        kind: "food",
        name: "Milk",
        calories: 50,
    });
    const html = renderUsualProductsListPage({
        chrome: { theme: "light" },
        needsUsual: [eggs],
        rows: [
            {
                food: eggs,
                products: [],
                usual: null,
            },
            {
                food: milk,
                products: [],
                usual: null,
            },
        ],
    });
    const needsAt = html.indexOf("Needs a usual product");
    const eggsAt = html.indexOf(">Eggs<");
    expect(needsAt).toBeGreaterThan(-1);
    expect(needsAt).toBeLessThan(eggsAt);
    expect(html).toContain("No nutrition");
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
