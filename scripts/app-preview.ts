/**
 * Renders every household-app page with fixture data, in light and dark, and
 * serves the result next to the real /app.css so the pages can be looked at
 * without a database. The widget equivalent is scripts/widget-harness.ts.
 *
 *   bun run preview:app            # writes tmp/app-preview/*.html, serves :4787
 *   bun run preview:app --shots    # also writes a 430px and a 1280px PNG per page, then exits
 *
 * --shots needs Chromium on PATH (google-chrome-stable, chromium, or
 * chromium-browser — not the PATH google-chrome wrapper, which pins the GUI
 * profile). Shots pass --force-prefers-reduced-motion so --virtual-time-budget
 * does not freeze page entrances half-done, a throwaway --user-data-dir, and
 * an emulated prefers-color-scheme so bare pages (OS theme) render light and
 * dark as different bytes.
 * The server never imports this file.
 */
import { fridgeNotices, utcTodayFromDate } from "../src/domain/stock.js";
import { groceryRestockNotices } from "../src/domain/restock.js";
import {
    needsAttentionCount,
    sortNotices,
    tabDotsFromNotices,
    type Notice,
} from "../src/domain/notices.js";
import { renderFridgePage } from "../src/web/pages/fridge.js";
import { renderGroceryPage } from "../src/web/pages/grocery.js";
import {
    renderRecipeDetailPage,
    renderRecipesPage,
} from "../src/web/pages/recipes.js";
import { renderSettingsPage } from "../src/web/pages/settings.js";
import {
    renderFoodsSettingsPage,
    FOOD_EDIT_MODAL_ID,
} from "../src/web/pages/foods.js";
import {
    renderUsualProductsListPage,
    renderUsualProductsPickerPage,
} from "../src/web/pages/usual-products.js";
import { renderHouseholdSettingsPage } from "../src/web/pages/household.js";
import { renderSettingsHelpPage } from "../src/web/pages/settings-help.js";
import { renderNeedsAttentionPage } from "../src/web/pages/needs-attention.js";
import { renderHouseholdSettingsPrefsPage } from "../src/web/pages/settings-household.js";
import {
    DEFAULT_RESTOCK,
    EMPTY_HOUSEHOLD_PREFERENCES,
} from "../src/household.js";
import {
    NUTRITION_LOG_MEAL_MODAL_ID,
    NUTRITION_LOG_WATER_MODAL_ID,
    NUTRITION_LOG_WEIGHT_MODAL_ID,
    renderNutritionPage,
    viewerChromeFromProfile,
} from "../src/web/pages/nutrition.js";
import {
    createHouseholdFormHtml,
    forbiddenDashboardHtml,
} from "../src/web/loaders.js";
import { isNutritionCard } from "../src/domain/layout.js";
import {
    matchFoodsByWords,
    possibleDuplicates,
    usualProductRows,
} from "../src/domain/foods.js";
import {
    possibleDuplicateNotices,
    possibleDuplicateNoticesByFoodId,
} from "../src/domain/notices-for.js";
import {
    DUP_MERGE_MODAL_ID,
    renderPossibleDuplicatesPage,
} from "../src/web/pages/possible-duplicates.js";
import { getAppCss, getAppJs, getEmbedWidgetHtml } from "../src/widgets.js";

const OUT = "./tmp/app-preview";
const PORT = 4787;
const H = "hh-1";
const ME = {
    householdId: H,
    userId: "u1",
    role: "owner",
    displayName: "Ethan",
};
const SAM = { ...ME, userId: "u2", role: "member", displayName: "Sam" };

const PREVIEW_STORES = [
    { id: "s-costco", householdId: H, name: "Costco", sortOrder: 0 },
];

// The widget templates carry a SAMPLE payload for standalone preview; reuse it
// so the nutrition page shows real cards.
async function widgetSample(key: string): Promise<unknown> {
    const src = await Bun.file(
        `./public/widgets/src/templates/${key}.html`,
    ).text();
    const m = src.match(/const SAMPLE = (\{[\s\S]*?\n {12}\});/);
    return m ? new Function(`return (${m[1]})`)() : { locale: "en" };
}

function addUtcDays(isoDate: string, days: number): string {
    const d = new Date(`${isoDate}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function fridgeView(chrome: unknown) {
    const today = utcTodayFromDate();
    const loc = (id: string, name: string, sortOrder: number) => ({
        id,
        householdId: H,
        name,
        sortOrder,
    });
    const item = (
        id: string,
        locationId: string,
        displayName: string,
        amount: number,
        unit: string,
        expiresOn: string | null,
        food = true,
        foodId?: string,
    ) => ({
        id,
        householdId: H,
        locationId,
        kind: food ? "food" : "supply",
        displayName,
        quantity: { amount, unit },
        foodId: food ? (foodId ?? `f-${id}`) : `f-sup-${id}`,
        expiresOn,
    });
    const foodsById = new Map([
        ["f-i1", { id: "f-i1", genericFoodId: null }],
        ["f-milk", { id: "f-milk", genericFoodId: null }],
        ["f-long-milk", { id: "f-long-milk", genericFoodId: null }],
        ["f-i3", { id: "f-i3", genericFoodId: null }],
        ["f-i4", { id: "f-i4", genericFoodId: null }],
        ["f-i5", { id: "f-i5", genericFoodId: null }],
    ]);
    return {
        chrome,
        today,
        locations: [loc("l1", "Fridge", 0), loc("l2", "Pantry", 1)],
        items: [
            item(
                "i1",
                "l1",
                "Cremini mushrooms",
                250,
                "g",
                addUtcDays(today, -2),
            ),
            item(
                "i2",
                "l1",
                "Expired milk",
                1,
                "l",
                addUtcDays(today, -1),
                true,
                "f-milk",
            ),
            item(
                "i-long",
                "l1",
                "Organic whole milk with extra long product name that wraps across two lines in the list",
                1,
                "l",
                addUtcDays(today, -5),
                true,
                "f-long-milk",
            ),
            item("i3", "l1", "Eggs", 6, "each", addUtcDays(today, 1)),
            item("i4", "l1", "Lime", 3, "each", addUtcDays(today, 5)),
            item("i5", "l1", "Cheese", 200, "g", addUtcDays(today, 5)),
            item("i6", "l2", "Paper towels", 3, "roll", null, false),
        ],
        groceryLines: [
            { foodId: "f-milk", checked: false },
            { foodId: "f-i4", checked: false },
        ],
        foodsById,
    };
}

/** A line the weekly restock run added, with its "Restocked" notice. */
function restockLine() {
    const today = utcTodayFromDate();
    const row = {
        id: "g4",
        householdId: H,
        storeId: "s1",
        sectionId: "sec2",
        kind: "food" as const,
        displayName: "Milk",
        quantity: { amount: 2, unit: "l" },
        foodId: "f-milk",
        checked: false,
        source: "restock" as const,
        sourceFridgeItemId: "i-milk-restock",
        note: null,
    };
    const notices = groceryRestockNotices(
        [row],
        [
            {
                id: "i-milk-restock",
                displayName: "Milk",
                expiresOn: addUtcDays(today, 3),
            } as never,
        ],
        today,
    );
    return { ...row, alreadyHave: null, notices };
}

function groceryView(chrome: unknown) {
    const section = (
        storeId: string,
        id: string,
        name: string,
        isOther: boolean,
        lines: unknown[],
    ) => ({
        id,
        householdId: H,
        storeId,
        name,
        sortOrder: isOther ? 8 : 0,
        hidden: false,
        isOther,
        lines,
    });
    const line = (
        storeId: string,
        sectionId: string,
        id: string,
        name: string,
        amount: number,
        unit: string,
        checked: boolean,
        alreadyHave: unknown = null,
    ) => ({
        id,
        householdId: H,
        storeId,
        sectionId,
        kind: "food",
        displayName: name,
        quantity: { amount, unit },
        foodId: `f-${id}`,
        checked,
        alreadyHave,
    });
    return {
        chrome,
        isOwner: true,
        locations: [
            { id: "l1", name: "Fridge" },
            { id: "l2", name: "Pantry" },
        ],
        stores: [
            {
                id: "s1",
                householdId: H,
                name: "Safeway",
                sortOrder: 0,
                rules: [{ id: "r1", body: "Prefer store brand." }],
                sections: [
                    section("s1", "sec1", "Produce", false, [
                        line("s1", "sec1", "g1", "Bananas", 6, "each", false),
                        line("s1", "sec1", "g2", "Spinach", 300, "g", true),
                    ]),
                    section("s1", "sec2", "Other", true, [
                        {
                            ...line(
                                "s1",
                                "sec2",
                                "g3",
                                "Eggs",
                                12,
                                "each",
                                false,
                                {
                                    cover: "partial",
                                    have: { amount: 6, unit: "each" },
                                    need: { amount: 12, unit: "each" },
                                },
                            ),
                            usualProductName: "Kirkland Large Eggs",
                            usualPickerHref:
                                "/household/usual-products/f-eggs?from=%2Fgrocery",
                            putAwayProducts: [
                                { id: "f-eggs", label: "Eggs" },
                                {
                                    id: "f-kirkland",
                                    label: "Kirkland Large Eggs · Kirkland",
                                },
                            ],
                            putAwayProductId: "f-kirkland",
                        },
                        restockLine(),
                    ]),
                ],
            },
            {
                id: "s2",
                householdId: H,
                name: "Costco",
                sortOrder: 1,
                rules: [],
                sections: [
                    section("s2", "sec3", "Dairy", false, [
                        line("s2", "sec3", "g4", "Milk", 2, "l", false),
                    ]),
                ],
            },
        ],
    };
}

const RECIPE = {
    id: "r1",
    householdId: H,
    creatorId: "u1",
    name: "Shakshuka",
    yieldPortions: 4,
    instructions: "Simmer tomatoes, crack eggs, cover.",
    sourceUrl: null,
    tags: ["dinner", "vegetarian"],
    notes: null,
    prepMinutes: 10,
    cookMinutes: 20,
};

const RECIPE_TWO = {
    id: "r2",
    householdId: H,
    creatorId: "u1",
    name: "Oatmeal",
    yieldPortions: 2,
    instructions: "Simmer oats.",
    sourceUrl: null,
    tags: ["breakfast"],
    notes: null,
    prepMinutes: 5,
    cookMinutes: 10,
};

const MACROS = {
    calories: 320,
    protein_g: 18,
    carbs_g: 22,
    fat_g: 17,
    fiber_g: 5,
    sugar_g: 9,
    alcohol_g: 0,
    incomplete: true,
    incompleteReasons: [
        "Buttermilk: no nutrition — add it, or pick a usual product",
    ],
    gaps: [
        {
            ingredientId: "ing0",
            displayName: "Buttermilk",
            foodId: "f-buttermilk",
            reason: "no_nutrition",
            missingNutrients: [],
            usualProduct: null,
            message:
                "Buttermilk: no nutrition — add it, or pick a usual product",
        },
    ],
};

function food(
    id: string,
    name: string,
    calories: number | null,
    over: Record<string, unknown> = {},
) {
    return {
        id,
        householdId: H,
        kind: "food" as const,
        name,
        normalizedName: name.toLowerCase(),
        brand: null,
        defaultUnit: "g",
        gramsPerEach: null,
        gramsPerMl: null,
        calories,
        proteinG: null,
        carbsG: null,
        fatG: null,
        fiberG: null,
        sugarG: null,
        alcoholG: null,
        caffeineMg: null,
        nutritionSource: null,
        allergens: [],
        offSourceId: null,
        genericFoodId: null,
        usualProductId: null,
        usualStoreId: null,
        usualAmount: null,
        createdBy: null,
        archivedAt: null,
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
        aliases: [],
        ...over,
    };
}

// Views are cast with `as never`: this script is not typechecked (CI's
// typecheck covers src/ only) and the fixtures only carry what renderers read.
function previewFoodCatalog() {
    const catalog = [
        food("f-eggs", "Eggs", 143, {
            usualProductId: "f-kirkland",
            gramsPerEach: 50,
            proteinG: 12,
        }),
        food("f-kirkland", "Kirkland Large Eggs", 140, {
            genericFoodId: "f-eggs",
            brand: "Kirkland",
            usualStoreId: "s-costco",
            usualAmount: { amount: 24, unit: "each" },
        }),
        food("f-gv", "Great Value Eggs", 130, { genericFoodId: "f-eggs" }),
        food("f-buttermilk", "Buttermilk", null),
        food("f2", "Milk", 64),
        food("f-flour-a", "All purpose flour", null),
        food("f-flour-b", "all-purpose flour", null),
        food("f-carton", "Cage Free Grade A Large Eggs", 140, {
            offSourceId: "070852010016",
        }),
        food("f-chicken-egg", "chicken egg", 155, { proteinG: 13 }),
    ];
    const usual = usualProductRows({ foods: catalog });
    return { catalog, usual };
}

/** The household-wide notices the preview pages share: the real fridge
 *  producer over the fridge fixture, plus one recipe gap. The top-bar count
 *  and the tab dots are computed from them, as the loaders do. */
function previewNotices(): Notice[] {
    const { catalog } = previewFoodCatalog();
    const recipeGap: Notice = {
        code: "recipe.no_nutrition",
        severity: "warn",
        subject: { kind: "recipe_ingredient", id: "ing0", recipeId: RECIPE.id },
        related: [],
        params: { name: "Buttermilk", foodId: "f-buttermilk" },
    };
    const duplicateNotices = possibleDuplicateNotices(
        catalog.filter((f) => !f.archivedAt && !f.genericFoodId),
        new Map(),
        new Set(),
        new Set(),
    );
    return sortNotices([
        recipeGap,
        ...duplicateNotices,
        ...(() => {
            const items = fridgeView(null).items;
            // Nothing is on the grocery list, so each food item offers
            // "Add to grocery list", as on the fridge page.
            const foodsById = new Map(
                items.map((row) => [
                    row.foodId,
                    { id: row.foodId, genericFoodId: null },
                ]),
            );
            return fridgeNotices(items as never, utcTodayFromDate(), {
                lines: [],
                foodsById,
            });
        })(),
    ]);
}

function previewAttention() {
    const notices = previewNotices();
    return {
        count: needsAttentionCount(notices),
        tabs: tabDotsFromNotices(notices),
    };
}

async function pages(theme: "light" | "dark"): Promise<Record<string, string>> {
    const chrome = {
        ...viewerChromeFromProfile({ theme }),
        attention: previewAttention(),
    };
    const { catalog, usual } = previewFoodCatalog();
    const catalogById = new Map(catalog.map((row) => [row.id, row]));
    const eggsPlain = catalog.find((row) => row.id === "f-eggs")!;
    const eggProducts = catalog
        .filter((row) => row.genericFoodId === "f-eggs")
        .sort((a, b) => a.name.localeCompare(b.name));
    const nutrition = await renderNutritionPage({
        access: { ok: true, mode: "self", viewer: ME, subject: ME },
        members: [ME, SAM],
        summary: await widgetSample("nutrition-summary"),
        goals: await widgetSample("goal-progress"),
        trends: await widgetSample("trends"),
        weight: await widgetSample("weight-trends"),
        chrome,
        cardOrder: [
            "nutrition-summary",
            "goal-progress",
            "trends",
            "weight-trends",
        ],
    } as never);
    const nutritionPeer = await renderNutritionPage({
        access: { ok: true, mode: "peer", viewer: ME, subject: SAM },
        members: [ME, SAM],
        summary: await widgetSample("nutrition-summary"),
        goals: await widgetSample("goal-progress"),
        trends: await widgetSample("trends"),
        weight: await widgetSample("weight-trends"),
        chrome,
        cardOrder: [
            "nutrition-summary",
            "goal-progress",
            "trends",
            "weight-trends",
        ],
        viewMemberId: SAM.userId,
    } as never);
    return {
        nutrition,
        "nutrition-peer": nutritionPeer,
        fridge: renderFridgePage(fridgeView(chrome) as never),
        grocery: renderGroceryPage(groceryView(chrome) as never),
        "grocery-allergen-modal": renderGroceryPage({
            ...(groceryView(chrome) as object),
            allergenNotices: [
                {
                    code: "grocery.allergen",
                    severity: "block",
                    subject: { kind: "grocery_line", id: "" },
                    related: [{ kind: "member", id: "u1", name: "Morgan" }],
                    params: { allergens: ["peanut"] },
                },
            ],
            openModalId: "grocery-add-food-s1",
            allergenRetry: {
                storeId: "s1",
                fields: {
                    kind: "food",
                    store_id: "s1",
                    food_name: "Peanut butter",
                    qty_amount: "1",
                    qty_unit: "each",
                },
            },
        } as never),
        recipes: renderRecipesPage({
            chrome,
            recipes: [RECIPE, RECIPE_TWO],
            members: [ME, SAM],
            viewerId: "u1",
        } as never),
        recipe: renderRecipeDetailPage({
            chrome: {
                ...chrome,
                householdPossibleDuplicates: 1,
            },
            foodDuplicateNotices: possibleDuplicateNoticesByFoodId(
                possibleDuplicateNotices(
                    catalog,
                    new Map(),
                    new Set(),
                    new Set(),
                ),
            ),
            recipe: {
                ...RECIPE,
                name: "Banana bread",
                yieldPortions: 10,
                instructions:
                    "Mash the bananas.\nWhisk in the sugar, then fold in the flour.\nBake at 175 °C for 55 minutes.",
            },
            notices: [
                {
                    code: "recipe.no_nutrition",
                    severity: "warn",
                    subject: {
                        kind: "recipe_ingredient",
                        id: "ing0",
                        recipeId: "r1",
                    },
                    related: [],
                    params: { name: "Buttermilk", foodId: "f-buttermilk" },
                },
            ],
            noticeContext: {
                from: "/recipes/r1",
                foods: new Map(
                    catalog.map((f) => [
                        f.id,
                        { genericFoodId: f.genericFoodId },
                    ]),
                ),
            },
            ingredients: [
                {
                    id: "ing1",
                    recipeId: "r1",
                    foodId: "f-eggs",
                    displayName: "Eggs · Kirkland Large Eggs",
                    quantity: { amount: 3, unit: "each" },
                    note: null,
                    sortOrder: 0,
                    perPortionAmount: 0.3,
                    personAmount: 0.3,
                },
                {
                    id: "ing0",
                    recipeId: "r1",
                    foodId: "f-buttermilk",
                    displayName: "Buttermilk",
                    quantity: { amount: 200, unit: "ml" },
                    note: null,
                    sortOrder: 0,
                    perPortionAmount: 20,
                    personAmount: 20,
                },
                {
                    id: "ing2",
                    recipeId: "r1",
                    foodId: "f2",
                    displayName: "All-purpose flour",
                    quantity: { amount: 200, unit: "g" },
                    note: null,
                    sortOrder: 1,
                    perPortionAmount: 20,
                    personAmount: 20,
                },
                {
                    id: "ing3",
                    recipeId: "r1",
                    foodId: "f3",
                    displayName: "Sugar",
                    quantity: { amount: 100, unit: "g" },
                    note: null,
                    sortOrder: 2,
                    perPortionAmount: 10,
                    personAmount: 10,
                },
            ],
            members: [ME, SAM],
            stores: [{ id: "s1", name: "Safeway" }],
            viewerId: "u1",
            filterUserId: "u1",
            portionCount: 1,
            macros: MACROS,
            isOwner: true,
        } as never),
        settings: renderSettingsPage({
            chrome,
            backHref: "/fridge",
            displayName: "Ethan",
            timezone: "America/Los_Angeles",
            weightUnit: "kg",
            widgetsEnabled: true,
            alcoholTrackingEnabled: false,
            drinkUnit: "",
        } as never),
        household: renderHouseholdSettingsPage({
            chrome,
            householdName: "Flow house",
            location: "Portland",
            members: [ME, SAM],
            stores: [
                {
                    id: "s1",
                    householdId: H,
                    name: "Safeway",
                    sortOrder: 0,
                    sections: [
                        {
                            id: "sec1",
                            householdId: H,
                            storeId: "s1",
                            name: "Produce",
                            sortOrder: 0,
                            hidden: false,
                            isOther: false,
                        },
                    ],
                    rules: [{ id: "r1", body: "Prefer store brand." }],
                },
            ],
            memberRules: [
                { member: ME, rules: [], allergens: [], dislikes: [] },
            ],
            isOwner: true,
        } as never),
        foods: renderFoodsSettingsPage({
            chrome,
            foods: catalog.map((row) => ({ ...row, aliases: [] })),
            stores: PREVIEW_STORES,
        } as never),
        "foods-edit": renderFoodsSettingsPage({
            chrome,
            foods: catalog.map((row) => ({ ...row, aliases: [] })),
            stores: PREVIEW_STORES,
            openModalId: `${FOOD_EDIT_MODAL_ID}-f-kirkland`,
        } as never),
        "usual-products-picker": renderUsualProductsPickerPage({
            chrome,
            food: eggsPlain,
            products: eggProducts,
            usualProductId: eggsPlain.usualProductId,
            prefillStoreId: catalogById.get("f-kirkland")!.usualStoreId,
            prefillAmount: catalogById.get("f-kirkland")!.usualAmount,
            stores: PREVIEW_STORES,
            from: "/household/usual-products",
        } as never),
        "usual-products": renderUsualProductsListPage({
            chrome,
            rows: usual.rows,
            addable: usual.addable,
        } as never),
        "usual-products-search": renderUsualProductsListPage({
            chrome,
            rows: usual.rows,
            addable: usual.addable,
            addSearch: {
                q: "flour",
                results: matchFoodsByWords(
                    "flour",
                    usual.addable,
                    new Map(),
                ).slice(0, 20),
                truncated: false,
            },
        } as never),
        "possible-duplicates": (() => {
            const dupPairs = possibleDuplicates(
                catalog.filter((f) => !f.archivedAt && !f.genericFoodId),
                new Map(),
                new Set(),
                new Set(),
            );
            return renderPossibleDuplicatesPage({
                chrome: {
                    ...chrome,
                    householdPossibleDuplicates: dupPairs.length,
                },
                pairs: dupPairs,
                refCounts: new Map([
                    ["f-chicken-egg", 0],
                    ["f-eggs", 1],
                ]),
            } as never);
        })(),
        "possible-duplicates-merge": (() => {
            const dupPairs = possibleDuplicates(
                catalog.filter((f) => !f.archivedAt && !f.genericFoodId),
                new Map(),
                new Set(),
                new Set(),
            );
            const pair = dupPairs[0]!;
            return renderPossibleDuplicatesPage({
                chrome: {
                    ...chrome,
                    householdPossibleDuplicates: dupPairs.length,
                },
                pairs: dupPairs,
                refCounts: new Map([
                    [pair.subject.id, 0],
                    [pair.related.id, 0],
                ]),
                openModalId: DUP_MERGE_MODAL_ID,
                mergePost: {
                    foodA: pair.subject.id,
                    foodB: pair.related.id,
                    keepId: pair.subject.id,
                    picks: {},
                },
            } as never);
        })(),
        help: renderSettingsHelpPage({ chrome, backHref: "/fridge" } as never),
        "needs-attention": (() => {
            const fridgeItems = fridgeView(null).items;
            return renderNeedsAttentionPage({
                chrome,
                result: {
                    notices: previewNotices(),
                    dismissals: [],
                    subjectNames: new Map([
                        ...fridgeItems.map(
                            (row) =>
                                [`fridge_item:${row.id}`, row.displayName] as [
                                    string,
                                    string,
                                ],
                        ),
                        [`recipe:${RECIPE.id}`, RECIPE.name],
                    ]),
                    subjectTimes: new Map([
                        ...fridgeItems.map(
                            (row, i) =>
                                [
                                    `fridge_item:${row.id}`,
                                    Date.parse("2026-01-01T00:00:00.000Z") +
                                        i * 60_000,
                                ] as [string, number],
                        ),
                        [
                            `recipe:${RECIPE.id}`,
                            Date.parse("2026-02-01T00:00:00.000Z"),
                        ],
                    ]),
                    noticeFoods: new Map(
                        catalog.map((f) => [
                            f.id,
                            { genericFoodId: f.genericFoodId },
                        ]),
                    ),
                },
            } as never);
        })(),
        "settings-household": renderHouseholdSettingsPrefsPage({
            chrome,
            backHref: "/fridge",
            member: { ...ME, role: "owner" },
            preferences: {
                ...EMPTY_HOUSEHOLD_PREFERENCES,
                timezone: null,
                restock: { ...DEFAULT_RESTOCK, enabled: true },
            },
            ownerTimezoneLabel: "America/Los_Angeles",
        }),
        "settings-household-member": renderHouseholdSettingsPrefsPage({
            chrome,
            backHref: "/fridge",
            member: { ...SAM, role: "member" },
            preferences: {
                ...EMPTY_HOUSEHOLD_PREFERENCES,
                restock: { ...DEFAULT_RESTOCK, enabled: true },
            },
            ownerTimezoneLabel: "America/Los_Angeles",
        }),
        "create-household": createHouseholdFormHtml(undefined, theme),
        forbidden: forbiddenDashboardHtml(theme),
    };
}

function findChromium(): string | null {
    // Prefer the real binary. PATH `google-chrome` is often a wrapper that
    // pins --user-data-dir to the GUI profile and hangs headless shots.
    for (const bin of [
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
    ]) {
        if (bin.startsWith("/")) {
            try {
                if (Bun.file(bin).size > 0) return bin;
            } catch {
                // missing
            }
            continue;
        }
        const path = Bun.which(bin);
        if (path) return path;
    }
    return null;
}

async function nutritionWithModal(
    theme: "light" | "dark",
    openModalId: string,
): Promise<string> {
    const chrome = {
        ...viewerChromeFromProfile({ theme }),
        attention: previewAttention(),
    };
    return renderNutritionPage({
        access: { ok: true, mode: "self", viewer: ME, subject: ME },
        members: [ME, SAM],
        summary: await widgetSample("nutrition-summary"),
        goals: await widgetSample("goal-progress"),
        trends: await widgetSample("trends"),
        weight: await widgetSample("weight-trends"),
        chrome,
        cardOrder: [
            "nutrition-summary",
            "goal-progress",
            "trends",
            "weight-trends",
        ],
        openModalId,
    } as never);
}

const names: string[] = [];
const modalShotPages: string[] = [];
for (const theme of ["light", "dark"] as const) {
    const p = await pages(theme);
    for (const [name, html] of Object.entries(p)) {
        const file = `${name}-${theme}`;
        await Bun.write(`${OUT}/${file}.html`, html);
        names.push(file);
    }
    for (const [slug, modalId] of [
        ["log-meal", NUTRITION_LOG_MEAL_MODAL_ID],
        ["log-water", NUTRITION_LOG_WATER_MODAL_ID],
        ["log-weight", NUTRITION_LOG_WEIGHT_MODAL_ID],
    ] as const) {
        const file = `nutrition-${slug}-${theme}`;
        await Bun.write(
            `${OUT}/${file}.html`,
            await nutritionWithModal(theme, modalId),
        );
        modalShotPages.push(file);
    }
    modalShotPages.push(
        `foods-edit-${theme}`,
        `usual-products-picker-${theme}`,
        `possible-duplicates-${theme}`,
        `possible-duplicates-merge-${theme}`,
        `recipe-${theme}`,
    );
}

const server = Bun.serve({
    port: PORT,
    async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path.startsWith("/app/widgets/")) {
            let key = path.slice("/app/widgets/".length);
            try {
                key = decodeURIComponent(key);
            } catch {
                return new Response("not found", { status: 404 });
            }
            if (!isNutritionCard(key)) {
                return new Response("not found", { status: 404 });
            }
            const doc = await getEmbedWidgetHtml(key);
            return new Response(doc.html, {
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        }
        if (path === "/app.css") {
            return new Response(await getAppCss(), {
                headers: { "content-type": "text/css; charset=utf-8" },
            });
        }
        if (path === "/app.js") {
            return new Response(await getAppJs(), {
                headers: { "content-type": "text/javascript; charset=utf-8" },
            });
        }
        if (path === "/") {
            const links = names
                .map((n) => `<li><a href="/${n}.html">${n}</a></li>`)
                .join("");
            return new Response(`<!doctype html><ul>${links}</ul>`, {
                headers: { "content-type": "text/html" },
            });
        }
        const file = Bun.file(`${OUT}${path}`);
        if (await file.exists()) return new Response(file);
        const pub = Bun.file(`./public${path}`);
        return (await pub.exists())
            ? new Response(pub)
            : new Response("not found", { status: 404 });
    },
});
console.log(`app preview: http://localhost:${server.port}/`);

if (process.argv.includes("--shots")) {
    const chromium = findChromium();
    if (!chromium) {
        console.error("--shots: no chromium on PATH");
        process.exit(1);
    }
    for (const name of names) {
        const theme = name.endsWith("-dark") ? "dark" : "light";
        const dataDir = `${OUT}/chrome-${name}`;
        // Bare pages follow the OS; headless Chromium defaults to dark, so
        // emulate the shot's colour scheme. --user-data-dir is throwaway so
        // the GUI profile is never touched.
        const colorScheme = theme === "dark" ? 2 : 1;
        await Bun.$`${chromium} --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --hide-scrollbars --force-prefers-reduced-motion --blink-settings=preferredColorScheme=${colorScheme} --user-data-dir=${dataDir} --window-size=430,2400 --virtual-time-budget=3000 --screenshot=${OUT}/${name}.png http://localhost:${PORT}/${name}.html`.quiet();
        console.log(`${OUT}/${name}.png`);
        // From 768px the bottom nav becomes the left sidebar.
        await Bun.$`${chromium} --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --hide-scrollbars --force-prefers-reduced-motion --blink-settings=preferredColorScheme=${colorScheme} --user-data-dir=${dataDir} --window-size=1280,900 --virtual-time-budget=3000 --screenshot=${OUT}/${name}-wide.png http://localhost:${PORT}/${name}.html`.quiet();
        console.log(`${OUT}/${name}-wide.png`);
    }
    for (const name of modalShotPages) {
        const theme = name.endsWith("-dark") ? "dark" : "light";
        const dataDir = `${OUT}/chrome-${name}`;
        const colorScheme = theme === "dark" ? 2 : 1;
        await Bun.$`${chromium} --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --hide-scrollbars --force-prefers-reduced-motion --blink-settings=preferredColorScheme=${colorScheme} --user-data-dir=${dataDir} --window-size=390,844 --virtual-time-budget=4000 --screenshot=${OUT}/${name}.png http://localhost:${PORT}/${name}.html`.quiet();
        console.log(`${OUT}/${name}.png`);
    }
    server.stop();
}
