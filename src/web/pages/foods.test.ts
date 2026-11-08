import { FIXTURE_APP_CHROME_FLAGS } from "../../test-support/chrome-flags.js";
import { expect, test } from "bun:test";
import { newFood } from "../../domain/foods.js";
import { renderFoodsSettingsPage } from "./foods.js";

const HH = "hh-items";

function food(
    id: string,
    name: string,
    over: Partial<ReturnType<typeof newFood>> = {},
) {
    return {
        ...newFood({
            householdId: HH,
            kind: "food",
            name,
            ...over,
        }),
        id,
        aliases: [] as string[],
    };
}

test("items nests products with Usual pill", () => {
    const plain = food("p1", "Eggs");
    const kirkland = food("k1", "Kirkland Large Eggs", {
        genericFoodId: "p1",
        brand: "Kirkland",
    });
    const html = renderFoodsSettingsPage({
        chrome: {
            theme: "light",
            attention: { count: 0, tabs: {} },
            flags: FIXTURE_APP_CHROME_FLAGS,
        },
        stores: [],
        foods: [{ ...plain, usualProductId: "k1" }, kirkland],
    });
    expect(html).toContain('class="food-products list"');
    expect(html).toContain('class="pill pill-dim">Usual</span>');
    expect(html).toContain("Kirkland Large Eggs");
});

test("standalone row shows Belongs to action", () => {
    const solo = food("s1", "Kirkland Large Eggs", { brand: "Kirkland" });
    const plain = food("p1", "Eggs");
    const html = renderFoodsSettingsPage({
        chrome: {
            theme: "light",
            attention: { count: 0, tabs: {} },
            flags: FIXTURE_APP_CHROME_FLAGS,
        },
        stores: [],
        foods: [plain, solo],
    });
    expect(html).toContain("Belongs to…");
});

test("items edit modal includes usual buy controls on a normal page load", () => {
    const plain = food("p1", "Eggs");
    const kirkland = food("k1", "Kirkland Large Eggs", {
        genericFoodId: "p1",
        brand: "Kirkland",
    });
    const html = renderFoodsSettingsPage({
        chrome: {
            theme: "light",
            attention: { count: 0, tabs: {} },
            flags: FIXTURE_APP_CHROME_FLAGS,
        },
        stores: [
            { id: "s-z", householdId: HH, name: "Zebra", sortOrder: 1 },
            { id: "s-a", householdId: HH, name: "Aldi", sortOrder: 0 },
        ],
        foods: [{ ...plain, usualProductId: "k1" }, kirkland],
    });
    expect(html).toContain('name="usual_amount"');
    expect(html).toContain('name="usual_unit"');
    expect(html).toContain('name="usual_store_id"');
    const idx = html.indexOf('name="usual_store_id"');
    expect(idx).toBeGreaterThan(-1);
    const bit = html.slice(idx, idx + 500);
    expect(bit.indexOf("Aldi")).toBeLessThan(bit.indexOf("Zebra"));
});

test("open food-edit modal shows usual field values from the food row", () => {
    const plain = food("p1", "Eggs", {
        usualStoreId: "s-a",
        usualAmount: { amount: 6, unit: "g" },
    });
    const html = renderFoodsSettingsPage({
        chrome: {
            theme: "light",
            attention: { count: 0, tabs: {} },
            flags: FIXTURE_APP_CHROME_FLAGS,
        },
        stores: [{ id: "s-a", householdId: HH, name: "Aldi", sortOrder: 0 }],
        foods: [plain],
        openModalId: "food-edit-p1",
    });
    expect(html).toContain('name="usual_amount"');
    expect(html).toMatch(/name="usual_amount"[^>]*value="6"/);
    expect(html).toContain('name="usual_unit"');
    expect(html).toContain('value="g" selected');
    expect(html).toContain('name="usual_store_id"');
    expect(html).toContain('value="s-a" selected');
});
