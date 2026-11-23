import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import * as actualDbFoods from "../../db/foods.js";
import * as actualDbFridge from "../../db/fridge.js";
import * as actualDbGrocery from "../../db/grocery.js";
import * as actualDbHousehold from "../../db/household.js";
import * as actualDbProfiles from "../../db/profiles.js";
import * as actualDbRecipes from "../../db/recipes.js";
import * as actualDbRules from "../../db/rules.js";
import * as actualDbSettings from "../../db/settings.js";
import * as actualDbStock from "../../db/stock.js";
import * as actualDbNoticeDismissals from "../../db/notice-dismissals.js";
import * as actualDbPlans from "../../db/plans.js";
import * as actualDbWeighIns from "../../db/weigh-ins.js";
import {
    decodeToastFlash,
    readToastCookie,
    TOAST_COOKIE,
} from "../components/toast.js";
import { createMemoryPlansStore } from "../../domain/plan.js";
import { createMemoryWeighInStore } from "../../domain/notices-actionable.js";
import { createGroceryStore } from "../../domain/settings.js";
import { createMemoryNoticeDismissalsStore } from "../../domain/notice-dismissals.js";
import * as actualFoods from "../../foods.js";
import { createMemoryFoodsStore, newFood } from "../../domain/foods.js";
import {
    addLocation,
    addManualFood,
    createMemoryFridgeStore,
} from "../../domain/fridge.js";
import { createMemoryGroceryStore } from "../../domain/grocery.js";
import {
    createMemoryRecipesStore,
    createRecipe,
} from "../../domain/recipes.js";
import { createMemorySettingsStore } from "../../domain/settings.js";
import { createMemoryRulesStore } from "../../domain/rules.js";
import { createMemoryStockStore } from "../../domain/stock.js";
import { utcTodayFromDate } from "../../domain/stock.js";
import { noticesFor } from "../../domain/notices-for.js";
import {
    dismissalKey,
    dismissalKeyString,
} from "../../domain/notice-dismissals.js";
import { inboxFor, type NotificationRow } from "../../domain/notifications.js";

process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

const realDbFoods = { ...actualDbFoods };
const realDbFridge = { ...actualDbFridge };
const realDbGrocery = { ...actualDbGrocery };
const realDbHousehold = { ...actualDbHousehold };
const realDbProfiles = { ...actualDbProfiles };
const realDbRecipes = { ...actualDbRecipes };
const realDbRules = { ...actualDbRules };
const realDbSettings = { ...actualDbSettings };
const realDbStock = { ...actualDbStock };
const realDbNoticeDismissals = { ...actualDbNoticeDismissals };
const realDbPlans = { ...actualDbPlans };
const realDbWeighIns = { ...actualDbWeighIns };
const realFoods = { ...actualFoods };

const ALICE = "11111111-1111-4111-8111-111111111111";
const MIA = "22222222-2222-4222-8222-222222222222";
const HH = "hh-1";
const HH_OTHER = "hh-other";

const PROFILE: actualDbProfiles.Profile = {
    user_id: ALICE,
    timezone: "UTC",
    preferred_weight_unit: null,
    widgets_enabled: true,
    alcohol_tracking_enabled: false,
    preferred_drink_unit: null,
    theme: "light",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
};

const db = {
    profile: PROFILE,
    members: [
        {
            householdId: HH,
            userId: ALICE,
            role: "owner",
            displayName: "Alice",
        },
    ] as actualDbHousehold.HouseholdMembership[],
    household: {
        name: "Home",
        recipeSearchPlaces: [] as string[],
        preferences: {
            drink_unit: null,
            grocery_default_store_id: null,
        },
    },
    foodsStore: createMemoryFoodsStore(),
    dismissalsStore: createMemoryNoticeDismissalsStore(),
    fridgeStore: createMemoryFridgeStore(),
    stockStore: createMemoryStockStore(),
    groceryStore: createMemoryGroceryStore(),
    recipesStore: createMemoryRecipesStore(),
    settingsStore: createMemorySettingsStore(),
    rulesStore: createMemoryRulesStore(),
    plansStore: createMemoryPlansStore(),
    weighInStore: createMemoryWeighInStore([]),
    barcodeFoods: {} as Record<string, unknown>,
};

mock.module("../../db/foods.js", () => ({
    ...realDbFoods,
    liveFoodsStore: () => db.foodsStore,
}));
mock.module("../../db/fridge.js", () => ({
    ...realDbFridge,
    liveFridgeStore: () => db.fridgeStore,
}));
mock.module("../../db/stock.js", () => ({
    ...realDbStock,
    liveStockStore: () => db.stockStore,
}));
mock.module("../../db/grocery.js", () => ({
    ...realDbGrocery,
    liveGroceryStore: () => db.groceryStore,
}));
mock.module("../../db/recipes.js", () => ({
    ...realDbRecipes,
    liveRecipesStore: () => db.recipesStore,
}));
mock.module("../../db/settings.js", () => ({
    ...realDbSettings,
    liveSettingsStore: () => db.settingsStore,
}));
mock.module("../../db/rules.js", () => ({
    ...realDbRules,
    liveRulesStore: () => db.rulesStore,
}));
mock.module("../../db/plans.js", () => ({
    ...realDbPlans,
    liveRecipePlansStore: () => db.plansStore,
    // No database here: the memory stores are the "transaction".
    planTransaction: () => (fn: () => Promise<unknown>) => fn(),
}));
mock.module("../../db/weigh-ins.js", () => ({
    ...realDbWeighIns,
    liveWeighInStore: () => db.weighInStore,
}));
mock.module("../../db/notice-dismissals.js", () => ({
    ...realDbNoticeDismissals,
    liveNoticeDismissalsStore: () => db.dismissalsStore,
}));
mock.module("../../db/household.js", () => ({
    ...realDbHousehold,
    getHouseholdMembership: async (userId: string) =>
        db.members.find((member) => member.userId === userId) ?? null,
    householdExists: async () => db.household != null,
    getHouseholdOwnerProfile: async () => ({ timezone: "UTC" }),
    getHouseholdConfig: async () => structuredClone(db.household),
    listHouseholdMembers: async (householdId: string) =>
        db.members.filter((member) => member.householdId === householdId),
}));
mock.module("../../db/profiles.js", () => ({
    ...realDbProfiles,
    getProfile: async () => db.profile,
}));
mock.module("../../foods.js", () => ({
    ...realFoods,
    lookupBarcode: async () => null,
}));

afterAll(() => {
    mock.module("../../db/foods.js", () => realDbFoods);
    mock.module("../../db/fridge.js", () => realDbFridge);
    mock.module("../../db/stock.js", () => realDbStock);
    mock.module("../../db/grocery.js", () => realDbGrocery);
    mock.module("../../db/recipes.js", () => realDbRecipes);
    mock.module("../../db/settings.js", () => realDbSettings);
    mock.module("../../db/rules.js", () => realDbRules);
    mock.module("../../db/household.js", () => realDbHousehold);
    mock.module("../../db/profiles.js", () => realDbProfiles);
    mock.module("../../db/notice-dismissals.js", () => realDbNoticeDismissals);
    mock.module("../../db/plans.js", () => realDbPlans);
    mock.module("../../db/weigh-ins.js", () => realDbWeighIns);
    mock.module("../../foods.js", () => realFoods);
});

const { noticeActionRoutes } = await import("./notices.js");
const { mintSiteSession, SITE_COOKIE } = await import("../../site-session.js");

function cookieFor(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

function app() {
    const hono = new Hono();
    hono.route("/", noticeActionRoutes);
    return hono;
}

function addDaysUtc(iso: string, delta: number): string {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, d! + delta))
        .toISOString()
        .slice(0, 10);
}

async function seedGroupedNotices() {
    const today = utcTodayFromDate();
    const loc = await addLocation(db.fridgeStore, HH, "Fridge");
    const yogurt = await addManualFood(db.fridgeStore, db.foodsStore, {
        householdId: HH,
        locationId: loc.id,
        name: "Soon yogurt",
        amount: 1,
        unit: "g",
    });
    await db.fridgeStore.updateItem({
        ...yogurt,
        expiresOn: addDaysUtc(today, 4),
    });
    const recipe = await createRecipe(db.recipesStore, {
        householdId: HH,
        creatorId: ALICE,
        name: "Gap stew",
        yieldPortions: 2,
    });
    await db.recipesStore.insertIngredient({
        id: crypto.randomUUID(),
        householdId: HH,
        recipeId: recipe.id,
        kind: "food",
        displayName: "Mystery",
        quantity: { amount: 1, unit: "g" },
        foodId: null,
        sortOrder: 0,
        note: null,
    });
    return { yogurt, recipe, today };
}

function noticeDeps() {
    return {
        foods: db.foodsStore,
        fridge: db.fridgeStore,
        recipes: db.recipesStore,
        dismissals: db.dismissalsStore,
        grocery: db.groceryStore,
    };
}

beforeEach(() => {
    db.dismissalsStore = createMemoryNoticeDismissalsStore();
    db.foodsStore = createMemoryFoodsStore();
    db.fridgeStore = createMemoryFridgeStore();
    db.stockStore = createMemoryStockStore();
    db.groceryStore = createMemoryGroceryStore();
    db.recipesStore = createMemoryRecipesStore();
    db.settingsStore = createMemorySettingsStore();
    db.rulesStore = createMemoryRulesStore();
    db.plansStore = createMemoryPlansStore();
    db.weighInStore = createMemoryWeighInStore([]);
    db.fridgeStore.linkDismissals(db.dismissalsStore);
    db.groceryStore.linkDismissals(db.dismissalsStore);
    db.recipesStore.linkDismissals(db.dismissalsStore);
    db.foodsStore.linkDismissals(db.dismissalsStore);
    db.profile = { ...PROFILE };
    db.members = [
        {
            householdId: HH,
            userId: ALICE,
            role: "owner",
            displayName: "Alice",
        },
    ];
});

describe("one-tap notice routes", () => {
    function post(
        path: string,
        fields: Record<string, string>,
        as: string = ALICE,
    ) {
        return app().request(`http://x${path}`, {
            method: "POST",
            headers: {
                cookie: cookieFor(as),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams(fields).toString(),
        });
    }

    function toastOf(res: Response) {
        const cookie = res.headers
            .getSetCookie()
            .map((h) => h.split(";")[0] ?? "")
            .find((h) => h.startsWith(`${TOAST_COOKIE}=`));
        return cookie ? decodeToastFlash(readToastCookie(cookie) ?? "") : null;
    }

    function open() {
        return noticesFor(
            {
                ...noticeDeps(),
                plans: db.plansStore,
                weighIns: db.weighInStore,
            },
            HH,
            {
                today: utcTodayFromDate(),
                timezone: "UTC",
                actionable: true,
            },
        ).then((result) =>
            result.notices.filter((n) =>
                [
                    "grocery.running_low",
                    "plan.missing_ingredient",
                    "nutrition.weigh_in_due",
                ].includes(n.code),
            ),
        );
    }

    async function seed(hh = HH) {
        await createGroceryStore(db.settingsStore, hh, "Safeway").catch(
            () => undefined,
        );
        const eggs = await db.foodsStore.insertFood({
            ...newFood({
                householdId: hh,
                kind: "food",
                name: "Eggs",
                defaultUnit: "each",
                restockWhenLow: true,
                usualAmount: { amount: 12, unit: "each" },
                restockLowLevel: 4,
            }),
        });
        return eggs;
    }

    async function planFlour() {
        const flour = await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Flour" }),
        );
        const recipe = await createRecipe(db.recipesStore, {
            householdId: HH,
            creatorId: ALICE,
            name: "Pancakes",
            yieldPortions: 2,
        });
        await db.recipesStore.insertIngredient({
            id: crypto.randomUUID(),
            householdId: HH,
            recipeId: recipe.id,
            kind: "food",
            displayName: "Flour",
            quantity: { amount: 250, unit: "g" },
            foodId: flour.id,
            sortOrder: 0,
            note: null,
        });
        const plan = await db.plansStore.addPlan({
            householdId: HH,
            recipeId: recipe.id,
            date: addDaysUtc(utcTodayFromDate(), 1),
            slot: "dinner",
            servings: 2,
        });
        return { flour, plan: plan! };
    }

    function weighedLongAgo() {
        const lastLoggedAt = `${addDaysUtc(utcTodayFromDate(), -10)}T12:00:00Z`;
        db.weighInStore = createMemoryWeighInStore([
            { userId: ALICE, displayName: "Alice", lastLoggedAt },
        ]);
        return addDaysUtc(utcTodayFromDate(), -10);
    }

    test("running low: Add puts the usual on the list and goes back to the page", async () => {
        const eggs = await seed();
        const res = await post("/notices/grocery.running_low/act", {
            subject_id: eggs.id,
            back: "/kitchen/usuals",
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/kitchen/usuals");
        expect(toastOf(res)).toBeNull();
        const lines = await db.groceryStore.listLines(HH);
        expect(lines.map((l) => [l.foodId, l.source])).toEqual([
            [eggs.id, "restock"],
        ]);
        expect(await open()).toEqual([]);
    });

    test("running low: a second tap is idempotent and says nothing", async () => {
        const eggs = await seed();
        const fields = { subject_id: eggs.id, back: "/kitchen/fridge" };
        await post("/notices/grocery.running_low/act", fields);
        const again = await post("/notices/grocery.running_low/act", fields);
        expect(again.status).toBe(303);
        expect(again.headers.get("location")).toBe("/kitchen/fridge");
        expect(toastOf(again)).toBeNull();
        expect(await db.groceryStore.listLines(HH)).toHaveLength(1);
    });

    test("running low: a stale tap (the usual is no longer low) writes nothing", async () => {
        const eggs = await seed();
        const loc = await addLocation(db.fridgeStore, HH, "Fridge");
        await addManualFood(db.fridgeStore, db.foodsStore, {
            householdId: HH,
            locationId: loc.id,
            name: "Eggs",
            amount: 11,
            unit: "each",
            foodId: eggs.id,
        } as never);
        const res = await post("/notices/grocery.running_low/act", {
            subject_id: eggs.id,
            back: "/",
        });
        expect(res.status).toBe(303);
        expect(toastOf(res)).toBeNull();
        expect(await db.groceryStore.listLines(HH)).toEqual([]);
    });

    test("plan missing: Add puts only that food on the list, never an amount from the form", async () => {
        await seed();
        const { flour } = await planFlour();
        const res = await post("/notices/plan.missing_ingredient/act", {
            subject_id: flour.id,
            back: "/recipes",
            amount: "999",
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/recipes");
        expect(toastOf(res)).toBeNull();
        const lines = await db.groceryStore.listLines(HH);
        expect(lines.map((l) => [l.foodId, l.quantity, l.source])).toEqual([
            [flour.id, { amount: 250, unit: "g" }, "plan"],
        ]);
        const again = await post("/notices/plan.missing_ingredient/act", {
            subject_id: flour.id,
            back: "/recipes",
        });
        expect(toastOf(again)).toBeNull();
        expect(await db.groceryStore.listLines(HH)).toHaveLength(1);
    });

    test("plan missing: a plan removed since the page was drawn is a stale tap", async () => {
        await seed();
        const { flour, plan } = await planFlour();
        await db.plansStore.removePlan(HH, plan.id);
        const res = await post("/notices/plan.missing_ingredient/act", {
            subject_id: flour.id,
            back: "/recipes",
        });
        expect(toastOf(res)).toBeNull();
        expect(await db.groceryStore.listLines(HH)).toEqual([]);
    });

    test("another household's food id writes nothing for either household", async () => {
        await seed();
        const theirs = await seed(HH_OTHER);
        const res = await post("/notices/grocery.running_low/act", {
            subject_id: theirs.id,
            back: "/",
        });
        expect(res.status).toBe(303);
        expect(toastOf(res)).toBeNull();
        expect(await db.groceryStore.listLines(HH)).toEqual([]);
        expect(await db.groceryStore.listLines(HH_OTHER)).toEqual([]);
        const dismissed = await post("/notices/dismiss", {
            code: "plan.missing_ingredient",
            subject_kind: "food",
            subject_id: theirs.id,
            related_id: crypto.randomUUID(),
            back: "/",
        });
        expect(dismissed.status).toBe(303);
        expect(toastOf(dismissed)).toBeNull();
        expect(await db.dismissalsStore.listForHousehold(HH_OTHER)).toEqual([]);
        expect(await db.dismissalsStore.listForHousehold(HH)).toEqual([]);
    });

    test("with no store yet the person is told, and nothing is written", async () => {
        const eggs = await db.foodsStore.insertFood({
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                defaultUnit: "each",
                restockWhenLow: true,
                usualAmount: { amount: 12, unit: "each" },
                restockLowLevel: 4,
            }),
        });
        const res = await post("/notices/grocery.running_low/act", {
            subject_id: eggs.id,
            back: "/",
        });
        expect(res.status).toBe(303);
        expect(toastOf(res)?.key).toBe("notice.error");
        expect(await db.groceryStore.listLines(HH)).toEqual([]);
    });

    test("the weigh-in reminder has no act route (the sheet is on the page)", async () => {
        weighedLongAgo();
        const res = await post("/notices/nutrition.weigh_in_due/act", {
            subject_id: ALICE,
            back: "/",
        });
        expect(res.status).toBe(404);
    });

    test("dismiss: what the plan is missing goes away; the inbox's codes are refused here", async () => {
        const eggs = await seed();
        const { flour, plan } = await planFlour();
        const lastWeighedOn = weighedLongAgo();
        const codes = (await open()).map((n) => n.code).sort();
        expect(codes).toEqual([
            "grocery.running_low",
            "nutrition.weigh_in_due",
            "plan.missing_ingredient",
        ]);
        const res = await post("/notices/dismiss", {
            code: "plan.missing_ingredient",
            subject_kind: "food",
            subject_id: flour.id,
            related_id: plan.id,
            back: "/recipes",
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/recipes");
        expect(toastOf(res)).toBeNull();
        // The inbox carries these two: it is where they are dismissed.
        for (const [code, kind, id, related] of [
            ["grocery.running_low", "food", eggs.id, ""],
            ["nutrition.weigh_in_due", "member", ALICE, lastWeighedOn],
        ] as const) {
            const refused = await post("/notices/dismiss", {
                code,
                subject_kind: kind,
                subject_id: id,
                related_id: related,
                back: "/recipes",
            });
            expect(refused.status).toBe(303);
            expect(toastOf(refused)?.key).toBe("notice.error");
        }
        expect((await open()).map((n) => n.code).sort()).toEqual([
            "grocery.running_low",
            "nutrition.weigh_in_due",
        ]);
        expect(await db.dismissalsStore.listForHousehold(HH)).toHaveLength(1);
    });

    test("dismiss: a member's hand-made POST with an inbox code is refused, and the household's inbox is unchanged", async () => {
        db.members.push({
            householdId: HH,
            userId: MIA,
            role: "member",
            displayName: "Mia",
        });
        const eggs = await seed();
        const [low] = (await open()).filter(
            (n) => n.code === "grocery.running_low",
        );
        // Alice's inbox row for the same condition the POST names.
        const row: NotificationRow = {
            id: "n-low",
            householdId: HH,
            recipientUserId: ALICE,
            kind: "running_low",
            bucket: "household",
            source: "condition",
            noticeKey: dismissalKeyString(dismissalKey(low!)),
            subjectKind: "food",
            subjectId: eggs.id,
            actorUserId: null,
            payload: {},
            createdAt: new Date().toISOString(),
            readAt: null,
            snoozedUntil: null,
            snoozedBy: null,
            dismissedAt: null,
            dismissedBy: null,
            resolvedAt: null,
        };
        const inbox = async () =>
            inboxFor({
                rows: [row],
                prefs: [],
                now: new Date(),
                householdDismissals:
                    await db.dismissalsStore.listForHousehold(HH),
                timezone: "UTC",
            });
        const before = await inbox();
        expect(before.today.map((r) => r.id)).toEqual(["n-low"]);
        const res = await post(
            "/notices/dismiss",
            {
                code: "grocery.running_low",
                subject_kind: "food",
                subject_id: eggs.id,
                related_id: low!.params.dismissScope as string,
                back: "/",
            },
            MIA,
        );
        expect(res.status).toBe(303);
        expect(toastOf(res)?.key).toBe("notice.error");
        expect(await db.dismissalsStore.listForHousehold(HH)).toEqual([]);
        expect(await inbox()).toEqual(before);
    });

    test("dismiss: a member can't dismiss what the plan is missing for the household", async () => {
        db.members.push({
            householdId: HH,
            userId: MIA,
            role: "member",
            displayName: "Mia",
        });
        const { flour, plan } = await planFlour();
        const res = await post(
            "/notices/dismiss",
            {
                code: "plan.missing_ingredient",
                subject_kind: "food",
                subject_id: flour.id,
                related_id: plan.id,
                back: "/recipes",
            },
            MIA,
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/recipes");
        const toast = toastOf(res);
        expect(toast?.key).toBe("notice.error");
        expect(toast?.params?.message).toBe(
            "Only the household owner or an admin can do that.",
        );
        expect(await db.dismissalsStore.listForHousehold(HH)).toEqual([]);
        expect((await open()).map((n) => n.code)).toEqual([
            "plan.missing_ingredient",
        ]);
        // Add still works for a member.
        await createGroceryStore(db.settingsStore, HH, "Safeway");
        const add = await post(
            "/notices/plan.missing_ingredient/act",
            { subject_id: flour.id, back: "/recipes" },
            MIA,
        );
        expect(add.status).toBe(303);
        expect((await open()).map((n) => n.code)).toEqual([]);
    });

    test("dismiss: a second tap is idempotent, and one that is not open says so", async () => {
        const { flour, plan } = await planFlour();
        const fields = {
            code: "plan.missing_ingredient",
            subject_kind: "food",
            subject_id: flour.id,
            related_id: plan.id,
            back: "/",
        };
        await post("/notices/dismiss", fields);
        const again = await post("/notices/dismiss", fields);
        expect(again.status).toBe(303);
        expect(await db.dismissalsStore.listForHousehold(HH)).toHaveLength(1);
        const unknown = await post("/notices/dismiss", {
            ...fields,
            subject_id: crypto.randomUUID(),
        });
        expect(unknown.status).toBe(303);
        expect(toastOf(unknown)).toBeNull();
        expect(await db.dismissalsStore.listForHousehold(HH)).toHaveLength(1);
    });

    test("a return path that is not one of the app's pages falls back to Today", async () => {
        const eggs = await seed();
        for (const back of ["https://evil.example", "//evil.example", ""]) {
            const res = await post("/notices/grocery.running_low/act", {
                subject_id: eggs.id,
                back,
            });
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe("/");
        }
    });

    test("dismiss: a notice that cannot be dismissed says why, not that it is taken care of", async () => {
        const res = await post("/notices/dismiss", {
            code: "grocery.allergen",
            subject_kind: "grocery_line",
            subject_id: crypto.randomUUID(),
            related_id: "",
            back: "/",
        });
        expect(res.status).toBe(303);
        const toast = toastOf(res);
        expect(toast?.key).toBe("notice.error");
        expect(toast?.params?.message).toBe(
            "This notice can't be dismissed; fix the cause instead.",
        );
    });

    test("an act or dismiss from another day of Today comes back to that day", async () => {
        const eggs = await seed();
        const res = await post("/notices/grocery.running_low/act", {
            subject_id: eggs.id,
            back: "/?date=2026-11-03",
        });
        expect(res.headers.get("location")).toBe("/?date=2026-11-03");
        const { flour, plan } = await planFlour();
        const dismissed = await post("/notices/dismiss", {
            code: "plan.missing_ingredient",
            subject_kind: "food",
            subject_id: flour.id,
            related_id: plan.id,
            back: "/?date=2026-11-03",
        });
        expect(dismissed.headers.get("location")).toBe("/?date=2026-11-03");
        for (const back of ["/?date=nope", "/?date=2026-11-03&x=1", "/?x=1"]) {
            const bad = await post("/notices/dismiss", {
                code: "plan.missing_ingredient",
                subject_kind: "food",
                subject_id: flour.id,
                related_id: plan.id,
                back,
            });
            expect(bad.headers.get("location")).toBe("/");
        }
    });

    test("POST /notices/dismiss works from Recipes: it dismisses and goes back to Recipes", async () => {
        const { flour, plan } = await planFlour();
        const res = await post("/notices/dismiss", {
            code: "plan.missing_ingredient",
            subject_kind: "food",
            subject_id: flour.id,
            related_id: plan.id,
            back: "/recipes",
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/recipes");
        expect(toastOf(res)).toBeNull();
        expect(await db.dismissalsStore.listForHousehold(HH)).toHaveLength(1);
        expect(await open()).toEqual([]);
    });

    test("the Needs attention page's return path is gone: a back to it falls back to Today", async () => {
        const eggs = await seed();
        const res = await post("/notices/grocery.running_low/act", {
            subject_id: eggs.id,
            back: "/needs-attention",
        });
        expect(res.headers.get("location")).toBe("/");
        const { flour, plan } = await planFlour();
        const dismissed = await post("/notices/dismiss", {
            code: "plan.missing_ingredient",
            subject_kind: "food",
            subject_id: flour.id,
            related_id: plan.id,
            back: "/needs-attention",
        });
        expect(dismissed.headers.get("location")).toBe("/");
    });
});
