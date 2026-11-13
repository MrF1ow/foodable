import { expect, test } from "bun:test";
import {
    createMemoryFoodsStore,
    effectiveFoodsByIds,
    newFood,
    type EffectiveFood,
    type Food,
} from "./foods.js";
import type { FridgeItem } from "./fridge.js";
import { addLocation, createMemoryFridgeStore } from "./fridge.js";
import {
    checkGroceryLine,
    createMemoryGroceryStore,
    type GroceryLine,
} from "./grocery.js";
import { createMemoryNoticeDismissalsStore } from "./notice-dismissals.js";
import {
    EMPTY_HOUSEHOLD_PREFERENCES,
    type HouseholdPreferences,
} from "../household.js";
import {
    createMemoryRestockStore,
    runRestockCheck,
    usualsDue,
    type RestockCheckDeps,
    type RestockSource,
} from "./restock.js";
import { createGroceryStore, createMemorySettingsStore } from "./settings.js";
import { addFridgeItemAdjust, createMemoryStockStore } from "./stock.js";

const HH = "hh-schedules";
// 2026-06-06 is a Saturday (weekday 6).
const SAT = "2026-06-06";
const SATURDAY = 6;

function usual(over: Partial<Food> = {}): EffectiveFood {
    return {
        ...newFood({ householdId: HH, kind: "food", name: "Eggs" }),
        id: "eggs",
        ...over,
        product: null,
    };
}

function item(over: Partial<FridgeItem> = {}): FridgeItem {
    return {
        id: "i1",
        householdId: HH,
        kind: "food",
        displayName: "Eggs",
        foodId: "eggs",
        quantity: { amount: 1, unit: "each" },
        locationId: "loc",
        expiresOn: null,
        openedOn: null,
        purchasedOn: null,
        ...over,
    };
}

function due(
    food: EffectiveFood,
    stock: FridgeItem[] = [],
    today = SAT,
    restockDay = SATURDAY,
) {
    return usualsDue(
        [food],
        stock,
        today,
        restockDay,
        new Map([[food.id, food]]),
    );
}

test("weekly is due 7 days after the last restock, on the restock day", () => {
    const weekly = { restockSchedule: "weekly" as const };
    expect(due(usual({ ...weekly, lastRestockedOn: "2026-05-30" }))).toEqual([
        expect.objectContaining({
            trigger: "schedule",
            reason: "weekly, last bought 7 days ago",
        }),
    ]);
    expect(
        due(usual({ ...weekly, lastRestockedOn: "2026-05-29" }))[0]!.reason,
    ).toBe("weekly, last bought 8 days ago");
    expect(due(usual({ ...weekly, lastRestockedOn: "2026-05-31" }))).toEqual(
        [],
    );
});

test("a scheduled usual is not due off the restock day", () => {
    const food = usual({ restockSchedule: "weekly", lastRestockedOn: null });
    expect(due(food, [], "2026-06-05")).toEqual([]);
    expect(due(food, [], SAT, 5)).toEqual([]);
    expect(due(food, [], SAT, SATURDAY)).toHaveLength(1);
});

test("a usual never restocked is due on its first restock day", () => {
    expect(due(usual({ restockSchedule: "weekly" }))[0]!.reason).toBe(
        "weekly, not bought yet",
    );
});

test("every N weeks: 13 days is not due, 14 is", () => {
    const base = {
        restockSchedule: "every_n_weeks" as const,
        restockEveryWeeks: 2,
    };
    expect(due(usual({ ...base, lastRestockedOn: "2026-05-24" }))).toEqual([]);
    expect(
        due(usual({ ...base, lastRestockedOn: "2026-05-23" }))[0]!.reason,
    ).toBe("every 2 weeks, last bought 14 days ago");
    expect(due(usual({ ...base, restockEveryWeeks: null }))).toEqual([]);
});

test("monthly is due once a calendar month has passed, clamped to short months", () => {
    const monthly = { restockSchedule: "monthly" as const };
    expect(due(usual({ ...monthly, lastRestockedOn: "2026-05-07" }))).toEqual(
        [],
    );
    expect(
        due(usual({ ...monthly, lastRestockedOn: "2026-05-06" }))[0]!.reason,
    ).toBe("monthly, last bought 31 days ago");
    // Jan 31 + one month lands on Feb 28; Mar 28 2026 is a Saturday after it.
    expect(
        usualsDue(
            [usual({ ...monthly, lastRestockedOn: "2026-01-31" })],
            [],
            "2026-02-28",
            6,
        ),
    ).toHaveLength(1);
});

test("date math does not move across a DST change", () => {
    // US DST began 2026-03-08: 7 calendar days stay 7 days.
    const food = usual({
        restockSchedule: "weekly",
        lastRestockedOn: "2026-03-07",
    });
    expect(usualsDue([food], [], "2026-03-14", 6)).toHaveLength(1);
    expect(usualsDue([food], [], "2026-03-13", 5)).toEqual([]);
});

test("paused is never due, by schedule or by low stock", () => {
    const food = usual({
        restockSchedule: "weekly",
        restockWhenLow: true,
        restockLowLevel: 6,
        restockPaused: true,
        usualAmount: { amount: 12, unit: "each" },
    });
    expect(
        due(food, [item({ quantity: { amount: 1, unit: "each" } })]),
    ).toEqual([]);
});

test("low: strictly below the level, not at it", () => {
    const food = usual({
        restockWhenLow: true,
        restockLowLevel: 6,
        usualAmount: { amount: 12, unit: "each" },
    });
    const stock = (amount: number) => [
        item({ quantity: { amount, unit: "each" } }),
    ];
    expect(due(food, stock(6))).toEqual([]);
    expect(due(food, stock(7))).toEqual([]);
    expect(due(food, stock(3))).toEqual([
        expect.objectContaining({ trigger: "low", reason: "3 left, below 6" }),
    ]);
    // Empty stock is low too, on any day.
    expect(due(food, [], "2026-06-03")[0]!.reason).toBe("0 left, below 6");
});

test("low defaults to a quarter of the usual amount", () => {
    const food = usual({
        restockWhenLow: true,
        usualAmount: { amount: 12, unit: "each" },
    });
    const stock = (amount: number) => [
        item({ quantity: { amount, unit: "each" } }),
    ];
    expect(due(food, stock(3))).toEqual([]);
    expect(due(food, stock(2))[0]!.reason).toBe("2 left, below 3");
});

test("low with no level and no usual amount is never low", () => {
    expect(due(usual({ restockWhenLow: true }))).toEqual([]);
});

test("low converts units through grams and a missing factor is unknown, not low", () => {
    const food = usual({
        restockWhenLow: true,
        restockLowLevel: 500,
        usualAmount: { amount: 2000, unit: "g" },
    });
    expect(
        due(food, [item({ quantity: { amount: 1, unit: "lb" } })])[0]!.reason,
    ).toBe("453.6 left, below 500");
    // A count with no grams-per-each cannot be compared with grams.
    expect(
        due(food, [item({ quantity: { amount: 1, unit: "each" } })]),
    ).toEqual([]);
    // With the factor it can.
    const withFactor = { ...food, gramsPerEach: 60 };
    expect(
        due(withFactor, [item({ quantity: { amount: 2, unit: "each" } })])[0]!
            .reason,
    ).toBe("120 left, below 500");
    // Another food's stock is not counted.
    expect(
        due(food, [
            item({ foodId: "other", quantity: { amount: 900, unit: "g" } }),
        ])[0]!.reason,
    ).toBe("0 left, below 500");
});

test("stock of a product counts toward its plain food", () => {
    const plain = usual({
        restockWhenLow: true,
        restockLowLevel: 6,
        usualAmount: { amount: 12, unit: "each" },
    });
    const product: EffectiveFood = {
        ...usual({
            id: "kirkland",
            name: "Kirkland Eggs",
            genericFoodId: "eggs",
        }),
    };
    const byId = new Map([
        [plain.id, plain],
        [product.id, product],
    ]);
    const stock = [
        item({ foodId: "kirkland", quantity: { amount: 8, unit: "each" } }),
    ];
    expect(usualsDue([plain], stock, SAT, SATURDAY, byId)).toEqual([]);
});

test("schedule wins over low when both apply", () => {
    const food = usual({
        restockSchedule: "weekly",
        restockWhenLow: true,
        restockLowLevel: 6,
        usualAmount: { amount: 12, unit: "each" },
        lastRestockedOn: "2026-05-01",
    });
    const out = due(food);
    expect(out).toHaveLength(1);
    expect(out[0]!.trigger).toBe("schedule");
});

// ---- the runner's source switch

async function runnerWorld() {
    const grocery = createMemoryGroceryStore();
    const fridge = createMemoryFridgeStore();
    const foods = createMemoryFoodsStore();
    const dismissals = createMemoryNoticeDismissalsStore();
    const settings = createMemorySettingsStore();
    const store = await createGroceryStore(settings, HH, "Costco");
    const stock = createMemoryStockStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const milk = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Milk" }),
    );
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: milk.id,
        amount: 1,
        unit: "l",
        locationId: loc.id,
        expiresOn: "2026-06-08",
        actorUserId: "u1",
    });
    const rice = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Rice",
            restockSchedule: "weekly",
            lastRestockedOn: "2026-05-01",
            usualAmount: { amount: 2, unit: "lb" },
        }),
    );
    const oats = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Oats",
            restockSchedule: "weekly",
            lastRestockedOn: "2026-05-01",
        }),
    );
    let prefs: HouseholdPreferences = {
        ...EMPTY_HOUSEHOLD_PREFERENCES,
        restock: { enabled: true, weekday: 6, time: "00:00", lastRunOn: null },
    };
    const restock = createMemoryRestockStore({
        grocery,
        getPrefs: () => prefs,
        setPrefs: (p) => {
            prefs = p;
        },
    });
    const logs: string[] = [];
    const deps = (source?: RestockSource): RestockCheckDeps => ({
        listEnabled: async () => [{ id: HH, preferences: prefs }],
        getOwnerProfile: async () => ({ timezone: "UTC" }),
        fridge,
        foods,
        grocery,
        settings,
        dismissals,
        restock,
        ...(source ? { source } : {}),
        logger: { log: (m) => logs.push(m) },
    });
    return {
        grocery,
        dismissals,
        deps,
        logs,
        store,
        fridge,
        stock,
        loc,
        milk,
        rice,
        oats,
        foods,
        getPrefs: () => prefs,
    };
}

const NOW = new Date("2026-06-06T15:00:00Z");

function shape(lines: GroceryLine[]) {
    return lines
        .map(({ id: _id, ...rest }) => rest)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

test("source legacy ignores schedules and matches a run with no source", async () => {
    const a = await runnerWorld();
    await runRestockCheck(a.deps(), NOW);
    const b = await runnerWorld();
    await runRestockCheck(b.deps("legacy"), NOW);
    const aLines = await a.grocery.listLines(HH);
    const bLines = await b.grocery.listLines(HH);
    expect(aLines.map((l) => l.displayName)).toEqual(["Milk"]);
    expect(shape(bLines).map((l) => l.displayName)).toEqual(["Milk"]);
    // Same log line, byte for byte, apart from nothing schedule-related.
    expect(a.logs).toEqual(b.logs);
    expect(a.logs[0]).not.toContain("due_usuals");
});

test("source schedules adds due usuals and keeps the expiring lines", async () => {
    const w = await runnerWorld();
    await runRestockCheck(w.deps("schedules"), NOW);
    const lines = await w.grocery.listLines(HH);
    expect(lines.map((l) => l.displayName).sort()).toEqual([
        "Milk",
        "Oats",
        "Rice",
    ]);
    const rice = lines.find((l) => l.displayName === "Rice")!;
    expect(rice).toMatchObject({
        foodId: w.rice.id,
        source: "restock",
        sourceFridgeItemId: null,
        storeId: w.store.id,
        quantity: { amount: 2, unit: "lb" },
    });
    expect(
        lines.find((l) => l.displayName === "Milk")!.sourceFridgeItemId,
    ).not.toBeNull();
    expect(w.logs[0]).toContain("due_usuals=2");
});

test("source schedules skips a usual already on the list", async () => {
    const w = await runnerWorld();
    const sections = await createMemorySettingsStoreSections(w);
    await w.grocery.insertLine({
        id: "existing",
        householdId: HH,
        storeId: w.store.id,
        sectionId: sections,
        kind: "food",
        displayName: "Rice",
        quantity: { amount: 1, unit: "lb" },
        foodId: w.rice.id,
        checked: false,
        source: "manual",
        sourceFridgeItemId: null,
        note: null,
    });
    await runRestockCheck(w.deps("schedules"), NOW);
    const lines = await w.grocery.listLines(HH);
    expect(lines.filter((l) => l.foodId === w.rice.id)).toHaveLength(1);
    expect(lines.map((l) => l.displayName).sort()).toEqual([
        "Milk",
        "Oats",
        "Rice",
    ]);
});

test("source schedules adds a low usual and does not add a paused one", async () => {
    const w = await runnerWorld();
    await w.foods.updateFoodRow({
        ...(await w.foods.getFood(HH, w.rice.id))!,
        restockSchedule: null,
        restockWhenLow: true,
        restockLowLevel: 1,
        restockPaused: true,
    });
    await runRestockCheck(w.deps("schedules"), NOW);
    const names = (await w.grocery.listLines(HH))
        .map((l) => l.displayName)
        .sort();
    expect(names).toEqual(["Milk", "Oats"]);
});

// 2026-06-03 is a Wednesday, three days before the restock day.
const WED = new Date("2026-06-03T15:00:00Z");

async function makeRiceLow(w: Awaited<ReturnType<typeof runnerWorld>>) {
    await w.foods.updateFoodRow({
        ...(await w.foods.getFood(HH, w.rice.id))!,
        restockSchedule: null,
        restockWhenLow: true,
        restockLowLevel: 1,
    });
}

test("source schedules adds a low usual on any day, and only that off the restock day", async () => {
    const w = await runnerWorld();
    await makeRiceLow(w);
    await runRestockCheck(w.deps("schedules"), WED);
    const names = (await w.grocery.listLines(HH))
        .map((l) => l.displayName)
        .sort();
    // Oats is scheduled (not its day) and Milk is expiring (not its day).
    expect(names).toEqual(["Rice"]);
    expect(w.getPrefs().restock.lastRunOn).toBe("2026-06-03");
    expect(w.logs[0]).toContain("due_usuals=1");
});

test("source schedules runs the low pass once a day", async () => {
    const w = await runnerWorld();
    await makeRiceLow(w);
    await runRestockCheck(w.deps("schedules"), WED);
    const [rice] = await w.grocery.listLines(HH);
    await w.grocery.deleteLine(HH, rice!.id);
    await runRestockCheck(w.deps("schedules"), WED);
    expect(await w.grocery.listLines(HH)).toEqual([]);
    expect(w.logs.some((l) => l.includes("already ran"))).toBe(false);
});

const THU = new Date("2026-06-04T15:00:00Z");
const FRI = new Date("2026-06-05T15:00:00Z");

async function riceLines(w: Awaited<ReturnType<typeof runnerWorld>>) {
    return (await w.grocery.listLines(HH)).filter(
        (l) => l.displayName === "Rice",
    );
}

test("source schedules: a ticked low-usual line awaiting put-away is not doubled the next day", async () => {
    const w = await runnerWorld();
    await makeRiceLow(w);
    await runRestockCheck(w.deps("schedules"), WED);
    const [line] = await riceLines(w);
    await checkGroceryLine(w.grocery, HH, line!.id, true, {
        foods: w.foods,
        today: "2026-06-03",
    });
    await runRestockCheck(w.deps("schedules"), THU);
    await runRestockCheck(w.deps("schedules"), FRI);
    const rice = await riceLines(w);
    expect(rice.map((l) => l.checked)).toEqual([true]);
});

test("source schedules: a dismissed running-low notice keeps the low pass from re-adding the usual", async () => {
    const w = await runnerWorld();
    await makeRiceLow(w);
    // The notice's dismissal scope is the usual's last restock day.
    await w.dismissals.insert({
        householdId: HH,
        code: "grocery.running_low",
        subjectKind: "food",
        subjectId: w.rice.id,
        relatedKey: "2026-05-01",
        dismissedBy: "u1",
    });
    for (const day of [WED, THU, FRI]) {
        await runRestockCheck(w.deps("schedules"), day);
        expect(await riceLines(w)).toEqual([]);
    }
    expect(w.logs[0]).toContain("skipped_dismissed=1");
});

test("source schedules: a dismissal for an older restock does not hide a low usual", async () => {
    const w = await runnerWorld();
    await makeRiceLow(w);
    await w.dismissals.insert({
        householdId: HH,
        code: "grocery.running_low",
        subjectKind: "food",
        subjectId: w.rice.id,
        relatedKey: "2026-04-01",
        dismissedBy: "u1",
    });
    await runRestockCheck(w.deps("schedules"), WED);
    expect(await riceLines(w)).toHaveLength(1);
});

test("source schedules: a running-low dismissal does not stop a schedule-due usual", async () => {
    const w = await runnerWorld();
    await w.foods.updateFoodRow({
        ...(await w.foods.getFood(HH, w.rice.id))!,
        restockWhenLow: true,
        restockLowLevel: 1,
    });
    await w.dismissals.insert({
        householdId: HH,
        code: "grocery.running_low",
        subjectKind: "food",
        subjectId: w.rice.id,
        relatedKey: "2026-05-01",
        dismissedBy: "u1",
    });
    await runRestockCheck(w.deps("schedules"), NOW);
    expect(await riceLines(w)).toHaveLength(1);
});

test("source schedules still adds the schedule part and expiring lines on the restock day after a weekday pass", async () => {
    const w = await runnerWorld();
    await makeRiceLow(w);
    await runRestockCheck(w.deps("schedules"), WED);
    await runRestockCheck(w.deps("schedules"), NOW);
    const names = (await w.grocery.listLines(HH))
        .map((l) => l.displayName)
        .sort();
    expect(names).toEqual(["Milk", "Oats", "Rice"]);
});

test("source legacy does nothing off the restock day, low usual or not", async () => {
    const w = await runnerWorld();
    await makeRiceLow(w);
    await runRestockCheck(w.deps("legacy"), WED);
    await runRestockCheck(w.deps(), WED);
    expect(await w.grocery.listLines(HH)).toEqual([]);
    expect(w.getPrefs().restock.lastRunOn).toBeNull();
});

// ---- the switch day: the legacy runner and the schedules runner share one marker

const SWITCH_DAY = NOW; // Saturday, the restock weekday
const NEXT_DAY = new Date("2026-06-07T15:00:00Z");

function names(lines: GroceryLine[]) {
    return lines.map((l) => l.displayName).sort();
}

test("switch day: a schedules run after the legacy run the same day adds nothing", async () => {
    const w = await runnerWorld();
    await runRestockCheck(w.deps("legacy"), SWITCH_DAY);
    const afterLegacy = await w.grocery.listLines(HH);
    expect(names(afterLegacy)).toEqual(["Milk"]);
    expect(w.getPrefs().restock.lastRunOn).toBe(SAT);

    await runRestockCheck(w.deps("schedules"), SWITCH_DAY);
    const afterSchedules = await w.grocery.listLines(HH);
    // No duplicate expiring line, and no usual (Rice, Oats) added that day.
    expect(afterSchedules).toEqual(afterLegacy);
    expect(w.logs.filter((l) => l.includes("added="))).toHaveLength(1);
});

test("switch day: a legacy and a schedules run started together insert the lines once", async () => {
    const w = await runnerWorld();
    // The live store commits atomically (one conditional UPDATE); the memory
    // store awaits between its check and its write, so serialize the commits
    // to model that.
    let chain: Promise<unknown> = Promise.resolve();
    const serial = (d: RestockCheckDeps): RestockCheckDeps => ({
        ...d,
        restock: {
            commitRestockRun: (hh, on, lines, families) => {
                const run = chain.then(() =>
                    d.restock.commitRestockRun(hh, on, lines, families),
                );
                chain = run.catch(() => undefined);
                return run;
            },
        },
    });
    await Promise.all([
        runRestockCheck(serial(w.deps("legacy")), SWITCH_DAY),
        runRestockCheck(serial(w.deps("schedules")), SWITCH_DAY),
    ]);
    const lines = await w.grocery.listLines(HH);
    const milk = lines.filter((l) => l.displayName === "Milk");
    expect(milk).toHaveLength(1);
    // Exactly one run committed: either the legacy set or the schedules set,
    // never the sum of both.
    expect(
        names(lines).join(",") === "Milk" ||
            names(lines).join(",") === "Milk,Oats,Rice",
    ).toBe(true);
    expect(w.logs.filter((l) => l.includes("added="))).toHaveLength(1);
    expect(w.logs.filter((l) => l.includes("already ran"))).toHaveLength(1);
});

test("switch day: the schedules run the day after a legacy switch-day run proceeds normally", async () => {
    const w = await runnerWorld();
    await makeRiceLow(w);
    await runRestockCheck(w.deps("legacy"), SWITCH_DAY);
    expect(names(await w.grocery.listLines(HH))).toEqual(["Milk"]);

    // Sunday: not the restock day, but a low usual is added; the marker moves on.
    await runRestockCheck(w.deps("schedules"), NEXT_DAY);
    expect(names(await w.grocery.listLines(HH))).toEqual(["Milk", "Rice"]);
    expect(w.getPrefs().restock.lastRunOn).toBe("2026-06-07");
});

test("switch day: a schedules run first adds expiring food and due usuals once, and a second tick adds nothing", async () => {
    const w = await runnerWorld();
    await runRestockCheck(w.deps("schedules"), SWITCH_DAY);
    const first = await w.grocery.listLines(HH);
    expect(names(first)).toEqual(["Milk", "Oats", "Rice"]);

    await runRestockCheck(w.deps("schedules"), SWITCH_DAY);
    expect(await w.grocery.listLines(HH)).toEqual(first);
    expect(w.logs.filter((l) => l.includes("added="))).toHaveLength(1);
});

async function createMemorySettingsStoreSections(w: {
    store: { id: string };
    deps: () => RestockCheckDeps;
}): Promise<string> {
    const sections = await w.deps().settings.listSections(w.store.id);
    return sections[0]!.id;
}

const SAT_2 = new Date("2026-06-13T15:00:00Z");
const SAT_3 = new Date("2026-06-20T15:00:00Z");

test("source schedules: a scheduled usual whose ticked line was never cleared is added again when due", async () => {
    const w = await runnerWorld();
    await runRestockCheck(w.deps("schedules"), NOW);
    const [first] = await riceLines(w);
    // Ticked in the store the next day; nobody clears the checked lines.
    await checkGroceryLine(w.grocery, HH, first!.id, true, {
        foods: w.foods,
        today: "2026-06-07",
    });
    await runRestockCheck(w.deps("schedules"), SAT_2);
    expect((await riceLines(w)).map((l) => l.checked)).toEqual([true]);
    // Two weeks on the schedule is due again; the stale tick must not cover it.
    await runRestockCheck(w.deps("schedules"), SAT_3);
    expect((await riceLines(w)).map((l) => l.checked).sort()).toEqual([
        false,
        true,
    ]);
});

test("source schedules: a ticked manual line from weeks ago does not block a scheduled usual", async () => {
    const w = await runnerWorld();
    const sectionId = await createMemorySettingsStoreSections(w);
    await w.grocery.insertLine({
        id: "old-ticked",
        householdId: HH,
        storeId: w.store.id,
        sectionId,
        kind: "food",
        displayName: "Rice",
        quantity: { amount: 1, unit: "lb" },
        foodId: w.rice.id,
        checked: true,
        source: "manual",
        sourceFridgeItemId: null,
        note: null,
    });
    await runRestockCheck(w.deps("schedules"), NOW);
    const rice = await riceLines(w);
    expect(rice.filter((l) => !l.checked)).toHaveLength(1);
    expect(w.logs[0]).toContain("skipped_on_list=0");
});

test("source schedules: a low usual ticked one or two days ago is not doubled", async () => {
    const w = await runnerWorld();
    await makeRiceLow(w);
    await runRestockCheck(w.deps("schedules"), WED);
    const [line] = await riceLines(w);
    await checkGroceryLine(w.grocery, HH, line!.id, true, {
        foods: w.foods,
        today: "2026-06-04",
    });
    await runRestockCheck(w.deps("schedules"), FRI);
    expect((await riceLines(w)).map((l) => l.checked)).toEqual([true]);
});

test("source schedules: a low usual whose ticked line is older than the window is added again", async () => {
    const w = await runnerWorld();
    await makeRiceLow(w);
    await runRestockCheck(w.deps("schedules"), WED);
    const [line] = await riceLines(w);
    await checkGroceryLine(w.grocery, HH, line!.id, true, {
        foods: w.foods,
        today: "2026-06-03",
    });
    // Ticked 3 June and never put away: by 10 June the tick is stale.
    await runRestockCheck(
        w.deps("schedules"),
        new Date("2026-06-10T15:00:00Z"),
    );
    expect((await riceLines(w)).map((l) => l.checked).sort()).toEqual([
        false,
        true,
    ]);
});

// ---- the expiring pass honours a recent tick like the low pass does

async function addRiceCarton(w: Awaited<ReturnType<typeof runnerWorld>>) {
    // One pound on hand is under the raised low level, so Rice reads low too.
    await w.foods.updateFoodRow({
        ...(await w.foods.getFood(HH, w.rice.id))!,
        restockLowLevel: 5,
    });
    await addFridgeItemAdjust(w.fridge, w.stock, w.foods, {
        householdId: HH,
        foodId: w.rice.id,
        amount: 1,
        unit: "lb",
        locationId: w.loc.id,
        expiresOn: "2026-06-08",
        actorUserId: "u1",
    });
}

test("source schedules: an expiring carton does not double a low line ticked earlier in the week", async () => {
    const w = await runnerWorld();
    await makeRiceLow(w);
    await addRiceCarton(w);
    await runRestockCheck(w.deps("schedules"), WED);
    const [line] = await riceLines(w);
    await checkGroceryLine(w.grocery, HH, line!.id, true, {
        foods: w.foods,
        today: "2026-06-04",
    });
    // Saturday, the restock day: the carton is expiring, the tick is two days old.
    await runRestockCheck(w.deps("schedules"), NOW);
    expect((await riceLines(w)).map((l) => l.checked)).toEqual([true]);
});

test("source schedules: an expiring carton still gets its line when the family's ticked line is older than the window", async () => {
    const w = await runnerWorld();
    await makeRiceLow(w);
    await addRiceCarton(w);
    // A ticked line that was never put away, stamped well before the window.
    await w.grocery.insertLine({
        id: "old-ticked",
        householdId: HH,
        storeId: w.store.id,
        sectionId: await createMemorySettingsStoreSections(w),
        kind: "food",
        displayName: "Rice",
        quantity: { amount: 1, unit: "lb" },
        foodId: w.rice.id,
        checked: true,
        source: "restock",
        sourceFridgeItemId: null,
        note: null,
    });
    await w.foods.updateFoodRow({
        ...(await w.foods.getFood(HH, w.rice.id))!,
        lastRestockedOn: "2026-05-20",
    });
    await runRestockCheck(w.deps("schedules"), NOW);
    expect((await riceLines(w)).filter((l) => !l.checked)).toHaveLength(1);
});
