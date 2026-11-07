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
    locale: null,
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
mock.module("../../db/notice-dismissals.js", () => ({
    ...realDbNoticeDismissals,
    liveNoticeDismissalsStore: () => db.dismissalsStore,
}));
mock.module("../../db/household.js", () => ({
    ...realDbHousehold,
    getHouseholdMembership: async (userId: string) =>
        db.members.find((member) => member.userId === userId) ?? null,
    householdExists: async () => db.household != null,
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
        const before = await noticesFor(noticeDeps(), HH);
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
        const after = await noticesFor(noticeDeps(), HH);
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
        const before = await noticesFor(noticeDeps(), HH);
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
        expect(html.toLowerCase()).toContain("suggestion");
        const after = await noticesFor(noticeDeps(), HH);
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
        const open = await noticesFor(noticeDeps(), HH);
        expect(
            open.notices.some(
                (n) =>
                    n.subject.id === yogurt.id && n.code === "fridge.expiring",
            ),
        ).toBe(true);
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
        const empty = await app().request("http://x/fridge", {
            headers: { cookie: cookieFor(ALICE) },
        });
        const emptyHtml = await empty.text();
        expect(emptyHtml).not.toContain("app-bar-attention");
        expect(emptyHtml).toContain('href="/settings" data-turbo="false"');

        await seedGroupedNotices();
        const open = await noticesFor(noticeDeps(), HH);
        const count = needsAttentionCount(open.notices);
        expect(count).toBeGreaterThan(0);
        const withBadge = await app().request("http://x/fridge", {
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
        await app().request(`http://x/fridge/locations/${loc.id}/delete`, {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "",
        });
        const rows = await db.dismissalsStore.listForHousehold(HH);
        expect(rows.some((r) => r.subjectId === item.id)).toBe(false);
    });
});
