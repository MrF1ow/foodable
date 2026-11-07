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
import { createGroceryStore, createMemorySettingsStore } from "./settings.js";
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
    const { store, sections } = await seedCostco();
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
    return restockPlan({
        items,
        foodsById: eff,
        lines: opts?.lines ?? [],
        dismissed: dismissedKeySet(await dismissals.listForHousehold(HH)),
        today: TODAY,
        stores: [store],
        sections,
        householdId: HH,
    });
}

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
    };
    const item = fridgeFood({
        id: "fi",
        foodId: "f",
        expiresOn: addDays(TODAY, 3),
        displayName: "Whole milk",
    });
    const n = groceryRestockNotices([line], [item], TODAY)[0]!;
    expect(noticeSentence(n)).toContain("Thursday");
    expect(
        noticeSentence({
            ...n,
            params: { ...n.params, daysLeft: 0 },
        }),
    ).toContain("today");
    expect(
        noticeSentence({
            ...n,
            params: { ...n.params, daysLeft: 1 },
        }),
    ).toContain("tomorrow");
    expect(
        noticeSentence({
            ...n,
            params: { ...n.params, daysLeft: -1 },
        }),
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
    };
    await grocery.insertLine(line);
    const open = await noticesFor(deps, HH, { today: TODAY });
    expect(open.notices.some((n) => n.code === "grocery.restocked")).toBe(true);
    await dismissNotice(deps, HH, "u", {
        code: "grocery.restocked",
        subjectKind: "grocery_line",
        subjectId: line.id,
    });
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
    expect(html).toContain("Restocked");
    expect(html).toContain("notice-list");
    expect(html).toContain('data-notice="grocery.restocked"');
    expect(html).toContain(noticeSentence(notice));
});
