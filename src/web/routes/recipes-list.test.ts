import {
    afterAll,
    beforeEach,
    describe,
    expect,
    mock,
    spyOn,
    test,
} from "bun:test";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import * as actualHousehold from "../../db/household.js";
import * as actualProfiles from "../../db/profiles.js";
import * as actualRecipesDb from "../../db/recipes.js";
import * as actualFridgeDb from "../../db/fridge.js";
import * as actualFoodsDb from "../../db/foods.js";
import { createMemoryFoodsStore, newFood } from "../../domain/foods.js";
import { addLocation, createMemoryFridgeStore } from "../../domain/fridge.js";
import {
    addRecipeIngredientById,
    createMemoryRecipesStore,
    createRecipe,
} from "../../domain/recipes.js";
import { recheckRecipe } from "../../domain/recipe-import.js";
import * as actualAttention from "../attention.js";
import * as actualNoticeDismissals from "../../db/notice-dismissals.js";
import * as actualGrocery from "../../db/grocery.js";
import * as actualStock from "../../db/stock.js";
import * as actualRules from "../../db/rules.js";
import * as actualSettings from "../../db/settings.js";
import * as actualNutrition from "../../db/nutrition.js";
import * as actualPlans from "../../db/plans.js";
import * as actualWeighIns from "../../db/weigh-ins.js";
import { createMemoryWeighInStore } from "../../domain/notices-actionable.js";
import * as actualLoadersToday from "../loaders-today.js";
import { buildPreviewTodayView } from "../pages/v2/today.js";
import { createMemoryPlansStore } from "../../domain/plan.js";
import { addPlanDays } from "../../domain/plan-week.js";
import { dateInTz } from "../../domain/tz.js";
import { createGroceryStore } from "../../domain/settings.js";
import { PLAN_UNKNOWN_LINE_NOTE } from "../../copy/toasts.js";
import { createMemoryNoticeDismissalsStore } from "../../domain/notice-dismissals.js";
import { createMemoryGroceryStore } from "../../domain/grocery.js";
import {
    addFridgeItemAdjust,
    createMemoryStockStore,
} from "../../domain/stock.js";
import { createMemoryRulesStore } from "../../domain/rules.js";
import { createMemorySettingsStore } from "../../domain/settings.js";
import { Hono } from "hono";
import {
    decodeToastFlash,
    readToastCookie,
    TOAST_COOKIE,
} from "../components/toast.js";

const realHousehold = { ...actualHousehold };
const realProfiles = { ...actualProfiles };
const realRecipesDb = { ...actualRecipesDb };
const realFridgeDb = { ...actualFridgeDb };
const realFoodsDb = { ...actualFoodsDb };
const realAttention = { ...actualAttention };
const realNoticeDismissals = { ...actualNoticeDismissals };
const realWeighIns = { ...actualWeighIns };
const realGrocery = { ...actualGrocery };
const realStock = { ...actualStock };
const realRules = { ...actualRules };
const realSettings = { ...actualSettings };
const realNutrition = { ...actualNutrition };
const realPlans = { ...actualPlans };
const realLoadersToday = { ...actualLoadersToday };

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const HH = "hh-1";

process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

const db = {
    foodsStore: createMemoryFoodsStore(),
    fridgeStore: createMemoryFridgeStore(),
    recipesStore: createMemoryRecipesStore(),
    dismissalsStore: createMemoryNoticeDismissalsStore(),
    groceryStore: createMemoryGroceryStore(),
    stockStore: createMemoryStockStore(),
    rulesStore: createMemoryRulesStore(),
    settingsStore: createMemorySettingsStore(),
    plansStore: createMemoryPlansStore(),
    /** The household owner's timezone, which is the household's calendar. */
    ownerTimezone: "UTC",
    recipeId: "",
    flourId: "",
    /** Makes the next insertMeal throw, like a db outage. */
    failInsert: false,
    meals: [] as {
        id: string;
        userId: string;
        input: Record<string, any>;
    }[],
    profile: {
        user_id: ALICE,
        timezone: "UTC",
        preferred_weight_unit: null,
        widgets_enabled: true,
        alcohol_tracking_enabled: false,
        preferred_drink_unit: null,
        theme: "light",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
    },
};

mock.module("../../db/foods.js", () => ({
    ...realFoodsDb,
    liveFoodsStore: () => db.foodsStore,
}));
mock.module("../../db/fridge.js", () => ({
    ...realFridgeDb,
    liveFridgeStore: () => db.fridgeStore,
}));
mock.module("../../db/recipes.js", () => ({
    ...realRecipesDb,
    liveRecipesStore: () => db.recipesStore,
}));
mock.module("../../db/grocery.js", () => ({
    ...realGrocery,
    liveGroceryStore: () => db.groceryStore,
}));
mock.module("../../db/stock.js", () => ({
    ...realStock,
    liveStockStore: () => db.stockStore,
    // No database here: the memory stores are the "transaction".
    inStockTransaction: <T>(fn: () => Promise<T>) => fn(),
}));
mock.module("../../db/plans.js", () => ({
    ...realPlans,
    liveRecipePlansStore: () => db.plansStore,
    // No database here: the memory stores are the "transaction".
    planTransaction: () => (fn: () => Promise<unknown>) => fn(),
}));
// Today's own meals and goals are not what these tests are about; its week plan
// (the real loader over the memory stores) is. The day follows the household.
mock.module("../loaders-today.js", () => ({
    ...realLoadersToday,
    loadToday: async () => buildPreviewTodayView(dateInTz(new Date(), "UTC")),
}));
mock.module("../../db/rules.js", () => ({
    ...realRules,
    liveRulesStore: () => db.rulesStore,
}));
mock.module("../../db/settings.js", () => ({
    ...realSettings,
    liveSettingsStore: () => db.settingsStore,
}));
mock.module("../../db/nutrition.js", () => ({
    ...realNutrition,
    // Keeps what was written, and dedupes on the idempotency key like the table.
    insertMeal: async (userId: string, input: Record<string, any>) => {
        if (db.failInsert) throw new Error("meal store down");
        const dup = input.idempotency_key
            ? db.meals.find(
                  (m) =>
                      m.userId === userId &&
                      m.input.idempotency_key === input.idempotency_key,
              )
            : undefined;
        if (dup) return { meal: { id: dup.id }, deduplicated: true };
        const id = `meal-${db.meals.length + 1}`;
        db.meals.push({ id, userId, input });
        return { meal: { id }, deduplicated: false };
    },
    getLatestWeight: async () => null,
    deleteMeal: async (userId: string, id: string) => {
        const at = db.meals.findIndex(
            (m) => m.userId === userId && m.id === id,
        );
        if (at < 0) return false;
        db.meals.splice(at, 1);
        return true;
    },
    existingIdempotencyKeys: async (userId: string, keys: string[]) =>
        new Set(
            db.meals
                .filter((m) => m.userId === userId)
                .map((m) => m.input.idempotency_key as string)
                .filter((k) => keys.includes(k)),
        ),
}));
mock.module("../../db/weigh-ins.js", () => ({
    ...realWeighIns,
    liveWeighInStore: () => createMemoryWeighInStore([]),
}));
mock.module("../../db/notice-dismissals.js", () => ({
    ...realNoticeDismissals,
    liveNoticeDismissalsStore: () => db.dismissalsStore,
}));
mock.module("../../db/profiles.js", () => ({
    ...realProfiles,
    getProfile: async (userId: string) =>
        userId === ALICE ? db.profile : null,
}));
mock.module("../../db/household.js", () => ({
    ...realHousehold,
    getHouseholdMembership: async (userId: string) =>
        userId === ALICE
            ? {
                  userId: ALICE,
                  householdId: HH,
                  role: "owner" as const,
                  displayName: "Alice",
              }
            : userId === BOB
              ? {
                    userId: BOB,
                    householdId: HH,
                    role: "member" as const,
                    displayName: "Bob",
                }
              : null,
    listHouseholdMembers: async () => [
        {
            userId: ALICE,
            householdId: HH,
            role: "owner" as const,
            displayName: "Alice",
        },
        {
            userId: BOB,
            householdId: HH,
            role: "member" as const,
            displayName: "Bob",
        },
    ],
    getHouseholdConfig: async () => ({
        name: "Home",
        recipeSearchPlaces: [],
        preferences: { drink_unit: null, grocery_default_store_id: null },
    }),
    householdExists: async () => true,
    getHouseholdOwnerProfile: async () => ({
        timezone: db.ownerTimezone,
    }),
}));

afterAll(() => {
    mock.module("../../db/foods.js", () => realFoodsDb);
    mock.module("../../db/fridge.js", () => realFridgeDb);
    mock.module("../../db/recipes.js", () => realRecipesDb);
    mock.module("../../db/grocery.js", () => realGrocery);
    mock.module("../../db/notice-dismissals.js", () => realNoticeDismissals);
    mock.module("../../db/weigh-ins.js", () => realWeighIns);
    mock.module("../../db/profiles.js", () => realProfiles);
    mock.module("../../db/household.js", () => realHousehold);
    mock.module("../attention.js", () => realAttention);
    mock.module("../../db/stock.js", () => realStock);
    mock.module("../../db/rules.js", () => realRules);
    mock.module("../../db/settings.js", () => realSettings);
    mock.module("../../db/nutrition.js", () => realNutrition);
    mock.module("../../db/plans.js", () => realPlans);
    mock.module("../loaders-today.js", () => realLoadersToday);
});

const { renderRecipesListPage, renderRecipeDetailRoute } =
    await import("../loaders.js");
const { recipesRoutes } = await import("./recipes.js");
const { mintSiteSession, SITE_COOKIE } = await import("../../site-session.js");

function cookieFor(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

function recipesApp() {
    const hono = new Hono();
    hono.route("/", recipesRoutes);
    return hono;
}

beforeEach(async () => {
    resetFlagsForTests();
    db.foodsStore = createMemoryFoodsStore();
    db.fridgeStore = createMemoryFridgeStore();
    db.recipesStore = createMemoryRecipesStore();
    db.dismissalsStore = createMemoryNoticeDismissalsStore();
    db.groceryStore = createMemoryGroceryStore();
    db.stockStore = createMemoryStockStore();
    db.rulesStore = createMemoryRulesStore();
    db.settingsStore = createMemorySettingsStore();
    db.plansStore = createMemoryPlansStore();
    db.ownerTimezone = "UTC";
    db.meals = [];
    db.failInsert = false;
    db.fridgeStore.linkDismissals(db.dismissalsStore);
    db.recipesStore.linkDismissals(db.dismissalsStore);
    db.foodsStore.linkRefs(db.stockStore);
    const flour = await db.foodsStore.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Flour",
            calories: 364,
            proteinG: 10,
            carbsG: 76,
            fatG: 1,
            gramsPerMl: null,
            gramsPerEach: null,
        }),
    );
    const recipe = await createRecipe(db.recipesStore, {
        householdId: HH,
        creatorId: ALICE,
        name: "Pancakes",
        yieldPortions: 2,
        prepMinutes: 10,
        cookMinutes: 5,
    });
    await addRecipeIngredientById(db.recipesStore, db.foodsStore, {
        householdId: HH,
        recipeId: recipe.id,
        foodId: flour.id,
        amount: 100,
        unit: "g",
    });
    const loc = await addLocation(db.fridgeStore, HH, "Pantry");
    await addFridgeItemAdjust(db.fridgeStore, db.stockStore, db.foodsStore, {
        householdId: HH,
        foodId: flour.id,
        amount: 500,
        unit: "g",
        locationId: loc.id,
        actorUserId: ALICE,
    });
    db.recipeId = recipe.id;
    db.flourId = flour.id;
});

function cookFormBodyFromHtml(html: string): string {
    const form = html.match(
        /<form\b[^>]*\bclass="[^"]*\b(?:fd-recipe-cook|recipe-cook)\b[^"]*"[^>]*>[\s\S]*?<\/form>/,
    )?.[0];
    if (!form) throw new Error("cook form not found in page HTML");
    const params = new URLSearchParams();
    for (const m of form.matchAll(/<input\b([^>]*)\/?>/gi)) {
        const attrs = m[1] ?? "";
        const name = /name="([^"]+)"/.exec(attrs)?.[1];
        if (!name) continue;
        const type = (/type="([^"]+)"/.exec(attrs)?.[1] ?? "text")
            .trim()
            .toLowerCase();
        if (type === "checkbox" || type === "radio") {
            if (!/\bchecked\b/.test(attrs)) continue;
            params.append(name, /value="([^"]+)"/.exec(attrs)?.[1] ?? "on");
            continue;
        }
        const value = /value="([^"]*)"/.exec(attrs)?.[1];
        if (value != null) params.append(name, value);
        else params.append(name, "");
    }
    for (const m of form.matchAll(
        /<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi,
    )) {
        const name = m[1]!;
        const options = m[2] ?? "";
        const selected =
            /<option\b[^>]*\bselected\b[^>]*\bvalue="([^"]*)"/i.exec(options) ??
            /<option\b[^>]*\bvalue="([^"]*)"[^>]*\bselected\b/i.exec(options);
        if (selected) params.append(name, selected[1]!);
    }
    return params.toString();
}

describe("renderRecipesListPage", () => {
    test("renders the list body", async () => {
        const page = await renderRecipesListPage(ALICE, {});
        expect(page.status).toBe(200);
        expect(page.html).toContain("fd-recipes-page");
        expect(page.html).toContain("Pancakes");
        expect(page.html).toContain('action="/recipes/import"');
    });

    test("the shared-recipe import form follows mcp-share-links", async () => {
        setFlagsForTests(createMemoryFlags({ "mcp-share-links": false }));
        const off = await renderRecipesListPage(ALICE, {});
        expect(off.html).toContain('action="/recipes/import"');
        expect(off.html).not.toContain("/recipes/import-shared");
        setFlagsForTests(createMemoryFlags({ "mcp-share-links": true }));
        const on = await renderRecipesListPage(ALICE, {});
        expect(on.html).toContain('action="/recipes/import-shared"');
    });

    test("duplicate import surfaces open link", async () => {
        const page = await renderRecipesListPage(ALICE, {
            importDuplicateRecipeId: "11111111-1111-4111-8111-111111111112",
        });
        expect(page.html).toContain("You already have this recipe");
        expect(page.html).toContain("11111111-1111-4111-8111-111111111112");
    });

    test("filter query trims the card list", async () => {
        const eggs = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                calories: 140,
                proteinG: 12,
                carbsG: 1,
                fatG: 10,
                gramsPerMl: null,
                gramsPerEach: 50,
            }),
        );
        const high = await createRecipe(db.recipesStore, {
            householdId: HH,
            creatorId: ALICE,
            name: "Egg whites",
            yieldPortions: 1,
            prepMinutes: 5,
            cookMinutes: 5,
        });
        await addRecipeIngredientById(db.recipesStore, db.foodsStore, {
            householdId: HH,
            recipeId: high.id,
            foodId: eggs.id,
            amount: 2,
            unit: "each",
        });
        const page = await renderRecipesListPage(ALICE, {
            q: "egg",
            filter: "quick",
        });
        expect(page.html).toContain("Egg whites");
        expect(page.html).not.toContain("Pancakes");
    });
});

describe("renderRecipeDetailRoute", () => {
    test("renders the recipe page", async () => {
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        expect(page.status).toBe(200);
        expect(page.html).toContain("fd-recipe-detail");
        expect(page.html).toContain("fd-recipe-cook");
        expect(page.html).toContain("Pantry");
    });

    test("Share is offered only while mcp-share-links is on", async () => {
        setFlagsForTests(createMemoryFlags({ "mcp-share-links": false }));
        const off = await renderRecipeDetailRoute(ALICE, db.recipeId);
        expect(off.html).not.toContain("fd-recipe-share");
        expect(off.html).not.toContain("/share");
        setFlagsForTests(createMemoryFlags({ "mcp-share-links": true }));
        const on = await renderRecipeDetailRoute(ALICE, db.recipeId);
        expect(on.html).toContain('id="fd-recipe-share-sheet"');
        expect(on.html).toContain(`action="/recipes/${db.recipeId}/share"`);
    });

    test("the page carries the cook sheet with a preview of what the cook takes", async () => {
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        expect(page.html).toContain('id="fd-recipe-cook-sheet"');
        expect(page.html).toContain("Takes from your kitchen");
        // 2 portions of a 2-portion recipe: 100 g of the 500 g of flour.
        expect(page.html).toContain("500 g → 400 g");
        expect(page.html).toContain("Log 1 serving to ");
        expect(page.html).toContain('name="servings"');
        expect(page.html).not.toContain("data-sheet-open-on-load");
    });

    test("?cook=1 opens the sheet on load", async () => {
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId, {
            openCook: true,
        });
        expect(page.html).toContain("data-sheet-open-on-load");
    });
});

/** The sheet's form as a browser would post it (entities decoded). */
function cookSheetBody(html: string): URLSearchParams {
    const form = html.match(
        /<form\b[^>]*\bid="fd-recipe-cook-form"[^>]*>[\s\S]*?<\/form>/,
    )?.[0];
    if (!form) throw new Error("cook sheet form not found in page HTML");
    const decode = (v: string) =>
        v
            .replaceAll("&quot;", '"')
            .replaceAll("&#39;", "'")
            .replaceAll("&lt;", "<")
            .replaceAll("&gt;", ">")
            .replaceAll("&amp;", "&");
    const params = new URLSearchParams();
    for (const m of form.matchAll(/<input\b([^>]*)>/gi)) {
        const attrs = m[1] ?? "";
        const name = /name="([^"]+)"/.exec(attrs)?.[1];
        if (!name) continue;
        const type = /type="([^"]+)"/.exec(attrs)?.[1] ?? "text";
        if (type === "checkbox" && !/\bchecked\b/.test(attrs)) continue;
        params.append(name, decode(/value="([^"]*)"/.exec(attrs)?.[1] ?? "on"));
    }
    return params;
}

async function postConfirm(body: URLSearchParams | string) {
    return recipesApp().request(
        `http://x/recipes/${db.recipeId}/cook/confirm`,
        {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
        },
    );
}

function toastOf(res: Response) {
    const cookie = res.headers
        .getSetCookie()
        .map((h) => h.split(";")[0] ?? "")
        .find((h) => h.startsWith(`${TOAST_COOKIE}=`));
    if (!cookie) return null;
    return decodeToastFlash(readToastCookie(cookie) ?? "");
}

async function flourLeft(): Promise<number> {
    const items = await db.fridgeStore.listItems(HH);
    return items
        .filter((i) => i.foodId === db.flourId)
        .reduce((sum, i) => sum + i.quantity.amount, 0);
}

describe("GET /recipes/:id/cook/preview", () => {
    function get(servings: string, cookie = cookieFor(ALICE)) {
        return recipesApp().request(
            `http://x/recipes/${db.recipeId}/cook/preview?servings=${servings}`,
            { headers: { cookie } },
        );
    }

    test("returns the preview region for that many servings", async () => {
        const res = await get("4");
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toContain("no-store");
        const html = await res.text();
        // 4 servings of a 2-portion recipe: 200 g of the 500 g.
        expect(html).toContain("500 g → 300 g");
        expect(html).toContain("data-fd-cook-region");
        expect(html).not.toContain("<html");
        expect(await flourLeft()).toBe(500);
    });

    test("names what is short when the kitchen cannot cover it", async () => {
        const html = await (await get("20")).text();
        expect(html).toContain("fd-recipe-cook-use--short");
    });

    test("rejects junk servings without a preview", async () => {
        for (const bad of ["0", "-1", "abc", ""]) {
            const res = await get(bad);
            expect(res.status).toBe(400);
        }
    });
});

describe("POST /recipes/:id/cook/confirm", () => {
    test("cooks and logs exactly one portion of the recipe to the chosen slot", async () => {
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        const body = cookSheetBody(page.html);
        body.set("servings", "4");
        body.set("meal_type", "lunch");
        const res = await postConfirm(body);
        expect(res.status).toBe(303);
        // 4 servings of a 2-portion recipe takes 200 g.
        expect(await flourLeft()).toBe(300);
        const cooks = (await db.stockStore.listMovements(HH)).filter(
            (m) => m.reason === "cook",
        );
        expect(cooks).toHaveLength(1);

        expect(db.meals).toHaveLength(1);
        const meal = db.meals[0]!;
        expect(meal.userId).toBe(ALICE);
        expect(meal.input.meal_type).toBe("lunch");
        expect(meal.input.items).toHaveLength(1);
        expect(meal.input.items[0].recipe_id).toBe(db.recipeId);
        expect(meal.input.items[0].portions).toBe(1);
        expect(meal.input.description).toContain("Pancakes");
        // One portion of the recipe: 100 g of flour over 2 portions.
        expect(meal.input.calories).toBe(182);
        expect(meal.input.idempotency_key).toContain(db.recipeId);

        expect(toastOf(res)).toEqual({
            key: "recipes.cooked.logged",
            params: { slot: "lunch" },
        });
    });

    test("a double submit cooks and logs once", async () => {
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        const body = cookSheetBody(page.html);
        const first = await postConfirm(body);
        expect(first.status).toBe(303);
        const second = await postConfirm(body);
        expect(second.status).toBe(303);
        expect(await flourLeft()).toBe(400);
        expect(db.meals).toHaveLength(1);
        expect(toastOf(second)).toEqual({ key: "recipes.cooked.already" });
    });

    test("a double submit with the switch off cooks once", async () => {
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        const body = cookSheetBody(page.html);
        body.delete("log_serving");
        const first = await postConfirm(body);
        expect(first.status).toBe(303);
        expect(toastOf(first)).toEqual({ key: "recipes.cooked" });
        const second = await postConfirm(body);
        expect(second.status).toBe(303);
        expect(toastOf(second)).toEqual({ key: "recipes.cooked.already" });
        expect(await flourLeft()).toBe(400);
        expect(
            (await db.stockStore.listMovements(HH)).filter(
                (m) => m.reason === "cook",
            ),
        ).toHaveLength(1);
        expect(db.meals).toHaveLength(0);
    });

    test("with the switch off it cooks and logs nothing", async () => {
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        const body = cookSheetBody(page.html);
        body.delete("log_serving");
        const res = await postConfirm(body);
        expect(res.status).toBe(303);
        expect(await flourLeft()).toBe(400);
        expect(db.meals).toHaveLength(0);
        expect(toastOf(res)).toEqual({ key: "recipes.cooked" });
    });

    test("a shortfall is cooked anyway and the toast says so", async () => {
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        const body = cookSheetBody(page.html);
        body.set("servings", "20");
        body.delete("expected");
        const res = await postConfirm(body);
        expect(res.status).toBe(303);
        expect(toastOf(res)?.key).toBe("recipes.cooked.shortfall.logged");
        expect(await flourLeft()).toBe(0);
    });

    test("lists what moved when the kitchen changed after the preview", async () => {
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        const body = cookSheetBody(page.html);
        // Someone cooked or discarded flour between the preview and the confirm.
        const [item] = await db.fridgeStore.listItems(HH);
        await db.fridgeStore.updateItem({
            ...item!,
            quantity: { amount: 250, unit: "g" },
        });
        const res = await postConfirm(body);
        expect(res.status).toBe(303);
        const toast = toastOf(res);
        expect(toast?.key).toBe("recipes.cooked.changed.logged");
        expect(toast?.params?.names).toBe("Flour");
        expect(await flourLeft()).toBe(150);
        // It still did what was asked, meal included.
        expect(db.meals).toHaveLength(1);
    });

    function cookMovements() {
        return db.stockStore
            .listMovements(HH)
            .then((rows) => rows.filter((m) => m.reason === "cook"));
    }

    test("two submits in flight at once cook and log once", async () => {
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        const body = cookSheetBody(page.html);
        const [a, b] = await Promise.all([
            postConfirm(body),
            postConfirm(body),
        ]);
        expect(a.status).toBe(303);
        expect(b.status).toBe(303);
        expect(await cookMovements()).toHaveLength(1);
        expect(await flourLeft()).toBe(400);
        expect(db.meals).toHaveLength(1);
        const keys = [toastOf(a)?.key, toastOf(b)?.key].sort();
        expect(keys).toContain("recipes.cooked.already");
    });

    test("a meal that cannot be saved cooks nothing and re-opens the sheet", async () => {
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        const body = cookSheetBody(page.html);
        db.failInsert = true;
        const res = await postConfirm(body);
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain("data-sheet-open-on-load");
        expect(html).toContain("meal store down");
        expect(await cookMovements()).toHaveLength(0);
        expect(await flourLeft()).toBe(500);
        expect(db.meals).toHaveLength(0);
    });

    test("a cook that fails takes the just-logged meal back", async () => {
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        const body = cookSheetBody(page.html);
        const insertMovement = db.stockStore.insertMovement;
        db.stockStore.insertMovement = async () => {
            throw new Error("ledger down");
        };
        try {
            const res = await postConfirm(body);
            expect(res.status).toBe(400);
            expect(await res.text()).toContain("ledger down");
        } finally {
            db.stockStore.insertMovement = insertMovement;
        }
        expect(db.meals).toHaveLength(0);
        // The sheet's own retry is not mistaken for a repeat.
        const retry = await postConfirm(body);
        expect(retry.status).toBe(303);
        expect(toastOf(retry)?.key).not.toBe("recipes.cooked.already");
        expect(db.meals).toHaveLength(1);
    });

    test("bad servings re-open the sheet with the error and change nothing", async () => {
        const res = await postConfirm(
            new URLSearchParams({
                servings: "0",
                meal_type: "dinner",
                log_serving: "1",
                submit_key: "k",
            }),
        );
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain("data-sheet-open-on-load");
        expect(html).toContain("greater than zero");
        expect(await flourLeft()).toBe(500);
        expect(db.meals).toHaveLength(0);
    });

    test("an unknown slot falls back to the guess instead of failing", async () => {
        const res = await postConfirm(
            new URLSearchParams({
                servings: "2",
                meal_type: "brunch",
                log_serving: "1",
                submit_key: "k2",
            }),
        );
        expect(res.status).toBe(303);
        expect(["breakfast", "lunch", "dinner", "snack"]).toContain(
            db.meals[0]?.input.meal_type,
        );
    });
});

async function postFavourite(
    body: URLSearchParams,
    opts: { as?: string; recipeId?: string } = {},
) {
    return recipesApp().request(
        `http://x/recipes/${opts.recipeId ?? db.recipeId}/favourite`,
        {
            method: "POST",
            headers: {
                cookie: cookieFor(opts.as ?? ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
        },
    );
}

async function favouriteIds(userId: string): Promise<string[]> {
    return db.recipesStore.listFavourites(HH, userId);
}

describe("POST /recipes/:id/favourite", () => {
    test("stars for the viewer and goes back to the list with its search and filter", async () => {
        const res = await postFavourite(
            new URLSearchParams({
                on: "1",
                back: "list",
                q: "pan",
                filter: "quick",
            }),
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe(
            `/recipes?q=pan&filter=quick#recipe-${db.recipeId}`,
        );
        expect(await favouriteIds(ALICE)).toEqual([db.recipeId]);
    });

    test("goes back to the recipe page from the recipe page", async () => {
        const res = await postFavourite(
            new URLSearchParams({ on: "1", back: "recipe" }),
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe(`/recipes/${db.recipeId}`);
    });

    test("an unknown filter or back value falls back instead of being followed", async () => {
        const res = await postFavourite(
            new URLSearchParams({
                on: "1",
                back: "https://evil.example/",
                q: "",
                filter: "//evil.example",
            }),
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe(`/recipes/${db.recipeId}`);
        const list = await postFavourite(
            new URLSearchParams({
                on: "1",
                back: "list",
                filter: "//evil.example",
            }),
        );
        expect(list.headers.get("location")).toBe(
            `/recipes#recipe-${db.recipeId}`,
        );
    });

    test("on=0 unstars, and starring or unstarring twice changes nothing more", async () => {
        await postFavourite(new URLSearchParams({ on: "1" }));
        await postFavourite(new URLSearchParams({ on: "1" }));
        expect(await favouriteIds(ALICE)).toEqual([db.recipeId]);
        await postFavourite(new URLSearchParams({ on: "0" }));
        await postFavourite(new URLSearchParams({ on: "0" }));
        expect(await favouriteIds(ALICE)).toEqual([]);
    });

    test("another member's stars are untouched", async () => {
        await postFavourite(new URLSearchParams({ on: "1" }), { as: BOB });
        await postFavourite(new URLSearchParams({ on: "1" }));
        await postFavourite(new URLSearchParams({ on: "0" }));
        expect(await favouriteIds(ALICE)).toEqual([]);
        expect(await favouriteIds(BOB)).toEqual([db.recipeId]);
    });

    test("a recipe that is not in the household is a 404 and stars nothing", async () => {
        const res = await postFavourite(new URLSearchParams({ on: "1" }), {
            recipeId: "11111111-1111-4111-8111-1111111111ff",
        });
        expect(res.status).toBe(404);
        expect(await favouriteIds(ALICE)).toEqual([]);
    });
});

describe("steps-mention warnings on the recipe page", () => {
    const STEPS = "Fry the rice.\nScramble 2 lightly beaten eggs into it.";

    /** A recipe whose steps use an egg that its one ingredient (rice) never lists. */
    async function friedRice(opts: { imported?: boolean } = {}) {
        const recipe = await createRecipe(db.recipesStore, {
            householdId: HH,
            creatorId: ALICE,
            name: "Fried rice",
            yieldPortions: 2,
            instructions: STEPS,
            verification: "unverified",
        });
        const rice = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Rice",
                calories: 130,
                proteinG: 3,
                carbsG: 28,
                fatG: 0,
                gramsPerMl: null,
                gramsPerEach: null,
            }),
        );
        await addRecipeIngredientById(db.recipesStore, db.foodsStore, {
            householdId: HH,
            recipeId: recipe.id,
            foodId: rice.id,
            amount: 200,
            unit: "g",
        });
        if (opts.imported !== false) {
            await db.recipesStore.upsertImport({
                recipeId: recipe.id,
                householdId: HH,
                sourceKind: "text",
                sourceUrl: null,
                sourceText: "pasted",
                sourceTextOrigin: "pasted",
                transcript: null,
                credit: null,
                unresolvedLines: [],
                problems: [],
                dismissedMentions: [],
                importedAt: "2026-01-01T00:00:00.000Z",
            });
        }
        await recheckRecipe(db.recipesStore, HH, recipe.id);
        return recipe.id;
    }

    function postMention(
        action: "add" | "dismiss",
        recipeId: string,
        key: string,
        opts: { as?: string } = {},
    ) {
        return recipesApp().request(
            `http://x/recipes/${recipeId}/mentions/${action}`,
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(opts.as ?? ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({ key }).toString(),
            },
        );
    }

    async function pageOf(recipeId: string): Promise<string> {
        return (await renderRecipeDetailRoute(ALICE, recipeId)).html;
    }

    const ingredientNames = async (recipeId: string) =>
        (await db.recipesStore.listIngredients(HH, recipeId)).map(
            (i) => i.displayName,
        );

    test("an imported recipe shows the food its steps miss, and the page still cooks", async () => {
        const id = await friedRice();
        const html = await pageOf(id);
        expect(html).toContain("fd-mention-card");
        expect(html).toContain(
            "The steps mention egg, which isn't an ingredient.",
        );
        expect(html).toContain(`action="/recipes/${id}/mentions/add"`);
        expect(html).toContain(`action="/recipes/${id}/mentions/dismiss"`);
        expect(html).toContain('<span class="fd-mention-mark">eggs</span>');
        // Advice only: the recipe is still verified and can be cooked.
        expect((await db.recipesStore.getRecipe(HH, id))?.verification).toBe(
            "verified",
        );
        expect(html).toContain('id="fd-recipe-cook-sheet"');
    });

    test("a hand-made recipe, and one with nothing missing, show no card", async () => {
        expect(
            await pageOf(await friedRice({ imported: false })),
        ).not.toContain("fd-mention");
        expect(await pageOf(db.recipeId)).not.toContain("fd-mention");
    });

    test("Add puts the ingredient on the recipe with the step's amount and note, and the card goes", async () => {
        const id = await friedRice();
        const res = await postMention("add", id, "egg");
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe(`/recipes/${id}`);
        expect(toastOf(res)).toMatchObject({
            key: "recipes.mention.added",
            params: { name: "egg" },
        });
        const ingredients = await db.recipesStore.listIngredients(HH, id);
        const egg = ingredients.find((i) => i.displayName === "egg");
        expect(egg?.quantity).toEqual({ amount: 2, unit: "each" });
        expect(egg?.note).toBe("lightly beaten");
        expect(await pageOf(id)).not.toContain("fd-mention");
        expect((await db.recipesStore.getRecipe(HH, id))?.verification).toBe(
            "verified",
        );
        expect(await ingredientNames(id)).toContain("egg");
    });

    test("Dismiss hides the card, adds nothing, and the dismissal survives a re-check", async () => {
        const id = await friedRice();
        const res = await postMention("dismiss", id, "egg");
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe(`/recipes/${id}`);
        expect(toastOf(res)).toBeNull();
        expect(await ingredientNames(id)).toEqual(["Rice"]);
        expect(await pageOf(id)).not.toContain("fd-mention");
        await recheckRecipe(db.recipesStore, HH, id);
        expect(await pageOf(id)).not.toContain("fd-mention");
        expect(
            (await db.recipesStore.getImport(HH, id))?.dismissedMentions,
        ).toEqual(["egg"]);
    });

    test("a key that is no longer flagged goes back with a toast, not a 500", async () => {
        const id = await friedRice();
        for (const action of ["add", "dismiss"] as const) {
            const res = await postMention(action, id, "kale");
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe(`/recipes/${id}`);
            expect(toastOf(res)?.key).toBe("recipes.mention.error");
        }
        await postMention("add", id, "egg");
        const again = await postMention("add", id, "egg");
        expect(again.status).toBe(303);
        expect(toastOf(again)?.key).toBe("recipes.mention.error");
        expect(
            (await ingredientNames(id)).filter((n) => n === "egg"),
        ).toHaveLength(1);
    });

    test("a hand-made recipe has nothing to add or dismiss", async () => {
        const id = await friedRice({ imported: false });
        for (const action of ["add", "dismiss"] as const) {
            const res = await postMention(action, id, "egg");
            expect(res.status).toBe(303);
            expect(toastOf(res)?.key).toBe("recipes.mention.error");
        }
        expect(await ingredientNames(id)).toEqual(["Rice"]);
        expect(await db.recipesStore.getImport(HH, id)).toBeNull();
    });

    test("an unknown recipe or a bad id is a 404", async () => {
        for (const action of ["add", "dismiss"] as const) {
            const unknown = await postMention(
                action,
                "11111111-1111-4111-8111-1111111111ff",
                "egg",
            );
            expect(unknown.status).toBe(404);
            expect((await postMention(action, "nope", "egg")).status).toBe(404);
        }
    });

    test("another household's recipe is a 404 and is left alone", async () => {
        const other = await createRecipe(db.recipesStore, {
            householdId: "hh-other",
            creatorId: ALICE,
            name: "Their rice",
            yieldPortions: 2,
            instructions: STEPS,
            verification: "unverified",
        });
        for (const action of ["add", "dismiss"] as const) {
            const res = await postMention(action, other.id, "egg");
            expect(res.status).toBe(404);
        }
        expect(
            await db.recipesStore.getImport("hh-other", other.id),
        ).toBeNull();
        expect(
            await db.recipesStore.listIngredients("hh-other", other.id),
        ).toEqual([]);
    });

    test("a food archived after the page was drawn goes back with a toast, not a 500", async () => {
        const id = await friedRice();
        const egg = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Egg",
                calories: 143,
                proteinG: 13,
                carbsG: 1,
                fatG: 10,
                gramsPerMl: null,
                gramsPerEach: 50,
            }),
        );
        const original = db.foodsStore.getFood;
        db.foodsStore.getFood = async (household, foodId) => {
            const food = await original.call(db.foodsStore, household, foodId);
            return food?.id === egg.id
                ? { ...food, archivedAt: "2026-01-02T00:00:00.000Z" }
                : food;
        };
        try {
            const res = await postMention("add", id, "egg");
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe(`/recipes/${id}`);
            expect(toastOf(res)?.key).toBe("recipes.mention.error");
        } finally {
            db.foodsStore.getFood = original;
        }
        expect(await ingredientNames(id)).toEqual(["Rice"]);
    });

    test("a member can add or dismiss, and a visitor without a session cannot", async () => {
        const id = await friedRice();
        expect(
            (await postMention("dismiss", id, "egg", { as: BOB })).status,
        ).toBe(303);
        const visitor = await recipesApp().request(
            `http://x/recipes/${id}/mentions/add`,
            {
                method: "POST",
                headers: {
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "key=egg",
            },
        );
        expect(visitor.status).not.toBe(303);
        expect(await ingredientNames(id)).toEqual(["Rice"]);
    });

    test("a warning lookup that fails leaves the page whole, without the card", async () => {
        const id = await friedRice();
        const original = db.foodsStore.listAllAliases;
        db.foodsStore.listAllAliases = async (...args) => {
            if (new Error().stack?.includes("mentionVocabulary")) {
                throw new Error("aliases are down");
            }
            return original.apply(db.foodsStore, args);
        };
        const logged = spyOn(console, "error").mockImplementation(() => {});
        try {
            const page = await renderRecipeDetailRoute(ALICE, id);
            expect(page.status).toBe(200);
            expect(page.html).toContain("fd-recipe-detail");
            expect(page.html).not.toContain("fd-mention");
            expect(logged).toHaveBeenCalled();
        } finally {
            db.foodsStore.listAllAliases = original;
            logged.mockRestore();
        }
    });
});

describe("favourites on the pages", () => {
    async function second(): Promise<string> {
        const other = await createRecipe(db.recipesStore, {
            householdId: HH,
            creatorId: ALICE,
            name: "Porridge",
            yieldPortions: 1,
        });
        return other.id;
    }

    test("the Favourites filter lists only the viewer's starred recipes", async () => {
        const porridge = await second();
        await db.recipesStore.setFavourite(HH, ALICE, db.recipeId, true);
        await db.recipesStore.setFavourite(HH, BOB, porridge, true);

        const mine = await renderRecipesListPage(ALICE, {
            filter: "favourites",
        });
        expect(mine.html).toContain("Pancakes");
        expect(mine.html).not.toContain("Porridge");
        expect(mine.html).toMatch(
            /fd-chip--selected[^>]*aria-current="true"[^>]*><span class="fd-chip__label">Favourites/,
        );

        const bobs = await renderRecipesListPage(BOB, {
            filter: "favourites",
        });
        expect(bobs.html).toContain("Porridge");
        expect(bobs.html).not.toContain("Pancakes");

        const all = await renderRecipesListPage(ALICE, {});
        expect(all.html).toContain("Pancakes");
        expect(all.html).toContain("Porridge");
    });

    test("cards show the viewer's own star state", async () => {
        const porridge = await second();
        await db.recipesStore.setFavourite(HH, ALICE, db.recipeId, true);
        await db.recipesStore.setFavourite(HH, BOB, porridge, true);
        const page = await renderRecipesListPage(ALICE, {});
        const card = (id: string) =>
            page.html.match(
                new RegExp(
                    `<li class="fd-row fd-row--recipe" id="recipe-${id}">[\\s\\S]*?</li>`,
                ),
            )![0];
        expect(card(db.recipeId)).toContain("fd-star--on");
        expect(card(porridge)).not.toContain("fd-star--on");
    });

    test("with nothing starred the filter says so", async () => {
        const page = await renderRecipesListPage(ALICE, {
            filter: "favourites",
        });
        expect(page.html).toContain("No favourites yet");
    });

    test("the recipe page star reflects the viewer's own state", async () => {
        await db.recipesStore.setFavourite(HH, BOB, db.recipeId, true);
        const unstarred = await renderRecipeDetailRoute(ALICE, db.recipeId);
        expect(unstarred.html).toContain("fd-star-form");
        expect(unstarred.html).not.toContain("fd-star--on");
        await db.recipesStore.setFavourite(HH, ALICE, db.recipeId, true);
        const starred = await renderRecipeDetailRoute(ALICE, db.recipeId);
        expect(starred.html).toContain("fd-star--on");
        expect(starred.html).toContain("Remove Pancakes from favourites");
    });
});

/* ---- The week plan ---- */

function todayUtc(): string {
    return dateInTz(new Date(), "UTC");
}

function postPlanPath(
    path: string,
    body: URLSearchParams,
    opts: { as?: string } = {},
) {
    return recipesApp().request(`http://x${path}`, {
        method: "POST",
        headers: {
            cookie: cookieFor(opts.as ?? ALICE),
            "content-type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
    });
}

async function planned() {
    return db.plansStore.listPlans(HH, "2000-01-01", "2100-01-01");
}

describe("POST /recipes/:id/plan", () => {
    function add(body: Record<string, string>, opts: { as?: string } = {}) {
        return postPlanPath(
            `/recipes/${db.recipeId}/plan`,
            new URLSearchParams(body),
            opts,
        );
    }

    test("plans the recipe on a day and slot with its servings", async () => {
        const day = addPlanDays(todayUtc(), 2);
        const res = await add({ date: day, slot: "lunch", servings: "3" });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe(`/recipes/${db.recipeId}`);
        expect(await planned()).toMatchObject([
            {
                householdId: HH,
                recipeId: db.recipeId,
                date: day,
                slot: "lunch",
                servings: 3,
                createdBy: ALICE,
            },
        ]);
        expect(toastOf(res)?.key).toBe("plan.added");
    });

    test("servings default to what the recipe yields", async () => {
        await add({ date: todayUtc(), slot: "dinner", servings: "" });
        expect((await planned())[0]?.servings).toBe(2);
    });

    test("a bad slot re-renders the recipe with the sheet open and plans nothing", async () => {
        const res = await add({ date: todayUtc(), slot: "brunch" });
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain('id="fd-recipe-plan-sheet"');
        expect(html).toMatch(
            /<dialog[^>]*id="fd-recipe-plan-sheet"[^>]*data-sheet-open-on-load/,
        );
        expect(html).toContain("A plan slot must be one of");
        expect(await planned()).toEqual([]);
    });

    test("a bad date re-renders with the sheet open and keeps what was typed", async () => {
        const res = await add({
            date: "2026-02-30",
            slot: "dinner",
            servings: "4",
        });
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toMatch(
            /<dialog[^>]*id="fd-recipe-plan-sheet"[^>]*data-sheet-open-on-load/,
        );
        expect(html).toContain("A plan date must be a day");
        expect(html).toContain('value="2026-02-30"');
        expect(html).toContain('value="4"');
        expect(await planned()).toEqual([]);
    });

    test("a day before the household's today is refused with the sheet open", async () => {
        const yesterday = addPlanDays(todayUtc(), -1);
        const res = await add({
            date: yesterday,
            slot: "dinner",
            servings: "3",
        });
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toMatch(
            /<dialog[^>]*id="fd-recipe-plan-sheet"[^>]*data-sheet-open-on-load/,
        );
        expect(html).toContain("Pick today or a later day.");
        expect(html).toContain(`value="${yesterday}"`);
        expect(await planned()).toEqual([]);
    });

    test("the household's calendar decides what is past, not UTC's", async () => {
        // One of these zones is on a different calendar day from UTC right now.
        for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
            db.ownerTimezone = tz;
            const hhToday = dateInTz(new Date(), tz);
            const past = await add({
                date: addPlanDays(hhToday, -1),
                slot: "dinner",
            });
            expect(past.status).toBe(400);
            const ok = await add({ date: hhToday, slot: "dinner" });
            expect(ok.status).toBe(303);
            expect(toastOf(ok)?.key).toBe("plan.added");
            await db.plansStore.removePlan(HH, (await planned())[0]!.id);
        }
    });

    test("servings that are not more than zero are refused", async () => {
        for (const bad of ["0", "-2", "abc"]) {
            const res = await add({
                date: todayUtc(),
                slot: "dinner",
                servings: bad,
            });
            expect(res.status).toBe(400);
        }
        expect(await planned()).toEqual([]);
    });

    test("a double submit plans once", async () => {
        const body = { date: todayUtc(), slot: "dinner", servings: "2" };
        await add(body);
        const again = await add(body);
        expect(again.status).toBe(303);
        expect(toastOf(again)?.key).toBe("plan.already");
        expect(await planned()).toHaveLength(1);
    });

    test("a recipe that is not in the household is a 404", async () => {
        const res = await postPlanPath(
            "/recipes/99999999-9999-4999-8999-999999999999/plan",
            new URLSearchParams({ date: todayUtc(), slot: "dinner" }),
        );
        expect(res.status).toBe(404);
        expect(await planned()).toEqual([]);
    });
});

describe("moving and removing a plan", () => {
    async function seed(): Promise<string> {
        const row = await db.plansStore.addPlan({
            householdId: HH,
            recipeId: db.recipeId,
            date: todayUtc(),
            slot: "dinner",
            servings: 2,
        });
        return row!.id;
    }

    test("move puts the plan on another day and slot and changes its servings", async () => {
        const id = await seed();
        const day = addPlanDays(todayUtc(), 3);
        const res = await postPlanPath(
            `/recipes/plan/${id}/move`,
            new URLSearchParams({
                date: day,
                slot: "lunch",
                servings: "4",
                back: "today",
            }),
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/");
        expect(toastOf(res)?.key).toBe("plan.moved");
        expect(await planned()).toMatchObject([
            { id, date: day, slot: "lunch", servings: 4 },
        ]);
    });

    test("move onto a day and slot that holds the same recipe merges into one plan", async () => {
        const id = await seed();
        const day = addPlanDays(todayUtc(), 2);
        const there = await db.plansStore.addPlan({
            householdId: HH,
            recipeId: db.recipeId,
            date: day,
            slot: "lunch",
            servings: 3,
        });
        const res = await postPlanPath(
            `/recipes/plan/${id}/move`,
            new URLSearchParams({
                date: day,
                slot: "lunch",
                servings: "2",
                back: "today",
            }),
        );
        expect(res.status).toBe(303);
        expect(toastOf(res)?.key).toBe("plan.merged");
        expect(JSON.stringify(toastOf(res))).toContain("lunch");
        // One plan remains: the one already there, with both servings.
        expect(await planned()).toMatchObject([
            { id: there!.id, date: day, slot: "lunch", servings: 5 },
        ]);
    });

    const EDIT_OPEN = (id: string) =>
        new RegExp(
            `<dialog[^>]*id="fd-plan-edit-${id}"[^>]*data-sheet-open-on-load`,
        );

    test("a form that does not check re-renders Recipes with that plan's sheet open and the typed values kept", async () => {
        const id = await seed();
        const before = await planned();
        const yesterday = addPlanDays(todayUtc(), -1);
        const cases: {
            body: Record<string, string>;
            error: string;
            kept: string[];
        }[] = [
            {
                body: { date: yesterday, slot: "lunch", servings: "3" },
                error: "Pick today or a later day.",
                kept: [`value="${yesterday}"`, 'value="3"'],
            },
            {
                body: { date: "nope", slot: "lunch", servings: "3" },
                error: "A plan date must be a day",
                kept: ['value="nope"'],
            },
            {
                body: { date: todayUtc(), slot: "brunch", servings: "3" },
                error: "A plan slot must be one of",
                kept: ['value="3"'],
            },
            {
                body: { date: todayUtc(), slot: "lunch", servings: "0" },
                error: "Plan servings must be more than zero.",
                kept: ['value="0"'],
            },
            {
                body: { date: todayUtc(), slot: "lunch", servings: "1000" },
                error: "Keep it to 999 servings or fewer.",
                kept: ['value="1000"'],
            },
        ];
        for (const { body, error, kept } of cases) {
            const res = await postPlanPath(
                `/recipes/plan/${id}/move`,
                new URLSearchParams({ ...body, back: "recipes" }),
            );
            expect(res.status).toBe(400);
            const html = await res.text();
            expect(html).toMatch(EDIT_OPEN(id));
            expect(html).toContain(error);
            // Recipes, not a redirect: the page and its list are there.
            expect(html).toContain("fd-plan-strip");
            const sheet = html.match(
                new RegExp(
                    `<dialog[^>]*id="fd-plan-edit-${id}"[\\s\\S]*?</dialog>`,
                ),
            )![0];
            for (const value of kept) expect(sheet).toContain(value);
            expect(sheet).toContain('class="fd-plan-error"');
        }
        expect(await planned()).toEqual(before);
    });

    test("the same failure from Today re-renders Today with the sheet open", async () => {
        const id = await seed();
        const res = await postPlanPath(
            `/recipes/plan/${id}/move`,
            new URLSearchParams({
                date: addPlanDays(todayUtc(), -3),
                slot: "lunch",
                servings: "2",
                back: "today",
            }),
        );
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toMatch(EDIT_OPEN(id));
        expect(html).toContain("Pick today or a later day.");
        expect(html).toContain("fd-today-page");
        expect(await planned()).toMatchObject([
            { id, date: todayUtc(), slot: "dinner" },
        ]);
    });

    test("a plan that is gone is still a redirect with the gone toast", async () => {
        const res = await postPlanPath(
            "/recipes/plan/99999999-9999-4999-8999-999999999999/move",
            new URLSearchParams({
                date: "nope",
                slot: "brunch",
                back: "today",
            }),
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/");
        expect(toastOf(res)?.key).toBe("plan.gone");
    });

    test("a plan outside the week cannot reopen a sheet, so the reason comes as a toast", async () => {
        const old = await db.plansStore.addPlan({
            householdId: HH,
            recipeId: db.recipeId,
            date: addPlanDays(todayUtc(), -4),
            slot: "dinner",
            servings: 2,
        });
        const res = await postPlanPath(
            `/recipes/plan/${old!.id}/move`,
            new URLSearchParams({ date: "nope", slot: "lunch" }),
        );
        expect(res.status).toBe(303);
        expect(toastOf(res)?.key).toBe("plan.notice");
    });

    test("a past day is not a move target; today and later are", async () => {
        for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
            db.ownerTimezone = tz;
            const hhToday = dateInTz(new Date(), tz);
            // The plan sits on the household's own today, so it is in the
            // week whatever the UTC date is when the test runs.
            const row = await db.plansStore.addPlan({
                householdId: HH,
                recipeId: db.recipeId,
                date: hhToday,
                slot: "dinner",
                servings: 2,
            });
            const id = row!.id;
            const past = await postPlanPath(
                `/recipes/plan/${id}/move`,
                new URLSearchParams({
                    date: addPlanDays(hhToday, -1),
                    slot: "lunch",
                }),
            );
            expect(past.status).toBe(400);
        }
    });

    test("move and remove treat a malformed plan id like a plan that is gone", async () => {
        await seed();
        // The uuid column rejects anything else with a cast error, so the
        // route has to turn it away before asking the store.
        const real = db.plansStore;
        const uuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const strict = (id: string) => {
            if (!uuid.test(id)) {
                throw new Error(`invalid input syntax for type uuid: "${id}"`);
            }
        };
        db.plansStore = {
            ...real,
            getPlan: async (h, id) => (strict(id), real.getPlan(h, id)),
            removePlan: async (h, id) => (strict(id), real.removePlan(h, id)),
            movePlan: async (h, id, d, sl) => (
                strict(id),
                real.movePlan(h, id, d, sl)
            ),
        };
        for (const bad of ["nope", "1", "not-a-uuid"]) {
            const moved = await postPlanPath(
                `/recipes/plan/${bad}/move`,
                new URLSearchParams({ date: todayUtc(), slot: "lunch" }),
            );
            expect(moved.status).toBe(303);
            expect(toastOf(moved)?.key).toBe("plan.gone");
            const removed = await postPlanPath(
                `/recipes/plan/${bad}/remove`,
                new URLSearchParams({}),
            );
            expect(removed.status).toBe(303);
            expect(toastOf(removed)?.key).toBe("plan.gone");
        }
        expect(await planned()).toHaveLength(1);
    });

    test("move and remove only reach the household's own plans", async () => {
        await seed();
        const other = "99999999-9999-4999-8999-999999999999";
        const moved = await postPlanPath(
            `/recipes/plan/${other}/move`,
            new URLSearchParams({ date: todayUtc(), slot: "lunch" }),
        );
        expect(toastOf(moved)?.key).toBe("plan.gone");
        const removed = await postPlanPath(
            `/recipes/plan/${other}/remove`,
            new URLSearchParams({}),
        );
        expect(toastOf(removed)?.key).toBe("plan.gone");
        expect(await planned()).toHaveLength(1);
    });

    test("remove takes the plan off and goes back to the page it came from", async () => {
        const id = await seed();
        const res = await postPlanPath(
            `/recipes/plan/${id}/remove`,
            new URLSearchParams({ back: "recipes" }),
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/recipes");
        expect(toastOf(res)?.key).toBe("plan.removed");
        expect(await planned()).toEqual([]);
    });

    test("an unknown back value is not followed", async () => {
        const id = await seed();
        const res = await postPlanPath(
            `/recipes/plan/${id}/remove`,
            new URLSearchParams({ back: "https://evil.example/" }),
        );
        expect(res.headers.get("location")).toBe("/recipes");
    });
});

describe("POST /recipes/plan/add-missing", () => {
    function addMissing(back = "recipes") {
        return postPlanPath(
            "/recipes/plan/add-missing",
            new URLSearchParams({ back }),
        );
    }

    async function planPancakes(servings: number) {
        await db.plansStore.addPlan({
            householdId: HH,
            recipeId: db.recipeId,
            date: addPlanDays(todayUtc(), 1),
            slot: "dinner",
            servings,
        });
    }

    async function lines() {
        const snap = await db.groceryStore.listLines(HH);
        return snap;
    }

    test("puts what the kitchen cannot cover on the list with source plan", async () => {
        await createGroceryStore(db.settingsStore, HH, "Market");
        // 20 servings of a 2-portion recipe: 1000 g of flour, and 500 g is held.
        await planPancakes(20);
        const res = await addMissing("today");
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/");
        expect(toastOf(res)).toMatchObject({
            key: "plan.missing.added",
            params: { count: 1 },
        });
        const added = await lines();
        expect(added).toHaveLength(1);
        expect(added[0]).toMatchObject({
            foodId: db.flourId,
            source: "plan",
            quantity: { amount: 500, unit: "g" },
        });
    });

    test("a second tap adds nothing more", async () => {
        await createGroceryStore(db.settingsStore, HH, "Market");
        await planPancakes(20);
        await addMissing();
        const again = await addMissing();
        expect(toastOf(again)?.key).toBe("plan.missing.on-list");
        expect(await lines()).toHaveLength(1);
    });

    test("with the kitchen covering the plan it says nothing is missing", async () => {
        await createGroceryStore(db.settingsStore, HH, "Market");
        await planPancakes(2);
        const res = await addMissing();
        expect(toastOf(res)?.key).toBe("plan.missing.none");
        expect(await lines()).toEqual([]);
    });

    test("an amount that cannot be counted is added in full and labelled", async () => {
        await createGroceryStore(db.settingsStore, HH, "Market");
        const eggs = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                calories: 143,
                proteinG: 12,
                carbsG: 1,
                fatG: 10,
                gramsPerMl: null,
                gramsPerEach: null,
            }),
        );
        const omelette = await createRecipe(db.recipesStore, {
            householdId: HH,
            creatorId: ALICE,
            name: "Omelette",
            yieldPortions: 1,
        });
        await addRecipeIngredientById(db.recipesStore, db.foodsStore, {
            householdId: HH,
            recipeId: omelette.id,
            foodId: eggs.id,
            amount: 3,
            unit: "each",
        });
        // The kitchen holds eggs by weight, and the egg has no weight per piece.
        const loc = (await db.fridgeStore.listLocations(HH))[0]!;
        await addFridgeItemAdjust(
            db.fridgeStore,
            db.stockStore,
            db.foodsStore,
            {
                householdId: HH,
                foodId: eggs.id,
                amount: 120,
                unit: "g",
                locationId: loc.id,
                actorUserId: ALICE,
            },
        );
        await db.plansStore.addPlan({
            householdId: HH,
            recipeId: omelette.id,
            date: todayUtc(),
            slot: "breakfast",
            servings: 1,
        });
        const res = await addMissing();
        expect(toastOf(res)).toMatchObject({
            key: "plan.missing.added.unknown",
            params: { count: 1, names: "Eggs" },
        });
        const added = await lines();
        expect(added[0]).toMatchObject({
            foodId: eggs.id,
            source: "plan",
            quantity: { amount: 3, unit: "each" },
            note: PLAN_UNKNOWN_LINE_NOTE,
        });
    });

    test("without a store it asks for one and adds nothing", async () => {
        await planPancakes(20);
        const res = await addMissing();
        expect(toastOf(res)).toMatchObject({
            key: "plan.notice",
            params: { message: "Add a store first." },
        });
        expect(await lines()).toEqual([]);
    });
});

describe("This week on the pages", () => {
    test("Recipes lists seven days from the household's today with the planned recipes", async () => {
        const today = todayUtc();
        await db.plansStore.addPlan({
            householdId: HH,
            recipeId: db.recipeId,
            date: addPlanDays(today, 2),
            slot: "dinner",
            servings: 2,
        });
        const page = await renderRecipesListPage(ALICE, {});
        expect(page.html).toContain("fd-plan-strip");
        expect(page.html.match(/<li class="fd-plan-tile/g)).toHaveLength(7);
        const strip = page.html.match(
            /<ul class="fd-plan-tiles">[\s\S]*?<\/ul>\s*<\/section>/,
        )![0];
        expect(strip).toContain("Pancakes");
        expect(page.html).toContain(`id="fd-plan-edit-`);
    });

    test("the week starts on the household's calendar day, not UTC's", async () => {
        db.ownerTimezone = "Pacific/Kiritimati";
        const ahead = dateInTz(new Date(), "Pacific/Kiritimati");
        await db.plansStore.addPlan({
            householdId: HH,
            recipeId: db.recipeId,
            date: ahead,
            slot: "dinner",
            servings: 2,
        });
        const page = await renderRecipesListPage(ALICE, {});
        expect(page.html).toContain("Pancakes");
        expect(page.html).toContain('fd-plan-tile"');
        // Kiritimati is a day ahead of UTC for most of every day.
        const firstTile = page.html.match(
            /<li class="fd-plan-tile[^>]*>[\s\S]*?<\/li>/,
        )![0];
        expect(firstTile).toContain("Pancakes");
    });

    test("plans before today are hidden but stay stored", async () => {
        await db.plansStore.addPlan({
            householdId: HH,
            recipeId: db.recipeId,
            date: addPlanDays(todayUtc(), -2),
            slot: "dinner",
            servings: 2,
        });
        const page = await renderRecipesListPage(ALICE, {});
        expect(page.html).not.toContain("fd-plan-edit-");
        expect(page.html).toContain("Nothing planned yet");
        expect(await planned()).toHaveLength(1);
    });

    test("an empty week shows the empty state and no missing link", async () => {
        const page = await renderRecipesListPage(ALICE, {});
        expect(page.html).toContain("Nothing planned yet");
        expect(page.html).not.toContain("fd-plan-missing-sheet");
    });

    test("a missing ingredient shows the link and the sheet that adds it", async () => {
        await db.plansStore.addPlan({
            householdId: HH,
            recipeId: db.recipeId,
            date: todayUtc(),
            slot: "dinner",
            servings: 20,
        });
        const page = await renderRecipesListPage(ALICE, {});
        expect(page.html).toContain("1 ingredient missing");
        expect(page.html).toContain('action="/recipes/plan/add-missing"');
        expect(page.html).toContain("Flour");
    });

    test("?plan_date sends each card's Plan to that day", async () => {
        const day = addPlanDays(todayUtc(), 3);
        const page = await renderRecipesListPage(ALICE, { planDate: day });
        expect(page.html).toContain("Pick a recipe for");
        expect(page.html).toContain(
            `href="/recipes/${db.recipeId}?plan=1&amp;date=${day}"`,
        );
        const junk = await renderRecipesListPage(ALICE, { planDate: "nope" });
        expect(junk.html).not.toContain("Pick a recipe for");
    });

    test("the recipe page offers Add to plan, open on ?plan=1 with the day", async () => {
        const closed = await renderRecipeDetailRoute(ALICE, db.recipeId);
        expect(closed.html).toContain('id="fd-recipe-plan-sheet"');
        expect(closed.html).not.toMatch(
            /fd-recipe-plan-sheet"[^>]*data-sheet-open-on-load/,
        );
        const day = addPlanDays(todayUtc(), 4);
        const open = await renderRecipeDetailRoute(ALICE, db.recipeId, {
            plan: { open: true, date: day },
        });
        expect(open.html).toMatch(
            /<dialog[^>]*id="fd-recipe-plan-sheet"[^>]*data-sheet-open-on-load/,
        );
        expect(open.html).toContain(`value="${day}"`);
    });
});
