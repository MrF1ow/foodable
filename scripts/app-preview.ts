/**
 * Renders every household-app page with fixture data, in light and dark, and
 * serves the result next to the real /app.css so the pages can be looked at
 * without a database. The widget equivalent is scripts/widget-harness.ts.
 *
 *   bun run preview:app            # writes tmp/app-preview/*.html, serves :4787
 *   bun run preview:app --shots    # also writes a 430px and a 1280px PNG per page, then exits
 *   FOODABLE_FLAGS=ui-v2:all bun run preview:app --shots
 *                                  # the new shell (flag ui-v2): serves /app-v2.css and
 *                                  # /app-v2.js and adds a 390x844 phone shot (-v2-390.png)
 *                                  # and a 1440x960 desktop shot (-v2-1440.png) per page
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
import { renderRecipesListV2Page } from "../src/web/pages/v2/recipes-list.js";
import {
    groupRecipeIngredientsByPlace,
    renderRecipeDetailV2Page,
} from "../src/web/pages/v2/recipes-page.js";
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
import { renderHouseholdInvitesPage } from "../src/web/pages/v2/settings-household-invites.js";
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
import { renderDevGalleryV2Page } from "../src/web/pages/dev-gallery.js";
import {
    buildPreviewTrendsPageData,
    renderTrendsV2Page,
} from "../src/web/pages/v2/trends.js";
import {
    buildPreviewTodayPageData,
    buildPreviewTodayViewWithRail,
    buildPreviewTodayViewWithSuggestions,
    buildPreviewTodayViewWithYesterdayHint,
    renderTodayV2Page,
} from "../src/web/pages/v2/today.js";
import {
    buildPreviewKitchenFridgeView,
    renderKitchenFridgeV2Page,
} from "../src/web/pages/v2/kitchen-fridge.js";
import { buildKitchenFridgeGroceryOverview } from "../src/web/pages/v2/kitchen-overview.js";
import {
    buildPreviewKitchenGroceriesView,
    renderKitchenGroceriesV2Page,
} from "../src/web/pages/v2/kitchen-groceries.js";
import {
    buildPreviewKitchenUsualsView,
    kitchenUsualRowMeta,
    renderKitchenUsualsV2Page,
} from "../src/web/pages/v2/kitchen-usuals.js";
import {
    buildPreviewProductPageView,
    renderProductBarcodeUnknownPage,
    renderProductV2Page,
} from "../src/web/pages/v2/product.js";
import {
    buildProductScoreSection,
    previewMemberCards,
} from "../src/web/pages/v2/product-score.js";
import { listExpiring } from "../src/domain/stock.js";
import { defaultFreezeExpiry } from "../src/domain/fridge.js";
import { renderSettingsHomeV2Page } from "../src/web/pages/v2/settings-home.js";
import { renderSettingsAccountV2Page } from "../src/web/pages/v2/settings-account.js";
import { renderSettingsDisplayV2Page } from "../src/web/pages/v2/settings-display.js";
import { renderSettingsHelpV2Page } from "../src/web/pages/v2/settings-help.js";
import { renderSettingsHouseholdV2Page } from "../src/web/pages/v2/settings-household.js";
import { renderSettingsMemberV2Page } from "../src/web/pages/v2/settings-member.js";
import { renderSettingsGoalsV2Page } from "../src/web/pages/v2/settings-goals.js";
import { renderSettingsSavedV2Page } from "../src/web/pages/v2/settings-saved.js";
import {
    renderSettingsStoresV2Page,
    STORES_REORDER_SHEET_ID,
} from "../src/web/pages/v2/settings-stores.js";
import {
    renderSettingsStoreV2Page,
    STORE_DELETE_SHEET_ID,
} from "../src/web/pages/v2/settings-stores-detail.js";
import { renderSettingsExportV2Page } from "../src/web/pages/v2/settings-export.js";
import { goalsResolver } from "../src/domain/insights.js";
import type { NutritionGoals } from "../src/db/nutrition.js";
import { pageHeader } from "../src/web/components/ui.js";
import { renderAppShell } from "../src/web/shell.js";
import { isNutritionCard } from "../src/domain/layout.js";
import {
    didYouMeanView,
    matchFoodsByWords,
    NO_USUAL_SCHEDULE,
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
import {
    getAppCss,
    getAppJs,
    getAppV2Css,
    getAppV2Js,
    getEmbedWidgetHtml,
} from "../src/widgets.js";
import { buildFlagContext, initFlags } from "../src/flags.js";
import { evaluateViewerFlags } from "../src/viewer-flags.js";

const OUT = "./tmp/app-preview";
// PREVIEW_PORT lets two checkouts shoot at once.
const PORT = Number(process.env.PREVIEW_PORT ?? 4787);
const H = "hh-1";
const ME = {
    householdId: H,
    userId: "u1",
    role: "owner",
    displayName: "Ethan",
};
const SAM = { ...ME, userId: "u2", role: "member", displayName: "Sam" };

// The Stores screens of the design: Costco with six sections and five lines on
// the list, Trader Joe's, and a market with no sections yet.
const PREVIEW_STORE_SUMMARIES = [
    { id: "s-costco", name: "Costco", sectionCount: 6, lineCount: 5 },
    { id: "s-trader", name: "Trader Joe's", sectionCount: 5, lineCount: 3 },
    { id: "s-market", name: "Farmers market", sectionCount: 0, lineCount: 0 },
];
const PREVIEW_COSTCO_SECTIONS = [
    ["Produce", 0],
    ["Bakery", 0],
    ["Meat", 1],
    ["Dairy & eggs", 2],
    ["Pantry", 2],
    ["Frozen", 0],
].map(([name, lines], index) => ({
    section: {
        id: `sec-${index}`,
        householdId: H,
        storeId: "s-costco",
        name: String(name),
        sortOrder: index,
        hidden: false,
        isOther: false,
    },
    lines: Number(lines),
}));
function previewStoreView(chrome: unknown, over: Record<string, unknown> = {}) {
    return {
        chrome,
        store: {
            id: "s-costco",
            householdId: H,
            name: "Costco",
            sortOrder: 0,
        },
        sections: PREVIEW_COSTCO_SECTIONS.map((row) => row.section),
        sectionLineCounts: new Map(
            PREVIEW_COSTCO_SECTIONS.map((row) => [row.section.id, row.lines]),
        ),
        lineCount: 5,
        rules: [],
        moveTarget: {
            id: "s-trader",
            householdId: H,
            name: "Trader Joe's",
            sortOrder: 1,
        },
        canManage: true,
        ...over,
    };
}

const PREVIEW_STORES = [
    { id: "s-costco", householdId: H, name: "Costco", sortOrder: 0 },
];

// The widget templates carry a SAMPLE payload for standalone preview; reuse it
// so the nutrition page shows real cards.
const PREVIEW_TRENDS_GOALS: NutritionGoals = {
    user_id: "u1",
    daily_calories: 2200,
    daily_protein_g: 160,
    daily_carbs_g: 220,
    daily_fat_g: 70,
    daily_fiber_g: 30,
    daily_sugar_g: 45,
    daily_alcohol_g: 0,
    daily_caffeine_mg: 400,
    daily_water_ml: 2500,
    target_weight_g: null,
    updated_at: "2026-01-01T00:00:00Z",
};

function previewTrendsDays(today: string) {
    const days = [];
    for (let i = 364; i >= 0; i--) {
        const d = new Date(`${today}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - i);
        const date = d.toISOString().slice(0, 10);
        const logged = i % 9 !== 0 && i % 17 !== 0;
        const wobble = Math.sin(i / 5);
        days.push({
            date,
            calories: logged ? Math.round(2050 + wobble * 220) : 0,
            protein_g: logged ? Math.round(140 + wobble * 12) : 0,
            carbs_g: logged ? Math.round(210 + wobble * 20) : 0,
            fat_g: logged ? Math.round(68 + wobble * 8) : 0,
            logged,
        });
    }
    return days;
}

function previewTrendsPage(chrome: ReturnType<typeof previewChrome>) {
    const today = "2026-11-09";
    const data = buildPreviewTrendsPageData(
        chrome as Parameters<typeof buildPreviewTrendsPageData>[0],
        previewTrendsDays(today),
        goalsResolver(PREVIEW_TRENDS_GOALS, [
            {
                user_id: "u1",
                date: "2026-10-15",
                updated_at: "x",
                daily_calories: 1900,
                daily_protein_g: null,
                daily_carbs_g: null,
                daily_fat_g: null,
                daily_fiber_g: null,
                daily_sugar_g: null,
                daily_alcohol_g: null,
                daily_caffeine_mg: null,
                daily_water_ml: null,
            },
        ]),
        [
            { date: "2026-10-01", weight_g: 81_500 },
            { date: "2026-10-20", weight_g: 80_200 },
            { date: "2026-11-05", weight_g: 79_800 },
        ],
        today,
        "kg",
    );
    return renderTrendsV2Page(data);
}

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
        locations: [
            loc("l1", "Fridge", 0),
            loc("l3", "Freezer", 1),
            loc("l2", "Pantry", 2),
        ],
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
        id: "g-restock",
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

function previewGrocerySnapshot(): import("../src/domain/grocery.js").GrocerySnapshot {
    const legacy = groceryView(null) as {
        stores: {
            id: string;
            householdId: string;
            name: string;
            sortOrder: number;
            sections: {
                id: string;
                householdId: string;
                storeId: string;
                name: string;
                sortOrder: number;
                hidden: boolean;
                isOther: boolean;
                lines: ReturnType<typeof previewGroceryLines>;
            }[];
        }[];
    };
    return {
        stores: legacy.stores.map((store) => ({
            id: store.id,
            householdId: store.householdId,
            name: store.name,
            sortOrder: store.sortOrder,
        })),
        sections: legacy.stores.flatMap((store) =>
            store.sections.map((section) => ({
                id: section.id,
                householdId: section.householdId,
                storeId: section.storeId,
                name: section.name,
                sortOrder: section.sortOrder,
                hidden: section.hidden,
                isOther: section.isOther,
            })),
        ),
        lines: previewGroceryLines(),
    };
}

function previewGroceryLines() {
    type LegacyLine = {
        id: string;
        householdId: string;
        storeId: string;
        sectionId: string;
        kind: "food" | "supply";
        displayName: string;
        quantity: { amount: number; unit: string };
        foodId: string;
        checked: boolean;
    };
    const legacy = groceryView(null) as {
        stores: {
            sections: { lines: LegacyLine[] }[];
        }[];
    };
    return legacy.stores
        .flatMap((store) => store.sections.flatMap((section) => section.lines))
        .map((line) => ({
            ...line,
            source: "manual" as const,
            sourceFridgeItemId: null,
            note: null,
        }));
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
                                "/kitchen/usuals/f-eggs?from=%2Fkitchen%2Fgroceries",
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
    verification: "verified" as const,
    updatedAt: "2026-01-01T00:00:00.000Z",
};

const RECIPE_LIST_MACROS = {
    calories: 320,
    protein_g: 48,
    carbs_g: 62,
    fat_g: 22,
    fiber_g: null,
    sugar_g: null,
    alcohol_g: null,
    incomplete: false,
    incompleteReasons: [] as string[],
    gaps: [],
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
    verification: "verified" as const,
    updatedAt: "2026-01-01T00:00:00.000Z",
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
        saturatedFatG: null,
        alcoholG: null,
        caffeineMg: null,
        nutritionSource: null,
        offNutrientLevels: null,
        allergens: [],
        offSourceId: null,
        offQuality: null,
        genericFoodId: null,
        usualProductId: null,
        usualStoreId: null,
        usualAmount: null,
        ...NO_USUAL_SCHEDULE,
        createdBy: null,
        archivedAt: null,
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
        aliases: [],
        ...over,
    };
}

// Views are cast with `as never`: the fixtures only carry what renderers read.
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

/** The usuals page's own catalog: seven usuals, each with a product, in every
 *  restock state (weekly, every N weeks, monthly, when low only, paused). */
function previewUsualsCatalog() {
    const usualOf = (
        id: string,
        name: string,
        product: string,
        brand: string | null,
        store: string,
        amount: { amount: number; unit: string },
        plain: Record<string, unknown> = {},
    ) => [
        food(id, name, null, {
            usualProductId: `${id}-p`,
            usualStoreId: store,
            usualAmount: amount,
            ...plain,
        }),
        food(`${id}-p`, product, null, {
            genericFoodId: id,
            brand,
            usualStoreId: store,
            usualAmount: amount,
        }),
    ];
    const catalog = [
        ...usualOf(
            "u-milk",
            "Milk",
            "Kirkland 2% milk",
            null,
            "s-costco",
            { amount: 64, unit: "fl oz" },
            { restockSchedule: "weekly" },
        ),
        ...usualOf(
            "u-eggs",
            "Eggs",
            "Vital Farms large",
            null,
            "s-costco",
            { amount: 24, unit: "each" },
            {
                restockSchedule: "weekly",
                restockWhenLow: true,
            },
        ),
        ...usualOf(
            "u-yogurt",
            "Greek yogurt",
            "Fage Total 2%",
            null,
            "s-tj",
            { amount: 32, unit: "oz" },
            { restockSchedule: "weekly" },
        ),
        ...usualOf(
            "u-chicken",
            "Chicken thighs",
            "Kirkland boneless",
            null,
            "s-costco",
            { amount: 4, unit: "lb" },
            { restockSchedule: "every_n_weeks", restockEveryWeeks: 2 },
        ),
        ...usualOf(
            "u-bananas",
            "Bananas",
            "Bananas",
            null,
            "s-tj",
            { amount: 6, unit: "each" },
            { restockWhenLow: true, restockLowLevel: 2 },
        ),
        ...usualOf(
            "u-coffee",
            "Coffee beans",
            "Onyx Southern Weather",
            null,
            "s-tj",
            { amount: 1, unit: "each" },
            { restockSchedule: "monthly" },
        ),
        ...usualOf(
            "u-oil",
            "Olive oil",
            "California Olive Ranch",
            null,
            "s-costco",
            { amount: 1, unit: "each" },
            { restockSchedule: "monthly", restockPaused: true },
        ),
    ];
    return { catalog, usual: usualProductRows({ foods: catalog }) };
}

const PREVIEW_USUAL_STORES = [
    { id: "s-costco", householdId: H, name: "Costco", sortOrder: 0 },
    { id: "s-tj", householdId: H, name: "Trader Joe's", sortOrder: 1 },
];

function previewKitchenUsualsView(
    chrome: unknown,
    overrides: Partial<ReturnType<typeof buildPreviewKitchenUsualsView>> = {},
): ReturnType<typeof buildPreviewKitchenUsualsView> {
    const { catalog, usual } = previewUsualsCatalog();
    const stores = PREVIEW_USUAL_STORES;
    const storesById = new Map(stores.map((row) => [row.id, row]));
    const foodsById = new Map(
        catalog.map((row) => [
            row.id,
            { id: row.id, genericFoodId: row.genericFoodId },
        ]),
    );
    const rowMeta = new Map(
        usual.rows.map((row) => [
            row.food.id,
            kitchenUsualRowMeta(row, {
                storesById,
                groceryLines: [{ foodId: "u-yogurt", checked: false }],
                foodsById,
            }),
        ]),
    );
    return buildPreviewKitchenUsualsView({
        chrome: chrome as never,
        rows: usual.rows,
        stores,
        rowMeta,
        addable: usual.addable,
        restockDay: "Sundays",
        openGroceriesCount: previewGroceryLines().filter((l) => !l.checked)
            .length,
        ...overrides,
    });
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

// The viewer's flags, read the way the server reads them on a deploy without a
// Railway token: FOODABLE_FLAGS (for example ui-v2:all) switches the new shell on.
await initFlags();
const PREVIEW_FLAGS = evaluateViewerFlags(
    buildFlagContext({
        auth: { kind: "user", userId: ME.userId },
        member: ME as never,
    }),
);
const V2 = PREVIEW_FLAGS.uiV2;

// What viewerChromeWithAttention loads when ui-v2 is on.
const PREVIEW_IDENTITY = {
    viewerName: "Ethan Flow",
    viewerRole: "owner",
    householdName: "The Flow household",
    memberCount: 3,
} as const;

function previewChrome(theme: "light" | "dark") {
    return {
        ...viewerChromeFromProfile({ theme }),
        attention: previewAttention(),
        flags: PREVIEW_FLAGS,
        ...(V2 ? { identity: PREVIEW_IDENTITY } : {}),
    };
}

function previewAttention() {
    const notices = previewNotices();
    return {
        count: needsAttentionCount(notices),
        tabs: tabDotsFromNotices(notices),
    };
}

async function pages(theme: "light" | "dark"): Promise<Record<string, string>> {
    const chrome = previewChrome(theme);
    const { catalog, usual } = previewFoodCatalog();
    const catalogById = new Map(catalog.map((row) => [row.id, row]));
    const eggsPlain = catalog.find((row) => row.id === "f-eggs")!;
    const eggProducts = catalog
        .filter((row) => row.genericFoodId === "f-eggs")
        .sort((a, b) => a.name.localeCompare(b.name));
    const nutrition = V2
        ? renderTodayV2Page({
              ...buildPreviewTodayPageData(chrome as never, "2026-11-10"),
              view: buildPreviewTodayViewWithRail("2026-11-10"),
          })
        : await renderNutritionPage({
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
    const nutritionEditSheet = V2
        ? renderTodayV2Page({
              ...buildPreviewTodayPageData(chrome as never, "2026-11-10"),
              openEditMealId: "m3",
          })
        : "";
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
    const recipeView = {
        chrome: {
            ...chrome,
            householdPossibleDuplicates: 1,
        },
        foodDuplicateNotices: possibleDuplicateNoticesByFoodId(
            possibleDuplicateNotices(catalog, new Map(), new Set(), new Set()),
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
                catalog.map((f) => [f.id, { genericFoodId: f.genericFoodId }]),
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
    };
    return {
        nutrition,
        ...(V2 ? { "nutrition-edit-sheet": nutritionEditSheet } : {}),
        "nutrition-peer": nutritionPeer,
        fridge: (() => {
            const snap = fridgeView(chrome);
            return V2
                ? renderKitchenFridgeV2Page(
                      buildPreviewKitchenFridgeView(
                          chrome as never,
                          snap.today,
                          {
                              locations: snap.locations,
                              items: snap.items as import("../src/domain/fridge.js").FridgeItem[],
                              foodsById: new Map(
                                  [...snap.foodsById.entries()].map(
                                      ([id, row]) => [
                                          id,
                                          { ...row, usualAmount: null },
                                      ],
                                  ),
                              ),
                              freezeDefaultExpiry: defaultFreezeExpiry(
                                  snap.today,
                              ),
                              groceryLines: previewGroceryLines(),
                              groceryOverview:
                                  buildKitchenFridgeGroceryOverview(
                                      previewGrocerySnapshot(),
                                  ),
                          },
                      ),
                  )
                : renderFridgePage(snap as never);
        })(),
        ...(V2
            ? {
                  "kitchen-fridge-item": renderKitchenFridgeV2Page(
                      buildPreviewKitchenFridgeView(
                          chrome as never,
                          fridgeView(chrome).today,
                          {
                              locations: fridgeView(chrome).locations,
                              items: fridgeView(chrome)
                                  .items as import("../src/domain/fridge.js").FridgeItem[],
                              foodsById: new Map(
                                  [
                                      ...fridgeView(chrome).foodsById.entries(),
                                  ].map(([id, row]) => [
                                      id,
                                      { ...row, usualAmount: null },
                                  ]),
                              ),
                              openItemId: "i2",
                              freezeDefaultExpiry: defaultFreezeExpiry(
                                  fridgeView(chrome).today,
                              ),
                              groceryLines: previewGroceryLines(),
                              groceryOverview:
                                  buildKitchenFridgeGroceryOverview(
                                      previewGrocerySnapshot(),
                                  ),
                          },
                      ),
                  ),
              }
            : {}),
        grocery: V2
            ? renderKitchenGroceriesV2Page(
                  buildPreviewKitchenGroceriesView(chrome as never, {
                      ...((): Partial<
                          import("../src/web/pages/v2/kitchen-groceries.js").KitchenGroceriesV2View
                      > => {
                          const legacy = groceryView(chrome) as never as {
                              stores: import("../src/web/pages/grocery.js").GroceryStoreView[];
                              locations: { id: string; name: string }[];
                          };
                          const checked = legacy.stores.flatMap((s) =>
                              s.sections.flatMap((sec) =>
                                  sec.lines.filter((row) => row.checked),
                              ),
                          );
                          const open = legacy.stores.flatMap((s) =>
                              s.sections.flatMap((sec) =>
                                  sec.lines.filter((row) => !row.checked),
                              ),
                          );
                          return {
                              stores: legacy.stores.map((store) => ({
                                  ...store,
                                  sections: store.sections.map((section) => ({
                                      ...section,
                                      lines: section.lines,
                                  })),
                              })),
                              checkedLines: checked,
                              locations: legacy.locations,
                              openLineCount: open.length,
                              lineMeta: new Map(
                                  legacy.stores.flatMap((store) =>
                                      store.sections.flatMap((section) =>
                                          section.lines.map((row) => [
                                              row.id,
                                              {
                                                  plainFoodName:
                                                      row.usualProductName
                                                          ? "Eggs"
                                                          : null,
                                                  isUsual:
                                                      !!row.usualProductName,
                                                  allergenWarning: null,
                                                  storeName: store.name,
                                                  sectionName: section.name,
                                              },
                                          ]),
                                      ),
                                  ),
                              ),
                          };
                      })(),
                  }),
              )
            : renderGroceryPage(groceryView(chrome) as never),
        ...(V2
            ? {
                  "grocery-put-away": renderKitchenGroceriesV2Page(
                      buildPreviewKitchenGroceriesView(chrome as never, {
                          ...((): Partial<
                              import("../src/web/pages/v2/kitchen-groceries.js").KitchenGroceriesV2View
                          > => {
                              const legacy = groceryView(chrome) as never as {
                                  stores: import("../src/web/pages/grocery.js").GroceryStoreView[];
                                  locations: { id: string; name: string }[];
                              };
                              const checked = legacy.stores
                                  .flatMap((s) =>
                                      s.sections.flatMap((sec) => sec.lines),
                                  )
                                  .filter((row) => row.checked);
                              return {
                                  stores: legacy.stores.map((store) => ({
                                      ...store,
                                      sections: store.sections.map((s) => ({
                                          ...s,
                                          lines: [],
                                      })),
                                  })),
                                  checkedLines: checked.length
                                      ? checked
                                      : [
                                            {
                                                id: "g2",
                                                householdId: H,
                                                storeId: "s1",
                                                sectionId: "sec1",
                                                kind: "food" as const,
                                                displayName: "Spinach",
                                                quantity: {
                                                    amount: 300,
                                                    unit: "g",
                                                },
                                                foodId: "f-g2",
                                                checked: true,
                                                source: "manual" as const,
                                                sourceFridgeItemId: null,
                                                note: null,
                                                alreadyHave: null,
                                                lastLocationId: "l1",
                                            },
                                        ],
                                  locations: legacy.locations,
                                  openLineCount: 0,
                                  openPutAway: true,
                              };
                          })(),
                      }),
                  ),
                  "kitchen-usuals": renderKitchenUsualsV2Page(
                      previewKitchenUsualsView(chrome as never),
                  ),
                  "kitchen-usual-edit": renderKitchenUsualsV2Page(
                      previewKitchenUsualsView(chrome as never, {
                          openFoodId: "u-milk",
                      }),
                  ),
                  "kitchen-usual-restock": renderKitchenUsualsV2Page(
                      previewKitchenUsualsView(chrome as never, {
                          openFoodId: "u-eggs",
                          openRestock: true,
                      }),
                  ),
              }
            : {}),
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
        "grocery-did-you-mean": renderGroceryPage({
            ...(groceryView(chrome) as object),
            openModalId: "grocery-add-food-s1",
            didYouMean: didYouMeanSample(
                "grocery-add-food-s1",
                "/kitchen/groceries/lines",
                { kind: "food", store_id: "s1" },
            ),
        } as never),
        "fridge-did-you-mean": renderFridgePage({
            ...(fridgeView(chrome) as object),
            openModalId: "fridge-add-food-l1",
            didYouMean: didYouMeanSample(
                "fridge-add-food-l1",
                "/kitchen/fridge/items",
                { kind: "food", location_id: "l1" },
            ),
        } as never),
        recipes: V2
            ? renderRecipesListV2Page({
                  chrome,
                  query: "",
                  filter: "",
                  totalCount: 2,
                  cookableCount: 1,
                  cards: [
                      {
                          recipe: RECIPE,
                          flags: {
                              cookable: true,
                              highProtein: false,
                              quick: true,
                              missingCount: 0,
                              hasIngredients: true,
                          },
                          macrosPerPortion: RECIPE_LIST_MACROS,
                          missingNames: [],
                      },
                      {
                          recipe: RECIPE_TWO,
                          flags: {
                              cookable: false,
                              highProtein: false,
                              quick: true,
                              missingCount: 2,
                              hasIngredients: true,
                          },
                          macrosPerPortion: RECIPE_LIST_MACROS,
                          missingNames: ["Avocado", "Lime"],
                      },
                  ],
              })
            : renderRecipesPage({
                  chrome,
                  recipes: [RECIPE, RECIPE_TWO],
                  members: [ME, SAM],
                  viewerId: "u1",
              } as never),
        recipe: V2
            ? renderRecipeDetailV2Page({
                  chrome,
                  recipe: recipeView.recipe,
                  ingredients: recipeView.ingredients as never,
                  ingredientGroups: groupRecipeIngredientsByPlace(
                      recipeView.ingredients,
                      [
                          {
                              id: "ri-eggs",
                              householdId: H,
                              locationId: "l1",
                              kind: "food",
                              displayName: "Eggs",
                              quantity: { amount: 6, unit: "each" },
                              foodId: "f-eggs",
                              expiresOn: addUtcDays(utcTodayFromDate(), 4),
                          },
                          {
                              id: "ri-flour",
                              householdId: H,
                              locationId: "l2",
                              kind: "food",
                              displayName: "All-purpose flour",
                              quantity: { amount: 1, unit: "kg" },
                              foodId: "f2",
                              expiresOn: addUtcDays(utcTodayFromDate(), 30),
                          },
                          {
                              id: "ri-sugar",
                              householdId: H,
                              locationId: "l2",
                              kind: "food",
                              displayName: "Sugar",
                              quantity: { amount: 500, unit: "g" },
                              foodId: "f3",
                              expiresOn: addUtcDays(utcTodayFromDate(), 90),
                          },
                      ],
                      [
                          {
                              id: "l1",
                              householdId: H,
                              name: "Fridge",
                              sortOrder: 0,
                          },
                          {
                              id: "l2",
                              householdId: H,
                              name: "Pantry",
                              sortOrder: 1,
                          },
                      ],
                      new Map(
                          ["f-eggs", "f2", "f3", "f-buttermilk"].map((id) => [
                              id,
                              { id, genericFoodId: null },
                          ]),
                      ),
                  ),
                  macrosPerPortion: MACROS as never,
                  gapReasons: [],
                  members: recipeView.members,
                  viewerId: recipeView.viewerId,
                  portionCount: recipeView.portionCount,
              })
            : renderRecipeDetailPage(recipeView as never),
        "recipe-did-you-mean": renderRecipeDetailPage({
            ...recipeView,
            openModalId: "recipe-add-ingredient-r1",
            didYouMean: didYouMeanSample(
                "recipe-add-ingredient-r1",
                "/recipes/r1/ingredients",
                {},
            ),
        } as never),
        settings: V2
            ? renderSettingsHomeV2Page({
                  chrome,
                  displayName: "Ethan Flow",
                  email: "ethan@example.com",
              })
            : renderSettingsPage({
                  chrome,
                  flags: PREVIEW_FLAGS,
                  backHref: "/kitchen/fridge",
                  displayName: "Ethan",
                  timezone: "America/Los_Angeles",
                  weightUnit: "kg",
                  widgetsEnabled: true,
                  alcoholTrackingEnabled: false,
                  drinkUnit: "",
              } as never),
        ...(V2
            ? {
                  "settings-account": renderSettingsAccountV2Page({
                      chrome,
                      backHref: "/kitchen/fridge",
                      displayName: "Ethan Flow",
                      timezone: "America/Los_Angeles",
                      weightUnit: "kg",
                      widgetsEnabled: true,
                      alcoholTrackingEnabled: false,
                      drinkUnit: "",
                  }),
                  "settings-display": renderSettingsDisplayV2Page({
                      chrome,
                      storedTheme: null,
                  }),
                  "settings-household-v2": (() => {
                      const dupPairs = possibleDuplicates(
                          catalog.filter(
                              (f) => !f.archivedAt && !f.genericFoodId,
                          ),
                          new Map(),
                          new Set(),
                          new Set(),
                      );
                      return renderSettingsHouseholdV2Page({
                          chrome,
                          householdName: "The Flow household",
                          members: [ME, SAM] as never,
                          stores: PREVIEW_STORES,
                          isOwner: true,
                          canManage: true,
                          viewerUserId: ME.userId,
                          socialReaders:
                              EMPTY_HOUSEHOLD_PREFERENCES.socialReaders,
                          timezone: "America/Los_Angeles",
                          noticeResult: {
                              notices: previewNotices(),
                              dismissals: [],
                              subjectNames: new Map(),
                              subjectTimes: new Map(),
                              noticeFoods: new Map(),
                              catalogFoods: catalog,
                              aliasMap: new Map(),
                              barcodedIds: new Set(),
                              possibleDuplicatePairs: dupPairs,
                              recipesListPrefetch: {
                                  recipes: [],
                                  allIngredients: [],
                                  fridgeItems: [],
                                  foodsById: new Map(),
                              },
                          },
                          duplicatePairs: dupPairs,
                          refCounts: new Map(),
                          pluralsSameFood: true,
                      } as never);
                  })(),
                  "settings-household-v2-member": renderSettingsMemberV2Page({
                      chrome,
                      member: SAM as never,
                      viewer: ME as never,
                      todayHref: `/?member=${SAM.userId}`,
                  }),
                  "settings-goals": renderSettingsGoalsV2Page({
                      chrome,
                      goals: PREVIEW_TRENDS_GOALS,
                      goalDate: "2026-11-09",
                      weightUnit: "kg",
                      alcohol: "us",
                  }),
                  "settings-saved": renderSettingsSavedV2Page({
                      chrome,
                      foods: catalog.map((f) => ({
                          ...f,
                          aliases: [] as string[],
                      })),
                      recipes: [RECIPE, RECIPE_TWO],
                      searchQuery: "",
                  }),
                  "settings-export": renderSettingsExportV2Page({ chrome }),
                  "settings-stores": renderSettingsStoresV2Page({
                      chrome,
                      stores: PREVIEW_STORE_SUMMARIES,
                      defaultStoreId: "s-costco",
                      useUsualStore: true,
                      canManage: true,
                  }),
                  "settings-stores-reorder": renderSettingsStoresV2Page({
                      chrome,
                      stores: PREVIEW_STORE_SUMMARIES,
                      defaultStoreId: "s-costco",
                      useUsualStore: true,
                      canManage: true,
                      openModalId: STORES_REORDER_SHEET_ID,
                  }),
                  "settings-store": renderSettingsStoreV2Page(
                      previewStoreView(chrome) as never,
                  ),
                  "settings-store-delete": renderSettingsStoreV2Page(
                      previewStoreView(chrome, {
                          openModalId: STORE_DELETE_SHEET_ID,
                      }) as never,
                  ),
                  "settings-store-delete-empty": renderSettingsStoreV2Page(
                      previewStoreView(chrome, {
                          lineCount: 0,
                          openModalId: STORE_DELETE_SHEET_ID,
                      }) as never,
                  ),
              }
            : {}),
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
            from: "/kitchen/usuals",
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
        help: V2
            ? renderSettingsHelpV2Page({ chrome })
            : renderSettingsHelpPage({
                  chrome,
                  flags: PREVIEW_FLAGS,
                  backHref: "/kitchen/fridge",
              } as never),
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
            flags: PREVIEW_FLAGS,
            backHref: "/kitchen/fridge",
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
            flags: PREVIEW_FLAGS,
            backHref: "/kitchen/fridge",
            member: { ...SAM, role: "member" },
            preferences: {
                ...EMPTY_HOUSEHOLD_PREFERENCES,
                restock: { ...DEFAULT_RESTOCK, enabled: true },
            },
            ownerTimezoneLabel: "America/Los_Angeles",
        }),
        "settings-household-invites": renderHouseholdInvitesPage({
            chrome,
            flags: PREVIEW_FLAGS,
            backHref: "/",
            member: { ...ME, role: "owner" },
            invites: [
                {
                    id: "i-active",
                    householdId: H,
                    createdBy: ME.userId,
                    // Relative to the preview clock, so it always shows as active.
                    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
                    expiresAt: new Date(
                        Date.now() + 6 * 86_400_000,
                    ).toISOString(),
                    usedAt: null,
                    usedBy: null,
                },
                {
                    id: "i-used",
                    householdId: H,
                    createdBy: ME.userId,
                    createdAt: "2026-02-20T12:00:00.000Z",
                    expiresAt: "2026-02-27T12:00:00.000Z",
                    usedAt: "2026-02-22T09:00:00.000Z",
                    usedBy: SAM.userId,
                },
            ],
            createdCode: "preview-invite-code",
        }),
        "create-household": createHouseholdFormHtml(undefined, theme),
        forbidden: forbiddenDashboardHtml(theme),
        ...(V2
            ? {
                  "dev-gallery-v2": renderDevGalleryV2Page(chrome),
                  "nutrition-log-search": await logSheetPreview(theme, "empty"),
                  "nutrition-today-yesterday": renderTodayV2Page({
                      ...buildPreviewTodayPageData(
                          chrome as never,
                          "2026-11-10",
                      ),
                      view: buildPreviewTodayViewWithYesterdayHint(
                          "2026-11-10",
                      ),
                  }),
                  "nutrition-today-suggestions": renderTodayV2Page({
                      ...buildPreviewTodayPageData(
                          chrome as never,
                          "2026-11-10",
                      ),
                      view: buildPreviewTodayViewWithSuggestions("2026-11-10"),
                  }),
                  "kitchen-fridge-use-in": (() => {
                      const snap = fridgeView(chrome);
                      const items =
                          snap.items as import("../src/domain/fridge.js").FridgeItem[];
                      return renderKitchenFridgeV2Page(
                          buildPreviewKitchenFridgeView(
                              chrome as never,
                              snap.today,
                              {
                                  locations: snap.locations,
                                  items,
                                  foodsById: new Map(
                                      [...snap.foodsById.entries()].map(
                                          ([id, row]) => [
                                              id,
                                              { ...row, usualAmount: null },
                                          ],
                                      ),
                                  ),
                                  freezeDefaultExpiry: defaultFreezeExpiry(
                                      snap.today,
                                  ),
                                  // Every other expiring item has a recipe.
                                  useSoonUses: listExpiring(
                                      items,
                                      snap.today,
                                      7,
                                  )
                                      .filter((_, index) => index % 2 === 0)
                                      .map((item) => ({
                                          item: {
                                              id: item.id,
                                              displayName: item.displayName,
                                              expiresOn: item.expiresOn ?? "",
                                          },
                                          recipes: [
                                              {
                                                  recipeId: "r-salmon-rice",
                                                  name: "Salmon & rice",
                                                  incomplete: false,
                                              },
                                          ],
                                      })),
                                  groceryLines: previewGroceryLines(),
                                  groceryOverview:
                                      buildKitchenFridgeGroceryOverview(
                                          previewGrocerySnapshot(),
                                      ),
                              },
                          ),
                      );
                  })(),
                  "nutrition-log-results": await logSheetPreview(
                      theme,
                      "results",
                  ),
                  "nutrition-log-amount": await logSheetPreview(
                      theme,
                      "amount",
                  ),
                  "nutrition-log-quick-cal": await logSheetPreview(
                      theme,
                      "quick-cal",
                  ),
                  "nutrition-log-weigh-in": await logSheetPreview(
                      theme,
                      "weigh-in",
                  ),
                  "nutrition-log-scanner": await logScannerPreview(theme),
                  "trends-v2": previewTrendsPage(chrome),
                  "product-full": (() => {
                      const previewMembers = [
                          {
                              id: "u-ethan",
                              name: "Ethan",
                              allergens: [] as const,
                              dislikes: [],
                          },
                          {
                              id: "u-sam",
                              name: "Sam",
                              allergens: ["milk"] as const,
                              dislikes: [],
                          },
                          {
                              id: "u-jordan",
                              name: "Jordan",
                              allergens: ["tree_nut"] as const,
                              dislikes: [],
                          },
                      ];
                      const fullFood = food(
                          "f-product-full",
                          "Greek yogurt, plain 2%",
                          59,
                          {
                              brand: "Fage",
                              proteinG: 10,
                              carbsG: 4,
                              fatG: 0.4,
                              fiberG: 0,
                              sugarG: 4,
                              saturatedFatG: 2,
                              gramsPerEach: 170,
                              offQuality: {
                                  nutriscoreGrade: "a",
                                  novaGroup: 1,
                                  ecoscoreGrade: "b",
                                  additives: [],
                                  allergensTags: ["en:milk"],
                                  tracesTags: ["en:nuts"],
                                  ingredientsAnalysisTags: [],
                                  labelsTags: [],
                                  fetchedAt: "2026-01-01T00:00:00.000Z",
                              },
                          },
                      );
                      const score = buildProductScoreSection(
                          fullFood,
                          previewMemberCards(fullFood, previewMembers),
                      );
                      return renderProductV2Page(
                          buildPreviewProductPageView(chrome, fullFood, {
                              barcodes: ["5201054017463"],
                              stock: [
                                  {
                                      locationName: "Fridge",
                                      quantityLabel: "2",
                                  },
                              ],
                              score,
                          }),
                      );
                  })(),
                  "product-partial": (() => {
                      const partialFood = food(
                          "f-product-partial",
                          "Trail mix",
                          120,
                          {
                              proteinG: 8,
                              carbsG: 18,
                              fatG: 6,
                              sugarG: 10,
                              saturatedFatG: 2,
                              offQuality: {
                                  nutriscoreGrade: "c",
                                  novaGroup: 3,
                                  ecoscoreGrade: null,
                                  additives: null,
                                  allergensTags: [],
                                  tracesTags: null,
                                  ingredientsAnalysisTags: [],
                                  labelsTags: [],
                                  fetchedAt: "2026-01-01T00:00:00.000Z",
                              },
                          },
                      );
                      const score = buildProductScoreSection(
                          partialFood,
                          previewMemberCards(partialFood, [
                              {
                                  id: "u-ethan",
                                  name: "Ethan Flow",
                                  allergens: [],
                                  dislikes: [],
                              },
                          ]),
                      );
                      return renderProductV2Page(
                          buildPreviewProductPageView(chrome, partialFood, {
                              score,
                          }),
                      );
                  })(),
                  "product-none": renderProductV2Page(
                      buildPreviewProductPageView(
                          chrome,
                          food("f-product-none", "Spice blend", null),
                      ),
                  ),
                  "product-barcode-unknown": renderProductBarcodeUnknownPage({
                      chrome,
                      barcode: "9999999999999",
                      backHref: "/kitchen/fridge",
                  }),
              }
            : {}),
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

async function logScannerPreview(theme: "light" | "dark"): Promise<string> {
    const chrome = {
        ...previewChrome(theme),
        v2Timezone: "America/Los_Angeles",
    };
    return renderAppShell({
        ...chrome,
        title: "Nutrition",
        active: "nutrition" as const,
        body: pageHeader({ title: "Ethan Flow" }),
        v2LogSheet: {
            scannerOpenOnLoad: true,
            previewScanner: true,
            barcodeCamera: true,
        },
    });
}

async function logSheetPreview(
    theme: "light" | "dark",
    mode: "empty" | "results" | "amount" | "quick-cal" | "weigh-in",
): Promise<string> {
    const chrome = {
        ...previewChrome(theme),
        v2Timezone: "America/Los_Angeles",
    };
    const base = {
        ...chrome,
        title: "Nutrition",
        active: "nutrition" as const,
        body: pageHeader({ title: "Ethan Flow" }),
    };
    if (mode === "amount") {
        return renderAppShell({
            ...base,
            v2LogSheet: {
                amountOpenOnLoad: true,
                amount: {
                    name: "Chicken breast, grilled",
                    food_id: "f-chicken",
                    unit_hints: ["g", "each"],
                    amount: 150,
                    unit: "g",
                    meal_type: "dinner",
                    kcal_per_100g: 165,
                    protein_per_100g: 31,
                    carbs_per_100g: 0,
                    fat_per_100g: 3.3,
                },
            },
        });
    }
    if (mode === "quick-cal") {
        return renderAppShell({
            ...base,
            v2LogSheet: {
                quickCaloriesOpenOnLoad: true,
                quickCalories: {
                    calories: 350,
                    protein_g: 12,
                    carbs_g: 40,
                    fat_g: 14,
                    description: "Coffee & pastry",
                    meal_type: "snack",
                },
            },
        });
    }
    if (mode === "weigh-in") {
        return renderAppShell({
            ...base,
            v2LogSheet: {
                weighInOpenOnLoad: true,
                weighIn: {
                    weight: 182.4,
                    unit: "lb",
                    lastWeightG: 83007,
                    lastLoggedAt: "2026-11-04T19:00:00.000Z",
                },
            },
        });
    }
    return renderAppShell({
        ...base,
        v2LogSheet: {
            searchOpenOnLoad: true,
            previewSearch: mode,
            previewQuery: mode === "results" ? "chick" : "",
        },
    });
}

async function nutritionWithModal(
    theme: "light" | "dark",
    openModalId: string,
): Promise<string> {
    const chrome = previewChrome(theme);
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

function didYouMeanSample(
    modalId: string,
    action: string,
    fields: Record<string, string>,
) {
    return {
        modalId,
        action,
        view: didYouMeanView(
            {
                name: "chicken egg",
                candidates: [
                    {
                        food: {
                            id: "f-eggs",
                            name: "Eggs",
                            brand: null,
                        } as never,
                        why: "contains_words",
                    },
                ],
            },
            {
                food_name: "chicken egg",
                qty_amount: "6",
                qty_unit: "each",
                ...fields,
            },
        ),
    };
}

// The hashed asset hrefs the pages carry only exist once the bundles are built.
await Promise.all([getAppCss(), getAppJs(), getAppV2Css(), getAppV2Js()]);

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
        `grocery-did-you-mean-${theme}`,
        ...(V2
            ? [
                  `grocery-put-away-${theme}`,
                  `kitchen-usual-edit-${theme}`,
                  `kitchen-usual-restock-${theme}`,
                  `settings-stores-reorder-${theme}`,
                  `settings-store-delete-${theme}`,
                  `settings-store-delete-empty-${theme}`,
              ]
            : []),
        `fridge-did-you-mean-${theme}`,
        `recipe-did-you-mean-${theme}`,
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
        if (path === "/app-v2.css") {
            return new Response(await getAppV2Css(), {
                headers: { "content-type": "text/css; charset=utf-8" },
            });
        }
        if (path === "/app-v2.js") {
            return new Response(await getAppV2Js(), {
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
        if (V2) {
            // The new shell's two layouts: the phone nav at 390 wide, the
            // sidebar and top bar at the design's 1440. The dev gallery is
            // one long page — use a tall window so --shots capture every block.
            const shotBase = name.replace(/-(?:light|dark)$/, "");
            const galleryFullPage =
                shotBase.startsWith("dev-gallery-v2") ||
                shotBase.startsWith("trends-v2") ||
                shotBase === "nutrition" ||
                shotBase === "settings" ||
                shotBase === "settings-account" ||
                shotBase === "settings-display" ||
                shotBase === "settings-household-v2" ||
                shotBase === "settings-household-v2-member" ||
                shotBase === "settings-goals" ||
                shotBase === "settings-saved" ||
                shotBase === "settings-export" ||
                shotBase === "help" ||
                shotBase === "recipes" ||
                shotBase === "recipe";
            const v2Phone = galleryFullPage ? "390,5400" : "390,844";
            const v2Desktop = galleryFullPage ? "1440,5400" : "1440,960";
            await Bun.$`${chromium} --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --hide-scrollbars --force-prefers-reduced-motion --blink-settings=preferredColorScheme=${colorScheme} --user-data-dir=${dataDir} --window-size=${v2Phone} --virtual-time-budget=3000 --screenshot=${OUT}/${name}-v2-390.png http://localhost:${PORT}/${name}.html`.quiet();
            console.log(`${OUT}/${name}-v2-390.png`);
            await Bun.$`${chromium} --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --hide-scrollbars --force-prefers-reduced-motion --blink-settings=preferredColorScheme=${colorScheme} --user-data-dir=${dataDir} --window-size=${v2Desktop} --virtual-time-budget=3000 --screenshot=${OUT}/${name}-v2-1440.png http://localhost:${PORT}/${name}.html`.quiet();
            console.log(`${OUT}/${name}-v2-1440.png`);
        }
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
