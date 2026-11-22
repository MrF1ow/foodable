import { describe, expect, test } from "bun:test";
import { notifierFor } from "../db/notify.js";
import { createMemoryNotificationsStore } from "./notifications.js";
import { createMemoryRecipesStore, createRecipe } from "./recipes.js";
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
    movePlannedRecipe,
    unplanRecipe,
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

describe("week plan notifications", () => {
    const HH = "hh-1";
    const ALICE = "alice";
    const BOB = "bob";
    const CAROL = "carol";

    async function household(recipientsOn: string[]) {
        const notifications = createMemoryNotificationsStore();
        for (const userId of recipientsOn) {
            await notifications.upsertPref({
                householdId: HH,
                userId,
                kind: "week_plan_changes",
                enabled: true,
                updatedAt: "2026-11-12T10:00:00.000Z",
            });
        }
        const deps = {
            store: notifications,
            listMembers: async () => [
                { userId: ALICE, role: "owner" as const },
                { userId: BOB, role: "member" as const },
                { userId: CAROL, role: "member" as const },
            ],
            log: () => {},
        };
        return { notifications, notify: notifierFor(deps, HH, ALICE) };
    }

    async function setup() {
        const recipes = createMemoryRecipesStore();
        const recipe = await createRecipe(recipes, {
            householdId: HH,
            creatorId: ALICE,
            name: "Beef chili",
            yieldPortions: 4,
        });
        const plans = createMemoryPlansStore();
        const input = {
            householdId: HH,
            recipeId: recipe.id,
            recipeName: recipe.name,
            recipeYield: recipe.yieldPortions,
            date: "2026-11-13",
            slot: "dinner",
            servings: null,
            today: "2026-11-12",
            createdBy: ALICE,
        } as const;
        return { recipes, recipe, plans, input };
    }

    test("planning a recipe tells the others who have it on, never the person who planned it", async () => {
        const { notifications, notify } = await household([ALICE, BOB]);
        const { plans, recipe, input } = await setup();
        await planRecipe(plans, input, { notify });
        const rows = await notifications.listForHousehold(HH);
        expect(rows.map((r) => r.recipientUserId)).toEqual([BOB]);
        expect(rows[0]).toMatchObject({
            kind: "week_plan_changes",
            actorUserId: ALICE,
            subjectKind: "recipe",
            subjectId: recipe.id,
            payload: {
                recipeName: "Beef chili",
                date: "2026-11-13",
                slot: "dinner",
                change: "planned",
            },
        });
    });

    test("members who have the kind off get nothing", async () => {
        const { notifications, notify } = await household([]);
        const { plans, input } = await setup();
        await planRecipe(plans, input, { notify });
        expect(await notifications.listForHousehold(HH)).toEqual([]);
    });

    test("planning the same recipe, day and slot again is not a change, so it sends nothing", async () => {
        const { notifications, notify } = await household([BOB]);
        const { plans, input } = await setup();
        await planRecipe(plans, input, { notify });
        const again = await planRecipe(plans, input, { notify });
        expect(again?.alreadyPlanned).toBe(true);
        expect(await notifications.listForHousehold(HH)).toHaveLength(1);
    });

    test("a plan that is refused or finds no recipe sends nothing", async () => {
        const { notifications, notify } = await household([BOB]);
        const { plans, input } = await setup();
        await expect(
            planRecipe(plans, { ...input, date: "2026-11-11" }, { notify }),
        ).rejects.toThrow("Pick today or a later day.");
        const unknown = createMemoryPlansStore({
            recipeInHousehold: () => false,
        });
        expect(await planRecipe(unknown, input, { notify })).toBeNull();
        const failing = {
            ...plans,
            addPlan: async () => {
                throw new Error("database is down");
            },
        };
        await expect(planRecipe(failing, input, { notify })).rejects.toThrow(
            "database is down",
        );
        expect(await notifications.listForHousehold(HH)).toEqual([]);
    });

    test("unplanRecipe removes the entry and tells the others, with the name and day it had", async () => {
        const { notifications, notify } = await household([ALICE, BOB]);
        const { recipes, recipe, plans, input } = await setup();
        const planned = await planRecipe(plans, input);
        const removed = await unplanRecipe(plans, HH, planned!.plan.id, {
            recipes,
            notify,
        });
        expect(removed).toBe(true);
        expect(await plans.getPlan(HH, planned!.plan.id)).toBeNull();
        const rows = await notifications.listForHousehold(HH);
        expect(rows.map((r) => r.recipientUserId)).toEqual([BOB]);
        expect(rows[0]).toMatchObject({
            kind: "week_plan_changes",
            subjectKind: "recipe",
            subjectId: recipe.id,
            payload: {
                recipeName: "Beef chili",
                date: "2026-11-13",
                slot: "dinner",
                change: "unplanned",
            },
        });
    });

    test("unplanRecipe whose name lookup fails still unplans, and the event goes unnamed", async () => {
        const { notifications, notify } = await household([ALICE, BOB]);
        const { plans, input } = await setup();
        const planned = await planRecipe(plans, input);
        const recipes = {
            getRecipe: async () => {
                throw new Error("statement timeout");
            },
        };
        expect(
            await unplanRecipe(plans, HH, planned!.plan.id, {
                recipes,
                notify,
            }),
        ).toBe(true);
        expect(await plans.getPlan(HH, planned!.plan.id)).toBeNull();
        const rows = await notifications.listForHousehold(HH);
        expect(rows.map((r) => r.recipientUserId)).toEqual([BOB]);
        expect(rows[0]?.payload).toMatchObject({
            recipeName: null,
            change: "unplanned",
        });
    });

    test("unplanRecipe given the recipe's name does not read the recipe", async () => {
        const { notifications, notify } = await household([ALICE, BOB]);
        const { plans, input } = await setup();
        const planned = await planRecipe(plans, input);
        let reads = 0;
        const recipes = {
            getRecipe: async () => {
                reads++;
                return null;
            },
        };
        expect(
            await unplanRecipe(plans, HH, planned!.plan.id, {
                recipes,
                notify,
                recipeName: "Beef chili",
            }),
        ).toBe(true);
        expect(reads).toBe(0);
        const rows = await notifications.listForHousehold(HH);
        expect(rows[0]?.payload).toMatchObject({ recipeName: "Beef chili" });
    });

    test("movePlannedRecipe to another day or meal tells the others where it was and where it is", async () => {
        const { notifications, notify } = await household([ALICE, BOB]);
        const { recipes, recipe, plans, input } = await setup();
        const planned = await planRecipe(plans, input);
        const moved = await movePlannedRecipe(
            plans,
            HH,
            planned!.plan,
            { date: "2026-11-14", slot: "lunch" },
            { recipes, notify },
        );
        expect(moved).toMatchObject({ date: "2026-11-14", slot: "lunch" });
        const rows = await notifications.listForHousehold(HH);
        expect(rows.map((r) => r.recipientUserId)).toEqual([BOB]);
        expect(rows[0]).toMatchObject({
            kind: "week_plan_changes",
            subjectId: recipe.id,
            payload: {
                recipeName: "Beef chili",
                change: "moved",
                date: "2026-11-14",
                slot: "lunch",
                fromDate: "2026-11-13",
                fromSlot: "dinner",
            },
        });
    });

    test("movePlannedRecipe that only changes servings sends nothing", async () => {
        const { notifications, notify } = await household([ALICE, BOB]);
        const { recipes, plans, input } = await setup();
        const planned = await planRecipe(plans, input);
        const moved = await movePlannedRecipe(
            plans,
            HH,
            planned!.plan,
            { date: planned!.plan.date, slot: planned!.plan.slot, servings: 6 },
            { recipes, notify },
        );
        expect(moved?.servings).toBe(6);
        expect(await notifications.listForHousehold(HH)).toEqual([]);
    });

    test("movePlannedRecipe onto the same recipe already planned there merges and sends one event", async () => {
        const { notifications, notify } = await household([ALICE, BOB]);
        const { recipes, plans, input } = await setup();
        const first = await planRecipe(plans, input);
        const second = await planRecipe(plans, {
            ...input,
            date: "2026-11-14",
        });
        const merged = await movePlannedRecipe(
            plans,
            HH,
            second!.plan,
            { date: first!.plan.date, slot: first!.plan.slot },
            { recipes, notify },
        );
        expect(merged?.id).toBe(first!.plan.id);
        expect(await plans.getPlan(HH, second!.plan.id)).toBeNull();
        const rows = await notifications.listForHousehold(HH);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.payload).toMatchObject({
            change: "moved",
            fromDate: "2026-11-14",
        });
    });

    test("movePlannedRecipe whose name lookup fails still moves, and a missing plan sends nothing", async () => {
        const { notifications, notify } = await household([ALICE, BOB]);
        const { plans, input } = await setup();
        const planned = await planRecipe(plans, input);
        const recipes = {
            getRecipe: async () => {
                throw new Error("statement timeout");
            },
        };
        const moved = await movePlannedRecipe(
            plans,
            HH,
            planned!.plan,
            { date: "2026-11-14", slot: "dinner" },
            { recipes, notify },
        );
        expect(moved?.date).toBe("2026-11-14");
        expect(
            await movePlannedRecipe(
                plans,
                HH,
                { ...planned!.plan, id: crypto.randomUUID() },
                { date: "2026-11-15", slot: "dinner" },
                { recipes, notify },
            ),
        ).toBeNull();
        const rows = await notifications.listForHousehold(HH);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.payload).toMatchObject({ recipeName: null });
    });

    test("unplanRecipe of an entry that is not there is false and sends nothing", async () => {
        const { notifications, notify } = await household([BOB]);
        const { recipes, plans } = await setup();
        expect(
            await unplanRecipe(plans, HH, "no-such-plan", { recipes, notify }),
        ).toBe(false);
        expect(await notifications.listForHousehold(HH)).toEqual([]);
    });

    test("unplanRecipe whose delete fails sends nothing", async () => {
        const { notifications, notify } = await household([BOB]);
        const { recipes, plans, input } = await setup();
        const planned = await planRecipe(plans, input);
        const failing = {
            ...plans,
            getPlan: plans.getPlan.bind(plans),
            removePlan: async () => {
                throw new Error("database is down");
            },
        };
        await expect(
            unplanRecipe(failing, HH, planned!.plan.id, { recipes, notify }),
        ).rejects.toThrow("database is down");
        expect(await notifications.listForHousehold(HH)).toEqual([]);
    });

    test("unplanRecipe with no notify dep only removes the entry", async () => {
        const { recipes, plans, input } = await setup();
        const planned = await planRecipe(plans, input);
        expect(
            await unplanRecipe(plans, HH, planned!.plan.id, { recipes }),
        ).toBe(true);
    });
});
