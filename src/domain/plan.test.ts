import { describe, expect, test } from "bun:test";
import {
    PLAN_SLOTS,
    PlanInputError,
    checkPlanServings,
    createMemoryPlansStore,
    isPlanDate,
    isPlanSlot,
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
