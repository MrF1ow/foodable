import { FIXTURE_APP_CHROME_FLAGS } from "../test-support/chrome-flags.js";
import { expect, test } from "bun:test";
import {
    createMemoryFoodsStore,
    effectiveFoodsByIds,
    newFood,
} from "./foods.js";
import { createMemoryGroceryStore, type GroceryLine } from "./grocery.js";
import {
    createMemoryNoticeDismissalsStore,
    dismissedKeySet,
} from "./notice-dismissals.js";
import {
    dismissNotice,
    noticesFor,
    type NoticesForDeps,
} from "./notices-for.js";
import { noticeCodeDismissible, noticeSentence } from "../copy/notices.js";
import {
    createGroceryStore,
    createMemorySettingsStore,
    type GroceryPreferences,
} from "./settings.js";
import { createMemoryRecipesStore } from "./recipes.js";
import { renderGroceryPage } from "../web/pages/grocery.js";
import {
    EMPTY_HOUSEHOLD_PREFERENCES,
    type HouseholdPreferences,
} from "../household.js";
import { householdTimezone } from "../household.js";
import {
    createMemoryRestockStore,
    groceryRestockNotices,
    localClock,
    restockDue,
    restockPlan,
    runRestockCheck,
    usualsList,
    type RestockCheckDeps,
} from "./restock.js";
import type { FridgeItem } from "./fridge.js";
import { addLocation, createMemoryFridgeStore } from "./fridge.js";
import { addFridgeItemAdjust, createMemoryStockStore } from "./stock.js";

const HH = "hh-restock";
const TODAY = "2026-06-01";

function addDays(iso: string, days: number): string {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

function fridgeFood(
    over: Partial<FridgeItem> & Pick<FridgeItem, "id" | "foodId" | "expiresOn">,
): FridgeItem {
    return {
        householdId: HH,
        kind: "food",
        displayName: "Item",
        quantity: { amount: 1, unit: "each" },
        locationId: "loc",
        openedOn: null,
        purchasedOn: null,
        ...over,
    };
}

async function seedCostco() {
    const settings = createMemorySettingsStore();
    const store = await createGroceryStore(settings, HH, "Costco");
    const sections = await settings.listSections(store.id);
    return { settings, store, sections };
}

async function planForEggs(
    expiresOn: string,
    opts?: {
        dismissed?: boolean;
        extraFridge?: FridgeItem[];
        lines?: GroceryLine[];
        usualStoreId?: string;
        usualAmount?: { amount: number; unit: string };
        productName?: string;
        /** `defaultStoreId: "second"` stands for the store made by `secondStore`. */
        groceryPreferences?: GroceryPreferences;
        secondStore?: boolean;
    },
) {
    const foods = createMemoryFoodsStore();
    const plain = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            usualStoreId: opts?.usualStoreId,
            usualAmount: opts?.usualAmount ?? { amount: 24, unit: "each" },
        }),
    );
    const kirkland = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: opts?.productName ?? "Kirkland Eggs",
            genericFoodId: plain.id,
            usualStoreId: opts?.usualStoreId ?? plain.usualStoreId,
            usualAmount: opts?.usualAmount ?? plain.usualAmount,
        }),
    );
    const { settings, store, sections: costcoSections } = await seedCostco();
    const second = opts?.secondStore
        ? await createGroceryStore(settings, HH, "Aldi")
        : undefined;
    const sections = second
        ? [...costcoSections, ...(await settings.listSections(second.id))]
        : costcoSections;
    const eff = await effectiveFoodsByIds(foods, HH, [plain.id, kirkland.id]);
    const items: FridgeItem[] = [
        fridgeFood({
            id: "due-k",
            foodId: kirkland.id,
            expiresOn,
            displayName: kirkland.name,
        }),
        ...(opts?.extraFridge ?? []),
    ];
    const dismissals = createMemoryNoticeDismissalsStore();
    if (opts?.dismissed) {
        await dismissals.insert({
            householdId: HH,
            code: "fridge.expiring",
            subjectKind: "fridge_item",
            subjectId: "due-k",
            relatedKey: "",
            dismissedBy: "u1",
        });
    }
    const plan = restockPlan({
        items,
        foodsById: eff,
        lines: opts?.lines ?? [],
        dismissed: dismissedKeySet(await dismissals.listForHousehold(HH)),
        today: TODAY,
        stores: second ? [store, second] : [store],
        sections,
        householdId: HH,
        groceryPreferences:
            opts?.groceryPreferences?.defaultStoreId === "second"
                ? { ...opts.groceryPreferences, defaultStoreId: second!.id }
                : opts?.groceryPreferences,
    });
    return { ...plan, firstStoreId: store.id, secondStoreId: second?.id };
}

test("restockPlan places a food with no usual store at the default store, switch on or off", async () => {
    const run = (useUsualStore: boolean) =>
        planForEggs(addDays(TODAY, 3), {
            secondStore: true,
            groceryPreferences: { defaultStoreId: "second", useUsualStore },
        });
    const off = await run(false);
    const on = await run(true);
    expect(off.lines).toHaveLength(1);
    expect(on.lines).toHaveLength(1);
    expect(off.lines[0]!.storeId).toBe(off.secondStoreId!);
    expect(on.lines[0]!.storeId).toBe(on.secondStoreId!);
    // With no default saved it is still the first store.
    const none = await planForEggs(addDays(TODAY, 3), { secondStore: true });
    expect(none.lines[0]!.storeId).toBe(none.firstStoreId);
});

test("restockPlan adds item expiring in 3 days", async () => {
    const { lines } = await planForEggs(addDays(TODAY, 3));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.displayName).toBe("Eggs");
    expect(lines[0]!.source).toBe("restock");
});

test("restockPlan skips 8 days and expired", async () => {
    expect((await planForEggs(addDays(TODAY, 8))).lines).toHaveLength(0);
    expect((await planForEggs(addDays(TODAY, -1))).lines).toHaveLength(0);
});

test("restockPlan skips dismissed expiring notice", async () => {
    expect(
        (await planForEggs(addDays(TODAY, 2), { dismissed: true })).lines,
    ).toHaveLength(0);
});

test("restockPlan one Eggs line for two products at usual amount", async () => {
    const foods = createMemoryFoodsStore();
    const plain = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            usualAmount: { amount: 24, unit: "each" },
        }),
    );
    const k = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Kirkland",
            genericFoodId: plain.id,
        }),
    );
    const gv = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Great Value",
            genericFoodId: plain.id,
        }),
    );
    const { store, sections } = await seedCostco();
    const eff = await effectiveFoodsByIds(foods, HH, [plain.id, k.id, gv.id]);
    const plan = restockPlan({
        items: [
            fridgeFood({ id: "a", foodId: k.id, expiresOn: addDays(TODAY, 2) }),
            fridgeFood({
                id: "b",
                foodId: gv.id,
                expiresOn: addDays(TODAY, 4),
            }),
        ],
        foodsById: eff,
        lines: [],
        dismissed: dismissedKeySet([]),
        today: TODAY,
        stores: [store],
        sections,
        householdId: HH,
    });
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]!.quantity).toEqual({ amount: 24, unit: "each" });
});

test("restockPlan skips family with unchecked grocery line", async () => {
    const foods = createMemoryFoodsStore();
    const plain = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    const product = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Kirkland",
            genericFoodId: plain.id,
        }),
    );
    const { store, sections } = await seedCostco();
    const eff = await effectiveFoodsByIds(foods, HH, [plain.id, product.id]);
    const base: GroceryLine = {
        id: "g1",
        householdId: HH,
        storeId: store.id,
        sectionId: sections[0]!.id,
        kind: "food",
        displayName: "Eggs",
        quantity: { amount: 1, unit: "each" },
        foodId: plain.id,
        checked: false,
        source: "manual",
        sourceFridgeItemId: null,
        note: null,
    };
    const item = fridgeFood({
        id: "due-k",
        foodId: product.id,
        expiresOn: addDays(TODAY, 2),
    });
    const input = {
        items: [item],
        foodsById: eff,
        today: TODAY,
        stores: [store],
        sections,
        householdId: HH,
        dismissed: dismissedKeySet([]),
    };
    expect(restockPlan({ ...input, lines: [base] }).lines).toHaveLength(0);
    expect(
        restockPlan({ ...input, lines: [{ ...base, id: "g2", checked: true }] })
            .lines,
    ).toHaveLength(1);
});

test("restockPlan fresh stock skips family with undated sibling product", async () => {
    const foods = createMemoryFoodsStore();
    const plain = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    const kirkland = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Kirkland Eggs",
            genericFoodId: plain.id,
        }),
    );
    const greatValue = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Great Value Eggs",
            genericFoodId: plain.id,
        }),
    );
    const { store, sections } = await seedCostco();
    const eff = await effectiveFoodsByIds(foods, HH, [
        plain.id,
        kirkland.id,
        greatValue.id,
    ]);
    expect(
        restockPlan({
            items: [
                fridgeFood({
                    id: "k",
                    foodId: kirkland.id,
                    expiresOn: addDays(TODAY, 3),
                }),
                fridgeFood({
                    id: "gv",
                    foodId: greatValue.id,
                    expiresOn: null,
                    displayName: "Great Value Eggs",
                }),
            ],
            foodsById: eff,
            lines: [],
            dismissed: dismissedKeySet([]),
            today: TODAY,
            stores: [store],
            sections,
            householdId: HH,
        }).lines,
    ).toHaveLength(0);
});

test("restockPlan fresh stock skips family", async () => {
    const foods = createMemoryFoodsStore();
    const plain = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Milk" }),
    );
    const { store, sections } = await seedCostco();
    const eff = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const exp = addDays(TODAY, 3);
    const fresh = addDays(TODAY, 10);
    expect(
        restockPlan({
            items: [
                fridgeFood({ id: "e", foodId: plain.id, expiresOn: exp }),
                fridgeFood({ id: "f", foodId: plain.id, expiresOn: fresh }),
            ],
            foodsById: eff,
            lines: [],
            dismissed: dismissedKeySet([]),
            today: TODAY,
            stores: [store],
            sections,
            householdId: HH,
        }).lines,
    ).toHaveLength(0);
    expect(
        restockPlan({
            items: [
                fridgeFood({ id: "e2", foodId: plain.id, expiresOn: exp }),
                fridgeFood({
                    id: "u",
                    foodId: plain.id,
                    expiresOn: null,
                    displayName: "Milk",
                }),
            ],
            foodsById: eff,
            lines: [],
            dismissed: dismissedKeySet([]),
            today: TODAY,
            stores: [store],
            sections,
            householdId: HH,
        }).lines,
    ).toHaveLength(0);
    expect(
        restockPlan({
            items: [
                fridgeFood({ id: "e3", foodId: plain.id, expiresOn: exp }),
                fridgeFood({
                    id: "old",
                    foodId: plain.id,
                    expiresOn: addDays(TODAY, -2),
                }),
            ],
            foodsById: eff,
            lines: [],
            dismissed: dismissedKeySet([]),
            today: TODAY,
            stores: [store],
            sections,
            householdId: HH,
        }).lines,
    ).toHaveLength(1);
});

test("restockPlan sums convertible amounts without usual", async () => {
    const foods = createMemoryFoodsStore();
    const plain = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Juice",
            gramsPerMl: 1,
        }),
    );
    const { store, sections } = await seedCostco();
    const eff = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const plan = restockPlan({
        items: [
            fridgeFood({
                id: "a",
                foodId: plain.id,
                expiresOn: addDays(TODAY, 2),
                quantity: { amount: 500, unit: "ml" },
            }),
            fridgeFood({
                id: "b",
                foodId: plain.id,
                expiresOn: addDays(TODAY, 4),
                quantity: { amount: 1000, unit: "ml" },
            }),
        ],
        foodsById: eff,
        lines: [],
        dismissed: dismissedKeySet([]),
        today: TODAY,
        stores: [store],
        sections,
        householdId: HH,
    });
    expect(plan.lines[0]!.quantity.amount).toBe(1500);
    expect(plan.lines[0]!.quantity.unit).toBe("ml");
});

test("restockPlan sums cross-unit volumes without usual", async () => {
    const foods = createMemoryFoodsStore();
    const plain = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Cream",
            gramsPerMl: 1,
        }),
    );
    const { store, sections } = await seedCostco();
    const eff = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const plan = restockPlan({
        items: [
            fridgeFood({
                id: "cup",
                foodId: plain.id,
                expiresOn: addDays(TODAY, 1),
                quantity: { amount: 1, unit: "cup" },
            }),
            fridgeFood({
                id: "ml",
                foodId: plain.id,
                expiresOn: addDays(TODAY, 3),
                quantity: { amount: 240, unit: "ml" },
            }),
        ],
        foodsById: eff,
        lines: [],
        dismissed: dismissedKeySet([]),
        today: TODAY,
        stores: [store],
        sections,
        householdId: HH,
    });
    expect(plan.lines[0]!.quantity).toEqual({ amount: 2, unit: "cup" });
});

test("restockPlan sums each and mass without usual", async () => {
    const foods = createMemoryFoodsStore();
    const plain = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Bars",
            gramsPerEach: 50,
        }),
    );
    const { store, sections } = await seedCostco();
    const eff = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const plan = restockPlan({
        items: [
            fridgeFood({
                id: "each",
                foodId: plain.id,
                expiresOn: addDays(TODAY, 1),
                quantity: { amount: 2, unit: "each" },
            }),
            fridgeFood({
                id: "g",
                foodId: plain.id,
                expiresOn: addDays(TODAY, 2),
                quantity: { amount: 100, unit: "g" },
            }),
        ],
        foodsById: eff,
        lines: [],
        dismissed: dismissedKeySet([]),
        today: TODAY,
        stores: [store],
        sections,
        householdId: HH,
    });
    expect(plan.lines[0]!.quantity).toEqual({ amount: 4, unit: "each" });
});

test("restockPlan uses soonest amount when units do not convert", async () => {
    const foods = createMemoryFoodsStore();
    const plain = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Thing" }),
    );
    const { store, sections } = await seedCostco();
    const eff = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const plan = restockPlan({
        items: [
            fridgeFood({
                id: "s",
                foodId: plain.id,
                expiresOn: addDays(TODAY, 1),
                quantity: { amount: 3, unit: "each" },
            }),
            fridgeFood({
                id: "t",
                foodId: plain.id,
                expiresOn: addDays(TODAY, 3),
                quantity: { amount: 200, unit: "g" },
            }),
        ],
        foodsById: eff,
        lines: [],
        dismissed: dismissedKeySet([]),
        today: TODAY,
        stores: [store],
        sections,
        householdId: HH,
    });
    expect(plan.lines[0]!.quantity).toEqual({ amount: 3, unit: "each" });
    expect(plan.lines[0]!.sourceFridgeItemId).toBe("s");
});

test("restockPlan places at usual store", async () => {
    const { store, sections, settings } = await seedCostco();
    const foods = createMemoryFoodsStore();
    const eggs = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            usualStoreId: store.id,
            usualAmount: { amount: 12, unit: "each" },
        }),
    );
    const product = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Kirkland",
            genericFoodId: eggs.id,
            usualStoreId: store.id,
        }),
    );
    const eff = await effectiveFoodsByIds(foods, HH, [eggs.id, product.id]);
    const plan = restockPlan({
        items: [
            fridgeFood({
                id: "due",
                foodId: product.id,
                expiresOn: addDays(TODAY, 2),
            }),
        ],
        foodsById: eff,
        lines: [],
        dismissed: dismissedKeySet([]),
        today: TODAY,
        stores: [store],
        sections,
        householdId: HH,
    });
    expect(plan.lines[0]!.storeId).toBe(store.id);
});

test("restockPlan empty when no stores", async () => {
    const { lines } = await planForEggs(addDays(TODAY, 2));
    const foods = createMemoryFoodsStore();
    const plain = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "X" }),
    );
    const eff = await effectiveFoodsByIds(foods, HH, [plain.id]);
    expect(
        restockPlan({
            items: [
                fridgeFood({
                    id: "x",
                    foodId: plain.id,
                    expiresOn: addDays(TODAY, 2),
                }),
            ],
            foodsById: eff,
            lines: [],
            dismissed: dismissedKeySet([]),
            today: TODAY,
            stores: [],
            sections: [],
            householdId: HH,
        }).lines,
    ).toHaveLength(0);
    expect(lines).toHaveLength(1);
});

test("restockDue weekday time lastRunOn and enabled", () => {
    const restock = {
        enabled: true,
        weekday: 6,
        time: "07:00",
        lastRunOn: null,
    } as const;
    expect(
        restockDue(restock, { date: TODAY, weekday: 5, time: "08:00" }),
    ).toBe(false);
    expect(
        restockDue(restock, { date: TODAY, weekday: 6, time: "06:59" }),
    ).toBe(false);
    expect(
        restockDue(restock, { date: TODAY, weekday: 6, time: "07:00" }),
    ).toBe(true);
    expect(
        restockDue(
            { ...restock, lastRunOn: TODAY },
            { date: TODAY, weekday: 6, time: "12:00" },
        ),
    ).toBe(false);
    expect(
        restockDue(
            { ...restock, enabled: false },
            { date: TODAY, weekday: 6, time: "12:00" },
        ),
    ).toBe(false);
});

test("localClock matches dateInTz and household timezone precedence", () => {
    const spring = new Date("2026-03-08T12:30:00Z");
    const fall = new Date("2026-11-01T12:00:00Z");
    const hh = localClock(spring, "America/New_York");
    expect(hh.time).toBe("08:30");
    expect(hh.weekday).toBe(0);
    const owner = { timezone: "America/Los_Angeles" as const };
    const tz = householdTimezone({ timezone: "America/New_York" }, owner);
    expect(tz).toBe("America/New_York");
    expect(householdTimezone({ timezone: null }, owner)).toBe(
        "America/Los_Angeles",
    );
    const beforeRun = localClock(
        new Date("2026-03-08T06:30:00Z"),
        "America/New_York",
    );
    expect(beforeRun.time).toBe("01:30");
    expect(
        restockDue(
            { enabled: true, weekday: 0, time: "02:30", lastRunOn: null },
            beforeRun,
        ),
    ).toBe(false);
    const afterRun = localClock(
        new Date("2026-03-08T07:45:00Z"),
        "America/New_York",
    );
    expect(
        restockDue(
            { enabled: true, weekday: 0, time: "02:30", lastRunOn: null },
            afterRun,
        ),
    ).toBe(true);
    expect(
        restockDue(
            {
                enabled: true,
                weekday: 0,
                time: "02:30",
                lastRunOn: afterRun.date,
            },
            { ...afterRun, time: "03:30" },
        ),
    ).toBe(false);
    expect(localClock(fall, "America/New_York").weekday).toBe(0);
});

test("runRestockCheck memory commits lines and lastRunOn", async () => {
    const grocery = createMemoryGroceryStore();
    const fridge = createMemoryFridgeStore();
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const dismissals = createMemoryNoticeDismissalsStore();
    const { settings, store, sections } = await seedCostco();
    const plain = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Milk" }),
    );
    const stock = createMemoryStockStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: plain.id,
        amount: 1,
        unit: "l",
        locationId: loc.id,
        expiresOn: addDays("2026-06-06", 2),
        actorUserId: "u1",
    });
    let prefs: HouseholdPreferences = {
        ...EMPTY_HOUSEHOLD_PREFERENCES,
        restock: {
            enabled: true,
            weekday: 6,
            time: "00:00",
            lastRunOn: null,
        },
    };
    const restock = createMemoryRestockStore({
        grocery,
        getPrefs: () => prefs,
        setPrefs: (p) => {
            prefs = p;
        },
    });
    const logs: string[] = [];
    const sat = new Date("2026-06-06T15:00:00Z");
    const deps: RestockCheckDeps = {
        listEnabled: async () => [{ id: HH, preferences: prefs }],
        getOwnerProfile: async () => ({ timezone: "UTC" }),
        fridge,
        foods,
        grocery,
        settings,
        dismissals,
        restock,
        logger: { log: (m) => logs.push(m) },
    };
    await runRestockCheck(deps, sat);
    expect(prefs.restock.lastRunOn).toBe("2026-06-06");
    expect((await grocery.listLines(HH)).length).toBe(1);
    expect(logs[0]).toContain("added=1");
    expect(logs[0]).not.toContain("Milk");
    await runRestockCheck(deps, sat);
    expect((await grocery.listLines(HH)).length).toBe(1);
});

test("runRestockCheck skips a line a card added after the run read the list", async () => {
    const grocery = createMemoryGroceryStore();
    const fridge = createMemoryFridgeStore();
    const foods = createMemoryFoodsStore();
    const { settings } = await seedCostco();
    const plain = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Milk" }),
    );
    const stock = createMemoryStockStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: plain.id,
        amount: 1,
        unit: "l",
        locationId: loc.id,
        expiresOn: addDays("2026-06-06", 2),
        actorUserId: "u1",
    });
    let prefs: HouseholdPreferences = {
        ...EMPTY_HOUSEHOLD_PREFERENCES,
        restock: { enabled: true, weekday: 6, time: "00:00", lastRunOn: null },
    };
    const inner = createMemoryRestockStore({
        grocery,
        getPrefs: () => prefs,
        setPrefs: (p) => {
            prefs = p;
        },
    });
    const deps: RestockCheckDeps = {
        listEnabled: async () => [{ id: HH, preferences: prefs }],
        getOwnerProfile: async () => ({ timezone: "UTC" }),
        fridge,
        foods,
        grocery,
        settings,
        dismissals: createMemoryNoticeDismissalsStore(),
        restock: {
            // The run has read the (empty) list and planned its line; a card
            // add lands before the commit.
            async commitRestockRun(hh, on, lines, families) {
                const planned = lines[0]!;
                await grocery.insertLineUnlessListed(
                    { ...planned, id: crypto.randomUUID(), source: "manual" },
                    families!.get(planned.id)!,
                );
                return inner.commitRestockRun(hh, on, lines, families);
            },
        },
    };
    await runRestockCheck(deps, new Date("2026-06-06T15:00:00Z"));
    const lines = await grocery.listLines(HH);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.source).toBe("manual");
    expect(prefs.restock.lastRunOn).toBe("2026-06-06");
});

test("runRestockCheck rolls back on insert failure", async () => {
    const grocery = createMemoryGroceryStore();
    let fail = true;
    let prefs: HouseholdPreferences = {
        ...EMPTY_HOUSEHOLD_PREFERENCES,
        restock: {
            enabled: true,
            weekday: 6,
            time: "00:00",
            lastRunOn: null,
        },
    };
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const { settings } = await seedCostco();
    const plain = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Bread" }),
    );
    const stock = createMemoryStockStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: plain.id,
        amount: 1,
        unit: "each",
        locationId: loc.id,
        expiresOn: addDays("2026-06-06", 1),
        actorUserId: "u1",
    });
    const restock = createMemoryRestockStore({
        grocery,
        getPrefs: () => prefs,
        setPrefs: (p) => {
            prefs = p;
        },
        failOnInsert: () => {
            if (fail) throw new Error("boom");
        },
    });
    const deps: RestockCheckDeps = {
        listEnabled: async () => [{ id: HH, preferences: prefs }],
        getOwnerProfile: async () => ({ timezone: "UTC" }),
        fridge,
        foods,
        grocery,
        settings,
        dismissals: createMemoryNoticeDismissalsStore(),
        restock,
    };
    await runRestockCheck(deps, new Date("2026-06-06T12:00:00Z"));
    expect(prefs.restock.lastRunOn).toBeNull();
    fail = false;
    await runRestockCheck(deps, new Date("2026-06-06T12:00:00Z"));
    expect(prefs.restock.lastRunOn).toBe("2026-06-06");
});

test("groceryRestockNotices sentences and filtering", async () => {
    const line: GroceryLine = {
        id: "ln",
        householdId: HH,
        storeId: "s",
        sectionId: "sec",
        kind: "food",
        displayName: "Milk",
        quantity: { amount: 1, unit: "l" },
        foodId: "f",
        checked: false,
        source: "restock",
        sourceFridgeItemId: "fi",
        note: null,
    };
    const item = fridgeFood({
        id: "fi",
        foodId: "f",
        expiresOn: addDays(TODAY, 3),
        displayName: "Whole milk",
    });
    const n = groceryRestockNotices([line], [item], TODAY)[0]!;
    expect(noticeSentence(n)).toContain("Thursday");
    const todayItem = fridgeFood({
        id: "fi-today",
        foodId: "f",
        expiresOn: TODAY,
        displayName: "Whole milk",
    });
    expect(
        noticeSentence(
            groceryRestockNotices(
                [{ ...line, sourceFridgeItemId: todayItem.id }],
                [todayItem],
                TODAY,
            )[0]!,
        ),
    ).toContain("today");
    const tomorrow = addDays(TODAY, 1);
    const tomorrowItem = fridgeFood({
        id: "fi-tom",
        foodId: "f",
        expiresOn: tomorrow,
        displayName: "Whole milk",
    });
    expect(
        noticeSentence(
            groceryRestockNotices(
                [{ ...line, sourceFridgeItemId: tomorrowItem.id }],
                [tomorrowItem],
                TODAY,
            )[0]!,
        ),
    ).toContain("tomorrow");
    const expiredItem = fridgeFood({
        id: "fi-exp",
        foodId: "f",
        expiresOn: addDays(TODAY, -1),
        displayName: "Whole milk",
    });
    expect(
        noticeSentence(
            groceryRestockNotices(
                [{ ...line, sourceFridgeItemId: expiredItem.id }],
                [expiredItem],
                TODAY,
            )[0]!,
        ),
    ).toContain("expired");
    expect(
        noticeSentence(
            groceryRestockNotices(
                [{ ...line, sourceFridgeItemId: null }],
                [],
                TODAY,
            )[0]!,
        ),
    ).toBe("Added by restock");
    const undated = fridgeFood({
        id: "fi-undated",
        foodId: "f",
        expiresOn: null,
        displayName: "Whole milk",
    });
    expect(
        noticeSentence(
            groceryRestockNotices(
                [{ ...line, sourceFridgeItemId: undated.id }],
                [undated],
                TODAY,
            )[0]!,
        ),
    ).toBe("Added by restock");
    expect(noticeCodeDismissible("grocery.restocked")).toBe(true);
    expect(
        groceryRestockNotices([{ ...line, checked: true }], [item], TODAY),
    ).toHaveLength(0);
    expect(
        groceryRestockNotices([{ ...line, source: "manual" }], [item], TODAY),
    ).toHaveLength(0);
});

test("noticesFor and dismissNotice accept grocery.restocked", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const recipes = createMemoryRecipesStore();
    const dismissals = createMemoryNoticeDismissalsStore();
    const deps: NoticesForDeps = {
        foods,
        fridge,
        recipes,
        dismissals,
        grocery,
    };
    const line: GroceryLine = {
        id: "gl",
        householdId: HH,
        storeId: "s",
        sectionId: "sec",
        kind: "food",
        displayName: "Eggs",
        quantity: { amount: 1, unit: "each" },
        foodId: "food",
        checked: false,
        source: "restock",
        sourceFridgeItemId: null,
        note: null,
    };
    await grocery.insertLine(line);
    const open = await noticesFor(deps, HH, { today: TODAY });
    expect(open.notices.some((n) => n.code === "grocery.restocked")).toBe(true);
    await dismissNotice(
        deps,
        HH,
        "u",
        {
            code: "grocery.restocked",
            subjectKind: "grocery_line",
            subjectId: line.id,
        },
        { today: TODAY },
    );
    const after = await noticesFor(deps, HH, { today: TODAY });
    expect(after.notices.some((n) => n.code === "grocery.restocked")).toBe(
        false,
    );
});

test("grocery page renders Restocked badge via notices component", () => {
    const notice = groceryRestockNotices(
        [
            {
                id: "ln",
                householdId: HH,
                storeId: "s",
                sectionId: "sec",
                kind: "food",
                displayName: "Milk",
                quantity: { amount: 1, unit: "l" },
                foodId: "f",
                checked: false,
                source: "restock",
                sourceFridgeItemId: "fi",
                note: null,
            },
        ],
        [
            fridgeFood({
                id: "fi",
                foodId: "f",
                expiresOn: addDays(TODAY, 2),
                displayName: "Milk pint",
            }),
        ],
        TODAY,
    )[0]!;
    const html = renderGroceryPage({
        chrome: {
            theme: "system",
            attention: { count: 0, tabs: {} },
            flags: FIXTURE_APP_CHROME_FLAGS,
        },
        stores: [
            {
                id: "s",
                householdId: HH,
                name: "Store",
                sortOrder: 0,
                sections: [
                    {
                        id: "sec",
                        householdId: HH,
                        storeId: "s",
                        name: "Dairy",
                        hidden: false,
                        isOther: false,
                        sortOrder: 0,
                        lines: [
                            {
                                id: "ln",
                                householdId: HH,
                                storeId: "s",
                                sectionId: "sec",
                                kind: "food",
                                displayName: "Milk",
                                quantity: { amount: 1, unit: "l" },
                                foodId: "f",
                                checked: false,
                                source: "restock",
                                sourceFridgeItemId: "fi",
                                note: null,
                                notices: [notice],
                                alreadyHave: null,
                            },
                        ],
                    },
                ],
                rules: [],
            },
        ],
    });
    expect(html).toContain("notice-list");
    expect(html).toContain(noticeSentence(notice));
    expect(html).toContain('name="return_to"');
    expect(html).not.toContain("grocery-restock-pill");
    // One Restocked pill, in the line's meta, and the sentence list styled
    // as quiet text rather than a bulleted list.
    expect(html.split('data-notice="grocery.restocked"')).toHaveLength(2);
    expect(html).toMatch(
        /1 l · <span class="pill[^"]*" data-notice="grocery.restocked">Restocked<\/span>/,
    );
    expect(html).toContain("notice-list grocery-line-notices");
});

// 2026-06-01 is a Monday (weekday 1).
const LIST_STORES = [{ id: "store-1", name: "Corner" }];

function listUsuals(
    listed: ReturnType<typeof newFood>[],
    opts: {
        weekday?: number;
        stores?: { id: string; name: string }[];
        lines?: Pick<GroceryLine, "foodId" | "checked">[];
        dismissed?: ReadonlySet<string>;
    } = {},
) {
    return usualsList({
        listed,
        stock: [],
        lines: opts.lines ?? [],
        dismissed: opts.dismissed ?? new Set<string>(),
        stores: opts.stores ?? LIST_STORES,
        today: TODAY,
        householdRestockDay: opts.weekday ?? 1,
    });
}

test("usualsList takes the product name, amount and store from the usual product", () => {
    const milk = newFood({
        householdId: HH,
        kind: "food",
        name: "Milk",
        restockSchedule: "weekly",
    });
    const brand = newFood({
        householdId: HH,
        kind: "food",
        name: "Oat Drink",
        brand: "Oatly",
        genericFoodId: milk.id,
        usualStoreId: "store-1",
        usualAmount: { amount: 2, unit: "l" },
    });
    milk.usualProductId = brand.id;
    const { rows } = listUsuals([milk, brand]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
        foodId: milk.id,
        name: "Milk",
        productName: "Oat Drink (Oatly)",
        storeId: "store-1",
        storeName: "Corner",
        amount: 2,
        unit: "l",
        schedule: "weekly",
    });
});

test("usualsList says whether a usual is a food or a supply, so it can be added back to the list", () => {
    const towels = newFood({
        householdId: HH,
        kind: "supply",
        name: "Paper towels",
        restockSchedule: "weekly",
    });
    const rice = newFood({
        householdId: HH,
        kind: "food",
        name: "Rice",
        restockSchedule: "weekly",
    });
    const { rows } = listUsuals([towels, rice]);
    expect(Object.fromEntries(rows.map((r) => [r.name, r.kind]))).toEqual({
        "Paper towels": "supply",
        Rice: "food",
    });
});

test("usualsList leaves the store name null when the store id matches no store", () => {
    const eggs = newFood({
        householdId: HH,
        kind: "food",
        name: "Eggs",
        restockSchedule: "weekly",
        usualStoreId: "gone",
    });
    const { rows } = listUsuals([eggs]);
    expect(rows[0]).toMatchObject({
        storeId: "gone",
        storeName: null,
        productName: null,
        amount: null,
    });
});

test("usualsList skips generic, product, archived and non-usual foods", () => {
    const milk = newFood({
        householdId: HH,
        kind: "food",
        name: "Milk",
        restockSchedule: "weekly",
    });
    const product = newFood({
        householdId: HH,
        kind: "food",
        name: "Whole Milk",
        genericFoodId: milk.id,
        restockSchedule: "weekly",
    });
    const plain = newFood({ householdId: HH, kind: "food", name: "Salt" });
    const archived = newFood({
        householdId: HH,
        kind: "food",
        name: "Old",
        restockSchedule: "weekly",
    });
    archived.archivedAt = "2026-01-01T00:00:00.000Z";
    const { rows } = listUsuals([milk, product, plain, archived]);
    expect(rows.map((r) => r.name)).toEqual(["Milk"]);
});

test("usualsList lists a paused usual with due null", () => {
    const rice = newFood({
        householdId: HH,
        kind: "food",
        name: "Rice",
        restockSchedule: "weekly",
        restockPaused: true,
    });
    const { rows } = listUsuals([rice]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ paused: true, due: null });
});

test("usualsList puts due usuals first, then sorts by name", () => {
    const make = (name: string, extra: object = {}) =>
        newFood({
            householdId: HH,
            kind: "food",
            name,
            restockSchedule: "weekly",
            ...extra,
        });
    const zucchini = make("Zucchini");
    const apple = make("Apple", { restockPaused: true });
    const bread = make("Bread");
    const butter = make("Butter", { restockPaused: true });
    const { rows } = listUsuals([apple, zucchini, butter, bread]);
    expect(rows.map((r) => r.name)).toEqual([
        "Bread",
        "Zucchini",
        "Apple",
        "Butter",
    ]);
    expect(rows.map((r) => r.due?.trigger ?? null)).toEqual([
        "schedule",
        "schedule",
        null,
        null,
    ]);
});

test("usualsList marks a usual on_list when an unchecked line names its food or family", () => {
    const eggs = newFood({
        householdId: HH,
        kind: "food",
        name: "Eggs",
        restockSchedule: "weekly",
    });
    const rice = newFood({
        householdId: HH,
        kind: "food",
        name: "Rice",
        restockSchedule: "weekly",
    });
    const tea = newFood({
        householdId: HH,
        kind: "food",
        name: "Tea",
        restockSchedule: "weekly",
    });
    const { rows } = listUsuals([eggs, rice, tea], {
        lines: [
            { foodId: eggs.id, checked: false },
            { foodId: rice.id, checked: true },
            { foodId: null, checked: false },
        ],
    });
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.onList]));
    expect(byName).toEqual({ Eggs: true, Rice: false, Tea: false });
});

test("usualsList counts a line for the usual's product as on the list", () => {
    const milk = newFood({
        householdId: HH,
        kind: "food",
        name: "Milk",
        restockSchedule: "weekly",
    });
    const brand = newFood({
        householdId: HH,
        kind: "food",
        name: "Kirkland 2%",
        genericFoodId: milk.id,
    });
    const { rows } = listUsuals([milk, brand], {
        lines: [{ foodId: brand.id, checked: false }],
    });
    expect(rows.find((r) => r.name === "Milk")!.onList).toBe(true);
});

function lowRice(over: Partial<ReturnType<typeof newFood>> = {}) {
    // No schedule and empty stock: due only because it is low.
    return newFood({
        householdId: HH,
        kind: "food",
        name: "Rice",
        restockWhenLow: true,
        restockLowLevel: 1,
        usualAmount: { amount: 4, unit: "each" },
        ...over,
    });
}

test("usualsList: a recent tick covers a low usual, like the runner", () => {
    const rice = lowRice({ lastRestockedOn: addDays(TODAY, -2) });
    const { rows } = listUsuals([rice], {
        lines: [{ foodId: rice.id, checked: true }],
    });
    expect(rows[0]).toMatchObject({
        due: { trigger: "low" },
        onList: true,
    });
});

test("usualsList: a stale tick no longer covers a low usual", () => {
    const rice = lowRice({ lastRestockedOn: addDays(TODAY, -8) });
    const { rows } = listUsuals([rice], {
        lines: [{ foodId: rice.id, checked: true }],
    });
    expect(rows[0]).toMatchObject({
        due: { trigger: "low" },
        onList: false,
    });
});

test("usualsList: a tick never covers a schedule-due usual", () => {
    const tea = newFood({
        householdId: HH,
        kind: "food",
        name: "Tea",
        restockSchedule: "weekly",
        lastRestockedOn: null,
    });
    const { rows } = listUsuals([tea], {
        lines: [{ foodId: tea.id, checked: true }],
    });
    expect(rows[0]).toMatchObject({
        due: { trigger: "schedule" },
        onList: false,
    });
});

test("usualsList: an unticked line covers a low usual whatever the tick age", () => {
    const rice = lowRice({ lastRestockedOn: addDays(TODAY, -30) });
    const { rows } = listUsuals([rice], {
        lines: [{ foodId: rice.id, checked: false }],
    });
    expect(rows[0]!.onList).toBe(true);
});

test("usualsList: a low usual whose running-low notice is dismissed says so", () => {
    const rice = lowRice({ lastRestockedOn: "2026-05-01" });
    const key = (relatedKey: string) =>
        dismissedKeySet([
            {
                id: "d1",
                householdId: HH,
                code: "grocery.running_low",
                subjectKind: "food",
                subjectId: rice.id,
                relatedKey,
                dismissedBy: "u1",
                createdAt: "2026-05-02T00:00:00.000Z",
            },
        ]);
    expect(
        listUsuals([rice], { dismissed: key("2026-05-01") }).rows[0],
    ).toMatchObject({ due: { trigger: "low" }, dismissed: true });
    // A dismissal for an older restock does not hide it.
    expect(
        listUsuals([rice], { dismissed: key("2026-04-01") }).rows[0]!.dismissed,
    ).toBe(false);
    expect(listUsuals([rice]).rows[0]!.dismissed).toBe(false);
});

test("usualsList: a dismissal does not touch a schedule-due usual", () => {
    const tea = newFood({
        householdId: HH,
        kind: "food",
        name: "Tea",
        restockSchedule: "weekly",
        restockWhenLow: true,
        restockLowLevel: 1,
        lastRestockedOn: null,
    });
    const dismissed = dismissedKeySet([
        {
            id: "d1",
            householdId: HH,
            code: "grocery.running_low",
            subjectKind: "food",
            subjectId: tea.id,
            relatedKey: "",
            dismissedBy: "u1",
            createdAt: "2026-05-02T00:00:00.000Z",
        },
    ]);
    const { rows } = listUsuals([tea], { dismissed });
    expect(rows[0]).toMatchObject({
        due: { trigger: "schedule" },
        dismissed: false,
    });
});

test("usualsList says whether today is the household restock day", () => {
    const tea = newFood({
        householdId: HH,
        kind: "food",
        name: "Tea",
        restockSchedule: "weekly",
    });
    expect(listUsuals([tea], { weekday: 1 }).isRestockDay).toBe(true);
    const off = listUsuals([tea], { weekday: 3 });
    expect(off.isRestockDay).toBe(false);
    expect(off.rows[0]!.due).toBeNull();
});
