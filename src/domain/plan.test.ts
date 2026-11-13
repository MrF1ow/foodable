import { describe, expect, test } from "bun:test";
import {
    PLAN_SERVINGS_MAX,
    PLAN_SLOTS,
    PlanInputError,
    checkPlanDay,
    checkPlanServings,
    checkPlanServingsCapped,
    createMemoryPlansStore,
    isPlanDate,
    isPlanSlot,
    planRecipe,
    planSlotRank,
} from "./plan.js";

describe("plan input checks", () => {
    test("a date is a real calendar day written YYYY-MM-DD", () => {
        expect(isPlanDate("2026-11-12")).toBe(true);
        expect(isPlanDate("2028-02-29")).toBe(true);
        expect(isPlanDate("2026-02-29")).toBe(false);
        expect(isPlanDate("2026-13-01")).toBe(false);
        expect(isPlanDate("2026-11-31")).toBe(false);
        expect(isPlanDate("0000-01-01")).toBe(false);
        expect(isPlanDate("2026-1-2")).toBe(false);
        expect(isPlanDate("2026-11-12T10:00:00Z")).toBe(false);
        expect(isPlanDate(20261112)).toBe(false);
    });

    test("slots are the four meals, in the order of the day", () => {
        expect(PLAN_SLOTS.map(planSlotRank)).toEqual([0, 1, 2, 3]);
        expect(isPlanSlot("dinner")).toBe(true);
        expect(isPlanSlot("brunch")).toBe(false);
        expect(isPlanSlot(undefined)).toBe(false);
    });

    test("servings must be a number above zero", () => {
        expect(checkPlanServings(0.25)).toBe(0.25);
        for (const bad of [0, -2, Number.NaN, Infinity, "2", null]) {
            expect(() => checkPlanServings(bad)).toThrow(PlanInputError);
        }
    });
});

describe("memory plans store recipe guard", () => {
    test("plans only recipes the household owns when it is asked to check", async () => {
        const household = crypto.randomUUID();
        const mine = crypto.randomUUID();
        const store = createMemoryPlansStore({
            recipeInHousehold: (h, r) => h === household && r === mine,
        });
        expect(
            await store.addPlan({
                householdId: household,
                recipeId: crypto.randomUUID(),
                date: "2026-11-12",
                slot: "lunch",
            }),
        ).toBeNull();
        expect(
            await store.addPlan({
                householdId: household,
                recipeId: mine,
                date: "2026-11-12",
                slot: "lunch",
            }),
        ).not.toBeNull();
    });

    test("returns copies, so a caller cannot edit a stored plan", async () => {
        const household = crypto.randomUUID();
        const store = createMemoryPlansStore();
        const plan = await store.addPlan({
            householdId: household,
            recipeId: crypto.randomUUID(),
            date: "2026-11-12",
            slot: "lunch",
        });
        plan!.servings = 99;
        expect((await store.getPlan(household, plan!.id))?.servings).toBe(1);
    });
});

describe("checkPlanDay", () => {
    test("a real day that is today or later passes", () => {
        expect(checkPlanDay("2026-11-12", "2026-11-12")).toBe("2026-11-12");
        expect(checkPlanDay("2026-12-01", "2026-11-12")).toBe("2026-12-01");
    });

    test("yesterday and a malformed day are refused", () => {
        expect(() => checkPlanDay("2026-11-11", "2026-11-12")).toThrow(
            "Pick today or a later day.",
        );
        expect(() => checkPlanDay("tomorrow", "2026-11-12")).toThrow(
            PlanInputError,
        );
    });
});

describe("checkPlanServingsCapped", () => {
    test("allows up to the ceiling and refuses above it", () => {
        expect(PLAN_SERVINGS_MAX).toBe(999);
        expect(checkPlanServingsCapped(999)).toBe(999);
        expect(() => checkPlanServingsCapped(1000)).toThrow(
            "Keep it to 999 servings or fewer.",
        );
        expect(() => checkPlanServingsCapped(0)).toThrow(PlanInputError);
    });
});

describe("planRecipe", () => {
    const HH = "hh-1";
    const base = {
        householdId: HH,
        recipeId: "r-1",
        recipeYield: 4,
        date: "2026-11-13",
        slot: "dinner",
        servings: null,
        today: "2026-11-12",
        createdBy: "u-1",
    } as const;

    test("plans the recipe at its yield when no servings are given", async () => {
        const store = createMemoryPlansStore();
        const out = await planRecipe(store, base);
        expect(out?.alreadyPlanned).toBe(false);
        expect(out?.plan).toMatchObject({
            recipeId: "r-1",
            date: "2026-11-13",
            slot: "dinner",
            servings: 4,
            createdBy: "u-1",
        });
    });

    test("the same recipe, day and slot twice is one plan", async () => {
        const store = createMemoryPlansStore();
        const first = await planRecipe(store, base);
        const again = await planRecipe(store, { ...base, servings: 9 });
        expect(again?.alreadyPlanned).toBe(true);
        expect(again?.plan.id).toBe(first!.plan.id);
        expect(
            await store.listPlans(HH, "2026-11-13", "2026-11-13"),
        ).toHaveLength(1);
    });

    test("a different slot is a new plan", async () => {
        const store = createMemoryPlansStore();
        await planRecipe(store, base);
        const lunch = await planRecipe(store, { ...base, slot: "lunch" });
        expect(lunch?.alreadyPlanned).toBe(false);
    });

    test("refuses a past day, a bad slot and too many servings, writing nothing", async () => {
        const store = createMemoryPlansStore();
        await expect(
            planRecipe(store, { ...base, date: "2026-11-11" }),
        ).rejects.toThrow("Pick today or a later day.");
        await expect(
            planRecipe(store, { ...base, slot: "brunch" }),
        ).rejects.toThrow(PlanInputError);
        await expect(
            planRecipe(store, { ...base, servings: 1000 }),
        ).rejects.toThrow("Keep it to 999 servings or fewer.");
        expect(await store.listPlans(HH, "2026-11-01", "2026-12-31")).toEqual(
            [],
        );
    });

    test("null when the store does not know the recipe", async () => {
        const store = createMemoryPlansStore({
            recipeInHousehold: () => false,
        });
        expect(await planRecipe(store, base)).toBeNull();
    });
});
