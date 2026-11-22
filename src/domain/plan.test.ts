import { describe, expect, test } from "bun:test";
import { notifierFor } from "../db/notify.js";
import { createMemoryFoodsStore, newFood } from "./foods.js";
import { createMemoryFridgeStore } from "./fridge.js";
import { createMemoryGroceryStore } from "./grocery.js";
import { createMemoryNoticeDismissalsStore } from "./notice-dismissals.js";
import { actOnNotice } from "./notice-actions.js";
import { createMemoryWeighInStore } from "./notices-actionable.js";
import { noticesFor } from "./notices-for.js";
import { createMemoryNotificationsStore } from "./notifications.js";
import { createMemoryRecipesStore, createRecipe } from "./recipes.js";
import { createGroceryStore, createMemorySettingsStore } from "./settings.js";
import {
    PLAN_SERVINGS_MAX,
    PLAN_SLOTS,
    PlanInputError,
    checkPlanDay,
    checkPlanServings,
    checkPlanServingsCapped,
    createMemoryPlansStore,
    expandRules,
    isPlanDate,
    isPlanSlot,
    planEntries,
    repeatPatternWords,
    planRecipe,
    planSlotRank,
    planWeekStart,
    rulesShareDay,
    movePlannedRecipe,
    unplanRecipe,
    type PlanRule,
    type PlansStore,
    type RecipePlan,
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

    test("a week starts on its Monday, and Sunday belongs to the week before", () => {
        expect(planWeekStart("2026-11-09")).toBe("2026-11-09"); // Monday
        expect(planWeekStart("2026-11-12")).toBe("2026-11-09"); // Thursday
        expect(planWeekStart("2026-11-15")).toBe("2026-11-09"); // Sunday
        expect(planWeekStart("2026-11-16")).toBe("2026-11-16");
        expect(planWeekStart("2027-01-01")).toBe("2026-12-28"); // across a year
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
        expect(moved?.alreadyPlanned).toBe(false);
        expect(moved?.plan).toMatchObject({
            date: "2026-11-14",
            slot: "lunch",
        });
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
        expect(moved?.plan.servings).toBe(6);
        expect(await notifications.listForHousehold(HH)).toEqual([]);
    });

    test("movePlannedRecipe onto the same recipe already planned there is already planned: nothing moves and nothing is sent", async () => {
        const { notifications, notify } = await household([ALICE, BOB]);
        const { recipes, plans, input } = await setup();
        const first = await planRecipe(plans, { ...input, servings: 2 });
        const second = await planRecipe(plans, {
            ...input,
            date: "2026-11-14",
            servings: 3,
        });
        const before = (await notifications.listForHousehold(HH)).length;
        const out = await movePlannedRecipe(
            plans,
            HH,
            second!.plan,
            { date: first!.plan.date, slot: first!.plan.slot, servings: 9 },
            { recipes, notify },
        );
        expect(out?.alreadyPlanned).toBe(true);
        expect(out?.plan).toEqual(first!.plan);
        // Both plans stay as they were, servings and all.
        expect(
            (await plans.listPlans(HH, "2026-11-01", "2026-11-30")).map((p) => [
                p.id,
                p.date,
                p.servings,
            ]),
        ).toEqual([
            [first!.plan.id, first!.plan.date, 2],
            [second!.plan.id, "2026-11-14", 3],
        ]);
        expect((await notifications.listForHousehold(HH)).length).toBe(before);
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
        expect(moved?.plan.date).toBe("2026-11-14");
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

const RULE_HOUSEHOLD = "11111111-1111-4111-8111-111111111111";
const RULE_RECIPE = "22222222-2222-4222-8222-222222222222";
const RULE_ID = "33333333-3333-4333-8333-333333333333";

function rule(over: Partial<PlanRule> = {}): PlanRule {
    return {
        id: RULE_ID,
        householdId: RULE_HOUSEHOLD,
        recipeId: RULE_RECIPE,
        slot: "dinner",
        servings: 2,
        startsOn: "2026-11-02", // a Monday
        repeat: "daily",
        days: [],
        endsOn: null,
        skippedOn: [],
        createdBy: null,
        createdAt: "2026-11-01T10:00:00+00:00",
        ...over,
    };
}

const datesOf = (rules: PlanRule[], from: string, to: string) =>
    expandRules(rules, from, to).map((e) => e.date);

describe("repeating plans", () => {
    const HH = "hh-1";
    const ALICE = "alice";
    const BOB = "bob";

    async function household() {
        const notifications = createMemoryNotificationsStore();
        await notifications.upsertPref({
            householdId: HH,
            userId: BOB,
            kind: "week_plan_changes",
            enabled: true,
            updatedAt: "2026-11-12T10:00:00.000Z",
        });
        const notify = notifierFor(
            {
                store: notifications,
                listMembers: async () => [
                    { userId: ALICE, role: "owner" as const },
                    { userId: BOB, role: "member" as const },
                ],
                log: () => {},
            },
            HH,
            ALICE,
        );
        return { notifications, notify };
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
            date: "2026-11-12", // a Thursday
            slot: "dinner",
            servings: null,
            repeat: "weekdays",
            today: "2026-11-12",
            createdBy: ALICE,
        } as const;
        return { recipes, recipe, plans, input };
    }

    const week = (plans: PlansStore) =>
        plans.listPlans(HH, "2026-11-12", "2026-11-19");

    test("a repeat started over a one-off comes back as the next day it shows", async () => {
        const { plans, input } = await setup();
        await plans.addPlan({
            householdId: HH,
            recipeId: input.recipeId,
            date: "2026-11-12",
            slot: "dinner",
            servings: 3,
            createdBy: ALICE,
        });
        const out = await planRecipe(plans, {
            ...input,
            repeat: "daily",
            servings: 2,
        });
        expect(out?.alreadyPlanned).toBe(false);
        expect(out?.plan).toMatchObject({
            date: "2026-11-13",
            slot: "dinner",
            servings: 2,
        });
        expect(out?.plan.ruleId).toBeDefined();
        const [thursday] = await plans.listPlans(
            HH,
            "2026-11-12",
            "2026-11-12",
        );
        // The one-off holds the day with its own servings.
        expect(thursday).toMatchObject({ servings: 3 });
        expect(thursday?.ruleId).toBeUndefined();
    });

    test("a repeat with a one-off on every day it covers comes back as the first one-off", async () => {
        const { plans, input } = await setup();
        for (let day = 0; day < 400; day++) {
            const date = new Date(Date.UTC(2026, 10, 12 + day))
                .toISOString()
                .slice(0, 10);
            await plans.addPlan({
                householdId: HH,
                recipeId: input.recipeId,
                date,
                slot: "dinner",
                servings: 3,
                createdBy: ALICE,
            });
        }
        const out = await planRecipe(plans, {
            ...input,
            repeat: "daily",
            servings: 2,
        });
        expect(out?.plan).toMatchObject({ date: "2026-11-12", servings: 3 });
        expect(out?.plan.ruleId).toBeUndefined();
    });

    test("a repeat is one stored rule, and the plan that comes back is its first day", async () => {
        const { plans, input } = await setup();
        const out = await planRecipe(plans, input);
        expect(out?.alreadyPlanned).toBe(false);
        expect(out?.plan).toMatchObject({
            date: "2026-11-12",
            slot: "dinner",
            servings: 4,
        });
        expect(out?.plan.id).toMatch(/^rule:[0-9a-f-]{36}:2026-11-12$/);
        expect((await week(plans)).map((p) => p.date)).toEqual([
            "2026-11-12",
            "2026-11-13",
            "2026-11-16",
            "2026-11-17",
            "2026-11-18",
            "2026-11-19",
        ]);
        expect(await plans.listRules(HH)).toHaveLength(1);
    });

    test("the first day of a repeat is the first day its pattern names", async () => {
        const { plans, input } = await setup();
        // 2026-11-14 is a Saturday: the first weekday is Monday the 16th.
        const out = await planRecipe(plans, {
            ...input,
            date: "2026-11-14",
        });
        expect(out?.plan.date).toBe("2026-11-16");
    });

    test("the same repeat twice is one repeat, a different one is another", async () => {
        const { plans, input } = await setup();
        await planRecipe(plans, input);
        const again = await planRecipe(plans, { ...input, servings: 9 });
        expect(again?.alreadyPlanned).toBe(true);
        expect(await plans.listRules(HH)).toHaveLength(1);
        // Another pattern on days the first does not use is another repeat.
        const other = await planRecipe(plans, {
            ...input,
            repeat: "days",
            days: [0, 6],
        });
        expect(other?.alreadyPlanned).toBe(false);
        expect(await plans.listRules(HH)).toHaveLength(2);
    });

    test("asking again for a repeat that already runs from an earlier day is already planned, from the day asked", async () => {
        const { plans, input } = await setup(); // weekdays from the 12th
        await planRecipe(plans, input);
        const later = await planRecipe(plans, {
            ...input,
            date: "2026-11-16",
        });
        expect(later?.alreadyPlanned).toBe(true);
        expect(later?.plan.date).toBe("2026-11-16");
        expect(await plans.listRules(HH)).toHaveLength(1);
        const weekly = await planRecipe(plans, {
            ...input,
            slot: "lunch",
            repeat: "weekly",
            date: "2026-11-17",
        });
        const again = await planRecipe(plans, {
            ...input,
            slot: "lunch",
            repeat: "weekly",
            date: "2026-11-24",
        });
        expect(weekly?.alreadyPlanned).toBe(false);
        expect(again?.alreadyPlanned).toBe(true);
        expect(again?.plan.date).toBe("2026-11-24");
        expect(await plans.listRules(HH)).toHaveLength(2);
    });

    test("asking again for a running repeat from a day taken off it plans that day once", async () => {
        const { plans, input } = await setup(); // weekdays from the 12th
        await planRecipe(plans, input);
        expect(
            await plans.removePlan(
                HH,
                `rule:${(await plans.listRules(HH))[0]!.id}:2026-11-17`,
            ),
        ).toBe(true);
        const again = await planRecipe(plans, { ...input, date: "2026-11-17" });
        expect(again?.alreadyPlanned).toBe(false);
        expect(again?.plan.date).toBe("2026-11-17");
        expect(again?.plan.ruleId).toBeUndefined();
        const tuesday = await plans.listPlans(HH, "2026-11-17", "2026-11-17");
        expect(tuesday.map((p) => p.id)).toEqual([again!.plan.id]);
        expect(await plans.listRules(HH)).toHaveLength(1);
        // That day now holds the recipe: asked again, it is already planned.
        const third = await planRecipe(plans, { ...input, date: "2026-11-17" });
        expect(third?.alreadyPlanned).toBe(true);
        expect(third?.plan.id).toBe(again!.plan.id);
    });

    test("a repeat over days another repeat of the recipe and meal shows is refused, by name, and nothing is saved", async () => {
        const { plans, input } = await setup();
        await planRecipe(plans, input); // weekdays from the 12th
        for (const clash of [
            {
                repeat: "daily",
                message:
                    "Beef chili is already planned at dinner on Mon, Tue, Wed, Thu and Fri by the repeat on weekdays. End that series first, or pick other days.",
            },
            {
                repeat: "weekly",
                date: "2026-11-19",
                message:
                    "Beef chili is already planned at dinner on Thu by the repeat on weekdays. End that series first, or pick other days.",
            },
            {
                repeat: "days",
                days: [5, 6],
                message:
                    "Beef chili is already planned at dinner on Fri by the repeat on weekdays. End that series first, or pick other days.",
            },
        ] as const) {
            await expect(
                planRecipe(plans, {
                    ...input,
                    repeat: clash.repeat,
                    ...("date" in clash ? { date: clash.date } : {}),
                    ...("days" in clash ? { days: [5, 6] } : {}),
                }),
            ).rejects.toThrow(clash.message);
        }
        expect(await plans.listRules(HH)).toHaveLength(1);
        // Another meal is free, and so is the days after the first one ends.
        expect(
            (await planRecipe(plans, { ...input, slot: "lunch" }))
                ?.alreadyPlanned,
        ).toBe(false);
        const first = (await plans.listRules(HH))[0]!;
        await plans.endRuleBefore(HH, first.id, "2026-11-17");
        const next = await planRecipe(plans, {
            ...input,
            repeat: "daily",
            date: "2026-11-17",
        });
        expect(next?.plan.ruleId).not.toBe(first.id);
    });

    test("planning a repeat again after its series was ended says it ended, and names its last day", async () => {
        const { plans, input } = await setup();
        await planRecipe(plans, input);
        const first = (await plans.listRules(HH))[0]!;
        await plans.endRuleBefore(HH, first.id, "2026-11-17");
        // The same repeat from its original start still lands on days the
        // ended series covers.
        await expect(planRecipe(plans, input)).rejects.toThrow(
            "Beef chili still repeats at dinner until Mon, Nov 16. Pick a start after that, or other days.",
        );
        // A repeat still running keeps the message that asks to end it.
        const live = await planRecipe(plans, {
            ...input,
            slot: "lunch",
        });
        expect(live?.alreadyPlanned).toBe(false);
        await expect(
            planRecipe(plans, { ...input, slot: "lunch", repeat: "daily" }),
        ).rejects.toThrow(
            "Beef chili is already planned at lunch on Mon, Tue, Wed, Thu and Fri by the repeat on weekdays. End that series first, or pick other days.",
        );
    });

    test("a repeat's result is its own first day, whichever repeats were made before it", async () => {
        const { plans, input } = await setup();
        const weekly = await planRecipe(plans, {
            ...input,
            repeat: "weekly",
            servings: 2,
        });
        // The weekend: days the weekly (Thursdays) does not use.
        const weekend = await planRecipe(plans, {
            ...input,
            repeat: "days",
            days: [0, 6],
            servings: 1,
        });
        expect(weekend?.alreadyPlanned).toBe(false);
        expect(weekend?.plan.ruleId).not.toBe(weekly?.plan.ruleId);
        expect(weekend?.plan).toMatchObject({
            date: "2026-11-14",
            servings: 1,
        });
        // Removing the series it shows ends that repeat and no other.
        expect(
            await unplanRecipe(
                plans,
                HH,
                weekend!.plan.id,
                { recipes: createMemoryRecipesStore() },
                "series",
            ),
        ).toBe(true);
        expect((await plans.listRules(HH)).map((r) => r.repeat)).toEqual([
            "weekly",
        ]);
    });

    test("a one-off and a daily repeat give the day the same servings whichever came first", async () => {
        const first = await setup();
        await planRecipe(first.plans, {
            ...first.input,
            repeat: "once",
            date: "2026-11-14",
            servings: 2,
        });
        await planRecipe(first.plans, {
            ...first.input,
            repeat: "daily",
            servings: 2,
        });
        const second = await setup();
        await planRecipe(second.plans, {
            ...second.input,
            repeat: "daily",
            servings: 2,
        });
        const again = await planRecipe(second.plans, {
            ...second.input,
            repeat: "once",
            date: "2026-11-14",
            servings: 2,
        });
        expect(again?.alreadyPlanned).toBe(true);
        const servingsOn14 = async (plans: PlansStore) =>
            (await plans.listPlans(HH, "2026-11-14", "2026-11-14")).map(
                (p) => p.servings,
            );
        expect(await servingsOn14(first.plans)).toEqual([2]);
        expect(await servingsOn14(second.plans)).toEqual([2]);
    });

    test("a repeat that starts at the end of the calendar plans its last days, or says it has none", async () => {
        const { plans, input } = await setup();
        const daily = await planRecipe(plans, {
            ...input,
            repeat: "daily",
            date: "9999-12-30",
            today: "2026-11-12",
        });
        expect(daily?.plan).toMatchObject({ date: "9999-12-30" });
        // 9999-12-30 is a Thursday and the 31st a Friday: no Monday is left.
        await expect(
            planRecipe(plans, {
                ...input,
                slot: "lunch",
                repeat: "days",
                days: [1],
                date: "9999-12-30",
                today: "2026-11-12",
            }),
        ).rejects.toThrow("no day before the calendar ends");
        expect(await plans.listRules(HH)).toHaveLength(1);
    });

    test("planning once on a day a repeat already covers is that plan", async () => {
        const { plans, input } = await setup();
        const repeated = await planRecipe(plans, input);
        const once = await planRecipe(plans, { ...input, repeat: "once" });
        expect(once?.alreadyPlanned).toBe(true);
        expect(once?.plan.id).toBe(repeated!.plan.id);
    });

    test("pick days needs weekdays, and weekdays go with pick days only", async () => {
        const { plans, input } = await setup();
        await expect(
            planRecipe(plans, { ...input, repeat: "days" }),
        ).rejects.toThrow(PlanInputError);
        await expect(
            planRecipe(plans, { ...input, repeat: "days", days: [7] }),
        ).rejects.toThrow(PlanInputError);
        await expect(
            planRecipe(plans, { ...input, repeat: "weekly", days: [1] }),
        ).rejects.toThrow(PlanInputError);
        await expect(
            planRecipe(plans, { ...input, repeat: "monthly" }),
        ).rejects.toThrow(PlanInputError);
        const picked = await planRecipe(plans, {
            ...input,
            repeat: "days",
            days: [4, 1, 4],
        });
        expect(picked?.alreadyPlanned).toBe(false);
        expect((await plans.listRules(HH))[0]?.days).toEqual([1, 4]);
        // A past start day is refused like any plan.
        await expect(
            planRecipe(plans, { ...input, date: "2026-11-11" }),
        ).rejects.toThrow("Pick today or a later day.");
    });

    test("a new repeat tells the others once, a repeat that was already there tells nobody", async () => {
        const { notifications, notify } = await household();
        const { plans, input } = await setup();
        await planRecipe(plans, input, { notify });
        await planRecipe(plans, input, { notify });
        const rows = await notifications.listForHousehold(HH);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.payload).toMatchObject({
            recipeName: "Beef chili",
            change: "planned",
            date: "2026-11-12",
        });
    });

    test("removing one day skips it, keeps the rest and tells the others like an unplan", async () => {
        const { notifications, notify } = await household();
        const { recipes, plans, input } = await setup();
        const out = await planRecipe(plans, input);
        const day = out!.plan.id.replace("2026-11-12", "2026-11-13");
        expect(await unplanRecipe(plans, HH, day, { recipes, notify })).toBe(
            true,
        );
        expect((await week(plans)).map((p) => p.date)).toEqual([
            "2026-11-12",
            "2026-11-16",
            "2026-11-17",
            "2026-11-18",
            "2026-11-19",
        ]);
        const rows = await notifications.listForHousehold(HH);
        expect(rows.map((r) => r.payload)).toEqual([
            expect.objectContaining({
                recipeName: "Beef chili",
                change: "unplanned",
                date: "2026-11-13",
                slot: "dinner",
            }),
        ]);
        // The day is gone: a second removal finds nothing.
        expect(await unplanRecipe(plans, HH, day, { recipes, notify })).toBe(
            false,
        );
    });

    test("removing the series ends it the day before, keeps earlier days and tells the others once", async () => {
        const { notifications, notify } = await household();
        const { recipes, plans, input } = await setup();
        const out = await planRecipe(plans, input);
        const day = out!.plan.id.replace("2026-11-12", "2026-11-17");
        expect(
            await unplanRecipe(plans, HH, day, { recipes, notify }, "series"),
        ).toBe(true);
        expect((await week(plans)).map((p) => p.date)).toEqual([
            "2026-11-12",
            "2026-11-13",
            "2026-11-16",
        ]);
        expect((await plans.getRule(HH, day.split(":")[1]!))?.endsOn).toBe(
            "2026-11-16",
        );
        const rows = await notifications.listForHousehold(HH);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.payload).toMatchObject({
            change: "unplanned",
            date: "2026-11-17",
        });
    });

    test("a new repeat says how it repeats, and a plan made once does not", async () => {
        const { notifications, notify } = await household();
        const { plans, input } = await setup();
        await planRecipe(plans, input, { notify });
        await planRecipe(
            plans,
            { ...input, repeat: "days", days: [6, 0] },
            { notify },
        );
        await planRecipe(
            plans,
            { ...input, repeat: "once", date: "2026-11-21", slot: "lunch" },
            { notify },
        );
        await planRecipe(
            plans,
            { ...input, repeat: "weekly", slot: "snack", date: "2026-11-13" },
            { notify },
        );
        const payloads = (await notifications.listForHousehold(HH))
            .map((r) => r.payload)
            .sort((a, b) => String(a.date).localeCompare(String(b.date)));
        expect(payloads.map((p) => [p.repeat, p.days])).toEqual([
            ["weekdays", undefined],
            ["weekly", undefined],
            ["days", [0, 6]],
            [undefined, undefined],
        ]);
    });

    test("removing the series says it was the series, and removing a day does not", async () => {
        const { notifications, notify } = await household();
        const { recipes, plans, input } = await setup();
        const out = await planRecipe(plans, input);
        const at = (date: string) =>
            out!.plan.id.replace("2026-11-12", () => date);
        await unplanRecipe(plans, HH, at("2026-11-13"), { recipes, notify });
        await unplanRecipe(
            plans,
            HH,
            at("2026-11-17"),
            { recipes, notify },
            "series",
        );
        const payloads = (await notifications.listForHousehold(HH))
            .map((r) => r.payload)
            .sort((a, b) => String(a.date).localeCompare(String(b.date)));
        expect(payloads.map((p) => [p.date, p.scope])).toEqual([
            ["2026-11-13", undefined],
            ["2026-11-17", "series"],
        ]);
    });

    test("a day of a repeat moved onto another day of the same repeat is already planned, and the repeat is left as it is", async () => {
        const { recipes, plans, input } = await setup();
        await planRecipe(plans, { ...input, repeat: "daily", servings: 2 });
        const [thursday, friday] = await plans.listPlans(
            HH,
            "2026-11-12",
            "2026-11-13",
        );
        const out = await movePlannedRecipe(
            plans,
            HH,
            thursday!,
            { date: "2026-11-13", slot: "dinner", servings: 6 },
            { recipes },
        );
        expect(out).toEqual({ plan: friday!, alreadyPlanned: true });
        expect(friday!.servings).toBe(2);
        const [rule] = await plans.listRules(HH);
        expect(rule?.skippedOn).toEqual([]);
        expect(
            (await plans.listPlans(HH, "2026-11-12", "2026-11-13")).map((p) => [
                p.id,
                p.servings,
            ]),
        ).toEqual([
            [thursday!.id, 2],
            [friday!.id, 2],
        ]);
    });

    test("a one-off moved onto a day of a repeat is already planned, and the repeat keeps the day", async () => {
        const { recipes, plans, input } = await setup();
        await planRecipe(plans, { ...input, repeat: "daily", servings: 2 });
        const lunch = await planRecipe(plans, {
            ...input,
            repeat: "once",
            slot: "lunch",
            date: "2026-11-14",
            servings: 5,
        });
        const out = await movePlannedRecipe(
            plans,
            HH,
            lunch!.plan,
            { date: "2026-11-14", slot: "dinner" },
            { recipes },
        );
        expect(out?.alreadyPlanned).toBe(true);
        expect(out?.plan).toMatchObject({
            date: "2026-11-14",
            slot: "dinner",
            servings: 2,
        });
        expect(out?.plan.ruleId).toBeDefined();
        expect((await plans.getPlan(HH, lunch!.plan.id))?.slot).toBe("lunch");
        expect((await plans.listRules(HH))[0]?.skippedOn).toEqual([]);
    });

    test("a day of a repeat moved onto a one-off of the same recipe and meal is already planned, and the day stays on its repeat", async () => {
        const { recipes, plans, input } = await setup();
        await planRecipe(plans, { ...input, repeat: "weekly", servings: 2 });
        const saturday = await planRecipe(plans, {
            ...input,
            repeat: "once",
            date: "2026-11-14",
            servings: 5,
        });
        const [thursday] = await plans.listPlans(
            HH,
            "2026-11-12",
            "2026-11-12",
        );
        const out = await movePlannedRecipe(
            plans,
            HH,
            thursday!,
            { date: "2026-11-14", slot: "dinner" },
            { recipes },
        );
        expect(out).toEqual({ plan: saturday!.plan, alreadyPlanned: true });
        expect((await plans.listRules(HH))[0]?.skippedOn).toEqual([]);
        expect(await plans.getPlan(HH, thursday!.id)).not.toBeNull();
    });

    test("a day of a repeat moved to a free day skips it and plans a one-off there", async () => {
        const { recipes, plans, input } = await setup();
        await planRecipe(plans, { ...input, repeat: "weekly", servings: 2 });
        const [thursday] = await plans.listPlans(
            HH,
            "2026-11-12",
            "2026-11-12",
        );
        const out = await movePlannedRecipe(
            plans,
            HH,
            thursday!,
            { date: "2026-11-14", slot: "dinner" },
            { recipes },
        );
        expect(out?.alreadyPlanned).toBe(false);
        expect(out?.plan).toMatchObject({ date: "2026-11-14", servings: 2 });
        expect(out?.plan.ruleId).toBeUndefined();
        expect((await plans.listRules(HH))[0]?.skippedOn).toEqual([
            "2026-11-12",
        ]);
    });

    test("planning once on a day a repeat covers, with other servings, writes nothing and leaves the repeat as it is", async () => {
        const { plans, input } = await setup();
        const repeated = await planRecipe(plans, {
            ...input,
            repeat: "daily",
            servings: 2,
        });
        const once = await planRecipe(plans, {
            ...input,
            repeat: "once",
            date: "2026-11-14",
            servings: 7,
        });
        expect(once?.alreadyPlanned).toBe(true);
        expect(once?.plan).toMatchObject({ date: "2026-11-14", servings: 2 });
        expect(once?.plan.ruleId).toBe(repeated!.plan.ruleId);
        expect((await plans.listRules(HH))[0]?.skippedOn).toEqual([]);
        expect(
            (await plans.listPlans(HH, "2026-11-14", "2026-11-14")).map(
                (p) => p.servings,
            ),
        ).toEqual([2]);
    });

    test("the store's addPlan on a day a repeat covers answers with that day's entry and takes nothing from the repeat", async () => {
        const { plans, input } = await setup();
        await planRecipe(plans, { ...input, repeat: "daily", servings: 2 });
        const there = await plans.addPlan({
            householdId: HH,
            recipeId: input.recipeId,
            date: "2026-11-14",
            slot: "dinner",
            servings: 7,
        });
        expect(there).toMatchObject({ date: "2026-11-14", servings: 2 });
        expect(there?.ruleId).toBeDefined();
        expect((await plans.listRules(HH))[0]?.skippedOn).toEqual([]);
        // A different meal is free.
        const lunch = await plans.addPlan({
            householdId: HH,
            recipeId: input.recipeId,
            date: "2026-11-14",
            slot: "lunch",
            servings: 7,
        });
        expect(lunch).toMatchObject({ slot: "lunch", servings: 7 });
        expect(lunch?.ruleId).toBeUndefined();
    });

    test("a repeat's day id names the same plan in any letter case", async () => {
        const { plans, input } = await setup();
        const planned = await planRecipe(plans, { ...input, repeat: "daily" });
        const upper = planned!.plan.id.replace(
            /^rule:([^:]+):/,
            (_, id: string) => `rule:${id.toUpperCase()}:`,
        );
        expect((await plans.getPlan(HH, upper))?.id).toBe(planned!.plan.id);
    });

    test("the series of a plan that does not repeat is refused, and nothing is removed", async () => {
        const { recipes, plans, input } = await setup();
        const one = await planRecipe(plans, { ...input, repeat: "once" });
        await expect(
            unplanRecipe(plans, HH, one!.plan.id, { recipes }, "series"),
        ).rejects.toThrow(PlanInputError);
        expect(await plans.getPlan(HH, one!.plan.id)).not.toBeNull();
    });

    test("moving one day of a repeat tells the others where it was and where it is", async () => {
        const { notifications, notify } = await household();
        const { recipes, plans, input } = await setup();
        const out = await planRecipe(plans, input);
        const day = await plans.getPlan(
            HH,
            out!.plan.id.replace("2026-11-12", "2026-11-13"),
        );
        const moved = await movePlannedRecipe(
            plans,
            HH,
            day!,
            { date: "2026-11-14", slot: "lunch" },
            { recipes, notify },
        );
        expect(moved?.alreadyPlanned).toBe(false);
        expect(moved?.plan).toMatchObject({
            date: "2026-11-14",
            slot: "lunch",
        });
        expect((await week(plans)).map((p) => `${p.date} ${p.slot}`)).toEqual([
            "2026-11-12 dinner",
            "2026-11-14 lunch",
            "2026-11-16 dinner",
            "2026-11-17 dinner",
            "2026-11-18 dinner",
            "2026-11-19 dinner",
        ]);
        const rows = await notifications.listForHousehold(HH);
        expect(rows[0]?.payload).toMatchObject({
            change: "moved",
            date: "2026-11-14",
            fromDate: "2026-11-13",
        });
    });
});

describe("a repeating plan and the plan notices", () => {
    const HH = "hh-notice";
    const TODAY = "2026-11-12";
    const OPTS = { today: TODAY, timezone: "UTC" };

    async function world() {
        const foods = createMemoryFoodsStore();
        const recipes = createMemoryRecipesStore();
        const grocery = createMemoryGroceryStore();
        const plans = createMemoryPlansStore();
        const settings = createMemorySettingsStore();
        await createGroceryStore(settings, HH, "Safeway");
        const deps = {
            foods,
            fridge: createMemoryFridgeStore(),
            recipes,
            dismissals: createMemoryNoticeDismissalsStore(),
            grocery,
            plans,
            weighIns: createMemoryWeighInStore([]),
            settings,
        };
        const eggs = await foods.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                defaultUnit: "each",
            }),
        );
        const recipe = await recipes.insertRecipe({
            id: crypto.randomUUID(),
            householdId: HH,
            creatorId: "u",
            name: "Omelette",
            yieldPortions: 2,
            instructions: null,
            sourceUrl: null,
            tags: [],
            notes: null,
            prepMinutes: null,
            cookMinutes: null,
            verification: "unverified",
            updatedAt: "2026-11-01T00:00:00Z",
        } as never);
        await recipes.insertIngredient({
            id: crypto.randomUUID(),
            householdId: HH,
            recipeId: recipe.id,
            kind: "food",
            displayName: "Eggs",
            quantity: { amount: 4, unit: "each" },
            foodId: eggs.id,
            sortOrder: 0,
            note: null,
        });
        return { deps, eggs, recipe, plans, grocery };
    }

    const open = (w: Awaited<ReturnType<typeof world>>) =>
        noticesFor(w.deps, HH, { ...OPTS, actionable: true }).then((r) =>
            r.notices
                .filter((n) => n.code === "plan.missing_ingredient")
                .map((n) => n.subject.id),
        );

    test("a repeat with no stored plan raises the missing-food notice, and the tap puts it on the list", async () => {
        const w = await world();
        await w.plans.addRule({
            householdId: HH,
            recipeId: w.recipe.id,
            slot: "dinner",
            servings: 2,
            startsOn: "2026-11-13",
            repeat: "weekly",
        });
        expect(await w.plans.listPlans(HH, TODAY, TODAY)).toEqual([]);
        expect(await open(w)).toEqual([w.eggs.id]);

        const result = await actOnNotice(
            w.deps,
            HH,
            { code: "plan.missing_ingredient", subjectId: w.eggs.id },
            OPTS,
        );
        expect(result).toMatchObject({ status: "added", name: "Eggs" });
        const lines = await w.grocery.listLines(HH);
        expect(lines.map((l) => [l.foodId, l.source])).toEqual([
            [w.eggs.id, "plan"],
        ]);
    });

    test("ending the series before the notice window clears the notice", async () => {
        const w = await world();
        const rule = await w.plans.addRule({
            householdId: HH,
            recipeId: w.recipe.id,
            slot: "dinner",
            servings: 2,
            startsOn: "2026-11-13",
            repeat: "weekly",
        });
        expect(await open(w)).toEqual([w.eggs.id]);
        await w.plans.endRuleBefore(HH, rule!.id, "2026-11-13");
        expect(await open(w)).toEqual([]);
    });
});

describe("planEntries", () => {
    const oneOff = (over: Partial<RecipePlan> = {}): RecipePlan => ({
        id: "one",
        householdId: RULE_HOUSEHOLD,
        recipeId: RULE_RECIPE,
        date: "2026-11-03",
        slot: "dinner",
        servings: 8,
        createdBy: null,
        createdAt: "2026-11-02T10:00:00+00:00",
        ...over,
    });

    test("one-offs and the days of repeats are one list in day, meal then planning order", () => {
        const entries = planEntries(
            [
                oneOff({ id: "late", date: "2026-11-04" }),
                oneOff({ id: "lunch", slot: "lunch", date: "2026-11-03" }),
            ],
            [rule({ servings: 2 })],
            "2026-11-03",
            "2026-11-04",
        );
        expect(entries.map((e) => `${e.date} ${e.slot} ${e.servings}`)).toEqual(
            [
                "2026-11-03 lunch 8",
                "2026-11-03 dinner 2",
                "2026-11-04 dinner 2",
                "2026-11-04 dinner 8",
            ],
        );
    });

    test("data that holds the same recipe, day and meal twice (the writes never make it) is shown as both entries, never summed", () => {
        const first = rule({
            id: "a".repeat(8) + "-0000-4000-8000-000000000000",
            servings: 2,
        });
        const second = rule({
            id: "b".repeat(8) + "-0000-4000-8000-000000000000",
            servings: 3,
            createdAt: "2026-11-01T11:00:00+00:00",
        });
        const entries = planEntries(
            [oneOff()],
            [second, first],
            "2026-11-03",
            "2026-11-03",
        );
        expect(entries.map((e) => [e.id, e.servings])).toEqual([
            [`rule:${first.id}:2026-11-03`, 2],
            [`rule:${second.id}:2026-11-03`, 3],
            ["one", 8],
        ]);
    });
});

describe("repeatPatternWords", () => {
    test("names each pattern in words", () => {
        const words = (over: Partial<PlanRule>) =>
            repeatPatternWords(rule(over));
        expect(words({ repeat: "daily" })).toBe("every day");
        // 2026-11-03 is a Tuesday.
        expect(words({ repeat: "weekly", startsOn: "2026-11-03" })).toBe(
            "every week on Tuesday",
        );
        expect(words({ repeat: "weekdays" })).toBe("on weekdays");
        expect(words({ repeat: "days", days: [6, 1, 3] })).toBe(
            "on Mon, Wed and Sat",
        );
        expect(words({ repeat: "days", days: [0] })).toBe("on Sun");
    });
});

describe("rulesShareDay", () => {
    const shape = (over: Partial<PlanRule> = {}) => ({
        startsOn: "2026-11-02",
        endsOn: null,
        repeat: "daily" as const,
        days: [] as number[],
        skippedOn: [] as string[],
        ...over,
    });

    test("meets on a day both patterns name inside both date ranges", () => {
        expect(rulesShareDay(shape(), shape({ repeat: "weekly" }))).toBe(true);
        // Mondays and Tuesdays never meet.
        expect(
            rulesShareDay(
                shape({ repeat: "days", days: [1] }),
                shape({ repeat: "days", days: [2] }),
            ),
        ).toBe(false);
        // The ranges do not touch: the first ends the day the second starts after.
        expect(
            rulesShareDay(
                shape({ endsOn: "2026-11-15" }),
                shape({ startsOn: "2026-11-16" }),
            ),
        ).toBe(false);
        expect(
            rulesShareDay(
                shape({ endsOn: "2026-11-16" }),
                shape({ startsOn: "2026-11-16" }),
            ),
        ).toBe(true);
    });

    test("a once is its start day, and a skipped day is a day not held", () => {
        const once = shape({ repeat: "once", startsOn: "2026-11-10" });
        expect(rulesShareDay(shape(), once)).toBe(true);
        expect(rulesShareDay(shape({ skippedOn: ["2026-11-10"] }), once)).toBe(
            false,
        );
        // A skip hides one meeting, not the next week's.
        expect(
            rulesShareDay(
                shape({ skippedOn: ["2026-11-10"] }),
                shape({ repeat: "weekly", startsOn: "2026-11-10" }),
            ),
        ).toBe(true);
    });
});

describe("expandRules", () => {
    test("an entry carries the rule's recipe, meal and servings, and an id that names the rule and the day", () => {
        const [entry] = expandRules([rule()], "2026-11-03", "2026-11-03");
        expect(entry).toEqual({
            id: `rule:${RULE_ID}:2026-11-03`,
            ruleId: RULE_ID,
            householdId: RULE_HOUSEHOLD,
            recipeId: RULE_RECIPE,
            date: "2026-11-03",
            slot: "dinner",
            servings: 2,
            createdBy: null,
            createdAt: "2026-11-01T10:00:00+00:00",
        });
    });

    test("every day fills the range, starting on the start day", () => {
        expect(datesOf([rule()], "2026-10-30", "2026-11-04")).toEqual([
            "2026-11-02",
            "2026-11-03",
            "2026-11-04",
        ]);
    });

    test("every week falls on the start day's weekday only", () => {
        expect(
            datesOf(
                [rule({ repeat: "weekly", startsOn: "2026-11-04" })], // Wednesday
                "2026-11-01",
                "2026-11-30",
            ),
        ).toEqual(["2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25"]);
    });

    test("weekdays are Monday to Friday, across a week boundary", () => {
        expect(
            datesOf(
                [rule({ repeat: "weekdays", startsOn: "2026-11-05" })], // Thursday
                "2026-11-05",
                "2026-11-12",
            ),
        ).toEqual([
            "2026-11-05", // Thu
            "2026-11-06", // Fri
            "2026-11-09", // Mon
            "2026-11-10",
            "2026-11-11",
            "2026-11-12", // Thu
        ]);
    });

    test("pick days uses 0 = Sunday, like the restock day", () => {
        expect(
            datesOf(
                [rule({ repeat: "days", days: [0, 3, 6] })],
                "2026-11-02",
                "2026-11-15",
            ),
        ).toEqual([
            "2026-11-04", // Wed
            "2026-11-07", // Sat
            "2026-11-08", // Sun
            "2026-11-11",
            "2026-11-14",
            "2026-11-15",
        ]);
    });

    test("once is the start day alone", () => {
        expect(
            datesOf([rule({ repeat: "once" })], "2026-11-01", "2026-12-31"),
        ).toEqual(["2026-11-02"]);
    });

    test("nothing before the start day or after the end day, both included", () => {
        const r = rule({ startsOn: "2026-11-04", endsOn: "2026-11-06" });
        expect(datesOf([r], "2026-11-01", "2026-11-30")).toEqual([
            "2026-11-04",
            "2026-11-05",
            "2026-11-06",
        ]);
        expect(datesOf([r], "2026-11-07", "2026-11-30")).toEqual([]);
        expect(datesOf([r], "2026-10-01", "2026-11-03")).toEqual([]);
    });

    test("a rule ended before it started has no days", () => {
        expect(
            datesOf(
                [rule({ startsOn: "2026-11-04", endsOn: "2026-11-03" })],
                "2026-11-01",
                "2026-11-30",
            ),
        ).toEqual([]);
    });

    test("skipped days are left out and the rest stay", () => {
        expect(
            datesOf(
                [rule({ skippedOn: ["2026-11-03"] })],
                "2026-11-02",
                "2026-11-04",
            ),
        ).toEqual(["2026-11-02", "2026-11-04"]);
    });

    test("several rules come back in day then meal order", () => {
        const lunch = rule({
            id: "44444444-4444-4444-8444-444444444444",
            slot: "lunch",
            startsOn: "2026-11-03",
            repeat: "once",
        });
        const out = expandRules(
            [rule({ endsOn: "2026-11-03" }), lunch],
            "2026-11-02",
            "2026-11-03",
        );
        expect(out.map((e) => `${e.date} ${e.slot}`)).toEqual([
            "2026-11-02 dinner",
            "2026-11-03 lunch",
            "2026-11-03 dinner",
        ]);
    });

    test("a range with the end before the start is empty", () => {
        expect(datesOf([rule()], "2026-11-05", "2026-11-04")).toEqual([]);
    });

    test("the spring-forward week has no lost or doubled day", () => {
        // 2026-03-08 is the Los Angeles change; the calendar day is a date,
        // not an instant, so every day is there once, whatever the zone.
        const previous = process.env.TZ;
        process.env.TZ = "America/Los_Angeles";
        try {
            expect(
                datesOf(
                    [rule({ startsOn: "2026-03-05" })],
                    "2026-03-05",
                    "2026-03-12",
                ),
            ).toEqual([
                "2026-03-05",
                "2026-03-06",
                "2026-03-07",
                "2026-03-08",
                "2026-03-09",
                "2026-03-10",
                "2026-03-11",
                "2026-03-12",
            ]);
            // 2026-03-08 is a Sunday, 2026-03-09 a Monday.
            expect(
                datesOf(
                    [rule({ repeat: "weekdays", startsOn: "2026-03-05" })],
                    "2026-03-05",
                    "2026-03-12",
                ),
            ).toEqual([
                "2026-03-05",
                "2026-03-06",
                "2026-03-09",
                "2026-03-10",
                "2026-03-11",
                "2026-03-12",
            ]);
            expect(
                datesOf(
                    [
                        rule({
                            repeat: "days",
                            days: [0],
                            startsOn: "2026-03-01",
                        }),
                    ],
                    "2026-03-01",
                    "2026-03-15",
                ),
            ).toEqual(["2026-03-01", "2026-03-08", "2026-03-15"]);
        } finally {
            if (previous === undefined) delete process.env.TZ;
            else process.env.TZ = previous;
        }
    });

    test("the fall-back week has no lost or doubled day", () => {
        const previous = process.env.TZ;
        process.env.TZ = "America/Los_Angeles";
        try {
            // 2026-11-01 is a Sunday: the day with 25 hours.
            expect(
                datesOf(
                    [rule({ repeat: "weekly", startsOn: "2026-10-25" })],
                    "2026-10-25",
                    "2026-11-15",
                ),
            ).toEqual(["2026-10-25", "2026-11-01", "2026-11-08", "2026-11-15"]);
            expect(
                datesOf(
                    [rule({ startsOn: "2026-10-30" })],
                    "2026-10-30",
                    "2026-11-03",
                ),
            ).toEqual([
                "2026-10-30",
                "2026-10-31",
                "2026-11-01",
                "2026-11-02",
                "2026-11-03",
            ]);
        } finally {
            if (previous === undefined) delete process.env.TZ;
            else process.env.TZ = previous;
        }
    });
});
