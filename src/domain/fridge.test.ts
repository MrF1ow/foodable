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

function dialogHtml(html: string, id: string): string {
    const re = new RegExp(
        `<dialog class="modal" id="${id}"[\\s\\S]*?</dialog>`,
    );
    return html.match(re)?.[0] ?? "";
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
                foodId: null,
            },
            {
                id: "item-2",
                householdId: HH,
                locationId: "loc-1",
                kind: "supply",
                displayName: "Foil",
                quantity: { amount: 2, unit: "roll" },
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
    expect(html).toContain('id="fridge-edit-food"');
    expect(html).toContain('id="fridge-delete-item"');
    expect(html).not.toContain('id="fridge-edit-it-1"');
    expect(html).not.toContain('id="fridge-delete-it-1"');
    expect(html).not.toContain('class="fridge-item-eat"');
    expect(html).not.toContain('aria-label="Eat Eggs"');
    expect(html).toContain("btn-icon");
    expect(html).not.toContain(">Ate it<");
    expect(html).not.toContain(">Toss<");
    const listStart = html.indexOf('<ul class="fridge-items list">');
    const actionsStart = html.indexOf('data-item-id="it-1"', listStart);
    const actionsEnd = html.indexOf("</li>", actionsStart);
    const itemChunk = html.slice(actionsStart, actionsEnd);
    const editPos = itemChunk.indexOf('commandfor="fridge-edit-food"');
    const deletePos = itemChunk.indexOf('commandfor="fridge-delete-item"');
    expect(editPos).toBeGreaterThan(-1);
    expect(deletePos).toBeGreaterThan(editPos);
    expect(itemChunk).toContain('aria-label="Edit Eggs"');
    expect(itemChunk).toContain('aria-label="Delete Eggs"');
    expect(itemChunk).toContain('class="btn-sm btn-icon btn-danger"');
    expect(itemChunk).toContain('data-item-id="it-1"');
    expect(itemChunk).toContain('data-fill-action="/fridge/items/it-1"');
    expect(itemChunk).toContain('data-fill-title="Edit Eggs"');
    expect(itemChunk).toContain('data-fill-field-qty_amount="6"');
    expect(itemChunk).toContain('data-fill-field-qty_unit="each"');
    expect(itemChunk).toContain('data-fill-field-location_id="loc-1"');
    expect(itemChunk).toContain(`data-fill-field-expires_on="${expiresOn}"`);
    expect(itemChunk).toContain(
        'data-fill-message="Remove Eggs from the fridge?"',
    );
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
    expect(html).toContain('commandfor="fridge-add-food"');
    expect(html).toContain('commandfor="fridge-add-supply"');
    expect(html).not.toContain('commandfor="fridge-add-food-loc-1"');
    expect(html).toContain('data-fill-title="Add food to Pantry"');
    expect(html).toContain('data-fill-field-location_id="loc-1"');
    expect(html).toContain('data-fill-field-qty_unit="g"');
    expect(html).toContain('data-fill-title="Add household item to Pantry"');
    expect(html).toContain(
        'data-fill-message="Remove Pantry and everything in it?"',
    );
    expect(html).toContain('data-fill-action="/fridge/locations/loc-1/delete"');
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
                foodId: "f-sup",
                expiresOn: null,
            },
        ],
    } as never);
    expect(html).not.toContain('class="fridge-item-eat"');
    const listStart = html.indexOf('<ul class="fridge-items list">');
    const itemEnd = html.indexOf("</li>", listStart);
    const itemChunk = html.slice(listStart, itemEnd);
    expect(itemChunk).toContain('commandfor="fridge-edit-supply"');
    expect(itemChunk).toContain('commandfor="fridge-delete-item"');
    expect(itemChunk).not.toContain('commandfor="fridge-edit-food"');
    expect(itemChunk).toContain('data-item-id="it-sup"');
    expect(itemChunk).toContain('data-fill-action="/fridge/items/it-sup"');
    expect(itemChunk).toContain('data-fill-field-qty_unit="roll"');
    expect(itemChunk).toContain('data-fill-field-expires_on=""');
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
        /<dialog class="modal" id="fridge-delete-item"[^>]*data-modal-open-on-load/,
    );
    expect(deleteHtml).toContain('action="/fridge/items/it-1/delete"');
    expect(deleteHtml).toContain("Remove Milk from the fridge?");
    expect(deleteHtml).not.toContain("Remove this item from the fridge?");
    const deleteDialog = dialogHtml(deleteHtml, "fridge-delete-item");
    expect(deleteDialog).toContain("error-banner");
    expect(deleteDialog).toContain("Cannot remove.");
    expect(deleteHtml.match(/Cannot remove\./g)?.length).toBe(1);
    expect(deleteHtml).not.toMatch(
        /<dialog class="modal" id="fridge-edit-food"[^>]*data-modal-open-on-load/,
    );
    expect(deleteHtml).not.toMatch(
        /<dialog class="modal" id="fridge-remove-location"[^>]*data-modal-open-on-load/,
    );
    const removeHtml = renderFridgePage({
        ...base,
        openModalId: "fridge-remove-location-loc-1",
    } as never);
    expect(removeHtml).toMatch(
        /<dialog class="modal" id="fridge-remove-location"[^>]*data-modal-open-on-load/,
    );
    expect(removeHtml).toContain('action="/fridge/locations/loc-1/delete"');
    expect(removeHtml).toContain("Remove Fridge and everything in it?");
    const removeDialog = dialogHtml(removeHtml, "fridge-remove-location");
    expect(removeDialog).toContain("error-banner");
    expect(removeDialog).toContain("Cannot remove.");
    expect(removeHtml.match(/Cannot remove\./g)?.length).toBe(1);
    expect(removeHtml).not.toMatch(
        /<dialog class="modal" id="fridge-delete-item"[^>]*data-modal-open-on-load/,
    );
    expect(removeHtml).toContain("Remove this item from the fridge?");
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
    const editGone = renderFridgePage({
        chrome: { theme: "light" },
        locations: [
            { id: "loc-1", householdId: HH, name: "Fridge", sortOrder: 0 },
        ],
        items: [],
        error: "Unknown item.",
        openModalId: "fridge-edit-gone",
    } as never);
    expect(editGone).toContain("Unknown item.");
    expect(editGone).not.toMatch(/data-modal-open-on-load/);
    const locationGone = renderFridgePage({
        chrome: { theme: "light" },
        locations: [
            { id: "loc-1", householdId: HH, name: "Fridge", sortOrder: 0 },
        ],
        items: [],
        error: "Unknown location.",
        openModalId: "fridge-add-food-gone",
    } as never);
    expect(locationGone).toContain("Unknown location.");
    expect(locationGone).not.toMatch(/data-modal-open-on-load/);
    expect(locationGone).toContain('id="fridge-add-food"');
});

test("a server error reopens the shared edit dialog pre-filled", () => {
    const expiresOn = "2026-11-02";
    const base = {
        chrome: { theme: "light" },
        locations: [
            { id: "loc-1", householdId: HH, name: "Fridge", sortOrder: 0 },
            { id: "loc-2", householdId: HH, name: "Pantry", sortOrder: 1 },
        ],
        error: "Enter an amount.",
    };
    const foodHtml = renderFridgePage({
        ...base,
        openModalId: "fridge-edit-it-1",
        items: [
            {
                id: "it-1",
                householdId: HH,
                locationId: "loc-2",
                kind: "food",
                displayName: "Eggs",
                quantity: { amount: 6, unit: "each" },
                foodId: "f-1",
                expiresOn,
            },
        ],
    } as never);
    const foodDialog = dialogHtml(foodHtml, "fridge-edit-food");
    expect(foodDialog).toMatch(/data-modal-open-on-load/);
    expect(foodDialog).toContain('action="/fridge/items/it-1"');
    expect(foodDialog).toContain(">Edit Eggs</h2>");
    expect(foodDialog).toContain('id="qty-edit-food-amount"');
    expect(foodDialog).toContain('value="6"');
    expect(foodDialog).toContain('value="each" selected');
    expect(foodDialog).toContain('value="loc-2" selected');
    expect(foodDialog).toContain(`value="${expiresOn}"`);
    expect(foodDialog).toContain("error-banner");
    expect(foodDialog).toContain("Enter an amount.");
    expect(foodHtml.match(/Enter an amount\./g)?.length).toBe(1);
    expect(foodHtml).not.toMatch(
        /<dialog class="modal" id="fridge-edit-supply"[^>]*data-modal-open-on-load/,
    );
    expect(dialogHtml(foodHtml, "fridge-edit-supply")).toContain('action=""');
    // Unfilled templates cannot submit; the reopened one can.
    expect(dialogHtml(foodHtml, "fridge-edit-supply")).toContain(
        '<button type="submit" class="btn-primary" disabled>',
    );
    expect(dialogHtml(foodHtml, "fridge-delete-item")).toContain(
        '<button type="submit" class="btn-danger" disabled>',
    );
    expect(foodDialog).toContain('<button type="submit" class="btn-primary">');

    const supplyHtml = renderFridgePage({
        ...base,
        openModalId: "fridge-edit-it-sup",
        items: [
            {
                id: "it-sup",
                householdId: HH,
                locationId: "loc-1",
                kind: "supply",
                displayName: "Paper towels",
                quantity: { amount: 2, unit: "roll" },
                foodId: "f-sup",
                expiresOn: null,
            },
        ],
    } as never);
    const supplyDialog = dialogHtml(supplyHtml, "fridge-edit-supply");
    expect(supplyDialog).toMatch(/data-modal-open-on-load/);
    expect(supplyDialog).toContain('action="/fridge/items/it-sup"');
    expect(supplyDialog).toContain(">Edit Paper towels</h2>");
    expect(supplyDialog).toContain('id="qty-edit-supply-amount"');
    expect(supplyDialog).toContain('value="2"');
    expect(supplyDialog).toContain('value="roll" selected');
    expect(supplyDialog).toContain('value="loc-1" selected');
    expect(supplyDialog).toContain('name="expires_on" type="date" value=""');
    expect(supplyDialog).toContain("Enter an amount.");
    expect(supplyHtml.match(/Enter an amount\./g)?.length).toBe(1);
    expect(supplyHtml).not.toMatch(
        /<dialog class="modal" id="fridge-edit-food"[^>]*data-modal-open-on-load/,
    );
});

test("fridge item edit and delete dialogs are shared and escape row data", () => {
    const hostile = `"><img src=x onerror=alert(1)>`;
    const locations = ["Fridge", "Freezer", "Pantry", "Counter"].map(
        (name, index) => ({
            id: `loc-${index + 1}`,
            householdId: HH,
            name,
            sortOrder: index,
        }),
    );
    const items = Array.from({ length: 8 }, (_, index) => {
        const supply = index % 2 === 1;
        return {
            id: `it-${index + 1}`,
            householdId: HH,
            locationId: locations[index % locations.length]!.id,
            kind: supply ? "supply" : "food",
            displayName: index === 0 ? hostile : `Item ${index + 1}`,
            quantity: supply
                ? { amount: 2, unit: "roll" }
                : { amount: 4, unit: "each" },
            foodId: `f-${index + 1}`,
            expiresOn: supply ? null : "2026-12-01",
        };
    });
    const html = renderFridgePage({
        chrome: { theme: "light" },
        locations,
        items,
    } as never);
    expect(html.match(/id="fridge-edit-food"/g)?.length).toBe(1);
    expect(html.match(/id="fridge-edit-supply"/g)?.length).toBe(1);
    expect(html.match(/id="fridge-delete-item"/g)?.length).toBe(1);
    expect(html.match(/id="qty-edit-food-amount"/g)?.length).toBe(1);
    expect(html.match(/id="qty-edit-supply-amount"/g)?.length).toBe(1);
    expect(html.match(/id="qty-edit-food-unit"/g)?.length).toBe(1);
    expect(html.match(/id="move-edit-food"/g)?.length).toBe(1);
    expect(html.match(/id="move-edit-supply"/g)?.length).toBe(1);
    expect(html.match(/<dialog\b/g)?.length).toBe(7);
    expect(html).toContain(
        'data-fill-title="Edit &quot;&gt;&lt;img src=x onerror=alert(1)&gt;"',
    );
    expect(html).toContain(
        'aria-label="Edit &quot;&gt;&lt;img src=x onerror=alert(1)&gt;"',
    );
    expect(html).not.toContain('"><img src=x');
    expect(html).not.toContain("onerror=alert(1)>");
    const foodTriggers = html.match(/commandfor="fridge-edit-food"/g) ?? [];
    const supplyTriggers = html.match(/commandfor="fridge-edit-supply"/g) ?? [];
    // Each shared dialog's close button also points at it.
    expect(foodTriggers.length).toBe(5);
    expect(supplyTriggers.length).toBe(5);
});

test("add-food, add-supply, and remove-location dialogs do not grow with locations", () => {
    function page(count: number) {
        const locations = Array.from({ length: count }, (_, index) => ({
            id: `loc-${index + 1}`,
            householdId: HH,
            name: `Place ${index + 1}`,
            sortOrder: index,
        }));
        return renderFridgePage({
            chrome: { theme: "light" },
            locations,
            items: [],
        } as never);
    }
    const one = page(1);
    const six = page(6);
    const dialogs = (html: string) => html.match(/<dialog\b/g)?.length ?? 0;
    expect(dialogs(one)).toBe(dialogs(six));
    expect(dialogs(one)).toBe(7);
    expect(six.match(/id="fridge-add-food"/g)?.length).toBe(1);
    expect(six.match(/id="fridge-add-supply"/g)?.length).toBe(1);
    expect(six.match(/id="fridge-remove-location"/g)?.length).toBe(1);
    expect(six.match(/data-food-picker/g)?.length).toBe(1);
    expect(six).toContain('data-fill-title="Add food to Place 6"');
    expect(six).toContain('data-fill-field-location_id="loc-6"');
    expect(six).toContain('data-fill-field-qty_unit="roll"');
    expect(six).toContain('data-fill-title="Add household item to Place 6"');
    expect(six).toContain(
        'data-fill-message="Remove Place 6 and everything in it?"',
    );
    expect(six).toContain('data-fill-action="/fridge/locations/loc-6/delete"');
    expect(six).not.toContain('id="fridge-add-food-loc-1"');
    expect(dialogHtml(six, "fridge-add-food")).toContain(
        '<button type="submit" class="btn-primary" disabled>',
    );
    expect(dialogHtml(six, "fridge-remove-location")).toContain(
        '<button type="submit" class="btn-danger" disabled>',
    );
});

test("a server error reopens the shared add-food dialog for that location", () => {
    const html = renderFridgePage({
        chrome: { theme: "light" },
        locations: [
            { id: "loc-1", householdId: HH, name: "Fridge", sortOrder: 0 },
            { id: "loc-2", householdId: HH, name: "Pantry", sortOrder: 1 },
        ],
        items: [],
        error: "Enter an amount.",
        openModalId: "fridge-add-food-loc-2",
    } as never);
    const foodDialog = dialogHtml(html, "fridge-add-food");
    expect(foodDialog).toMatch(/data-modal-open-on-load/);
    expect(foodDialog).toContain(">Add food to Pantry</h2>");
    expect(foodDialog).toContain('action="/fridge/items"');
    expect(foodDialog).toContain('name="location_id" value="loc-2"');
    expect(foodDialog).toContain('name="kind" value="food"');
    expect(foodDialog).toContain("error-banner");
    expect(foodDialog).toContain("Enter an amount.");
    expect(html.match(/Enter an amount\./g)?.length).toBe(1);
    expect(foodDialog).toContain('<button type="submit" class="btn-primary">');
    expect(dialogHtml(html, "fridge-add-supply")).toContain('action=""');
    expect(dialogHtml(html, "fridge-add-supply")).toContain(
        '<button type="submit" class="btn-primary" disabled>',
    );
    expect(dialogHtml(html, "fridge-remove-location")).toContain(
        '<button type="submit" class="btn-danger" disabled>',
    );
    expect(html).not.toMatch(
        /<dialog class="modal" id="fridge-add-supply"[^>]*data-modal-open-on-load/,
    );
});
