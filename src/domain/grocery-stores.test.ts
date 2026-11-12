import { expect, test } from "bun:test";
import {
    addGroceryManualFood,
    createMemoryGroceryStore,
    pickGroceryStore,
    type GroceryLine,
} from "./grocery.js";
import { createMemoryFoodsStore } from "./foods.js";
import { createMemoryNoticeDismissalsStore } from "./notice-dismissals.js";
import {
    createMemoryStoreManagement,
    deleteStore,
    destinationSectionId,
    planStoreDeletion,
    reorderStores,
    saveGroceryPreferences,
} from "./grocery-stores.js";
import {
    createGroceryStore,
    createMemorySettingsStore,
    groceryPreferencesFromJson,
    SettingsInputError,
    type GrocerySection,
    type GroceryStore,
} from "./settings.js";

const HH = "hh-1";
const stores: GroceryStore[] = [
    { id: "a", householdId: HH, name: "A", sortOrder: 0 },
    { id: "b", householdId: HH, name: "B", sortOrder: 1 },
    { id: "c", householdId: HH, name: "C", sortOrder: 2 },
];
const off = { defaultStoreId: "c", useUsualStore: false };
const on = { defaultStoreId: "c", useUsualStore: true };

function section(
    id: string,
    storeId: string,
    name: string,
    isOther = false,
): GrocerySection {
    return {
        id,
        householdId: HH,
        storeId,
        name,
        sortOrder: 0,
        hidden: false,
        isOther,
    };
}

function line(id: string, storeId: string, sectionId: string): GroceryLine {
    return {
        id,
        householdId: HH,
        storeId,
        sectionId,
        kind: "food",
        displayName: id,
        quantity: { amount: 1, unit: "each" },
        foodId: null,
        checked: false,
        source: "manual",
        sourceFridgeItemId: null,
        note: null,
    };
}

test("groceryPreferencesFromJson reads the two keys and ignores the rest", () => {
    expect(groceryPreferencesFromJson(null)).toEqual({
        defaultStoreId: null,
        useUsualStore: false,
    });
    expect(
        groceryPreferencesFromJson({
            "grocery.default_store_id": " s1 ",
            "grocery.use_usual_store": true,
            restock: {},
        }),
    ).toEqual({ defaultStoreId: "s1", useUsualStore: true });
    expect(
        groceryPreferencesFromJson({
            "grocery.default_store_id": 7,
            "grocery.use_usual_store": "yes",
        }),
    ).toEqual({ defaultStoreId: null, useUsualStore: false });
});

test("pickGroceryStore with the switch off: usual, list history, then the default store", () => {
    const base = { chosenStoreId: null, stores, lines: [], foodId: null };
    // A saved default store replaces the first-store fallback.
    expect(
        pickGroceryStore({ ...base, usualStoreId: null, prefs: off }),
    ).toEqual({ storeId: "c", reason: "preferred" });
    // With no default saved, or the switch's default unset, it is today's pick.
    expect(pickGroceryStore({ ...base, usualStoreId: null })).toEqual({
        storeId: "a",
        reason: "default",
    });
    expect(
        pickGroceryStore({
            ...base,
            usualStoreId: null,
            prefs: { defaultStoreId: null, useUsualStore: false },
        }),
    ).toEqual({ storeId: "a", reason: "default" });
    // A default store that no longer exists falls back to the first store.
    expect(
        pickGroceryStore({
            ...base,
            usualStoreId: null,
            prefs: { defaultStoreId: "gone", useUsualStore: false },
        }),
    ).toEqual({ storeId: "a", reason: "default" });
    expect(
        pickGroceryStore({ ...base, usualStoreId: "b", prefs: off }),
    ).toEqual({ storeId: "b", reason: "usual" });
    // The list history still beats the default store while the switch is off.
    expect(
        pickGroceryStore({
            ...base,
            usualStoreId: null,
            foodId: "f",
            lines: [{ ...line("l", "b", "s"), foodId: "f" }],
            prefs: off,
        }),
    ).toEqual({ storeId: "b", reason: "list" });
});

test("pickGroceryStore with the switch on: usual, then default store, then the rest", () => {
    const base = { chosenStoreId: null, stores, lines: [], foodId: null };
    expect(pickGroceryStore({ ...base, usualStoreId: "b", prefs: on })).toEqual(
        { storeId: "b", reason: "usual" },
    );
    expect(
        pickGroceryStore({ ...base, usualStoreId: null, prefs: on }),
    ).toEqual({ storeId: "c", reason: "preferred" });
    expect(
        pickGroceryStore({ ...base, usualStoreId: "gone", prefs: on }),
    ).toEqual({ storeId: "c", reason: "preferred" });
    // A chosen store still wins; a stale default falls through to today's rule.
    expect(
        pickGroceryStore({
            ...base,
            chosenStoreId: "a",
            usualStoreId: "b",
            prefs: on,
        }),
    ).toEqual({ storeId: "a", reason: "chosen" });
    expect(
        pickGroceryStore({
            ...base,
            usualStoreId: null,
            prefs: { defaultStoreId: "gone", useUsualStore: true },
        }),
    ).toEqual({ storeId: "a", reason: "default" });
    // The default store beats a store the food was last listed at.
    expect(
        pickGroceryStore({
            ...base,
            usualStoreId: null,
            foodId: "f",
            lines: [{ ...line("l", "b", "s"), foodId: "f" }],
            prefs: on,
        }),
    ).toEqual({ storeId: "c", reason: "preferred" });
    expect(
        pickGroceryStore({
            ...base,
            usualStoreId: null,
            foodId: "f",
            lines: [{ ...line("l", "b", "s"), foodId: "f" }],
            prefs: off,
        }),
    ).toEqual({ storeId: "b", reason: "list" });
});

test("destinationSectionId matches by name, else the Other section", () => {
    const from = [section("s1", "a", "Dairy"), section("s2", "a", "Pantry")];
    const to = [section("t1", "b", "dairy"), section("t2", "b", "Other", true)];
    expect(destinationSectionId(from, to, { sectionId: "s1" })).toBe("t1");
    expect(destinationSectionId(from, to, { sectionId: "s2" })).toBe("t2");
    expect(() =>
        destinationSectionId(from, [section("t1", "b", "Dairy")], {
            sectionId: "s2",
        }),
    ).toThrow(SettingsInputError);
});

test("planStoreDeletion: move N lines, delete N lines, clear the default", () => {
    const sectionsByStore = new Map([
        ["a", [section("a1", "a", "Dairy"), section("a2", "a", "Other", true)]],
        ["b", [section("b1", "b", "Dairy"), section("b2", "b", "Other", true)]],
    ]);
    const lines = [
        line("l1", "a", "a1"),
        line("l2", "a", "a2"),
        line("l3", "b", "b1"),
    ];
    const common = { stores, sectionsByStore, lines };
    expect(
        planStoreDeletion({
            ...common,
            storeId: "a",
            moveTo: "b",
            prefs: { defaultStoreId: "a", useUsualStore: false },
        }),
    ).toEqual({
        storeId: "a",
        moveTo: "b",
        moves: [
            { lineId: "l1", sectionId: "b1" },
            { lineId: "l2", sectionId: "b2" },
        ],
        deleteLineIds: [],
        clearDefault: true,
    });
    expect(
        planStoreDeletion({
            ...common,
            storeId: "a",
            prefs: off,
        }),
    ).toEqual({
        storeId: "a",
        moveTo: null,
        moves: [],
        deleteLineIds: ["l1", "l2"],
        clearDefault: false,
    });
    expect(
        planStoreDeletion({
            ...common,
            storeId: "c",
            prefs: off,
        }),
    ).toMatchObject({ moves: [], deleteLineIds: [], clearDefault: true });
    for (const [storeId, moveTo] of [
        ["a", "a"],
        ["a", "zzz"],
        ["zzz", undefined],
    ] as const) {
        expect(() =>
            planStoreDeletion({ ...common, storeId, moveTo, prefs: off }),
        ).toThrow(SettingsInputError);
    }
});

test("a line with no store lands in the default store, with the switch on or off", async () => {
    const settings = createMemorySettingsStore();
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const first = await createGroceryStore(settings, HH, "First");
    const second = await createGroceryStore(settings, HH, "Second");

    const before = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        name: "Oats",
        amount: 1,
        unit: "each",
    });
    expect(before.storeId).toBe(first.id);

    await saveGroceryPreferences(settings, HH, { defaultStoreId: second.id });
    const stillOff = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        name: "Rice",
        amount: 1,
        unit: "each",
    });
    expect(stillOff.storeId).toBe(second.id);

    await saveGroceryPreferences(settings, HH, { useUsualStore: true });
    const on = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        name: "Beans",
        amount: 1,
        unit: "each",
    });
    expect(on.storeId).toBe(second.id);
});

test("deleteStore then the default store is gone from the preference and the pick", async () => {
    const settings = createMemorySettingsStore();
    const grocery = createMemoryGroceryStore();
    const management = createMemoryStoreManagement(settings, grocery);
    const a = await createGroceryStore(settings, HH, "A");
    const b = await createGroceryStore(settings, HH, "B");
    await saveGroceryPreferences(settings, HH, {
        defaultStoreId: b.id,
        useUsualStore: true,
    });
    const result = await deleteStore(
        { management, settings, grocery },
        HH,
        b.id,
    );
    expect(result.clearedDefault).toBe(true);
    expect(await settings.getGroceryPreferences(HH)).toEqual({
        defaultStoreId: null,
        useUsualStore: true,
    });
    expect((await settings.listStores(HH)).map((s) => s.id)).toEqual([a.id]);
});

test("deleting a store in the memory twin clears foods' usual store and line dismissals", async () => {
    const settings = createMemorySettingsStore();
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const dismissals = createMemoryNoticeDismissalsStore();
    const management = createMemoryStoreManagement(settings, grocery, {
        foods,
        dismissals,
    });
    const a = await createGroceryStore(settings, HH, "A");
    const b = await createGroceryStore(settings, HH, "B");
    const rice = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        name: "Rice",
        amount: 1,
        unit: "each",
        storeId: b.id,
    });
    const food = (await foods.listFoods(HH))[0]!;
    await foods.updateFoodRow({ ...food, usualStoreId: b.id });
    await dismissals.insert({
        householdId: HH,
        code: "grocery_line_dup",
        subjectKind: "grocery_line",
        subjectId: rice.id,
        relatedKey: "",
    } as never);
    await deleteStore({ management, settings, grocery }, HH, b.id);
    expect((await foods.listFoods(HH))[0]!.usualStoreId).toBeNull();
    expect(await dismissals.listForHousehold(HH)).toEqual([]);
    expect((await settings.listStores(HH)).map((s) => s.id)).toEqual([a.id]);
});

test("reorderStores returns the stores in the new order", async () => {
    const settings = createMemorySettingsStore();
    const grocery = createMemoryGroceryStore();
    const management = createMemoryStoreManagement(settings, grocery);
    const a = await createGroceryStore(settings, HH, "A");
    const b = await createGroceryStore(settings, HH, "B");
    const listed = await reorderStores({ management, settings }, HH, [
        b.id,
        a.id,
    ]);
    expect(listed.map((s) => [s.id, s.sortOrder])).toEqual([
        [b.id, 0],
        [a.id, 1],
    ]);
});
