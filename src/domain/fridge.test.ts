import { test, expect } from "bun:test";
import type { FoodResult } from "../foods.js";
import {
    addFoodByBarcode,
    addLocation,
    addSupply,
    createMemoryFridgeStore,
    deleteItem,
    listFridge,
    moveItem,
    updateItemQuantity,
} from "./fridge.js";
import { createMemoryFoodsStore } from "./foods.js";
import { renderFridgePage } from "../web/pages/fridge.js";
import { expiryLevel, utcTodayFromDate } from "./stock.js";

function addUtcDays(isoDate: string, days: number): string {
    const d = new Date(`${isoDate}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

const HH = "hh-1";

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

test("add location Pantry then lists it", async () => {
    const store = createMemoryFridgeStore();
    const loc = await addLocation(store, HH, "Pantry");
    expect(loc.name).toBe("Pantry");
    const listed = await listFridge(store, HH);
    expect(listed.locations.map((l) => l.name)).toEqual(["Pantry"]);
    expect(listed.items).toEqual([]);
});

test("add location refuses a duplicate name", async () => {
    const store = createMemoryFridgeStore();
    await addLocation(store, HH, "Pantry");
    await expect(addLocation(store, HH, "Pantry")).rejects.toThrow(
        /already exists/i,
    );
});

test("add food by barcode mock stores grams", async () => {
    const store = createMemoryFridgeStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(store, HH, "Fridge");
    const hit = food({
        name: "Good Culture Cottage Cheese",
        barcode: "070852010016",
    });
    const item = await addFoodByBarcode(
        store,
        foods,
        {
            householdId: HH,
            locationId: loc.id,
            barcode: "0708-5201 0016",
            amount: 1360.8,
        },
        {
            lookup: async (barcode) => {
                expect(barcode).toBe("070852010016");
                return hit;
            },
        },
    );
    expect(item.displayName).toBe("Good Culture Cottage Cheese");
    expect(item.kind).toBe("food");
    expect(item.quantity).toEqual({ amount: 1360.8, unit: "g" });
    expect(item.foodId).toBeTruthy();
    expect(item.identity).toEqual({
        kind: "food",
        via: "catalog",
        source: "foodable",
        sourceId: item.foodId!,
        displayName: "Good Culture Cottage Cheese",
    });
});

test("add supply manual requires amount and unit", async () => {
    const store = createMemoryFridgeStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(store, HH, "Pantry");
    await expect(
        addSupply(store, foods, {
            householdId: HH,
            locationId: loc.id,
            name: "Foil",
            amount: 1,
            unit: "",
        }),
    ).rejects.toThrow(/unit/i);
    await expect(
        addSupply(store, foods, {
            householdId: HH,
            locationId: loc.id,
            name: "Foil",
            amount: 0,
            unit: "roll",
        }),
    ).rejects.toThrow(/amount/i);

    const item = await addSupply(store, foods, {
        householdId: HH,
        locationId: loc.id,
        name: "Foil",
        amount: 2,
        unit: "roll",
    });
    expect(item.kind).toBe("supply");
    expect(item.displayName).toBe("Foil");
    expect(item.quantity).toEqual({ amount: 2, unit: "roll" });
    expect(item.foodId).toBeTruthy();
    expect(item.identity.kind).toBe("supply");
    expect(item.identity.via).toBe("catalog");
});

test("edit quantity updates the stored amount", async () => {
    const store = createMemoryFridgeStore();
    const loc = await addLocation(store, HH, "Fridge");
    const item = await addSupply(store, createMemoryFoodsStore(), {
        householdId: HH,
        locationId: loc.id,
        name: "Foil",
        amount: 2,
        unit: "roll",
    });
    const updated = await updateItemQuantity(store, HH, item.id, {
        amount: 1,
        unit: "roll",
    });
    expect(updated?.quantity).toEqual({ amount: 1, unit: "roll" });
    const listed = await listFridge(store, HH);
    expect(listed.items[0]?.quantity.amount).toBe(1);
});

test("delete item removes the row", async () => {
    const store = createMemoryFridgeStore();
    const loc = await addLocation(store, HH, "Fridge");
    const item = await addSupply(store, createMemoryFoodsStore(), {
        householdId: HH,
        locationId: loc.id,
        name: "Foil",
        amount: 1,
        unit: "roll",
    });
    expect(await deleteItem(store, HH, item.id)).toBe(true);
    expect((await listFridge(store, HH)).items).toEqual([]);
    expect(await deleteItem(store, HH, item.id)).toBe(false);
});

test("move item changes location", async () => {
    const store = createMemoryFridgeStore();
    const fridge = await addLocation(store, HH, "Fridge");
    const pantry = await addLocation(store, HH, "Pantry");
    const item = await addSupply(store, createMemoryFoodsStore(), {
        householdId: HH,
        locationId: fridge.id,
        name: "Foil",
        amount: 1,
        unit: "roll",
    });
    const moved = await moveItem(store, HH, item.id, pantry.id);
    expect(moved?.locationId).toBe(pantry.id);
});

test("empty fridge page prompts add location then add item", () => {
    const html = renderFridgePage({
        locations: [],
        items: [],
        chrome: { theme: "light" },
    });
    expect(html).toContain("<h1>Fridge</h1>");
    expect(html).not.toContain("Coming soon.");
    expect(html.toLowerCase()).toContain("add a location");
    expect(html.toLowerCase()).toContain("add an item");
    expect(html).toContain('action="/fridge/locations"');
    expect(html).toContain('href="/fridge" aria-current="page"');
});

test("fridge page reuses quantity field and food picker", () => {
    const html = renderFridgePage({
        locations: [
            {
                id: "loc-1",
                householdId: HH,
                name: "Pantry",
                sortOrder: 0,
            },
        ],
        items: [
            {
                id: "item-1",
                householdId: HH,
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
            {
                id: "item-2",
                householdId: HH,
                locationId: "loc-1",
                kind: "supply",
                displayName: "Foil",
                quantity: { amount: 2, unit: "roll" },
                identity: {
                    kind: "supply",
                    via: "manual",
                    householdManualId: "hm-foil",
                    displayName: "Foil",
                },
                foodId: null,
            },
        ],
        chrome: { theme: "light" },
    });
    expect(html).toContain('class="quantity-field"');
    expect(html).toContain('class="food-picker"');
    expect(html).toContain("Cottage Cheese");
    expect(html).toContain("1360.8 g");
    expect(html).toContain("Foil");
    expect(html).toContain("2 roll");
    expect(html).toContain('value="roll"');
    expect(html).toContain('action="/fridge/items"');
});

test("fridge rows use modals for edit and delete, with expiry badges", () => {
    const today = utcTodayFromDate();
    const expiresOn = addUtcDays(today, 2);
    expiryLevel(expiresOn, today);
    const html = renderFridgePage({
        chrome: { theme: "light" },
        locations: [
            { id: "loc-1", householdId: "hh-1", name: "Fridge", sortOrder: 0 },
        ],
        items: [
            {
                id: "it-1",
                householdId: "hh-1",
                locationId: "loc-1",
                kind: "food",
                displayName: "Eggs",
                quantity: { amount: 6, unit: "each" },
                identity: { kind: "food", via: "manual", displayName: "Eggs" },
                foodId: "f-1",
                expiresOn,
            },
        ],
    } as never);
    expect(html).toContain('<ul class="fridge-items list">');
    expect(html).toContain(`6 · Expires ${expiresOn}`);
    expect(html).not.toContain('data-expiry="medium"');
    expect(html).not.toContain('data-expiry="high"');
    expect(html).not.toContain(">Medium<");
    expect(html).not.toContain(">High<");
    expect(html).not.toContain(">Low<");
    expect(html).toContain('class="fridge-item-edit"');
    expect(html).toContain('id="fridge-edit-it-1"');
    expect(html).toContain('commandfor="fridge-edit-it-1"');
    expect(html).toContain('id="fridge-delete-it-1"');
    expect(html).toContain('action="/fridge/items/it-1/delete"');
    expect(html).not.toContain('class="fridge-item-eat"');
    expect(html).not.toContain('aria-label="Eat Eggs"');
    expect(html).toContain("btn-icon");
    expect(html).not.toContain(">Ate it<");
    expect(html).not.toContain(">Toss<");
    const listStart = html.indexOf('<ul class="fridge-items list">');
    const actionsStart = html.indexOf('data-item-id="it-1"', listStart);
    const actionsEnd = html.indexOf("</li>", actionsStart);
    const itemChunk = html.slice(actionsStart, actionsEnd);
    const editPos = itemChunk.indexOf('commandfor="fridge-edit-it-1"');
    const deletePos = itemChunk.indexOf('commandfor="fridge-delete-it-1"');
    expect(editPos).toBeGreaterThan(-1);
    expect(deletePos).toBeGreaterThan(editPos);
    expect(html).not.toMatch(
        /<details class="more">\s*<summary>Edit<\/summary>/,
    );
});

test("location actions and add-location live in the page header and head rows", () => {
    const html = renderFridgePage({
        chrome: { theme: "light" },
        locations: [
            { id: "loc-1", householdId: "hh-1", name: "Pantry", sortOrder: 0 },
        ],
        items: [],
    } as never);
    expect(html).toContain('<header class="dash-head">');
    expect(html).toContain('commandfor="fridge-add-location"');
    expect(html).toContain('commandfor="fridge-add-food-loc-1"');
    expect(html).toContain('commandfor="fridge-add-supply-loc-1"');
    expect(html).toContain("Add household item");
    expect(html).not.toContain("popovertarget=");
    expect(html).toContain('class="fridge-add-supply"');
    expect(html).not.toContain("<h3>Add supply</h3>");
});

test("expiring soon is a closed details block with a count", () => {
    const html = renderFridgePage({
        chrome: { theme: "light" },
        locations: [
            { id: "loc-1", householdId: "hh-1", name: "Fridge", sortOrder: 0 },
        ],
        items: [
            {
                id: "it-1",
                householdId: "hh-1",
                locationId: "loc-1",
                kind: "food",
                displayName: "Milk",
                quantity: { amount: 1, unit: "l" },
                identity: { kind: "food", via: "manual", displayName: "Milk" },
                foodId: "f-1",
                expiresOn: utcTodayFromDate(),
            },
        ],
    } as never);
    expect(html).toMatch(
        /<details class="more">\s*<summary>Expiring soon <span class="count">1<\/span>/,
    );
    expect(html).not.toMatch(/<details class="more" open>/);
});

test("supply items omit the eat icon action", () => {
    const html = renderFridgePage({
        chrome: { theme: "light" },
        locations: [
            { id: "loc-1", householdId: HH, name: "Pantry", sortOrder: 0 },
        ],
        items: [
            {
                id: "it-sup",
                householdId: HH,
                locationId: "loc-1",
                kind: "supply",
                displayName: "Paper towels",
                quantity: { amount: 2, unit: "roll" },
                identity: {
                    kind: "supply",
                    via: "manual",
                    displayName: "Paper towels",
                },
                foodId: "f-sup",
                expiresOn: null,
            },
        ],
    } as never);
    expect(html).not.toContain('class="fridge-item-eat"');
    expect(html).toContain('commandfor="fridge-edit-it-sup"');
    expect(html).toContain('commandfor="fridge-delete-it-sup"');
});

test("a server error reopens the modal that submitted the form", () => {
    const html = renderFridgePage({
        chrome: { theme: "light" },
        locations: [],
        items: [],
        error: "Enter a location name.",
        openModalId: "fridge-add-location",
    } as never);
    expect(html).toContain('id="fridge-add-location"');
    expect(html).toContain("data-modal-open-on-load");
    expect(html).toMatch(
        /<dialog class="modal" id="fridge-add-location"[^>]*data-modal-open-on-load/,
    );
    expect(html.match(/Enter a location name./g)?.length).toBe(1);
    const dialog = html.match(
        /<dialog class="modal" id="fridge-add-location"[\s\S]*?<\/dialog>/,
    )?.[0];
    expect(dialog).toContain("error-banner");
});

test("a server error reopens delete and remove-location confirm modals only", () => {
    const base = {
        chrome: { theme: "light" },
        locations: [
            { id: "loc-1", householdId: HH, name: "Fridge", sortOrder: 0 },
        ],
        items: [
            {
                id: "it-1",
                householdId: HH,
                locationId: "loc-1",
                kind: "food",
                displayName: "Milk",
                quantity: { amount: 1, unit: "l" },
                identity: { kind: "food", via: "manual", displayName: "Milk" },
                foodId: "f-1",
                expiresOn: null,
            },
        ],
        error: "Cannot remove.",
    } as const;
    const deleteHtml = renderFridgePage({
        ...base,
        openModalId: "fridge-delete-it-1",
    } as never);
    expect(deleteHtml).toMatch(
        /<dialog class="modal" id="fridge-delete-it-1"[^>]*data-modal-open-on-load/,
    );
    expect(deleteHtml).not.toMatch(
        /<dialog class="modal" id="fridge-remove-location-loc-1"[^>]*data-modal-open-on-load/,
    );
    const removeHtml = renderFridgePage({
        ...base,
        openModalId: "fridge-remove-location-loc-1",
    } as never);
    expect(removeHtml).toMatch(
        /<dialog class="modal" id="fridge-remove-location-loc-1"[^>]*data-modal-open-on-load/,
    );
    expect(removeHtml).not.toMatch(
        /<dialog class="modal" id="fridge-delete-it-1"[^>]*data-modal-open-on-load/,
    );
});

test("fridge still shows a page banner when openModalId does not match a dialog", () => {
    const html = renderFridgePage({
        chrome: { theme: "light" },
        locations: [
            { id: "loc-1", householdId: HH, name: "Fridge", sortOrder: 0 },
        ],
        items: [],
        error: "Unknown item.",
        openModalId: "fridge-delete-gone",
    } as never);
    expect(html).toContain('class="error-banner"');
    expect(html).toContain("Unknown item.");
    expect(html).not.toMatch(/data-modal-open-on-load/);
});
