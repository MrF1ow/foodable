import { test, expect } from "bun:test";
import type { FoodResult } from "../foods.js";
import {
    addFoodByBarcode,
    addLocation,
    createMemoryFridgeStore,
    listFridge,
} from "./fridge.js";
import { createMemoryFoodsStore } from "./foods.js";
import {
    addGroceryFoodByBarcode,
    addGroceryManualFood,
    addGrocerySupply,
    checkGroceryLine,
    clearCheckedLines,
    createMemoryGroceryStore,
    groceryAllergenWarning,
    listGrocery,
    resolveGrocerySectionId,
} from "./grocery.js";
import { alreadyHaveTag } from "./linking.js";
import { createGroceryStore, createMemorySettingsStore } from "./settings.js";
import { renderGroceryPage } from "../web/pages/grocery.js";
import { addAllergen, createMemoryRulesStore } from "./rules.js";

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

async function seedStore() {
    const settings = createMemorySettingsStore();
    const store = await createGroceryStore(settings, HH, "Safeway");
    const sections = await settings.listSections(store.id);
    const dairy = sections.find((row) => row.name === "Dairy")!;
    const other = sections.find((row) => row.isOther)!;
    return { settings, store, dairy, other };
}

test("add grocery line then lists it under the chosen section", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store, dairy } = await seedStore();
    const line = await addGroceryFoodByBarcode(
        grocery,
        settings,
        foods,
        {
            householdId: HH,
            storeId: store.id,
            sectionId: dairy.id,
            barcode: "070852010016",
            amount: 1360.8,
        },
        {
            lookup: async () =>
                food({
                    name: "Good Culture Cottage Cheese",
                    barcode: "070852010016",
                }),
        },
    );
    expect(line.displayName).toBe("Good Culture Cottage Cheese");
    expect(line.checked).toBe(false);
    expect(line.quantity).toEqual({ amount: 1360.8, unit: "g" });
    expect(line.foodId).toBeTruthy();
    const listed = await listGrocery(grocery, settings, HH);
    expect(listed.lines).toHaveLength(1);
    expect(listed.lines[0]?.sectionId).toBe(dairy.id);
});

test("check line stays on the list and does not insert into fridge", async () => {
    const grocery = createMemoryGroceryStore();
    const fridge = createMemoryFridgeStore();
    const { settings, store, dairy } = await seedStore();
    await addLocation(fridge, HH, "Fridge");
    const line = await addGrocerySupply(
        grocery,
        settings,
        createMemoryFoodsStore(),
        {
            householdId: HH,
            storeId: store.id,
            sectionId: dairy.id,
            name: "Foil",
            amount: 1,
            unit: "roll",
        },
    );
    const checked = await checkGroceryLine(grocery, HH, line.id, true);
    expect(checked?.checked).toBe(true);
    const listed = await listGrocery(grocery, settings, HH);
    expect(listed.lines).toHaveLength(1);
    expect(listed.lines[0]?.checked).toBe(true);
    expect((await listFridge(fridge, HH)).items).toEqual([]);
});

test("clear checked removes only checked rows", async () => {
    const grocery = createMemoryGroceryStore();
    const { settings, store, dairy } = await seedStore();
    const keep = await addGrocerySupply(
        grocery,
        settings,
        createMemoryFoodsStore(),
        {
            householdId: HH,
            storeId: store.id,
            sectionId: dairy.id,
            name: "Wipes",
            amount: 1,
            unit: "pack",
        },
    );
    const drop = await addGrocerySupply(
        grocery,
        settings,
        createMemoryFoodsStore(),
        {
            householdId: HH,
            storeId: store.id,
            sectionId: dairy.id,
            name: "Foil",
            amount: 1,
            unit: "roll",
        },
    );
    await checkGroceryLine(grocery, HH, drop.id, true);
    const removed = await clearCheckedLines(grocery, HH);
    expect(removed).toBe(1);
    const listed = await listGrocery(grocery, settings, HH);
    expect(listed.lines.map((row) => row.id)).toEqual([keep.id]);
});

test("unknown section files the line under Other", async () => {
    const grocery = createMemoryGroceryStore();
    const { settings, store, other } = await seedStore();
    expect(await resolveGrocerySectionId(settings, store.id, "")).toBe(
        other.id,
    );
    const line = await addGroceryManualFood(
        grocery,
        settings,
        createMemoryFoodsStore(),
        {
            householdId: HH,
            storeId: store.id,
            name: "Zorblax",
            amount: 1,
        },
    );
    expect(line.sectionId).toBe(other.id);
});

test("a line with no section lands in the aisle its name suggests", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store } = await seedStore();
    const sections = await settings.listSections(store.id);
    const named = (id: string) => sections.find((row) => row.id === id)!.name;
    const cases: [string, string][] = [
        ["Butter", "Dairy"],
        ["Eggs", "Dairy"],
        ["All-purpose flour", "Pantry"],
        ["Peanut butter", "Pantry"],
        ["Ripe bananas", "Produce"],
        ["Chicken broth", "Pantry"],
        ["Chicken thighs", "Meat & seafood"],
        ["Frozen peas", "Frozen"],
        ["Ice cream", "Frozen"],
    ];
    for (const [name, section] of cases) {
        const line = await addGroceryManualFood(grocery, settings, foods, {
            householdId: HH,
            storeId: store.id,
            name,
            amount: 1,
        });
        expect([name, named(line.sectionId)]).toEqual([name, section]);
    }
    const supply = await addGrocerySupply(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "Batteries",
        amount: 4,
        unit: "each",
    });
    expect(named(supply.sectionId)).toBe("Household");
});

test("a food already on the list keeps its section, here and at another store", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store } = await seedStore();
    const sections = await settings.listSections(store.id);
    const bakery = sections.find((row) => row.name === "Bakery")!;
    const first = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        sectionId: bakery.id,
        name: "Zorblax",
        amount: 1,
    });
    expect(first.sectionId).toBe(bakery.id);
    const again = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "zorblax",
        amount: 2,
    });
    expect(again.sectionId).toBe(bakery.id);
    const costco = await createGroceryStore(settings, HH, "Costco");
    const costcoBakery = (await settings.listSections(costco.id)).find(
        (row) => row.name === "Bakery",
    )!;
    const there = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: costco.id,
        name: "Zorblax",
        amount: 1,
    });
    expect(there.sectionId).toBe(costcoBakery.id);
});

test("hidden sections are never suggested", async () => {
    const grocery = createMemoryGroceryStore();
    const { settings, store, dairy, other } = await seedStore();
    await settings.updateSection({ ...dairy, hidden: true });
    const line = await addGroceryManualFood(
        grocery,
        settings,
        createMemoryFoodsStore(),
        { householdId: HH, storeId: store.id, name: "Butter", amount: 1 },
    );
    expect(line.sectionId).toBe(other.id);
});

test("matching fridge stock tags the grocery line already-have", async () => {
    const grocery = createMemoryGroceryStore();
    const fridge = createMemoryFridgeStore();
    const foods = createMemoryFoodsStore();
    const { settings, store, dairy } = await seedStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const fridgeItem = await addFoodByBarcode(
        fridge,
        foods,
        {
            householdId: HH,
            locationId: loc.id,
            barcode: "070852010016",
            amount: 1360.8,
        },
        {
            lookup: async () =>
                food({
                    name: "Good Culture Cottage Cheese",
                    barcode: "070852010016",
                }),
        },
    );
    const line = await addGroceryFoodByBarcode(
        grocery,
        settings,
        foods,
        {
            householdId: HH,
            storeId: store.id,
            sectionId: dairy.id,
            barcode: "070852010016",
            amount: 1360.8,
        },
        {
            lookup: async () =>
                food({
                    name: "Good Culture Cottage Cheese",
                    barcode: "070852010016",
                }),
        },
    );
    expect(alreadyHaveTag(line, [fridgeItem])).toEqual({ cover: "full" });
});

test("grocery allergen warning uses catalog allergens before the name", async () => {
    const rules = createMemoryRulesStore();
    await addAllergen(rules, {
        householdId: HH,
        userId: "bob",
        allergen: "peanut",
    });
    const allergens = await rules.listAllergens(HH, "bob");
    const members = [{ displayName: "Bob", allergens }];
    const byName = groceryAllergenWarning("Peanut Butter", members);
    expect(byName?.blocking).toBe(true);
    expect(byName?.text.toLowerCase()).toContain("peanut");
    expect(
        groceryAllergenWarning("Skippy", members, ["peanut"])?.blocking,
    ).toBe(true);
    expect(groceryAllergenWarning("Peanut Butter", members, [])).toBeNull();
    expect(groceryAllergenWarning("Apples", members, null)?.text).toBe(
        "unknown allergen data",
    );
});

test("grocery page groups by store then section and shows already-have", () => {
    const html = renderGroceryPage({
        chrome: { theme: "light" },
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Safeway",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-dairy",
                        householdId: HH,
                        storeId: "st-1",
                        name: "Dairy",
                        sortOrder: 1,
                        hidden: false,
                        isOther: false,
                        lines: [
                            {
                                id: "line-1",
                                householdId: HH,
                                storeId: "st-1",
                                sectionId: "sec-dairy",
                                kind: "food",
                                displayName: "Cottage Cheese",
                                quantity: { amount: 1360.8, unit: "g" },
                                foodId: null,
                                checked: false,
                                alreadyHave: { cover: "full" },
                            },
                        ],
                    },
                ],
            },
        ],
    });
    expect(html).toContain("<h1>Groceries</h1>");
    expect(html).not.toContain("Coming soon.");
    expect(html).toContain("Safeway");
    expect(html).toContain("Dairy");
    expect(html).toContain("Cottage Cheese");
    expect(html).toContain('class="already-have-tag"');
    expect(html).toContain("already have");
    expect(html).toContain('class="quantity-field"');
    expect(html).toContain('class="food-picker"');
    expect(html).toContain('href="/grocery" aria-current="page"');
    expect(html).toContain('action="/grocery/lines"');
    expect(html).not.toContain('action="/grocery/clear-checked"');
    expect(html).toContain('commandfor="grocery-add-food"');
    expect(html).toContain('data-fill-field-store_id="st-1"');
    expect(html).not.toMatch(/<details class="more"/);
    expect(html).not.toContain("<h3>Add supply</h3>");
    expect(html).not.toContain("grocery-add-supply");
    expect(html).not.toContain('name="kind" value="supply"');
    expect(html).not.toContain('data-kind="supply"');
    expect(html).not.toContain("grocery-add-store");
    expect(html).not.toContain('action="/grocery/stores"');
});

const groceryChrome = {
    theme: "light" as const,
};

test("owner grocery page has a short add-store form and no add-supply", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        stores: [],
        canManage: true,
    });
    expect(html).toContain("<h1>Groceries</h1>");
    expect(html).toContain('class="grocery-add-store"');
    expect(html).toContain('action="/grocery/stores"');
    expect(html).toContain('id="grocery_store_name"');
    expect(html).toContain('name="name"');
    expect(html).toContain("Add store");
    expect(html).toContain("Household settings");
    expect(html).not.toContain("<h3>Add supply</h3>");
    expect(html).not.toContain("grocery-add-supply");
    expect(html).not.toContain('name="kind" value="supply"');
});

test("owner grocery page keeps the add-store form when a store already exists", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        canManage: true,
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Corner",
                sortOrder: 0,
                rules: [],
                sections: [],
            },
        ],
    });
    expect(html).toContain('<h2 class="row-title">Corner</h2>');
    expect(html).toContain('class="grocery-add-store"');
    expect(html).toContain('action="/grocery/stores"');
    expect(html).not.toContain("<h3>Add supply</h3>");
});

test("member grocery page does not get the add-store form", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        stores: [],
        canManage: false,
    });
    expect(html).toContain("<h1>Groceries</h1>");
    expect(html).toContain("Household settings");
    expect(html).not.toContain("grocery-add-store");
    expect(html).not.toContain('action="/grocery/stores"');
    expect(html).not.toContain("<h3>Add supply</h3>");
});

test("empty store name error re-renders groceries with the banner", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        stores: [],
        canManage: true,
        error: "Enter a store name.",
    });
    expect(html).toContain("<h1>Groceries</h1>");
    expect(html).toContain('class="error-banner"');
    expect(html).toContain("Enter a store name.");
    expect(html).toContain('action="/grocery/stores"');
    expect(html).not.toContain("<h3>Add supply</h3>");
});

test("grocery lines are rows with a labelled round check button", () => {
    const html = renderGroceryPage({
        chrome: { theme: "light" },
        canManage: true,
        locations: [{ id: "l1", name: "Fridge" }],
        stores: [
            {
                id: "st-1",
                householdId: "hh-1",
                name: "Corner",
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
                                displayName: "Milk",
                                quantity: { amount: 1, unit: "each" },
                                foodId: "f-1",
                                checked: true,
                                alreadyHave: null,
                            },
                        ],
                    },
                ],
            },
        ],
    } as never);
    expect(html).toContain('<ul class="grocery-lines list">');
    expect(html).toContain(
        '<button type="submit" class="check-btn" aria-pressed="true"><span class="visually-hidden">Uncheck Milk</span></button>',
    );
    expect(html).toContain('<form class="grocery-put-away row-actions"');
    expect(html).toContain(
        '<button type="submit" class="btn-sm btn-primary">Put away</button>',
    );
    expect(html).not.toMatch(/id="put-away-tip-/);
    expect(html).toContain('commandfor="grocery-add-food"');
    expect(html).toContain('data-fill-field-store_id="st-1"');
    expect(html).toContain('id="grocery-add-food"');
    expect(html).not.toContain('id="grocery-add-food-st-1"');
    expect(html).toContain('commandfor="grocery-clear-checked"');
    expect(html).toContain('action="/grocery/clear-checked"');
    expect(html).toContain("grocery-clear-checked");
    expect(html).not.toMatch(/<details class="more"/);
});

test("grocery header actions and modals match fridge patterns", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        canManage: true,
        locations: [{ id: "l1", name: "Fridge" }],
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Corner",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-other",
                        householdId: HH,
                        storeId: "st-1",
                        name: "Other",
                        sortOrder: 8,
                        hidden: false,
                        isOther: true,
                        lines: [
                            {
                                id: "line-1",
                                householdId: HH,
                                storeId: "st-1",
                                sectionId: "sec-other",
                                kind: "food",
                                displayName: "Milk",
                                quantity: { amount: 1, unit: "each" },
                                foodId: "f-1",
                                checked: true,
                                alreadyHave: null,
                            },
                        ],
                    },
                ],
            },
        ],
    } as never);
    expect(html).toContain('<header class="dash-head">');
    expect(html).toContain('commandfor="grocery-add-store"');
    expect(html).toContain('commandfor="grocery-clear-checked"');
    expect(html).toMatch(
        /<button type="button" class="btn-sm btn-danger" commandfor="grocery-clear-checked"/,
    );
    expect(html).toContain('<div class="grocery-line-put-away">');
    expect(html).toContain("Remove every checked item from the list?");
    expect(html).toContain('commandfor="grocery-add-food"');
    expect(html).toContain('data-fill-field-store_id="st-1"');
    expect(html).toContain('<form class="grocery-put-away row-actions"');
    expect(html).not.toMatch(/<details class="more"/);
});

test("member grocery page has no add-store trigger or form", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        canManage: false,
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Corner",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-other",
                        householdId: HH,
                        storeId: "st-1",
                        name: "Other",
                        sortOrder: 8,
                        hidden: false,
                        isOther: true,
                        lines: [
                            {
                                id: "line-1",
                                householdId: HH,
                                storeId: "st-1",
                                sectionId: "sec-other",
                                kind: "food",
                                displayName: "Milk",
                                quantity: { amount: 1, unit: "each" },
                                foodId: "f-1",
                                checked: true,
                                alreadyHave: null,
                            },
                        ],
                    },
                ],
            },
        ],
    } as never);
    expect(html).not.toContain('commandfor="grocery-add-store"');
    expect(html).not.toContain("grocery-add-store");
});

test("a server error reopens the grocery modal that submitted the form", () => {
    const addStore = renderGroceryPage({
        chrome: groceryChrome,
        stores: [],
        canManage: true,
        error: "Enter a store name.",
        openModalId: "grocery-add-store",
    });
    expect(addStore).toMatch(
        /<dialog class="modal" id="grocery-add-store"[^>]*data-modal-open-on-load/,
    );
    const clearChecked = renderGroceryPage({
        chrome: groceryChrome,
        canManage: true,
        locations: [{ id: "l1", name: "Fridge" }],
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Corner",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-other",
                        householdId: HH,
                        storeId: "st-1",
                        name: "Other",
                        sortOrder: 8,
                        hidden: false,
                        isOther: true,
                        lines: [
                            {
                                id: "line-1",
                                householdId: HH,
                                storeId: "st-1",
                                sectionId: "sec-other",
                                kind: "food",
                                displayName: "Milk",
                                quantity: { amount: 1, unit: "each" },
                                foodId: "f-1",
                                checked: true,
                                alreadyHave: null,
                            },
                        ],
                    },
                ],
            },
        ],
        error: "Could not clear.",
        openModalId: "grocery-clear-checked",
    } as never);
    expect(clearChecked).toMatch(
        /<dialog class="modal" id="grocery-clear-checked"[^>]*data-modal-open-on-load/,
    );
    const addFood = renderGroceryPage({
        chrome: groceryChrome,
        canManage: true,
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Corner",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-other",
                        householdId: HH,
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
        error: "Pick a food.",
        openModalId: "grocery-add-food-st-1",
    } as never);
    expect(addFood).toMatch(
        /<dialog class="modal" id="grocery-add-food"[^>]*data-modal-open-on-load/,
    );
    expect(addFood).not.toContain('id="grocery-add-food-st-1"');
    const foodDialog = dialogHtml(addFood, "grocery-add-food");
    expect(foodDialog).toContain('name="store_id" value="st-1"');
    expect(foodDialog).toContain("data-grocery-section");
    expect(foodDialog).toContain('data-infer-section="sec-other"');
    expect(foodDialog).toContain('<label for="grocery-add-section">');
    expect(foodDialog).toContain("error-banner");
    expect(foodDialog).toContain("Pick a food.");
    expect(addFood.match(/Pick a food\./g)?.length).toBe(1);
    expect(foodDialog).toContain('<button type="submit" class="btn-primary">');
    expect(foodDialog).not.toContain('name="section_id"');
});

test("add-food modal contains the section select with picker forms", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Corner",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-produce",
                        householdId: HH,
                        storeId: "st-1",
                        name: "Produce",
                        sortOrder: 0,
                        hidden: false,
                        isOther: false,
                        lines: [],
                    },
                    {
                        id: "sec-other",
                        householdId: HH,
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
    } as never);
    const modal = dialogHtml(html, "grocery-add-food");
    expect(modal).toContain('class="food-picker"');
    expect(modal).toContain('action=""');
    expect(modal).toContain(
        '<button type="submit" class="btn-primary" disabled>',
    );
    expect(modal).not.toContain("data-grocery-section");
    expect(modal).not.toContain('name="section_id"');
    expect(html).toContain(
        'data-fill-template-sections="grocery-sections-st-1"',
    );
    expect(html).toContain('<template id="grocery-sections-st-1">');
    expect(html).toContain("data-grocery-section");
    expect(html).toContain('data-infer-section="sec-other"');
    expect(html).toContain('value="sec-produce"');
    expect(html).toContain('for="grocery-add-section"');
    expect(html).not.toContain("popovertarget=");
    expect(html).toContain('data-fill-action="/grocery/lines"');
});

test("owner with no stores does not auto-open the add-store modal", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        stores: [],
        canManage: true,
    });
    expect(html).toContain('id="grocery-add-store"');
    expect(html).not.toMatch(
        /<dialog class="modal" id="grocery-add-store"[^>]*data-modal-open-on-load/,
    );
    expect(html).toContain('commandfor="grocery-add-store"');
});

test("blocking allergen warning and Add anyway form render inside the reopened add-food modal", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Corner",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-other",
                        householdId: HH,
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
        allergenWarning: "Peanut allergen for Bob.",
        openModalId: "grocery-add-food-st-1",
        allergenRetry: {
            storeId: "st-1",
            fields: {
                kind: "food",
                store_id: "st-1",
                food_name: "Peanut Butter",
                qty_amount: "1",
                qty_unit: "each",
            },
        },
    } as never);
    expect(html).not.toMatch(
        /<header class="dash-head">[\s\S]*class="allergen-warning"/,
    );
    const modal = dialogHtml(html, "grocery-add-food");
    expect(modal).toContain('class="allergen-warning"');
    expect(modal).toContain("data-fill-transient");
    expect(modal).toContain('name="confirm_allergen" value="1"');
    expect(modal).toContain("Add anyway");
    expect(modal).toContain('name="food_name" value="Peanut Butter"');
    expect(modal).toContain('name="store_id" value="st-1"');
    expect(html).not.toContain('id="grocery-add-food-st-1"');
});

function dialogHtml(html: string, id: string): string {
    const dialog = html.match(
        new RegExp(`<dialog class="modal" id="${id}"[\\s\\S]*?</dialog>`),
    )?.[0];
    expect(dialog).toBeDefined();
    return dialog!;
}

test("add-food dialog count does not grow with stores", () => {
    function page(count: number) {
        const stores = Array.from({ length: count }, (_, index) => ({
            id: `st-${index + 1}`,
            householdId: HH,
            name: `Store ${index + 1}`,
            sortOrder: index,
            rules: [],
            sections: [
                {
                    id: `sec-st-${index + 1}`,
                    householdId: HH,
                    storeId: `st-${index + 1}`,
                    name:
                        index === count - 1
                            ? `"><img src=x onerror=alert(1)>`
                            : "Produce",
                    sortOrder: 0,
                    hidden: false,
                    isOther: false,
                    lines: [],
                },
            ],
        }));
        return renderGroceryPage({
            chrome: groceryChrome,
            canManage: true,
            stores,
        } as never);
    }
    const one = page(1);
    const six = page(6);
    const dialogs = (html: string) => html.match(/<dialog\b/g)?.length ?? 0;
    expect(dialogs(one)).toBe(dialogs(six));
    expect(dialogs(one)).toBe(2);
    expect(six.match(/id="grocery-add-food"/g)?.length).toBe(1);
    expect(six.match(/data-food-picker/g)?.length).toBe(1);
    expect(six.match(/commandfor="grocery-add-food"/g)?.length).toBe(7);
    expect(six).toContain('data-fill-field-store_id="st-6"');
    expect(six).toContain(
        'data-fill-template-sections="grocery-sections-st-6"',
    );
    expect(six).toContain('<template id="grocery-sections-st-6">');
    expect(six).toContain('value="sec-st-6"');
    expect(six).not.toContain('id="grocery-add-food-st-1"');
    expect(six).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
    expect(six).not.toContain('"><img src=x');
    expect(six).not.toContain("onerror=alert(1)>");
    expect(dialogHtml(six, "grocery-add-food")).toContain(
        '<button type="submit" class="btn-primary" disabled>',
    );
    expect(dialogHtml(six, "grocery-add-food")).not.toContain(
        "data-grocery-section",
    );

    const reopened = renderGroceryPage({
        chrome: groceryChrome,
        canManage: true,
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Safeway",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-produce",
                        householdId: HH,
                        storeId: "st-1",
                        name: "Produce",
                        sortOrder: 0,
                        hidden: false,
                        isOther: false,
                        lines: [],
                    },
                    {
                        id: "sec-other",
                        householdId: HH,
                        storeId: "st-1",
                        name: "Other",
                        sortOrder: 8,
                        hidden: false,
                        isOther: true,
                        lines: [],
                    },
                ],
            },
            {
                id: "st-2",
                householdId: HH,
                name: "Costco",
                sortOrder: 1,
                rules: [],
                sections: [
                    {
                        id: "sec-dairy",
                        householdId: HH,
                        storeId: "st-2",
                        name: "Dairy",
                        sortOrder: 0,
                        hidden: false,
                        isOther: false,
                        lines: [],
                    },
                ],
            },
        ],
        error: "Pick a food.",
        openModalId: "grocery-add-food-st-2",
    } as never);
    const costco = dialogHtml(reopened, "grocery-add-food");
    expect(costco).toMatch(/data-modal-open-on-load/);
    expect(costco).toContain('data-filled-template="grocery-sections-st-2"');
    expect(costco).toContain('value="sec-dairy"');
    expect(costco).toContain(">Dairy</option>");
    expect(costco).not.toContain("sec-produce");
    expect(costco).not.toContain("data-infer-section");
    expect(costco).toContain(
        '<input type="hidden" name="section_id" value="sec-dairy" data-grocery-section-field />',
    );
    expect(costco).toContain('name="store_id" value="st-2"');
    expect(costco).toContain("Pick a food.");
    expect(reopened.match(/Pick a food\./g)?.length).toBe(1);
    expect(reopened).toContain('<template id="grocery-sections-st-1">');
    expect(reopened).toContain('value="sec-produce"');
    expect(reopened).toContain(
        'data-fill-template-sections="grocery-sections-st-1"',
    );
});
