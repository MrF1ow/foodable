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
import {
    createMemoryVariantsStore,
    setRecipeVariant,
} from "../../domain/recipe-variants.js";
import { recheckRecipe, saveRecipeDraft } from "../../domain/recipe-import.js";
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
    variantsStore: createMemoryVariantsStore(),
    dismissalsStore: createMemoryNoticeDismissalsStore(),
    groceryStore: createMemoryGroceryStore(),
    stockStore: createMemoryStockStore(),
    rulesStore: createMemoryRulesStore(),
    settingsStore: createMemorySettingsStore(),
    plansStore: createMemoryPlansStore(),
    /** The household owner's timezone, which is the household's calendar. */
    ownerTimezone: "UTC",
    /** Bob's role; Alice is the owner. */
    bobRole: "member" as "member" | "admin",
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
    liveRecipeVariantsStore: () => db.variantsStore,
    // No database here: the memory stores are the "transaction".
    recipeAlignTransaction: () => (fn: () => Promise<unknown>) => fn(),
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
                    role: db.bobRole,
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
            role: db.bobRole,
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
const { planDayLabel } = await import("../pages/v2/recipes-plan.js");
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
    db.variantsStore = createMemoryVariantsStore();
    db.dismissalsStore = createMemoryNoticeDismissalsStore();
    db.groceryStore = createMemoryGroceryStore();
    db.stockStore = createMemoryStockStore();
    db.rulesStore = createMemoryRulesStore();
    db.settingsStore = createMemorySettingsStore();
    db.plansStore = createMemoryPlansStore();
    db.ownerTimezone = "UTC";
    db.bobRole = "member";
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

    test("an import error reaches the page as a headline with its reason", async () => {
        const page = await renderRecipesListPage(ALICE, {
            importError: "This site asks apps not to read this page.",
            importErrorReason: "Paste the recipe instead.",
        });
        expect(page.html).toContain(
            '<p class="fd-recipes-import-error__headline">This site asks apps not to read this page.</p><p class="fd-recipes-import-error__reason">Paste the recipe instead.</p>',
        );
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

        // A clean cook says nothing: the recipe page and Today show it.
        expect(toastOf(res)).toBeNull();
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
        expect(toastOf(second)).toBeNull();
    });

    test("a double submit with the switch off cooks once", async () => {
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        const body = cookSheetBody(page.html);
        body.delete("log_serving");
        const first = await postConfirm(body);
        expect(first.status).toBe(303);
        expect(toastOf(first)).toBeNull();
        const second = await postConfirm(body);
        expect(second.status).toBe(303);
        expect(toastOf(second)).toBeNull();
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
        expect(toastOf(res)).toBeNull();
    });

    test("a shortfall is cooked anyway and the toast says so", async () => {
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        const body = cookSheetBody(page.html);
        body.set("servings", "20");
        body.delete("expected");
        const res = await postConfirm(body);
        expect(res.status).toBe(303);
        expect(toastOf(res)).toEqual({
            key: "recipes.cooked.short",
            params: { names: "Flour" },
        });
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
        expect(toast?.key).toBe("recipes.cooked.changed");
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
        // The one that lost the race is a repeat: no toast says so.
        expect([toastOf(a), toastOf(b)].filter((t) => t !== null)).toEqual([]);
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
        expect(await cookMovements()).toHaveLength(1);
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
        // Saved, as a person would after the import.
        await saveRecipeDraft(db.recipesStore, HH, recipe.id);
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
        expect(toastOf(res)).toBeNull();
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
        expect(toastOf(res)).toBeNull();
    });

    test("naming people plans exactly their saved portions and ignores the servings sent with them", async () => {
        await db.recipesStore.upsertPortion({
            householdId: HH,
            recipeId: db.recipeId,
            userId: ALICE.toLowerCase(),
            portionCount: 2,
        });
        const day = addPlanDays(todayUtc(), 2);
        const body = new URLSearchParams({
            date: day,
            slot: "lunch",
            servings: "9",
        });
        body.append("member_ids", ALICE);
        body.append("member_ids", BOB);
        const res = await postPlanPath(`/recipes/${db.recipeId}/plan`, body);
        expect(res.status).toBe(303);
        // Alice's 2 and Bob's 1 (none saved): 3, not the 9 sent.
        expect(await planned()).toMatchObject([
            { date: day, slot: "lunch", servings: 3, memberIds: [ALICE, BOB] },
        ]);
    });

    test("the recipe page the redirect lands on shows the planned day", async () => {
        const before = await renderRecipeDetailRoute(ALICE, db.recipeId);
        expect(before.html).not.toContain("fd-recipe-planned");
        const day = addPlanDays(todayUtc(), 2);
        const res = await add({ date: day, slot: "lunch", servings: "3" });
        expect(res.status).toBe(303);
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        expect(page.html).toContain("fd-recipe-planned");
        expect(page.html).toContain(`Planned · ${planDayLabel(day)} · lunch`);
    });

    test("a plan further out than the week, and one for another recipe, are told apart", async () => {
        const far = addPlanDays(todayUtc(), 20);
        await add({ date: far, slot: "dinner" });
        const other = await createRecipe(db.recipesStore, {
            householdId: HH,
            creatorId: ALICE,
            name: "Soup",
            yieldPortions: 2,
        });
        await db.plansStore.addPlan({
            householdId: HH,
            recipeId: other.id,
            date: todayUtc(),
            slot: "snack",
        });
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        expect(page.html).toContain(`Planned · ${planDayLabel(far)} · dinner`);
        expect(page.html).not.toContain(`${planDayLabel(todayUtc())} · snack`);
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
            expect(toastOf(ok)).toBeNull();
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
        expect(toastOf(again)).toBeNull();
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
        expect(toastOf(res)).toBeNull();
        expect(await planned()).toMatchObject([
            { id, date: day, slot: "lunch", servings: 4 },
        ]);
    });

    test("a plan for named people refuses servings in the sheet's form, and moves without them", async () => {
        const named = await db.plansStore.addPlan({
            householdId: HH,
            recipeId: db.recipeId,
            date: todayUtc(),
            slot: "dinner",
            servings: 2,
            memberIds: ["u1"],
        });
        const id = named!.id;
        const day = addPlanDays(todayUtc(), 2);
        const refused = await postPlanPath(
            `/recipes/plan/${id}/move`,
            new URLSearchParams({
                date: day,
                slot: "lunch",
                servings: "5",
                back: "recipes",
            }),
        );
        expect(refused.status).toBe(400);
        expect(await refused.text()).toContain(
            "This plan is for named people; change their portions instead.",
        );
        expect(await planned()).toMatchObject([
            { id, date: todayUtc(), slot: "dinner", servings: 2 },
        ]);
        const moved = await postPlanPath(
            `/recipes/plan/${id}/move`,
            new URLSearchParams({ date: day, slot: "lunch", back: "recipes" }),
        );
        expect(moved.status).toBe(303);
        expect(await planned()).toMatchObject([
            {
                id,
                date: day,
                slot: "lunch",
                servings: 2,
                memberIds: ["u1"],
            },
        ]);
    });

    test("move onto a day and slot that holds the same recipe is already planned: nothing moves and nothing is added", async () => {
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
        expect(res.headers.get("location")).toBe("/");
        expect(toastOf(res)).toMatchObject({
            key: "plan.already",
            params: { when: `${planDayLabel(day)} · lunch` },
        });
        // Both plans stay as they were.
        expect(await planned()).toMatchObject([
            { id, date: todayUtc(), slot: "dinner", servings: 2 },
            { id: there!.id, date: day, slot: "lunch", servings: 3 },
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
        expect(toastOf(res)).toBeNull();
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
            expect(toastOf(moved)).toBeNull();
            const removed = await postPlanPath(
                `/recipes/plan/${bad}/remove`,
                new URLSearchParams({}),
            );
            expect(removed.status).toBe(303);
            expect(toastOf(removed)).toBeNull();
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
        expect(toastOf(moved)).toBeNull();
        const removed = await postPlanPath(
            `/recipes/plan/${other}/remove`,
            new URLSearchParams({}),
        );
        expect(toastOf(removed)).toBeNull();
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
        expect(toastOf(res)).toBeNull();
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

describe("a repeating plan: add, remove and move", () => {
    async function seedRepeat(
        repeat: "daily" | "weekly" = "daily",
    ): Promise<{ ruleId: string; dayId: (n: number) => string }> {
        const rule = await db.plansStore.addRule({
            householdId: HH,
            recipeId: db.recipeId,
            slot: "dinner",
            servings: 2,
            startsOn: todayUtc(),
            repeat,
            createdBy: ALICE,
        });
        return {
            ruleId: rule!.id,
            dayId: (n) => `rule:${rule!.id}:${addPlanDays(todayUtc(), n)}`,
        };
    }

    // A repeat has no end: look at the next fortnight only.
    const fortnight = () =>
        db.plansStore.listPlans(HH, todayUtc(), addPlanDays(todayUtc(), 13));
    const dates = async () => (await fortnight()).map((p) => p.date);

    test("the add sheet's repeat and weekdays plan the recipe on a repeat", async () => {
        const res = await postPlanPath(
            `/recipes/${db.recipeId}/plan`,
            new URLSearchParams([
                ["date", todayUtc()],
                ["slot", "dinner"],
                ["servings", "2"],
                ["repeat", "days"],
                ["days", "1"],
                ["days", "3"],
            ]),
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe(`/recipes/${db.recipeId}`);
        expect(toastOf(res)).toBeNull();
        const [rule] = await db.plansStore.listRules(HH);
        expect(rule).toMatchObject({
            recipeId: db.recipeId,
            repeat: "days",
            days: [1, 3],
            startsOn: todayUtc(),
        });
        // No one-off was stored: the days come from the repeat.
        const week = await fortnight();
        expect(week.length).toBeGreaterThan(0);
        expect(week.every((p) => p.ruleId === rule!.id)).toBe(true);
        expect(
            week.every((p) =>
                [1, 3].includes(new Date(`${p.date}T00:00:00Z`).getUTCDay()),
            ),
        ).toBe(true);

        const bad = await postPlanPath(
            `/recipes/${db.recipeId}/plan`,
            new URLSearchParams({
                date: todayUtc(),
                slot: "lunch",
                repeat: "days",
            }),
        );
        expect(bad.status).toBe(400);
        expect(await db.plansStore.listRules(HH)).toHaveLength(1);
    });

    test("a blank weekday value is dropped, not read as Sunday", async () => {
        const mixed = await postPlanPath(
            `/recipes/${db.recipeId}/plan`,
            new URLSearchParams([
                ["date", todayUtc()],
                ["slot", "dinner"],
                ["repeat", "days"],
                ["days", ""],
                ["days", "  "],
                ["days", "3"],
            ]),
        );
        expect(mixed.status).toBe(303);
        const [rule] = await db.plansStore.listRules(HH);
        expect(rule?.days).toEqual([3]);

        const blank = await postPlanPath(
            `/recipes/${db.recipeId}/plan`,
            new URLSearchParams([
                ["date", todayUtc()],
                ["slot", "lunch"],
                ["repeat", "days"],
                ["days", ""],
            ]),
        );
        expect(blank.status).toBe(400);
        expect(await blank.text()).toContain("Pick at least one weekday");
        expect(await db.plansStore.listRules(HH)).toHaveLength(1);
    });

    test("remove asks for a day by default: that day is skipped and the others stay", async () => {
        const { dayId } = await seedRepeat();
        const res = await postPlanPath(
            `/recipes/plan/${dayId(2)}/remove`,
            new URLSearchParams({ back: "recipes" }),
        );
        expect(res.status).toBe(303);
        expect(toastOf(res)).toBeNull();
        const days = await dates();
        expect(days).not.toContain(addPlanDays(todayUtc(), 2));
        expect(days).toContain(addPlanDays(todayUtc(), 1));
        expect(days).toContain(addPlanDays(todayUtc(), 3));
        // Taking the same day off twice finds nothing.
        const again = await postPlanPath(
            `/recipes/plan/${dayId(2)}/remove`,
            new URLSearchParams({ scope: "day" }),
        );
        expect(again.status).toBe(303);
        expect(toastOf(again)).toBeNull();
        expect(await dates()).toEqual(days);
    });

    test("remove with scope series ends the repeat from that day and keeps the days before", async () => {
        const { ruleId, dayId } = await seedRepeat();
        const res = await postPlanPath(
            `/recipes/plan/${dayId(3)}/remove`,
            new URLSearchParams({ scope: "series", back: "today" }),
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/");
        expect(toastOf(res)).toBeNull();
        expect(await dates()).toEqual(
            [0, 1, 2].map((n) => addPlanDays(todayUtc(), n)),
        );
        expect((await db.plansStore.getRule(HH, ruleId))?.endsOn).toBe(
            addPlanDays(todayUtc(), 2),
        );
    });

    test("scope series on a plan that does not repeat is refused with a toast and removes nothing", async () => {
        const one = await db.plansStore.addPlan({
            householdId: HH,
            recipeId: db.recipeId,
            date: todayUtc(),
            slot: "dinner",
            servings: 2,
        });
        const res = await postPlanPath(
            `/recipes/plan/${one!.id}/remove`,
            new URLSearchParams({ scope: "series" }),
        );
        expect(res.status).toBe(303);
        expect(toastOf(res)?.key).toBe("plan.notice");
        expect(await fortnight()).toHaveLength(1);
    });

    test("move takes one day out of the series and puts a plan of its own on the new day", async () => {
        const { dayId } = await seedRepeat("weekly");
        const target = addPlanDays(todayUtc(), 2);
        const res = await postPlanPath(
            `/recipes/plan/${dayId(0)}/move`,
            new URLSearchParams({
                date: target,
                slot: "lunch",
                servings: "5",
                back: "recipes",
            }),
        );
        expect(res.status).toBe(303);
        expect(toastOf(res)).toBeNull();
        const week = await fortnight();
        expect(
            week.map((p) => [
                p.date,
                p.slot,
                p.servings,
                p.ruleId === undefined,
            ]),
        ).toEqual([
            [target, "lunch", 5, true],
            [addPlanDays(todayUtc(), 7), "dinner", 2, false],
        ]);
    });

    test("planning a repeat again with other servings says it is already planned, naming the day it starts on rather than the day asked for", async () => {
        // The next Saturday: weekdays from it start on the Monday after.
        let saturday = todayUtc();
        while (new Date(`${saturday}T00:00:00Z`).getUTCDay() !== 6) {
            saturday = addPlanDays(saturday, 1);
        }
        const monday = addPlanDays(saturday, 2);
        const form = (servings: string) =>
            new URLSearchParams({
                date: saturday,
                slot: "dinner",
                repeat: "weekdays",
                servings,
            });
        const added = await postPlanPath(
            `/recipes/${db.recipeId}/plan`,
            form("2"),
        );
        expect(added.status).toBe(303);
        expect(toastOf(added)).toBeNull();
        expect((await db.plansStore.listRules(HH))[0]?.startsOn).toBe(saturday);
        // The same again is the repeat the page shows.
        const double = await postPlanPath(
            `/recipes/${db.recipeId}/plan`,
            form("2"),
        );
        expect(toastOf(double)).toBeNull();
        const again = await postPlanPath(
            `/recipes/${db.recipeId}/plan`,
            form("5"),
        );
        expect(toastOf(again)).toMatchObject({
            key: "plan.already",
            params: { when: `${planDayLabel(monday)} · dinner` },
        });
        const [rule] = await db.plansStore.listRules(HH);
        expect(await db.plansStore.listRules(HH)).toHaveLength(1);
        expect(rule?.servings).toBe(2);
    });

    test("planning the recipe again on a day and meal it already holds changes nothing, whatever the servings", async () => {
        const plan = (date: string, slot: string, servings: string) =>
            postPlanPath(
                `/recipes/${db.recipeId}/plan`,
                new URLSearchParams({ date, slot, servings }),
            );
        const day = addPlanDays(todayUtc(), 1);
        expect((await plan(day, "dinner", "2")).status).toBe(303);
        const again = await plan(day, "dinner", "7");
        expect(toastOf(again)).toMatchObject({
            key: "plan.already",
            params: { when: `${planDayLabel(day)} · dinner` },
        });
        expect(await planned()).toMatchObject([
            { date: day, slot: "dinner", servings: 2 },
        ]);
        // Another meal on the same day is planned as usual.
        expect(toastOf(await plan(day, "lunch", "7"))).toBeNull();
        expect(await planned()).toMatchObject([
            { date: day, slot: "lunch", servings: 7 },
            { date: day, slot: "dinner", servings: 2 },
        ]);
    });

    test("planning once on a day a repeat holds is already planned: the repeat keeps the day and its servings", async () => {
        const { ruleId } = await seedRepeat("daily");
        const day = addPlanDays(todayUtc(), 3);
        const res = await postPlanPath(
            `/recipes/${db.recipeId}/plan`,
            new URLSearchParams({ date: day, slot: "dinner", servings: "9" }),
        );
        expect(toastOf(res)).toMatchObject({
            key: "plan.already",
            params: { when: `${planDayLabel(day)} · dinner` },
        });
        expect((await db.plansStore.getRule(HH, ruleId))?.skippedOn).toEqual(
            [],
        );
        const week = await fortnight();
        expect(week).toHaveLength(14);
        expect(week.every((p) => p.ruleId === ruleId && p.servings === 2)).toBe(
            true,
        );
    });

    test("a one-off moved onto a day a repeat holds is already planned: nothing moves", async () => {
        const { ruleId } = await seedRepeat("daily");
        const one = await db.plansStore.addPlan({
            householdId: HH,
            recipeId: db.recipeId,
            date: todayUtc(),
            slot: "lunch",
            servings: 4,
        });
        const day = addPlanDays(todayUtc(), 2);
        const res = await postPlanPath(
            `/recipes/plan/${one!.id}/move`,
            new URLSearchParams({ date: day, slot: "dinner", back: "recipes" }),
        );
        expect(toastOf(res)).toMatchObject({
            key: "plan.already",
            params: { when: `${planDayLabel(day)} · dinner` },
        });
        expect(await db.plansStore.getPlan(HH, one!.id)).toMatchObject({
            date: todayUtc(),
            slot: "lunch",
            servings: 4,
        });
        expect((await db.plansStore.getRule(HH, ruleId))?.skippedOn).toEqual(
            [],
        );
    });

    test("a day of a repeat moved onto a day another of its days holds is already planned: the repeat is left as it is", async () => {
        const { ruleId, dayId } = await seedRepeat("daily");
        const day = addPlanDays(todayUtc(), 4);
        const res = await postPlanPath(
            `/recipes/plan/${dayId(1)}/move`,
            new URLSearchParams({
                date: day,
                slot: "dinner",
                servings: "5",
                back: "recipes",
            }),
        );
        expect(toastOf(res)).toMatchObject({
            key: "plan.already",
            params: { when: `${planDayLabel(day)} · dinner` },
        });
        expect((await db.plansStore.getRule(HH, ruleId))?.skippedOn).toEqual(
            [],
        );
        const week = await fortnight();
        expect(week).toHaveLength(14);
        expect(week.every((p) => p.ruleId === ruleId && p.servings === 2)).toBe(
            true,
        );
    });

    test("a repeat over days that already hold the recipe's one-offs skips them and leaves them as they are", async () => {
        const one = await db.plansStore.addPlan({
            householdId: HH,
            recipeId: db.recipeId,
            date: addPlanDays(todayUtc(), 2),
            slot: "dinner",
            servings: 4,
        });
        const res = await postPlanPath(
            `/recipes/${db.recipeId}/plan`,
            new URLSearchParams({
                date: todayUtc(),
                slot: "dinner",
                servings: "2",
                repeat: "daily",
            }),
        );
        expect(res.status).toBe(303);
        const week = await fortnight();
        expect(week).toHaveLength(14);
        const held = week.filter((p) => p.date === addPlanDays(todayUtc(), 2));
        expect(held).toHaveLength(1);
        expect(held[0]).toMatchObject({ id: one!.id, servings: 4 });
        expect(held[0]?.ruleId).toBeUndefined();
    });

    test("a repeat over days another repeat of the recipe and meal shows is refused in the sheet, naming the clash, and nothing is saved", async () => {
        await seedRepeat("daily");
        const res = await postPlanPath(
            `/recipes/${db.recipeId}/plan`,
            new URLSearchParams({
                date: todayUtc(),
                slot: "dinner",
                repeat: "weekly",
            }),
        );
        expect(res.status).toBe(400);
        const weekday = new Date(`${todayUtc()}T00:00:00Z`).toLocaleDateString(
            "en-US",
            { weekday: "short", timeZone: "UTC" },
        );
        expect(await res.text()).toContain(
            `Pancakes is already planned at dinner on ${weekday} by the repeat every day. End that series first, or pick other days.`,
        );
        expect(await db.plansStore.listRules(HH)).toHaveLength(1);
    });

    test("saving the edit sheet with nothing changed leaves the day on its series", async () => {
        const { ruleId, dayId } = await seedRepeat("daily");
        const day = addPlanDays(todayUtc(), 2);
        const res = await postPlanPath(
            `/recipes/plan/${dayId(2)}/move`,
            new URLSearchParams({
                date: day,
                slot: "dinner",
                servings: "2",
                back: "recipes",
            }),
        );
        expect(res.status).toBe(303);
        expect((await db.plansStore.getRule(HH, ruleId))?.skippedOn).toEqual(
            [],
        );
        const week = await fortnight();
        expect(week.every((p) => p.ruleId === ruleId)).toBe(true);
        expect(week).toHaveLength(14);
    });

    test("a day that is not on the series is gone, for both routes", async () => {
        const { ruleId } = await seedRepeat("weekly");
        const off = `rule:${ruleId}:${addPlanDays(todayUtc(), 1)}`;
        const moved = await postPlanPath(
            `/recipes/plan/${off}/move`,
            new URLSearchParams({ date: todayUtc(), slot: "lunch" }),
        );
        expect(moved.status).toBe(303);
        expect(toastOf(moved)).toBeNull();
        const removed = await postPlanPath(
            `/recipes/plan/${off}/remove`,
            new URLSearchParams({}),
        );
        expect(removed.status).toBe(303);
        expect(toastOf(removed)).toBeNull();
        // Nothing of the series changed.
        expect(await fortnight()).toHaveLength(2);
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
        expect(toastOf(res)).toBeNull();
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
        expect(toastOf(again)?.key).toBe("fridge.item.already-on-grocery");
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

    test("a repeating plan shows on each of its days, with the ids the remove and move routes take", async () => {
        const today = todayUtc();
        const rule = await db.plansStore.addRule({
            householdId: HH,
            recipeId: db.recipeId,
            slot: "dinner",
            servings: 2,
            startsOn: today,
            repeat: "weekdays",
            createdBy: ALICE,
        });
        const page = await renderRecipesListPage(ALICE, {});
        const strip = page.html.match(
            /<ul class="fd-plan-tiles">[\s\S]*?<\/ul>\s*<\/section>/,
        )![0];
        const weekdays = [0, 1, 2, 3, 4, 5, 6].filter((n) => {
            const day = new Date(
                `${addPlanDays(today, n)}T00:00:00Z`,
            ).getUTCDay();
            return day >= 1 && day <= 5;
        });
        for (const n of weekdays) {
            const id = `rule:${rule!.id}:${addPlanDays(today, n)}`;
            expect(strip).toContain(`commandfor="fd-plan-edit-${id}"`);
            expect(page.html).toContain(`/recipes/plan/${id}/remove`);
            expect(page.html).toContain(`/recipes/plan/${id}/move`);
        }
        expect(strip.match(/class="fd-plan-item"/g)).toHaveLength(
            weekdays.length,
        );
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

describe("GET /recipes with ?filter and ?q", () => {
    async function getList(query: string, as = ALICE): Promise<string> {
        const res = await recipesApp().request(`http://x/recipes${query}`, {
            headers: { cookie: cookieFor(as) },
        });
        expect(res.status).toBe(200);
        return res.text();
    }

    /** Pancakes (quick, starred), Omelette (quick), Stew (slow, starred). */
    async function seed() {
        const omelette = await createRecipe(db.recipesStore, {
            householdId: HH,
            creatorId: ALICE,
            name: "Omelette",
            yieldPortions: 1,
            prepMinutes: 5,
            cookMinutes: 5,
        });
        const stew = await createRecipe(db.recipesStore, {
            householdId: HH,
            creatorId: ALICE,
            name: "Stew",
            yieldPortions: 4,
            prepMinutes: 30,
            cookMinutes: 120,
        });
        await db.recipesStore.setFavourite(HH, ALICE, db.recipeId, true);
        await db.recipesStore.setFavourite(HH, ALICE, stew.id, true);
        return { omelette: omelette.id, stew: stew.id };
    }

    test("one filter narrows the list", async () => {
        await seed();
        const html = await getList("?filter=quick");
        expect(html).toContain("Pancakes");
        expect(html).toContain("Omelette");
        expect(html).not.toContain("Stew");
    });

    test("?filter=a,b keeps only recipes that pass both", async () => {
        await seed();
        const html = await getList("?filter=quick,favourites");
        expect(html).toContain("Pancakes");
        expect(html).not.toContain("Omelette");
        expect(html).not.toContain("Stew");
        // The Filter button counts both, and both chips read as on.
        expect(html).toContain('data-fd-recipes-filter-count="2"');
        expect(html).not.toContain("fd-recipes-filter-button");
        expect(
            html.match(/<a class="fd-chip fd-chip--selected"/g)?.length,
        ).toBe(2);
        // The search form carries the filters on, so a search keeps them.
        expect(html).toContain('name="filter" value="quick,favourites"');
    });

    test("?q= and ?filter= combine", async () => {
        await seed();
        const html = await getList("?q=pan&filter=quick");
        expect(html).toContain("Pancakes");
        expect(html).not.toContain("Omelette");
        const none = await getList("?q=stew&filter=quick");
        expect(none).not.toContain("fd-row--recipe");
        expect(none).toContain("No recipes match this search.");
    });

    test("?q= alone filters by name", async () => {
        await seed();
        const html = await getList("?q=omel");
        expect(html).toContain("Omelette");
        expect(html).not.toContain("Pancakes");
        expect(html).toContain('data-fd-recipes-filter-count="0"');
    });

    test("unknown, repeated and empty filters are ignored", async () => {
        await seed();
        const all = await getList("?filter=");
        expect(all).toContain("Pancakes");
        expect(all).toContain("Stew");
        expect(all).toContain('data-fd-recipes-filter-count="0"');
        const messy = await getList("?filter=nonsense,quick,quick");
        expect(messy).toContain("Omelette");
        expect(messy).not.toContain("Stew");
        expect(messy).toContain('data-fd-recipes-filter-count="1"');
    });

    test("starring from a filtered list keeps every filter", async () => {
        const res = await postFavourite(
            new URLSearchParams({
                on: "1",
                back: "list",
                q: "pan",
                filter: "quick,favourites,nonsense",
            }),
        );
        expect(res.headers.get("location")).toBe(
            `/recipes?q=pan&filter=quick,favourites#recipe-${db.recipeId}`,
        );
    });
});

describe("recipe versions: compare and align (admin)", () => {
    const OTHER_HOUSEHOLD_RECIPE = "33333333-3333-4333-8333-333333333333";

    async function twoVersions() {
        const [flour] = await db.recipesStore.listIngredients(HH, db.recipeId);
        for (const [userId, amount] of [
            [ALICE, 60],
            [BOB, 80],
        ] as const) {
            await setRecipeVariant(
                db.recipesStore,
                db.foodsStore,
                db.variantsStore,
                {
                    householdId: HH,
                    recipeId: db.recipeId,
                    userId,
                    action: "amount",
                    ingredientId: flour!.id,
                    amount,
                    unit: "g",
                },
            );
        }
        return flour!;
    }

    const form = (fields: Record<string, string | string[]>) => ({
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded",
        } as Record<string, string>,
        body: new URLSearchParams(
            Object.entries(fields).flatMap(([key, value]) =>
                [value].flat().map((one): [string, string] => [key, one]),
            ),
        ).toString(),
    });
    function post(
        as: string,
        path: string,
        fields: Record<string, string | string[]>,
        id = db.recipeId,
    ) {
        const init = form(fields);
        init.headers.cookie = cookieFor(as);
        return recipesApp().request(`http://x/recipes/${id}/${path}`, init);
    }
    /** The rows the reset preview shows for a person, as the confirm posts them back. */
    const shownRows = async (who: string) =>
        (
            (await (
                await post(ALICE, "versions/reset", { user_id: who })
            ).json()) as { rowKeys: string[] }
        ).rowKeys;
    /** The key the compare read gives for one person's change. */
    const alignKey = async (who: string, ref: string) => {
        const res = await recipesApp().request(
            `http://x/recipes/${db.recipeId}/versions`,
            { headers: { cookie: cookieFor(ALICE) } },
        );
        const json = (await res.json()) as {
            versions: {
                userId: string;
                differences: { ref: string; rowKey: string }[];
            }[];
        };
        return (
            json.versions
                .find((v) => v.userId === who)
                ?.differences.find((d) => d.ref === ref)?.rowKey ?? ""
        );
    };
    const flourQty = async () =>
        (await db.recipesStore.listIngredients(HH, db.recipeId))[0]!.quantity;
    const rowCount = async () =>
        (await db.variantsStore.listOverrides(HH, db.recipeId)).length;

    test("the owner pushes one person's change into the base; the other differing version stays", async () => {
        const flour = await twoVersions();
        const res = await post(ALICE, "versions/align", {
            user_id: ALICE,
            ingredient_id: flour.id,
            row_key: await alignKey(ALICE, flour.id),
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe(`/recipes/${db.recipeId}`);
        // No success toast: the page shows the change.
        expect(toastOf(res)).toBeNull();
        expect(await flourQty()).toEqual({ amount: 60, unit: "g" });
        const left = await db.variantsStore.listOverrides(HH, db.recipeId);
        expect(left.map((row) => [row.userId, row.amount])).toEqual([
            [BOB, 80],
        ]);
    });

    test("an admin can align too", async () => {
        db.bobRole = "admin";
        const flour = await twoVersions();
        const res = await post(BOB, "versions/align", {
            user_id: ALICE,
            ingredient_id: flour.id,
            row_key: await alignKey(ALICE, flour.id),
        });
        expect(res.status).toBe(303);
        expect(await flourQty()).toEqual({ amount: 60, unit: "g" });
    });

    test("a member is refused align, reset and the compare read, and nothing changes", async () => {
        const flour = await twoVersions();
        const align = await post(BOB, "versions/align", {
            user_id: ALICE,
            ingredient_id: flour.id,
            row_key: await alignKey(ALICE, flour.id),
        });
        expect(align.status).toBe(403);
        const reset = await post(BOB, "versions/reset", {
            user_id: ALICE,
            confirm: "1",
        });
        expect(reset.status).toBe(403);
        const read = await recipesApp().request(
            `http://x/recipes/${db.recipeId}/versions`,
            { headers: { cookie: cookieFor(BOB) } },
        );
        expect(read.status).toBe(403);
        expect(await flourQty()).toEqual({ amount: 100, unit: "g" });
        expect(await rowCount()).toBe(2);
    });

    test("compare answers the base lines, each version's differences and who uses the base", async () => {
        const flour = await twoVersions();
        await db.variantsStore.clearVariant(HH, db.recipeId, BOB);
        const res = await recipesApp().request(
            `http://x/recipes/${db.recipeId}/versions`,
            { headers: { cookie: cookieFor(ALICE) } },
        );
        expect(res.status).toBe(200);
        const json = (await res.json()) as any;
        expect(json.recipeId).toBe(db.recipeId);
        expect(json.base[0]).toMatchObject({
            ingredientId: flour.id,
            displayName: "Flour",
        });
        expect(json.versions).toHaveLength(1);
        expect(json.versions[0]).toMatchObject({
            userId: ALICE,
            displayName: "Alice",
        });
        expect(json.versions[0].differences[0]).toMatchObject({
            kind: "amount",
            ref: flour.id,
            version: { amount: 60, unit: "g" },
        });
        expect(json.usingBase).toEqual([{ userId: BOB, displayName: "Bob" }]);
    });

    test("align refuses a change the person saved again since the compare read, and the base stays", async () => {
        const flour = await twoVersions();
        const row_key = await alignKey(ALICE, flour.id);
        // Alice changes her mind before the admin posts.
        await setRecipeVariant(
            db.recipesStore,
            db.foodsStore,
            db.variantsStore,
            {
                householdId: HH,
                recipeId: db.recipeId,
                userId: ALICE,
                action: "amount",
                ingredientId: flour.id,
                amount: 500,
                unit: "g",
            },
        );
        const res = await post(ALICE, "versions/align", {
            user_id: ALICE,
            ingredient_id: flour.id,
            row_key,
        });
        expect(res.status).toBe(400);
        expect(await res.text()).toContain("Their change changed; look again.");
        expect(await flourQty()).toEqual({ amount: 100, unit: "g" });
        expect(await rowCount()).toBe(2);
        // The key of what is stored now is accepted.
        const again = await post(ALICE, "versions/align", {
            user_id: ALICE,
            ingredient_id: flour.id,
            row_key: await alignKey(ALICE, flour.id),
        });
        expect(again.status).toBe(303);
        expect(await flourQty()).toEqual({ amount: 500, unit: "g" });
    });

    test("align of a change that is gone is a 400 and changes nothing", async () => {
        const flour = await twoVersions();
        const row_key = await alignKey(ALICE, flour.id);
        await db.variantsStore.clearVariant(HH, db.recipeId, ALICE);
        const res = await post(ALICE, "versions/align", {
            user_id: ALICE,
            ingredient_id: flour.id,
            row_key,
        });
        expect(res.status).toBe(400);
        expect(await res.text()).toContain("That change no longer exists.");
        expect(await flourQty()).toEqual({ amount: 100, unit: "g" });
        expect(await rowCount()).toBe(1);
    });

    test("reset without confirm changes nothing and says what would go", async () => {
        await twoVersions();
        const res = await post(ALICE, "versions/reset", { user_id: BOB });
        expect(res.status).toBe(200);
        const json = (await res.json()) as any;
        expect(json).toMatchObject({
            confirmRequired: true,
            userId: BOB,
            overrideCount: 1,
        });
        expect(json.rowKeys).toHaveLength(1);
        expect(json.differences[0]).toMatchObject({
            kind: "amount",
            version: { amount: 80, unit: "g" },
        });
        expect(await rowCount()).toBe(2);
        // Anything but 1 is not a confirmation.
        const no = await post(ALICE, "versions/reset", {
            user_id: BOB,
            confirm: "0",
        });
        expect(no.status).toBe(200);
        expect(await rowCount()).toBe(2);
    });

    test("reset with confirm clears that person's version and no one else's", async () => {
        await twoVersions();
        const res = await post(ALICE, "versions/reset", {
            user_id: BOB,
            confirm: "1",
            row_keys: await shownRows(BOB),
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe(`/recipes/${db.recipeId}`);
        expect(toastOf(res)).toBeNull();
        const left = await db.variantsStore.listOverrides(HH, db.recipeId);
        expect(left.map((row) => row.userId)).toEqual([ALICE]);
    });

    test("reset of a person with no version is a 400 and changes nothing", async () => {
        await twoVersions();
        const keys = await shownRows(BOB);
        await db.variantsStore.clearVariant(HH, db.recipeId, BOB);
        const res = await post(ALICE, "versions/reset", {
            user_id: BOB,
            confirm: "1",
            row_keys: keys,
        });
        expect(res.status).toBe(400);
        expect(await rowCount()).toBe(1);
    });

    test("a confirm takes the rows the preview showed and refuses when the person's version changed since", async () => {
        const flour = await twoVersions();
        const keys = await shownRows(BOB);
        // Bob saves another change after the admin opened the confirm.
        await setRecipeVariant(
            db.recipesStore,
            db.foodsStore,
            db.variantsStore,
            {
                householdId: HH,
                recipeId: db.recipeId,
                userId: BOB,
                action: "add",
                foodId: flour.foodId!,
                amount: 5,
                unit: "g",
            },
        );
        const stale = await post(ALICE, "versions/reset", {
            user_id: BOB,
            confirm: "1",
            row_keys: keys,
        });
        expect(stale.status).toBe(400);
        expect(await stale.text()).toContain("Their version changed");
        expect(await rowCount()).toBe(3);
        // No keys at all takes nothing either.
        const none = await post(ALICE, "versions/reset", {
            user_id: BOB,
            confirm: "1",
        });
        expect(none.status).toBe(400);
        expect(await rowCount()).toBe(3);
        // Looking again and confirming that takes both of Bob's rows, and no one else's.
        const fresh = await post(ALICE, "versions/reset", {
            user_id: BOB,
            confirm: "1",
            row_keys: await shownRows(BOB),
        });
        expect(fresh.status).toBe(303);
        const left = await db.variantsStore.listOverrides(HH, db.recipeId);
        expect(left.map((row) => row.userId)).toEqual([ALICE]);
    });

    const baseNow = async () =>
        (await db.recipesStore.listIngredients(HH, db.recipeId)).map((row) => ({
            ...row,
        }));

    test("a refused align or reset leaves the base ingredients as they were", async () => {
        const flour = await twoVersions();
        const before = await baseNow();
        const aliceKey = await alignKey(ALICE, flour.id);
        // A member, a change that is gone, a person with no version and
        // another person's id: each is refused, and the base is untouched.
        const refused = [
            await post(BOB, "versions/align", {
                user_id: ALICE,
                ingredient_id: flour.id,
                row_key: aliceKey,
            }),
            await post(ALICE, "versions/align", {
                user_id: ALICE,
                ingredient_id: "44444444-4444-4444-8444-444444444444",
                row_key: aliceKey,
            }),
            await post(ALICE, "versions/align", {
                user_id: "not-an-id",
                ingredient_id: flour.id,
                row_key: aliceKey,
            }),
            await post(BOB, "versions/reset", {
                user_id: ALICE,
                confirm: "1",
            }),
        ];
        const aliceKeys = await shownRows(ALICE);
        await db.variantsStore.clearVariant(HH, db.recipeId, ALICE);
        refused.push(
            await post(ALICE, "versions/align", {
                user_id: ALICE,
                ingredient_id: flour.id,
                row_key: aliceKey,
            }),
            await post(ALICE, "versions/reset", {
                user_id: ALICE,
                confirm: "1",
                row_keys: aliceKeys,
            }),
        );
        expect(refused.map((res) => res.status)).toEqual([
            403, 400, 400, 403, 400, 400,
        ]);
        expect(await baseNow()).toEqual(before);
        // Only Bob's own row is left; none of this touched it.
        expect(await rowCount()).toBe(1);
    });

    test("the compare read and the reset preview answer errors as JSON", async () => {
        await twoVersions();
        const asJson = async (res: Response, status: number) => {
            expect(res.status).toBe(status);
            expect(res.headers.get("content-type")).toContain(
                "application/json",
            );
            const json = (await res.json()) as { error?: string };
            expect(typeof json.error).toBe("string");
            return json.error!;
        };
        const read = (as: string, id = db.recipeId) =>
            recipesApp().request(`http://x/recipes/${id}/versions`, {
                headers: { cookie: cookieFor(as) },
            });
        await asJson(await read(BOB), 403);
        await asJson(await read(ALICE, OTHER_HOUSEHOLD_RECIPE), 404);
        await asJson(await read(ALICE, "not-an-id"), 404);
        await asJson(
            await post(BOB, "versions/reset", { user_id: ALICE }),
            403,
        );
        await asJson(
            await post(ALICE, "versions/reset", { user_id: "not-an-id" }),
            400,
        );
        await db.variantsStore.clearVariant(HH, db.recipeId, BOB);
        expect(
            await asJson(
                await post(ALICE, "versions/reset", { user_id: BOB }),
                400,
            ),
        ).toContain("no version");
        // The confirmed form post is a form: its errors stay the recipe page.
        const confirmed = await post(ALICE, "versions/reset", {
            user_id: BOB,
            confirm: "1",
        });
        expect(confirmed.status).toBe(400);
        expect(confirmed.headers.get("content-type")).toContain("text/html");
    });

    test("another household's recipe or person is refused", async () => {
        const flour = await twoVersions();
        await db.recipesStore.insertRecipe({
            ...(await db.recipesStore.getRecipe(HH, db.recipeId))!,
            id: OTHER_HOUSEHOLD_RECIPE,
            householdId: "hh-2",
        });
        for (const [path, fields] of [
            [
                "versions/align",
                {
                    user_id: ALICE,
                    ingredient_id: flour.id,
                    row_key: await alignKey(ALICE, flour.id),
                },
            ],
            ["versions/reset", { user_id: ALICE, confirm: "1" }],
        ] as const) {
            const res = await post(ALICE, path, fields, OTHER_HOUSEHOLD_RECIPE);
            expect(res.status).toBe(400);
        }
        const stranger = "44444444-4444-4444-8444-444444444444";
        const res = await post(ALICE, "versions/reset", {
            user_id: stranger,
            confirm: "1",
        });
        expect(res.status).toBe(400);
        const notId = await post(ALICE, "versions/reset", {
            user_id: "not-an-id",
            confirm: "1",
        });
        expect(notId.status).toBe(400);
        const read = await recipesApp().request(
            `http://x/recipes/${OTHER_HOUSEHOLD_RECIPE}/versions`,
            { headers: { cookie: cookieFor(ALICE) } },
        );
        expect(read.status).toBe(404);
        expect(await flourQty()).toEqual({ amount: 100, unit: "g" });
        expect(await rowCount()).toBe(2);
    });
});

describe("drafts in the app", () => {
    /** A draft Alice imported: no steps yet, so the check still fails. */
    async function draftOf(
        opts: {
            creatorId?: string;
            name?: string;
            steps?: string | null;
            expiresAt?: string;
        } = {},
    ): Promise<string> {
        const recipe = await createRecipe(db.recipesStore, {
            householdId: HH,
            creatorId: opts.creatorId ?? ALICE,
            name: opts.name ?? "Imported stew",
            yieldPortions: 2,
            instructions: opts.steps ?? null,
            verification: "unverified",
            draftExpiresAt: opts.expiresAt ?? "2026-12-01T12:00:00.000Z",
        });
        await addRecipeIngredientById(db.recipesStore, db.foodsStore, {
            householdId: HH,
            recipeId: recipe.id,
            foodId: db.flourId,
            amount: 100,
            unit: "g",
        });
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
            importedAt: "2026-11-24T12:00:00.000Z",
        });
        return recipe.id;
    }

    function postSave(recipeId: string, as = ALICE) {
        return recipesApp().request(`http://x/recipes/${recipeId}/save`, {
            method: "POST",
            headers: {
                cookie: cookieFor(as),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "",
        });
    }

    test("a draft's page shows what is left and Save, and no Cook, Plan or Share", async () => {
        setFlagsForTests(createMemoryFlags({ "mcp-share-links": true }));
        const id = await draftOf();
        const html = (await renderRecipeDetailRoute(ALICE, id)).html;
        expect(html).toContain('id="fd-recipe-draft"');
        expect(html).toContain(`action="/recipes/${id}/save"`);
        expect(html).toContain("Add the steps.");
        expect(html).toContain("deleted on 2026-12-01");
        expect(html).not.toContain('id="fd-recipe-cook-sheet"');
        expect(html).not.toContain("fd-recipe-cook-btn");
        expect(html).not.toContain("fd-recipe-plan-btn");
        // A saved recipe's page has no Save.
        const saved = (await renderRecipeDetailRoute(ALICE, db.recipeId)).html;
        expect(saved).not.toContain("/save");
        expect(saved).toContain("fd-recipe-cook-btn");
    });

    test("Save refuses a failing check in place with what is left, and saves once it passes", async () => {
        const id = await draftOf();
        const refused = await postSave(id);
        expect(refused.status).toBe(422);
        expect(await refused.text()).toContain(
            "Not saved yet. Fix these first: Add the steps.",
        );
        expect((await db.recipesStore.getRecipe(HH, id))?.verification).toBe(
            "unverified",
        );
        const ready = await draftOf({
            name: "Ready stew",
            steps: "1. Simmer",
        });
        const ok = await postSave(ready);
        expect(ok.status).toBe(303);
        expect(ok.headers.get("location")).toBe(`/recipes/${ready}`);
        const row = await db.recipesStore.getRecipe(HH, ready);
        expect(row?.verification).toBe("verified");
        expect(row?.draftExpiresAt).toBeNull();
        // Saving a saved recipe changes nothing.
        expect((await postSave(ready)).status).toBe(303);
        expect((await postSave("nope")).status).toBe(404);
    });

    test("the list shows a member their own drafts with their expiry, apart from the recipes", async () => {
        const mine = await draftOf({ name: "Bob draft", creatorId: BOB });
        await draftOf({ name: "Alice draft" });
        const html = (await renderRecipesListPage(BOB, {})).html;
        expect(html).toContain('id="fd-recipes-drafts"');
        expect(html).toContain(`href="/recipes/${mine}"`);
        expect(html).toContain("deleted 2026-12-01 unless saved");
        expect(html).not.toContain("Alice draft");
        // Drafts are not cards in All recipes, nor counted as saved.
        const all = html.slice(html.indexOf("fd-recipes-all-heading"));
        expect(all).not.toContain("Bob draft");
        expect(html).toContain("1 saved");
        // A search never finds a draft either.
        const searched = (await renderRecipesListPage(BOB, { q: "draft" }))
            .html;
        expect(searched).not.toContain('class="fd-recipe-card');
    });

    test("the owner's list shows every household draft, so one another member imported can be reached", async () => {
        const theirs = await draftOf({ name: "Bob draft", creatorId: BOB });
        const mine = await draftOf({ name: "Alice draft" });
        const html = (await renderRecipesListPage(ALICE, {})).html;
        const drafts = html.slice(
            html.indexOf('id="fd-recipes-drafts"'),
            html.indexOf("fd-recipes-all-heading"),
        );
        expect(drafts).toContain(`href="/recipes/${theirs}"`);
        expect(drafts).toContain(`href="/recipes/${mine}"`);
        // The owner may discard it from its page.
        const page = (await renderRecipeDetailRoute(ALICE, theirs)).html;
        expect(page).toContain(`action="/recipes/${theirs}/discard"`);
    });

    test("a draft's expiry is the household's local day, on its page and in the list", async () => {
        db.ownerTimezone = "America/New_York";
        const id = await draftOf({ expiresAt: "2026-12-01T02:00:00.000Z" });
        const page = (await renderRecipeDetailRoute(ALICE, id)).html;
        expect(page).toContain("deleted on 2026-11-30");
        expect(page).not.toContain("2026-12-01");
        const list = (await renderRecipesListPage(ALICE, {})).html;
        expect(list).toContain("deleted 2026-11-30 unless saved");
    });

    test("with only drafts, the list does not say there are no recipes", async () => {
        await db.recipesStore.deleteRecipe(HH, db.recipeId);
        const none = (await renderRecipesListPage(ALICE, {})).html;
        expect(none).toContain("No recipes yet.");
        await draftOf({ name: "Alice draft" });
        const html = (await renderRecipesListPage(ALICE, {})).html;
        expect(html).toContain('id="fd-recipes-drafts"');
        expect(html).toContain("0 saved");
        expect(html).not.toContain("No recipes yet.");
    });

    test("a draft has no favourite star, and starring one is refused", async () => {
        const id = await draftOf();
        const html = (await renderRecipeDetailRoute(ALICE, id)).html;
        expect(html).not.toContain("fd-recipe-star");
        const saved = (await renderRecipeDetailRoute(ALICE, db.recipeId)).html;
        expect(saved).toContain("fd-recipe-star");
        const res = await postFavourite(
            new URLSearchParams({ on: "1", back: "recipe" }),
            { recipeId: id },
        );
        expect(res.status).toBe(409);
        expect(await res.text()).toContain(
            "That recipe is a draft; save it first.",
        );
        expect(await favouriteIds(ALICE)).toEqual([]);
    });

    function postDiscard(recipeId: string, as = ALICE) {
        return recipesApp().request(`http://x/recipes/${recipeId}/discard`, {
            method: "POST",
            headers: {
                cookie: cookieFor(as),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "",
        });
    }

    test("a draft's page offers Discard draft, which deletes it and goes back to Recipes", async () => {
        const id = await draftOf();
        const html = (await renderRecipeDetailRoute(ALICE, id)).html;
        expect(html).toContain("Discard draft");
        expect(html).toContain(`action="/recipes/${id}/discard"`);
        expect(html).not.toContain(`action="/recipes/${id}/delete"`);
        const saved = (await renderRecipeDetailRoute(ALICE, db.recipeId)).html;
        expect(saved).not.toContain("Discard draft");
        const res = await postDiscard(id);
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/recipes");
        expect(await db.recipesStore.getRecipe(HH, id)).toBeNull();
        // Gone, or never a recipe: not found.
        expect((await postDiscard(id)).status).toBe(404);
        expect((await postDiscard("nope")).status).toBe(404);
    });

    test("Discard from a stale page keeps a draft saved since, and says so in place", async () => {
        const id = await draftOf({ steps: "1. Simmer" });
        const stale = (await renderRecipeDetailRoute(ALICE, id)).html;
        expect(stale).toContain(`action="/recipes/${id}/discard"`);
        // Someone saves it while the page is open.
        expect((await postSave(id, BOB)).status).toBe(303);
        const res = await postDiscard(id);
        expect(res.status).toBe(409);
        expect(await res.text()).toContain(
            "Imported stew was already saved, so it was not discarded.",
        );
        const row = await db.recipesStore.getRecipe(HH, id);
        expect(row?.verification).toBe("verified");
    });

    test("only the importer or the owner sees and may use Discard draft", async () => {
        const id = await draftOf();
        const asBob = (await renderRecipeDetailRoute(BOB, id)).html;
        expect(asBob).toContain(`action="/recipes/${id}/save"`);
        expect(asBob).not.toContain("Discard draft");
        expect(asBob).not.toContain(`/recipes/${id}/discard`);
        const refused = await postDiscard(id, BOB);
        expect(refused.status).toBe(403);
        expect(await db.recipesStore.getRecipe(HH, id)).not.toBeNull();
        const bobs = await draftOf({ name: "Bob stew", creatorId: BOB });
        const own = (await renderRecipeDetailRoute(BOB, bobs)).html;
        expect(own).toContain(`action="/recipes/${bobs}/discard"`);
        expect((await postDiscard(bobs, BOB)).status).toBe(303);
        expect(await db.recipesStore.getRecipe(HH, bobs)).toBeNull();
    });

    test("planning a draft from the app says it is a draft", async () => {
        const id = await draftOf({ steps: "1. Simmer" });
        const res = await recipesApp().request(`http://x/recipes/${id}/plan`, {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                date: addPlanDays(dateInTz(new Date(), "UTC"), 1),
                slot: "dinner",
            }).toString(),
        });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(await res.text()).toContain(
            "That recipe is a draft; save it first.",
        );
        expect(
            await db.plansStore.listPlans(HH, "2000-01-01", "2999-12-31"),
        ).toEqual([]);
    });
});
