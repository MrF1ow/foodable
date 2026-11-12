import { describe, expect, test } from "bun:test";
import {
    applyUsualSchedulePatch,
    createMemoryFoodsStore,
    effectiveFood,
    foodFromRow,
    foodToRow,
    FoodsInputError,
    linkProduct,
    markUsualRestocked,
    mergedFoodFields,
    mergeFoods,
    newFood,
    NO_USUAL_SCHEDULE,
    RESTOCK_MAX_EVERY_WEEKS,
    setUsualProduct,
    setUsualPurchase,
    setUsualSchedule,
    updateFood,
    usualLowLevel,
    type Food,
    type UsualScheduleFields,
} from "./foods.js";
import { createMemorySettingsStore } from "./settings.js";

const HH = "hh-schedule";

/** Every schedule field set to something other than its default. */
const SCHEDULED: UsualScheduleFields = {
    restockSchedule: "every_n_weeks",
    restockEveryWeeks: 3,
    restockPaused: true,
    restockWhenLow: true,
    restockLowLevel: 6,
    lastRestockedOn: "2026-11-02",
};

function scheduleOf(food: Food): UsualScheduleFields {
    return {
        restockSchedule: food.restockSchedule,
        restockEveryWeeks: food.restockEveryWeeks,
        restockPaused: food.restockPaused,
        restockWhenLow: food.restockWhenLow,
        restockLowLevel: food.restockLowLevel,
        lastRestockedOn: food.lastRestockedOn,
    };
}

async function seed() {
    const foods = createMemoryFoodsStore();
    const settings = createMemorySettingsStore();
    const shop = await settings.insertStore({
        id: "shop-1",
        householdId: HH,
        name: "Costco",
        sortOrder: 0,
    });
    const plain = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            usualStoreId: shop.id,
            usualAmount: { amount: 24, unit: "each" },
            ...SCHEDULED,
        }),
    );
    const product = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Kirkland Large Eggs",
            brand: "Kirkland",
            genericFoodId: plain.id,
            usualAmount: { amount: 12, unit: "each" },
        }),
    );
    await foods.updateFoodRow({ ...plain, usualProductId: product.id });
    return { foods, settings, shop, plain, product };
}

describe("a new food has no schedule", () => {
    test("newFood defaults every field", () => {
        const food = newFood({ householdId: HH, kind: "food", name: "Milk" });
        expect(scheduleOf(food)).toEqual(NO_USUAL_SCHEDULE);
    });

    test("newFood carries a schedule it is given", () => {
        const food = newFood({
            householdId: HH,
            kind: "food",
            name: "Milk",
            ...SCHEDULED,
        });
        expect(scheduleOf(food)).toEqual(SCHEDULED);
    });
});

describe("writes keep the whole usual record", () => {
    test("setUsualPurchase keeps the schedule when it changes the store and amount", async () => {
        const { foods, settings, plain } = await seed();
        await settings.insertStore({
            id: "shop-2",
            householdId: HH,
            name: "Safeway",
            sortOrder: 1,
        });
        const saved = await setUsualPurchase(
            foods,
            HH,
            plain.id,
            {
                usualStoreId: "shop-2",
                usualAmount: { amount: 18, unit: "each" },
            },
            { stores: settings },
        );
        expect(saved.usualStoreId).toBe("shop-2");
        expect(saved.usualAmount).toEqual({ amount: 18, unit: "each" });
        expect(scheduleOf(saved)).toEqual(SCHEDULED);
        expect(scheduleOf((await foods.getFood(HH, plain.id))!)).toEqual(
            SCHEDULED,
        );
    });

    test("setUsualPurchase keeps the schedule when it clears the store and amount", async () => {
        const { foods, settings, plain } = await seed();
        const saved = await setUsualPurchase(
            foods,
            HH,
            plain.id,
            { usualStoreId: null, usualAmount: null },
            { stores: settings },
        );
        expect(saved.usualStoreId).toBeNull();
        expect(saved.usualAmount).toBeNull();
        expect(scheduleOf(saved)).toEqual(SCHEDULED);
    });

    test("setUsualPurchase with an empty patch keeps the schedule", async () => {
        const { foods, settings, plain } = await seed();
        const saved = await setUsualPurchase(
            foods,
            HH,
            plain.id,
            {},
            {
                stores: settings,
            },
        );
        expect(scheduleOf(saved)).toEqual(SCHEDULED);
    });

    test("a refused setUsualPurchase leaves the record as it was", async () => {
        const { foods, settings, plain } = await seed();
        const before = await foods.getFood(HH, plain.id);
        await expect(
            setUsualPurchase(
                foods,
                HH,
                plain.id,
                { usualStoreId: "nowhere" },
                { stores: settings },
            ),
        ).rejects.toThrow(FoodsInputError);
        expect(await foods.getFood(HH, plain.id)).toEqual(before);
    });

    test("updateFood keeps the schedule on a rename and a usual change", async () => {
        const { foods, settings, plain } = await seed();
        const saved = await updateFood(
            foods,
            HH,
            plain.id,
            {
                name: "Free range eggs",
                usualAmount: { amount: 30, unit: "each" },
                usualStoreId: null,
            },
            { stores: settings },
        );
        expect(saved.name).toBe("Free range eggs");
        expect(saved.usualAmount).toEqual({ amount: 30, unit: "each" });
        expect(scheduleOf(saved)).toEqual(SCHEDULED);
    });

    test("setUsualProduct keeps the plain food's schedule, switching and clearing the usual", async () => {
        const { foods, settings, plain, product } = await seed();
        const other = await foods.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Great Value Eggs",
                genericFoodId: plain.id,
            }),
        );
        const switched = await setUsualProduct(foods, HH, plain.id, other.id, {
            purchase: { usualAmount: { amount: 18, unit: "each" } },
            stores: settings,
        });
        expect(switched.usualProductId).toBe(other.id);
        expect(scheduleOf(switched)).toEqual(SCHEDULED);

        const cleared = await setUsualProduct(foods, HH, plain.id, null, {
            purchase: { usualStoreId: null },
            stores: settings,
        });
        expect(cleared.usualProductId).toBeNull();
        expect(scheduleOf(cleared)).toEqual(SCHEDULED);
        expect(scheduleOf((await foods.getFood(HH, product.id))!)).toEqual(
            NO_USUAL_SCHEDULE,
        );
    });

    test("linking and unlinking a product keep the schedule on both rows", async () => {
        const { foods, plain, product } = await seed();
        await linkProduct(foods, HH, product.id, null);
        expect(scheduleOf((await foods.getFood(HH, plain.id))!)).toEqual(
            SCHEDULED,
        );
        await linkProduct(foods, HH, product.id, plain.id);
        expect(scheduleOf((await foods.getFood(HH, plain.id))!)).toEqual(
            SCHEDULED,
        );
    });

    test("effectiveFood hands the plain food's schedule through, not the product's", async () => {
        const { foods, plain, product } = await seed();
        await foods.updateFoodRow({
            ...product,
            restockSchedule: "weekly",
            restockPaused: false,
        });
        const catalog = new Map(
            (await foods.listFoods(HH)).map((row) => [row.id, row]),
        );
        const eff = effectiveFood(catalog.get(plain.id)!, catalog);
        expect(scheduleOf(eff)).toEqual(SCHEDULED);
    });

    test("an unrelated edit through the store keeps the schedule", async () => {
        const { foods, plain } = await seed();
        const saved = await foods.updateFoodRow({
            ...plain,
            allergens: ["egg"],
        });
        expect(scheduleOf(saved!)).toEqual(SCHEDULED);
    });
});

describe("merging foods keeps the schedule that exists", () => {
    async function pair(
        keepSchedule: Partial<UsualScheduleFields>,
        dropSchedule: Partial<UsualScheduleFields>,
    ) {
        const foods = createMemoryFoodsStore();
        const keep = await foods.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                ...keepSchedule,
            }),
        );
        const drop = await foods.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Egg",
                ...dropSchedule,
            }),
        );
        return { foods, keep, drop };
    }

    test("the kept food's own schedule wins and the dropped one's N does not leak in", async () => {
        const { foods, keep, drop } = await pair(
            { restockSchedule: "monthly" },
            { restockSchedule: "every_n_weeks", restockEveryWeeks: 2 },
        );
        const merged = await mergeFoods(foods, HH, keep.id, drop.id);
        expect(merged.restockSchedule).toBe("monthly");
        expect(merged.restockEveryWeeks).toBeNull();
    });

    test("a kept food without a schedule takes the dropped one's, with its N", async () => {
        const { foods, keep, drop } = await pair(
            {},
            {
                restockSchedule: "every_n_weeks",
                restockEveryWeeks: 2,
                restockWhenLow: true,
                restockLowLevel: 4,
                lastRestockedOn: "2026-11-01",
            },
        );
        const merged = await mergeFoods(foods, HH, keep.id, drop.id);
        expect(merged.restockSchedule).toBe("every_n_weeks");
        expect(merged.restockEveryWeeks).toBe(2);
        expect(merged.restockWhenLow).toBe(true);
        expect(merged.restockLowLevel).toBe(4);
        expect(merged.lastRestockedOn).toBe("2026-11-01");
    });

    test("a discarded schedule's paused flag does not pause the kept one", async () => {
        const { foods, keep, drop } = await pair(
            { restockSchedule: "weekly", lastRestockedOn: "2026-11-09" },
            {
                restockSchedule: "monthly",
                restockPaused: true,
                restockWhenLow: true,
                lastRestockedOn: "2026-11-01",
            },
        );
        const merged = await mergeFoods(foods, HH, keep.id, drop.id);
        expect(merged.restockSchedule).toBe("weekly");
        expect(merged.restockPaused).toBe(false);
        expect(merged.restockWhenLow).toBe(false);
        expect(merged.lastRestockedOn).toBe("2026-11-09");
    });

    test("a dropped schedule that wins brings its paused flag and drops the kept one's", async () => {
        const { foods, keep, drop } = await pair(
            { restockPaused: true, restockWhenLow: true },
            { restockSchedule: "monthly", lastRestockedOn: "2026-11-01" },
        );
        const merged = await mergeFoods(foods, HH, keep.id, drop.id);
        expect(merged.restockSchedule).toBe("monthly");
        expect(merged.restockPaused).toBe(false);
        expect(merged.restockWhenLow).toBe(false);
    });

    test("with no schedule on either side, either side's paused and add-when-low stand", async () => {
        const { foods, keep, drop } = await pair(
            { restockWhenLow: true },
            { restockPaused: true },
        );
        const merged = await mergeFoods(foods, HH, keep.id, drop.id);
        expect(merged.restockSchedule).toBeNull();
        expect(merged.restockPaused).toBe(true);
        expect(merged.restockWhenLow).toBe(true);
    });

    test("a dropped low level is not borrowed when the kept food measures in its own unit", () => {
        const keep = newFood({
            householdId: HH,
            kind: "food",
            name: "Milk",
            usualAmount: { amount: 2000, unit: "ml" },
        });
        const drop = newFood({
            householdId: HH,
            kind: "food",
            name: "Milks",
            usualAmount: { amount: 4, unit: "each" },
            restockLowLevel: 1,
        });
        expect(mergedFoodFields(keep, drop).restockLowLevel).toBeNull();
    });
});

describe("setUsualSchedule", () => {
    test("sets the schedule and keeps the fields it does not mention", async () => {
        const { foods, plain } = await seed();
        const saved = await setUsualSchedule(foods, HH, plain.id, {
            restockSchedule: "weekly",
            restockWhenLow: false,
        });
        expect(saved.restockSchedule).toBe("weekly");
        expect(saved.restockEveryWeeks).toBeNull();
        expect(saved.restockWhenLow).toBe(false);
        expect(saved.restockPaused).toBe(true);
        expect(saved.restockLowLevel).toBe(6);
        expect(saved.lastRestockedOn).toBe("2026-11-02");
        expect(saved.usualAmount).toEqual({ amount: 24, unit: "each" });
        expect(scheduleOf((await foods.getFood(HH, plain.id))!)).toEqual(
            scheduleOf(saved),
        );
    });

    test("every N weeks takes its number, and N changes alone while the schedule stays", async () => {
        const { foods, plain } = await seed();
        const saved = await setUsualSchedule(foods, HH, plain.id, {
            restockEveryWeeks: 5,
        });
        expect(saved.restockSchedule).toBe("every_n_weeks");
        expect(saved.restockEveryWeeks).toBe(5);
    });

    test("a form's text is accepted: blanks clear, numbers parse", async () => {
        const { foods, plain } = await seed();
        const saved = await setUsualSchedule(foods, HH, plain.id, {
            restockSchedule: "every_n_weeks",
            restockEveryWeeks: "4",
            restockLowLevel: "  ",
            lastRestockedOn: "",
        });
        expect(saved.restockEveryWeeks).toBe(4);
        expect(saved.restockLowLevel).toBeNull();
        expect(saved.lastRestockedOn).toBeNull();
        const none = await setUsualSchedule(foods, HH, plain.id, {
            restockSchedule: "",
        });
        expect(none.restockSchedule).toBeNull();
        expect(none.restockEveryWeeks).toBeNull();
        expect(none.restockPaused).toBe(true);
    });

    test("a patch that changes nothing writes nothing", async () => {
        const { foods, plain } = await seed();
        const before = await foods.getFood(HH, plain.id);
        const saved = await setUsualSchedule(foods, HH, plain.id, {
            restockPaused: true,
            restockLowLevel: 6,
        });
        expect(saved).toEqual(before!);
        expect(await foods.getFood(HH, plain.id)).toEqual(before!);
        expect(await setUsualSchedule(foods, HH, plain.id, {})).toEqual(
            before!,
        );
    });

    test("refuses a product, an archived food and an unknown food", async () => {
        const { foods, plain, product } = await seed();
        await expect(
            setUsualSchedule(foods, HH, product.id, {
                restockSchedule: "weekly",
            }),
        ).rejects.toThrow("product of another food");
        await expect(
            setUsualSchedule(foods, HH, "nope", { restockSchedule: "weekly" }),
        ).rejects.toThrow("Unknown food.");
        await updateFood(foods, HH, plain.id, { archived: true });
        await expect(
            setUsualSchedule(foods, HH, plain.id, {
                restockSchedule: "weekly",
            }),
        ).rejects.toThrow("Unknown food.");
    });

    test("a refused patch leaves the record as it was", async () => {
        const { foods, plain } = await seed();
        const before = await foods.getFood(HH, plain.id);
        await expect(
            setUsualSchedule(foods, HH, plain.id, {
                restockPaused: false,
                restockLowLevel: -1,
            }),
        ).rejects.toThrow(FoodsInputError);
        expect(await foods.getFood(HH, plain.id)).toEqual(before!);
    });
});

describe("applyUsualSchedulePatch validation", () => {
    const none = NO_USUAL_SCHEDULE;

    test("accepts each schedule and clears with null", () => {
        expect(
            applyUsualSchedulePatch(none, { restockSchedule: "weekly" })
                .restockSchedule,
        ).toBe("weekly");
        expect(
            applyUsualSchedulePatch(none, { restockSchedule: "monthly" })
                .restockSchedule,
        ).toBe("monthly");
        expect(
            applyUsualSchedulePatch(
                { ...none, restockSchedule: "weekly" },
                { restockSchedule: null },
            ).restockSchedule,
        ).toBeNull();
    });

    test("rejects an unknown schedule", () => {
        expect(() =>
            applyUsualSchedulePatch(none, { restockSchedule: "daily" }),
        ).toThrow("Pick weekly, every N weeks, monthly, or no schedule.");
    });

    test("every N weeks needs a whole number from 1 up", () => {
        const every = { restockSchedule: "every_n_weeks" };
        expect(() => applyUsualSchedulePatch(none, every)).toThrow(
            "Enter how many weeks between restocks.",
        );
        for (const bad of [0, -2, 1.5, "abc", RESTOCK_MAX_EVERY_WEEKS + 1]) {
            expect(() =>
                applyUsualSchedulePatch(none, {
                    ...every,
                    restockEveryWeeks: bad,
                }),
            ).toThrow("Enter a whole number of weeks");
        }
        expect(
            applyUsualSchedulePatch(none, {
                ...every,
                restockEveryWeeks: RESTOCK_MAX_EVERY_WEEKS,
            }).restockEveryWeeks,
        ).toBe(RESTOCK_MAX_EVERY_WEEKS);
    });

    test("no other schedule takes a number of weeks", () => {
        for (const restockSchedule of ["weekly", "monthly", null]) {
            expect(() =>
                applyUsualSchedulePatch(none, {
                    restockSchedule,
                    restockEveryWeeks: 2,
                }),
            ).toThrow("Only an every N weeks schedule takes a number");
        }
        expect(() =>
            applyUsualSchedulePatch(
                { ...none, restockSchedule: "weekly" },
                { restockEveryWeeks: 2 },
            ),
        ).toThrow("Only an every N weeks schedule takes a number");
    });

    test("switching away from every N weeks drops its number", () => {
        const next = applyUsualSchedulePatch(SCHEDULED, {
            restockSchedule: "monthly",
        });
        expect(next.restockSchedule).toBe("monthly");
        expect(next.restockEveryWeeks).toBeNull();
        const keepsN = applyUsualSchedulePatch(SCHEDULED, {
            restockSchedule: "every_n_weeks",
        });
        expect(keepsN.restockEveryWeeks).toBe(3);
    });

    test("the low level is zero or more, blank clears", () => {
        expect(
            applyUsualSchedulePatch(none, { restockLowLevel: 0 })
                .restockLowLevel,
        ).toBe(0);
        expect(
            applyUsualSchedulePatch(none, { restockLowLevel: "2.5" })
                .restockLowLevel,
        ).toBe(2.5);
        expect(
            applyUsualSchedulePatch(
                { ...none, restockLowLevel: 3 },
                { restockLowLevel: null },
            ).restockLowLevel,
        ).toBeNull();
        for (const bad of [-0.1, "x", Number.NaN, Infinity]) {
            expect(() =>
                applyUsualSchedulePatch(none, { restockLowLevel: bad }),
            ).toThrow("The low level must be zero or more.");
        }
    });

    test("paused and add-when-low are booleans", () => {
        expect(
            applyUsualSchedulePatch(none, { restockPaused: true })
                .restockPaused,
        ).toBe(true);
        expect(() =>
            applyUsualSchedulePatch(none, {
                restockPaused: "yes" as unknown as boolean,
            }),
        ).toThrow("Paused must be on or off.");
        expect(() =>
            applyUsualSchedulePatch(none, {
                restockWhenLow: null as unknown as boolean,
            }),
        ).toThrow("Add when low must be on or off.");
    });

    test("the last restocked day is a real calendar day", () => {
        expect(
            applyUsualSchedulePatch(none, { lastRestockedOn: "2028-02-29" })
                .lastRestockedOn,
        ).toBe("2028-02-29");
        for (const bad of ["2026-02-30", "2026-13-01", "11/09/2026", "today"]) {
            expect(() =>
                applyUsualSchedulePatch(none, { lastRestockedOn: bad }),
            ).toThrow("Enter the date as YYYY-MM-DD.");
        }
    });
});

describe("markUsualRestocked", () => {
    test("stamps the plain food", async () => {
        const { foods, plain } = await seed();
        const saved = await markUsualRestocked(
            foods,
            HH,
            plain.id,
            "2026-11-10",
        );
        expect(saved?.lastRestockedOn).toBe("2026-11-10");
        expect(scheduleOf(saved!)).toEqual({
            ...SCHEDULED,
            lastRestockedOn: "2026-11-10",
        });
    });

    test("a product stamps its plain food, not itself", async () => {
        const { foods, plain, product } = await seed();
        const saved = await markUsualRestocked(
            foods,
            HH,
            product.id,
            "2026-11-10",
        );
        expect(saved?.id).toBe(plain.id);
        expect((await foods.getFood(HH, plain.id))?.lastRestockedOn).toBe(
            "2026-11-10",
        );
        expect(
            (await foods.getFood(HH, product.id))?.lastRestockedOn,
        ).toBeNull();
    });

    test("the date only moves forward", async () => {
        const { foods, plain } = await seed();
        const same = await markUsualRestocked(
            foods,
            HH,
            plain.id,
            "2026-11-02",
        );
        expect(same?.lastRestockedOn).toBe("2026-11-02");
        const older = await markUsualRestocked(
            foods,
            HH,
            plain.id,
            "2026-10-01",
        );
        expect(older?.lastRestockedOn).toBe("2026-11-02");
    });

    test("a food with no schedule still records the day", async () => {
        const foods = createMemoryFoodsStore();
        const milk = await foods.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Milk" }),
        );
        const saved = await markUsualRestocked(
            foods,
            HH,
            milk.id,
            "2026-11-10",
        );
        expect(saved?.lastRestockedOn).toBe("2026-11-10");
        expect(saved?.restockSchedule).toBeNull();
    });

    test("returns null for an unknown or archived food and rejects a bad day", async () => {
        const { foods, plain } = await seed();
        expect(await markUsualRestocked(foods, HH, "nope", "2026-11-10")).toBe(
            null,
        );
        await expect(
            markUsualRestocked(foods, HH, plain.id, "2026-02-31"),
        ).rejects.toThrow("Enter the date as YYYY-MM-DD.");
        await expect(
            markUsualRestocked(foods, HH, plain.id, ""),
        ).rejects.toThrow("Enter the date as YYYY-MM-DD.");
        await updateFood(foods, HH, plain.id, { archived: true });
        expect(
            await markUsualRestocked(foods, HH, plain.id, "2026-11-10"),
        ).toBe(null);
    });
});

describe("usualLowLevel", () => {
    test("the household's own level wins, even zero", () => {
        expect(
            usualLowLevel({
                restockLowLevel: 6,
                usualAmount: { amount: 24, unit: "each" },
            }),
        ).toBe(6);
        expect(
            usualLowLevel({
                restockLowLevel: 0,
                usualAmount: { amount: 24, unit: "each" },
            }),
        ).toBe(0);
    });

    test("defaults to a quarter of the usual amount, computed rather than stored", () => {
        expect(
            usualLowLevel({
                restockLowLevel: null,
                usualAmount: { amount: 24, unit: "each" },
            }),
        ).toBe(6);
        expect(
            usualLowLevel({
                restockLowLevel: null,
                usualAmount: { amount: 2, unit: "l" },
            }),
        ).toBe(0.5);
    });

    test("is unknown with neither a level nor a usual amount", () => {
        expect(
            usualLowLevel({ restockLowLevel: null, usualAmount: null }),
        ).toBeNull();
    });
});

describe("row mapping", () => {
    const base = foodToRow(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );

    test("foodToRow writes the six columns and foodFromRow reads them back", () => {
        const food = newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            ...SCHEDULED,
        });
        const row = foodToRow(food);
        expect(row.restock_schedule).toBe("every_n_weeks");
        expect(row.restock_every_weeks).toBe(3);
        expect(row.restock_paused).toBe(true);
        expect(row.restock_when_low).toBe(true);
        expect(row.restock_low_level).toBe(6);
        expect(row.last_restocked_on).toBe("2026-11-02");
        expect(scheduleOf(foodFromRow(row as never))).toEqual(SCHEDULED);
    });

    test("a row from before the migration reads as no schedule", () => {
        const legacy = Object.fromEntries(
            Object.entries(base).filter(([key]) => !key.startsWith("restock")),
        );
        delete (legacy as Record<string, unknown>).last_restocked_on;
        expect(scheduleOf(foodFromRow(legacy as never))).toEqual(
            NO_USUAL_SCHEDULE,
        );
    });

    test("numeric text and date values from Postgres are read", () => {
        const food = foodFromRow({
            ...base,
            restock_schedule: "weekly",
            restock_every_weeks: null,
            restock_paused: false,
            restock_when_low: true,
            restock_low_level: "2.5",
            last_restocked_on: new Date("2026-11-09T00:00:00.000Z"),
        } as never);
        expect(food.restockLowLevel).toBe(2.5);
        expect(food.lastRestockedOn).toBe("2026-11-09");
        expect(
            foodFromRow({
                ...base,
                last_restocked_on: "2026-11-09",
            } as never).lastRestockedOn,
        ).toBe("2026-11-09");
    });

    test("an unknown schedule value reads as none", () => {
        const food = foodFromRow({
            ...base,
            restock_schedule: "daily",
            restock_every_weeks: 0,
        } as never);
        expect(food.restockSchedule).toBeNull();
        expect(food.restockEveryWeeks).toBeNull();
    });
});
