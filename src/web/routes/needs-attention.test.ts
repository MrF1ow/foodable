import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    mock,
    test,
} from "bun:test";
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
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
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
import { needsAttentionCount } from "../../domain/notices.js";
import { noticesFor } from "../../domain/notices-for.js";

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
    nutrition_layout: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
};

const db = {
    profile: PROFILE,
    members: [
        {
            householdId: HH,
            userId: ALICE,
            role: "owner" as const,
            displayName: "Alice",
        },
    ],
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

const { needsAttentionRoutes } = await import("./needs-attention.js");
const { fridgeRoutes } = await import("./fridge.js");
const { mintSiteSession, SITE_COOKIE } = await import("../../site-session.js");

function cookieFor(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

function app() {
    const hono = new Hono();
    hono.route("/", needsAttentionRoutes);
    hono.route("/", fridgeRoutes);
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

describe("needs-attention routes", () => {
    test("GET groups notices by subject in separate panels", async () => {
        const { yogurt, recipe } = await seedGroupedNotices();
        const r = await app().request("http://x/needs-attention", {
            headers: { cookie: cookieFor(ALICE) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("Soon yogurt");
        expect(html).toContain("Mystery");
        expect(html).toContain("not linked to a food");
        expect(
            (html.match(/class="panel"/g) ?? []).length,
        ).toBeGreaterThanOrEqual(2);
        expect(html).toContain(`/recipes/${recipe.id}`);
    });

    test("GET with no notices shows empty state", async () => {
        const r = await app().request("http://x/needs-attention", {
            headers: { cookie: cookieFor(ALICE) },
        });
        const html = await r.text();
        expect(html).toContain("Nothing needs attention");
    });

    test("POST dismiss info notice redirects and removes it from the list", async () => {
        const { yogurt } = await seedGroupedNotices();
        const before = await noticesFor(noticeDeps(), HH, {
            today: utcTodayFromDate(),
        });
        const countBefore = needsAttentionCount(before.notices);
        const r = await app().request("http://x/needs-attention/dismiss", {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                code: "fridge.expiring",
                subject_kind: "fridge_item",
                subject_id: yogurt.id,
            }).toString(),
        });
        expect(r.status).toBe(303);
        expect(r.headers.get("location")).toBe("/needs-attention");
        const after = await noticesFor(noticeDeps(), HH, {
            today: utcTodayFromDate(),
        });
        expect(
            after.notices.some(
                (n) =>
                    n.code === "fridge.expiring" && n.subject.id === yogurt.id,
            ),
        ).toBe(false);
        expect(needsAttentionCount(after.notices)).toBe(countBefore - 1);
        const page = await app().request("http://x/needs-attention", {
            headers: { cookie: cookieFor(ALICE) },
        });
        expect(await page.text()).not.toContain("Soon yogurt");
    });

    test("POST dismiss with return_to=/kitchen/groceries redirects to grocery", async () => {
        const { yogurt } = await seedGroupedNotices();
        const r = await app().request("http://x/needs-attention/dismiss", {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                code: "fridge.expiring",
                subject_kind: "fridge_item",
                subject_id: yogurt.id,
                return_to: "/kitchen/groceries",
            }).toString(),
        });
        expect(r.status).toBe(303);
        expect(r.headers.get("location")).toBe("/kitchen/groceries");
    });

    test("POST dismiss with a pre-move return_to=/grocery still goes back to grocery", async () => {
        const { yogurt } = await seedGroupedNotices();
        const r = await app().request("http://x/needs-attention/dismiss", {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                code: "fridge.expiring",
                subject_kind: "fridge_item",
                subject_id: yogurt.id,
                return_to: "/grocery",
            }).toString(),
        });
        expect(r.status).toBe(303);
        expect(r.headers.get("location")).toBe("/kitchen/groceries");
    });

    test("POST dismiss rejects open-redirect return_to", async () => {
        const { yogurt } = await seedGroupedNotices();
        for (const returnTo of [
            "https://evil.example",
            "//evil.example",
        ] as const) {
            const r = await app().request("http://x/needs-attention/dismiss", {
                method: "POST",
                headers: {
                    cookie: cookieFor(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    code: "fridge.expiring",
                    subject_kind: "fridge_item",
                    subject_id: yogurt.id,
                    return_to: returnTo,
                }).toString(),
            });
            expect(r.status).toBe(303);
            expect(r.headers.get("location")).toBe("/needs-attention");
        }
    });

    test("POST dismiss on warn notice returns 4xx and keeps state", async () => {
        const today = utcTodayFromDate();
        const loc = await addLocation(db.fridgeStore, HH, "Fridge");
        const milk = await addManualFood(db.fridgeStore, db.foodsStore, {
            householdId: HH,
            locationId: loc.id,
            name: "Expired milk",
            amount: 1,
            unit: "g",
        });
        await db.fridgeStore.updateItem({
            ...milk,
            expiresOn: addDaysUtc(today, -1),
        });
        const before = await noticesFor(noticeDeps(), HH, {
            today: utcTodayFromDate(),
        });
        const r = await app().request("http://x/needs-attention/dismiss", {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                code: "fridge.expired",
                subject_kind: "fridge_item",
                subject_id: milk.id,
            }).toString(),
        });
        expect(r.status).toBe(400);
        const html = await r.text();
        expect(html.toLowerCase()).toContain("can't be dismissed");
        const after = await noticesFor(noticeDeps(), HH, {
            today: utcTodayFromDate(),
        });
        expect(after.notices).toEqual(before.notices);
    });

    test("POST dismiss that fails with return_to=/kitchen/groceries goes back to grocery", async () => {
        const today = utcTodayFromDate();
        const loc = await addLocation(db.fridgeStore, HH, "Fridge");
        const milk = await addManualFood(db.fridgeStore, db.foodsStore, {
            householdId: HH,
            locationId: loc.id,
            name: "Expired milk",
            amount: 1,
            unit: "g",
        });
        await db.fridgeStore.updateItem({
            ...milk,
            expiresOn: addDaysUtc(today, -1),
        });
        const before = await noticesFor(noticeDeps(), HH, {
            today: utcTodayFromDate(),
        });
        const r = await app().request("http://x/needs-attention/dismiss", {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                code: "fridge.expired",
                subject_kind: "fridge_item",
                subject_id: milk.id,
                return_to: "/kitchen/groceries",
            }).toString(),
        });
        expect(r.status).toBe(303);
        expect(r.headers.get("location")).toBe("/kitchen/groceries");
        const after = await noticesFor(noticeDeps(), HH, {
            today: utcTodayFromDate(),
        });
        expect(after.notices).toEqual(before.notices);
    });

    test("POST dismiss for another household subject is rejected", async () => {
        const otherLoc = await addLocation(db.fridgeStore, HH_OTHER, "Other");
        const otherItem = await addManualFood(db.fridgeStore, db.foodsStore, {
            householdId: HH_OTHER,
            locationId: otherLoc.id,
            name: "Other milk",
            amount: 1,
            unit: "g",
        });
        const r = await app().request("http://x/needs-attention/dismiss", {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                code: "fridge.expiring",
                subject_kind: "fridge_item",
                subject_id: otherItem.id,
            }).toString(),
        });
        expect(r.status).toBe(400);
    });

    test("show dismissed lists dismissal; undo brings notice back", async () => {
        const { yogurt } = await seedGroupedNotices();
        await app().request("http://x/needs-attention/dismiss", {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                code: "fridge.expiring",
                subject_kind: "fridge_item",
                subject_id: yogurt.id,
            }).toString(),
        });
        const dismissed = await app().request(
            "http://x/needs-attention?show=dismissed",
            { headers: { cookie: cookieFor(ALICE) } },
        );
        const dismissedHtml = await dismissed.text();
        const rows = await db.dismissalsStore.listForHousehold(HH);
        const row = rows.find((d) => d.subjectId === yogurt.id);
        expect(row).toBeTruthy();
        expect(dismissedHtml).toContain(row!.id);

        const undo = await app().request("http://x/needs-attention/undo", {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ dismissal_id: row!.id }).toString(),
        });
        expect(undo.status).toBe(303);
        expect(undo.headers.get("location")).toBe(
            "/needs-attention?show=dismissed",
        );
        const open = await noticesFor(noticeDeps(), HH, {
            today: utcTodayFromDate(),
        });
        expect(
            open.notices.some(
                (n) =>
                    n.subject.id === yogurt.id && n.code === "fridge.expiring",
            ),
        ).toBe(true);
    });

    test("POST undo with return_to=/settings/household redirects there", async () => {
        const { yogurt } = await seedGroupedNotices();
        await app().request("http://x/needs-attention/dismiss", {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                code: "fridge.expiring",
                subject_kind: "fridge_item",
                subject_id: yogurt.id,
            }).toString(),
        });
        const rows = await db.dismissalsStore.listForHousehold(HH);
        const row = rows.find((d) => d.subjectId === yogurt.id);
        expect(row).toBeTruthy();
        const undo = await app().request("http://x/needs-attention/undo", {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                dismissal_id: row!.id,
                return_to: "/settings/household",
            }).toString(),
        });
        expect(undo.status).toBe(303);
        expect(undo.headers.get("location")).toBe("/settings/household");
    });

    test("POST undo rejects open-redirect return_to", async () => {
        const row = await db.dismissalsStore.insert({
            householdId: HH,
            code: "fridge.expiring",
            subjectKind: "fridge_item",
            subjectId: crypto.randomUUID(),
            relatedKey: "",
            dismissedBy: ALICE,
        });
        const undo = await app().request("http://x/needs-attention/undo", {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                dismissal_id: row.id,
                return_to: "//evil.example",
            }).toString(),
        });
        expect(undo.status).toBe(303);
        expect(undo.headers.get("location")).toBe(
            "/needs-attention?show=dismissed",
        );
    });

    test("POST undo with another household dismissal id is rejected", async () => {
        const foreign = await db.dismissalsStore.insert({
            householdId: HH_OTHER,
            code: "fridge.expiring",
            subjectKind: "fridge_item",
            subjectId: crypto.randomUUID(),
            relatedKey: "",
            dismissedBy: ALICE,
        });
        const r = await app().request("http://x/needs-attention/undo", {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                dismissal_id: foreign.id,
            }).toString(),
        });
        expect(r.status).toBe(400);
        const still = await db.dismissalsStore.listForHousehold(HH_OTHER);
        expect(still.some((d) => d.id === foreign.id)).toBe(true);
    });

    test("top-bar badge only when count > 0 and settings gear keeps data-turbo", async () => {
        const empty = await app().request("http://x/kitchen/fridge", {
            headers: { cookie: cookieFor(ALICE) },
        });
        const emptyHtml = await empty.text();
        expect(emptyHtml).not.toContain("app-bar-attention");
        expect(emptyHtml).toContain('href="/settings" data-turbo="false"');

        await seedGroupedNotices();
        const open = await noticesFor(noticeDeps(), HH, {
            today: utcTodayFromDate(),
        });
        const count = needsAttentionCount(open.notices);
        expect(count).toBeGreaterThan(0);
        const withBadge = await app().request("http://x/kitchen/fridge", {
            headers: { cookie: cookieFor(ALICE) },
        });
        const badgeHtml = await withBadge.text();
        expect(badgeHtml).toContain('class="pill app-bar-attention"');
        expect(badgeHtml).toContain(`>${count}<`);
        expect(badgeHtml).toContain('href="/settings" data-turbo="false"');
    });

    test("panel title is plain text with an Open recipe link in the body", async () => {
        const { recipe } = await seedGroupedNotices();
        const r = await app().request("http://x/needs-attention", {
            headers: { cookie: cookieFor(ALICE) },
        });
        const html = await r.text();
        expect(html).toContain("<h2>Gap stew</h2>");
        expect(html).toContain(
            `<a href="/recipes/${recipe.id}">Open recipe</a>`,
        );
        expect(html).not.toContain("&lt;a href=");
    });

    test("one recipe with three gap ingredients renders one recipe panel", async () => {
        const recipe = await createRecipe(db.recipesStore, {
            householdId: HH,
            creatorId: ALICE,
            name: "Triple gap",
            yieldPortions: 2,
        });
        for (const name of ["A", "B", "C"]) {
            await db.recipesStore.insertIngredient({
                id: crypto.randomUUID(),
                householdId: HH,
                recipeId: recipe.id,
                kind: "food",
                displayName: name,
                quantity: { amount: 1, unit: "g" },
                foodId: null,
                sortOrder: 0,
                note: null,
            });
        }
        const r = await app().request("http://x/needs-attention", {
            headers: { cookie: cookieFor(ALICE) },
        });
        const html = await r.text();
        expect(html).toContain("<h2>Triple gap</h2>");
        const stewPanels = (html.match(/<h2>Triple gap<\/h2>/g) ?? []).length;
        expect(stewPanels).toBe(1);
        expect(html).toContain("not linked to a food");
    });

    test("recipe.no_nutrition shows Pick usual product action", async () => {
        const food = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Buttermilk",
            }),
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
            displayName: "Buttermilk",
            quantity: { amount: 100, unit: "g" },
            foodId: food.id,
            sortOrder: 0,
            note: null,
        });
        const r = await app().request("http://x/needs-attention", {
            headers: { cookie: cookieFor(ALICE) },
        });
        const html = await r.text();
        expect(html).toContain("Pick usual product");
        expect(html).toContain("/needs-attention");
    });

    test("show dismissed names an existing fridge item", async () => {
        const { yogurt } = await seedGroupedNotices();
        await app().request("http://x/needs-attention/dismiss", {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                code: "fridge.expiring",
                subject_kind: "fridge_item",
                subject_id: yogurt.id,
            }).toString(),
        });
        const dismissed = await app().request(
            "http://x/needs-attention?show=dismissed",
            { headers: { cookie: cookieFor(ALICE) } },
        );
        const html = await dismissed.text();
        expect(html).toContain("Soon yogurt");
        expect(html).not.toContain("Removed item");
    });

    test("an expiring item offers Add to grocery list, returning here", async () => {
        const { yogurt } = await seedGroupedNotices();
        const r = await app().request("http://x/needs-attention", {
            headers: { cookie: cookieFor(ALICE) },
        });
        const html = await r.text();
        expect(html).toContain(
            `action="/kitchen/fridge/items/${yogurt.id}/add-to-grocery"`,
        );
        expect(html).toContain(
            '<input type="hidden" name="from" value="/needs-attention" />',
        );
    });

    test("show dismissed opens the disclosure", async () => {
        const r = await app().request(
            "http://x/needs-attention?show=dismissed",
            {
                headers: { cookie: cookieFor(ALICE) },
            },
        );
        const html = await r.text();
        expect(html).toContain('<details class="more" open>');
    });

    test("panels sort newest activity first", async () => {
        const today = utcTodayFromDate();
        const oldLoc = await addLocation(db.fridgeStore, HH, "Old");
        const newLoc = await addLocation(db.fridgeStore, HH, "New");
        const oldItem = await addManualFood(db.fridgeStore, db.foodsStore, {
            householdId: HH,
            locationId: oldLoc.id,
            name: "Old stock",
            amount: 1,
            unit: "g",
        });
        const newRecipe = await createRecipe(db.recipesStore, {
            householdId: HH,
            creatorId: ALICE,
            name: "Fresh recipe",
            yieldPortions: 1,
        });
        await db.fridgeStore.updateItem({
            ...oldItem,
            expiresOn: addDaysUtc(today, 4),
        });
        (
            db.fridgeStore as typeof db.fridgeStore & {
                __paritySetItemCreatedAt?: (id: string, at: string) => void;
            }
        ).__paritySetItemCreatedAt?.(oldItem.id, "2020-01-01T00:00:00.000Z");
        (
            db.recipesStore as typeof db.recipesStore & {
                __paritySetRecipeActivityAt?: (id: string, at: string) => void;
            }
        ).__paritySetRecipeActivityAt?.(
            newRecipe.id,
            "2030-01-01T00:00:00.000Z",
        );
        await db.recipesStore.insertIngredient({
            id: crypto.randomUUID(),
            householdId: HH,
            recipeId: newRecipe.id,
            kind: "food",
            displayName: "Gap",
            quantity: { amount: 1, unit: "g" },
            foodId: null,
            sortOrder: 0,
            note: null,
        });
        const r = await app().request("http://x/needs-attention", {
            headers: { cookie: cookieFor(ALICE) },
        });
        const html = await r.text();
        const freshAt = html.indexOf("<h2>Fresh recipe</h2>");
        const oldAt = html.indexOf("<h2>Old stock</h2>");
        expect(freshAt).toBeGreaterThanOrEqual(0);
        expect(oldAt).toBeGreaterThanOrEqual(0);
        expect(freshAt).toBeLessThan(oldAt);
    });

    test("deleting a fridge location cleans dismissals for its items", async () => {
        const loc = await addLocation(db.fridgeStore, HH, "Door");
        const item = await addManualFood(db.fridgeStore, db.foodsStore, {
            householdId: HH,
            locationId: loc.id,
            name: "Juice",
            amount: 1,
            unit: "g",
        });
        await db.dismissalsStore.insert({
            householdId: HH,
            code: "fridge.expiring",
            subjectKind: "fridge_item",
            subjectId: item.id,
            relatedKey: "",
            dismissedBy: ALICE,
        });
        await app().request(
            `http://x/kitchen/fridge/locations/${loc.id}/delete`,
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "",
            },
        );
        const rows = await db.dismissalsStore.listForHousehold(HH);
        expect(rows.some((r) => r.subjectId === item.id)).toBe(false);
    });
});

describe("one-tap notice routes (ui-v2)", () => {
    afterEach(() => {
        resetFlagsForTests();
    });

    function post(path: string, fields: Record<string, string>) {
        return app().request(`http://x${path}`, {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
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
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const eggs = await seed();
        const res = await post("/notices/grocery.running_low/act", {
            subject_id: eggs.id,
            back: "/kitchen/usuals",
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/kitchen/usuals");
        expect(toastOf(res)?.key).toBe("notice.added");
        const lines = await db.groceryStore.listLines(HH);
        expect(lines.map((l) => [l.foodId, l.source])).toEqual([
            [eggs.id, "restock"],
        ]);
        expect(await open()).toEqual([]);
    });

    test("running low: a second tap is idempotent and says it is done", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const eggs = await seed();
        const fields = { subject_id: eggs.id, back: "/kitchen/fridge" };
        await post("/notices/grocery.running_low/act", fields);
        const again = await post("/notices/grocery.running_low/act", fields);
        expect(again.status).toBe(303);
        expect(again.headers.get("location")).toBe("/kitchen/fridge");
        expect(toastOf(again)?.key).toBe("notice.gone");
        expect(await db.groceryStore.listLines(HH)).toHaveLength(1);
    });

    test("running low: a stale tap (the usual is no longer low) writes nothing", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
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
        expect(toastOf(res)?.key).toBe("notice.gone");
        expect(await db.groceryStore.listLines(HH)).toEqual([]);
    });

    test("plan missing: Add puts only that food on the list, never an amount from the form", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        await seed();
        const { flour } = await planFlour();
        const res = await post("/notices/plan.missing_ingredient/act", {
            subject_id: flour.id,
            back: "/recipes",
            amount: "999",
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/recipes");
        expect(toastOf(res)?.key).toBe("notice.added");
        const lines = await db.groceryStore.listLines(HH);
        expect(lines.map((l) => [l.foodId, l.quantity, l.source])).toEqual([
            [flour.id, { amount: 250, unit: "g" }, "plan"],
        ]);
        const again = await post("/notices/plan.missing_ingredient/act", {
            subject_id: flour.id,
            back: "/recipes",
        });
        expect(toastOf(again)?.key).toBe("notice.gone");
        expect(await db.groceryStore.listLines(HH)).toHaveLength(1);
    });

    test("plan missing: a plan removed since the page was drawn is a stale tap", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        await seed();
        const { flour, plan } = await planFlour();
        await db.plansStore.removePlan(HH, plan.id);
        const res = await post("/notices/plan.missing_ingredient/act", {
            subject_id: flour.id,
            back: "/recipes",
        });
        expect(toastOf(res)?.key).toBe("notice.gone");
        expect(await db.groceryStore.listLines(HH)).toEqual([]);
    });

    test("another household's food id writes nothing for either household", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        await seed();
        const theirs = await seed(HH_OTHER);
        const res = await post("/notices/grocery.running_low/act", {
            subject_id: theirs.id,
            back: "/",
        });
        expect(res.status).toBe(303);
        expect(toastOf(res)?.key).toBe("notice.gone");
        expect(await db.groceryStore.listLines(HH)).toEqual([]);
        expect(await db.groceryStore.listLines(HH_OTHER)).toEqual([]);
        const dismissed = await post("/notices/dismiss", {
            code: "grocery.running_low",
            subject_kind: "food",
            subject_id: theirs.id,
            related_id: "",
            back: "/",
        });
        expect(dismissed.status).toBe(303);
        expect(toastOf(dismissed)?.key).toBe("notice.gone");
        expect(await db.dismissalsStore.listForHousehold(HH_OTHER)).toEqual([]);
        expect(await db.dismissalsStore.listForHousehold(HH)).toEqual([]);
    });

    test("with no store yet the person is told, and nothing is written", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
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
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        weighedLongAgo();
        const res = await post("/notices/nutrition.weigh_in_due/act", {
            subject_id: ALICE,
            back: "/",
        });
        expect(res.status).toBe(404);
    });

    test("dismiss: each of the three goes away until its scope changes", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const eggs = await seed();
        const { flour, plan } = await planFlour();
        const lastWeighedOn = weighedLongAgo();
        const codes = (await open()).map((n) => n.code).sort();
        expect(codes).toEqual([
            "grocery.running_low",
            "nutrition.weigh_in_due",
            "plan.missing_ingredient",
        ]);
        const cases = [
            ["grocery.running_low", "food", eggs.id, ""],
            ["plan.missing_ingredient", "food", flour.id, plan.id],
            ["nutrition.weigh_in_due", "member", ALICE, lastWeighedOn],
        ] as const;
        for (const [code, kind, id, related] of cases) {
            const res = await post("/notices/dismiss", {
                code,
                subject_kind: kind,
                subject_id: id,
                related_id: related,
                back: "/recipes",
            });
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe("/recipes");
            expect(toastOf(res)).toBeNull();
        }
        expect(await open()).toEqual([]);
        // A newer weigh-in brings the reminder back once it is due again.
        db.weighInStore = createMemoryWeighInStore([
            {
                userId: ALICE,
                displayName: "Alice",
                lastLoggedAt: `${addDaysUtc(utcTodayFromDate(), -8)}T12:00:00Z`,
            },
        ]);
        expect((await open()).map((n) => n.code)).toEqual([
            "nutrition.weigh_in_due",
        ]);
    });

    test("dismiss: a second tap is idempotent, and one that is not open says so", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const eggs = await seed();
        const fields = {
            code: "grocery.running_low",
            subject_kind: "food",
            subject_id: eggs.id,
            related_id: "",
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
        expect(toastOf(unknown)?.key).toBe("notice.gone");
        expect(await db.dismissalsStore.listForHousehold(HH)).toHaveLength(1);
    });

    test("a return path that is not one of the app's pages falls back to Today", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
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
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
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
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const eggs = await seed();
        const res = await post("/notices/grocery.running_low/act", {
            subject_id: eggs.id,
            back: "/?date=2026-11-03",
        });
        expect(res.headers.get("location")).toBe("/?date=2026-11-03");
        const dismissed = await post("/notices/dismiss", {
            code: "grocery.running_low",
            subject_kind: "food",
            subject_id: eggs.id,
            related_id: "",
            back: "/?date=2026-11-03",
        });
        expect(dismissed.headers.get("location")).toBe("/?date=2026-11-03");
        for (const back of ["/?date=nope", "/?date=2026-11-03&x=1", "/?x=1"]) {
            const bad = await post("/notices/dismiss", {
                code: "grocery.running_low",
                subject_kind: "food",
                subject_id: eggs.id,
                related_id: "",
                back,
            });
            expect(bad.headers.get("location")).toBe("/");
        }
    });

    function getPage() {
        return app().request("http://x/needs-attention", {
            headers: { cookie: cookieFor(ALICE) },
        });
    }

    test("the Needs attention page lists the one-tap notices for a ui-v2 viewer, with their action and dismiss, and the tab dots stay lit", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const eggs = await seed();
        const { flour } = await planFlour();
        weighedLongAgo();
        const res = await getPage();
        expect(res.status).toBe(200);
        const html = await res.text();
        // The same notices the Today card counts.
        expect(html).toContain("Running low: Eggs");
        expect(html).toContain("Flour");
        expect(html).toContain("Alice");
        expect(html).toContain('action="/notices/grocery.running_low/act"');
        expect(html).toContain('action="/notices/plan.missing_ingredient/act"');
        expect(html).toContain(`name="subject_id" value="${eggs.id}"`);
        expect(html).toContain(`name="subject_id" value="${flour.id}"`);
        expect(html).toContain('name="back" value="/needs-attention"');
        expect(html).toContain('action="/notices/dismiss"');
        expect(html).not.toContain('action="/needs-attention/dismiss" ');
        // The Kitchen and Recipes dots are lit from the same notices.
        expect(html).toContain("has notices");
    });

    test("acting on a notice from the Needs attention page comes back to it", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const eggs = await seed();
        const res = await post("/notices/grocery.running_low/act", {
            subject_id: eggs.id,
            back: "/needs-attention",
        });
        expect(res.headers.get("location")).toBe("/needs-attention");
        const dismissed = await post("/notices/dismiss", {
            code: "grocery.running_low",
            subject_kind: "food",
            subject_id: eggs.id,
            related_id: "",
            back: "/needs-attention",
        });
        expect(dismissed.headers.get("location")).toBe("/needs-attention");
    });

    test("with ui-v2 off the Needs attention page shows exactly what it showed before", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        await seed();
        await planFlour();
        weighedLongAgo();
        const html = await (await getPage()).text();
        expect(html).not.toContain("Running low");
        expect(html).not.toContain("/notices/");
        expect(html).not.toContain("hasn't weighed in");
        // The notice the old page always had is still there.
        expect(html).toContain("Flour: no nutrition");
    });

    test("with ui-v2 off both routes are 404 and write nothing", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const eggs = await seed();
        const act = await post("/notices/grocery.running_low/act", {
            subject_id: eggs.id,
            back: "/",
        });
        const dismiss = await post("/notices/dismiss", {
            code: "grocery.running_low",
            subject_kind: "food",
            subject_id: eggs.id,
            related_id: "",
            back: "/",
        });
        expect([act.status, dismiss.status]).toEqual([404, 404]);
        expect(await db.groceryStore.listLines(HH)).toEqual([]);
        expect(await db.dismissalsStore.listForHousehold(HH)).toEqual([]);
    });
});
