/**
 * Renders every household-app page with fixture data, in light and dark, and
 * serves the result next to the real /app.css so the pages can be looked at
 * without a database. The widget equivalent is scripts/widget-harness.ts.
 *
 *   bun run preview:app            # writes tmp/app-preview/*.html, serves :4787
 *   bun run preview:app --shots    # also writes a 390px phone PNG (-390.png) and a
 *                                  # 1440px desktop PNG (-1440.png) per page, then exits
 *   bun run preview:app --shots --only=grocery,fridge   # only pages named like so
 *
 * --shots needs Chromium on PATH (google-chrome-stable, chromium, or
 * chromium-browser — not the PATH google-chrome wrapper, which pins the GUI
 * profile). One Chromium serves the whole run, driven over the DevTools
 * protocol with a private context per shot (scripts/app-preview-shots.ts). It
 * runs with reduced motion so the virtual-time budget does not freeze page
 * entrances half-done, a throwaway --user-data-dir, and an emulated
 * prefers-color-scheme so bare pages (OS theme) render light and dark as
 * different bytes.
 * The server never imports this file.
 */
import {
    colorSchemeOf,
    findChromium,
    DESKTOP_WIDTH,
    launchBrowser,
    layoutOf,
    MODAL_BUDGET_MS,
    PAGE_BUDGET_MS,
    PHONE_WIDTH,
    windowsFor,
} from "./app-preview-shots.js";
import {
    PREVIEW_NOW,
    pinBrowserClock,
    pinServerClock,
    pinTimeZone,
} from "./preview-clock.js";
import { utcTodayFromDate } from "../src/domain/stock.js";
import { groceryRestockNotices } from "../src/domain/restock.js";
import { renderShareViewPage } from "../src/web/pages/share-view.js";
import { renderRecipesListV2Page } from "../src/web/pages/v2/recipes-list.js";
import {
    buildWeekPlanView,
    PLAN_MISSING_SHEET_ID,
    planEditSheetId,
    withPlanEditDraft,
} from "../src/web/pages/v2/recipes-plan.js";
import { findMissingMentions } from "../src/domain/recipe-mentions.js";
import {
    groupRecipeIngredientsByPlace,
    renderRecipeDetailV2Page,
} from "../src/web/pages/v2/recipes-page.js";
import type { CookSheetView } from "../src/web/pages/v2/recipes-page-cook.js";
import { renderRecipeCompareV2Page } from "../src/web/pages/v2/recipes-page-compare.js";
import type { VersionsCompare } from "../src/domain/recipe-variants.js";
import {
    renderNotificationsPage,
    type NotificationsPageView,
} from "../src/web/pages/v2/notifications.js";
import type { NotificationRow } from "../src/domain/notifications.js";
import { renderSettingsNotificationsV2Page } from "../src/web/pages/v2/settings-notifications.js";
import { renderHouseholdInvitesPage } from "../src/web/pages/v2/settings-household-invites.js";
import { EMPTY_HOUSEHOLD_PREFERENCES } from "../src/household.js";
import {
    createHouseholdFormHtml,
    forbiddenDashboardHtml,
    notAllowedHtml,
    notFoundHtml,
} from "../src/web/loaders.js";
import { renderLoginPage } from "../src/oauth.js";
import { LOGIN_ERRORS } from "../src/copy/login.js";
import { resetSignupPolicyCache } from "../src/domain/signup.js";
import { renderDevGalleryV2Page } from "../src/web/pages/dev-gallery.js";
import {
    buildPreviewTrendsPageData,
    renderTrendsV2Page,
} from "../src/web/pages/v2/trends.js";
import {
    buildPreviewTodayPageData,
    buildPreviewTodayView,
    buildPreviewTodayViewWithSuggestions,
    buildPreviewTodayViewWithYesterdayHint,
    renderTodayV2Page,
} from "../src/web/pages/v2/today.js";
import {
    buildPreviewKitchenFridgeView,
    renderKitchenFridgeV2Page,
} from "../src/web/pages/v2/kitchen-fridge.js";
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
import { renderSettingsTimezoneV2Page } from "../src/web/pages/v2/settings-account-timezone.js";
import { renderSettingsUnitsV2Page } from "../src/web/pages/v2/settings-units.js";
import { renderSettingsNutrientsV2Page } from "../src/web/pages/v2/settings-nutrients.js";
import { renderSettingsHelpV2Page } from "../src/web/pages/v2/settings-help.js";
import { renderSettingsHouseholdV2Page } from "../src/web/pages/v2/settings-household.js";
import { renderSettingsRestockV2Page } from "../src/web/pages/v2/settings-restock.js";
import { renderSettingsReadersV2Page } from "../src/web/pages/v2/settings-readers.js";
import {
    renderSharedLinksPage,
    type SharedLinkRow,
} from "../src/web/pages/v2/settings-household-shared-links.js";
import {
    HOUSEHOLD_ROTATE_TOKEN_SHEET_ID,
    renderHouseholdTokenPage,
} from "../src/web/pages/v2/settings-household-token.js";
import { MEMBER_MAKE_OWNER_SHEET_ID } from "../src/web/pages/v2/settings-member.js";
import { renderShareCreatedPage } from "../src/web/pages/v2/share-sheet.js";
import { renderSettingsMemberV2Page } from "../src/web/pages/v2/settings-member.js";
import { renderSettingsGoalsV2Page } from "../src/web/pages/v2/settings-goals.js";
import { goalsDraftFrom } from "../src/web/pages/v2/settings-goals-form.js";
import { renderSettingsSavedV2Page } from "../src/web/pages/v2/settings-saved.js";
import {
    renderSettingsStoresV2Page,
    STORES_ADD_ID,
} from "../src/web/pages/v2/settings-stores.js";
import {
    renderSettingsStoreV2Page,
    STORE_ADD_SECTION_ID,
    STORE_DELETE_SHEET_ID,
} from "../src/web/pages/v2/settings-stores-detail.js";
import { renderSettingsAiV2Page } from "../src/web/pages/v2/settings-ai.js";
import {
    renderSettingsScoreHouseholdV2Page,
    renderSettingsScoreV2Page,
    type SettingsScoreV2View,
} from "../src/web/pages/v2/settings-score.js";
import { SCORE_PRESETS } from "../src/domain/product-score.js";
import { goalsResolver } from "../src/domain/insights.js";
import type { NutritionGoals } from "../src/db/nutrition.js";
import { pageHeader } from "../src/web/components/ui.js";
import { renderAppShell, viewerChromeFromProfile } from "../src/web/shell.js";
import {
    NO_USUAL_SCHEDULE,
    usualProductRows,
    type PossibleDuplicatePair,
} from "../src/domain/foods.js";
import {
    possibleDuplicateNotices,
    possibleDuplicateNoticesByFoodId,
} from "../src/domain/notices-for.js";
import {
    renderSettingsDuplicateCompareV2Page,
    renderSettingsDuplicatesV2Page,
} from "../src/web/pages/v2/settings-duplicates.js";
import {
    getAppCss,
    getAppJs,
    getAppV2Css,
    getAppV2Js,
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
const JORDAN = { ...SAM, userId: "u3", displayName: "Jordan" };
const RILEY = { ...SAM, userId: "u4", displayName: "Riley" };
const ALEX = { ...SAM, userId: "u5", displayName: "Alex" };
/** Settings › Household's Shared links: a recipe link that expires, the grocery
 *  list that never does, and a recipe link whose recipe was since deleted. */
const PREVIEW_SHARED_LINKS: SharedLinkRow[] = [
    {
        id: "00000000-0000-4000-8000-000000000001",
        kind: "recipe",
        recipeName: "Chicken alfredo",
        createdByName: "Ethan Flow",
        createdAt: "2026-11-10T18:00:00.000Z",
        expiresAt: "2026-12-12T18:00:00.000Z",
    },
    {
        id: "00000000-0000-4000-8000-000000000002",
        kind: "grocery_list",
        recipeName: null,
        createdByName: "Sam Flow",
        createdAt: "2026-11-02T09:30:00.000Z",
        expiresAt: null,
    },
    {
        id: "00000000-0000-4000-8000-000000000003",
        kind: "recipe",
        recipeName: null,
        createdByName: "Ethan Flow",
        createdAt: "2026-10-21T12:00:00.000Z",
        expiresAt: "2026-11-30T12:00:00.000Z",
    },
];

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

// The goals the Settings › Goals and Today previews show with a name, and the
// days that carry their own goals.
const PREVIEW_NAMED_GOALS: NutritionGoals = {
    ...PREVIEW_TRENDS_GOALS,
    daily_alcohol_g: 28,
    goal_name: "Recomp",
    goal_note: "maintenance minus 5%",
    goals_set_on: "2026-10-02",
};

// The apps the AI connections page lists: a named one used today, a named one
// last used days ago, one that was never used, and the tokens with no app.
/** The Product score page: an owner on the household's Balanced, as in the design. */
function previewScoreView(
    chrome: SettingsScoreV2View["chrome"],
    over: Partial<SettingsScoreV2View> = {},
): SettingsScoreV2View {
    return {
        chrome,
        preset: "balanced",
        weights: SCORE_PRESETS.balanced,
        followsHousehold: true,
        householdPresetLabel: "Balanced",
        canEditHousehold: true,
        warnTraces: true,
        compareGoals: true,
        allergensText: "Milk",
        allergensHref: "/settings/household/members/u-ethan",
        ...over,
    };
}

const PREVIEW_AI_NOW = new Date("2026-11-10T15:00:00.000Z");

/** The activity list: an undoable change, an undone one, one past its 24 hours. */
const PREVIEW_AI_MEMBER_ID = "0b6c4d2e-7a1f-4c3b-9e5d-2f8a6b1c3d4e";

const PREVIEW_AI_ACTIVITY = [
    {
        id: "a1000000-0000-4000-8000-000000000001",
        summary: "Cleared 20 grocery lines",
        connection: "Claude",
        memberId: PREVIEW_AI_MEMBER_ID,
        actor: { kind: "viewer" },
        when: "2 hours ago",
        createdAt: "2026-11-10T13:04:00.000Z",
        state: { kind: "undo" },
    },
    {
        id: "a1000000-0000-4000-8000-000000000002",
        summary: "Logged Chicken rice bowl",
        connection: "Grok CLI",
        memberId: PREVIEW_AI_MEMBER_ID,
        actor: { kind: "viewer" },
        when: "2 days ago",
        createdAt: "2026-11-08T18:30:00.000Z",
        state: { kind: "undo" },
    },
    {
        id: "a1000000-0000-4000-8000-000000000003",
        summary: "Deleted fridge item Greek yogurt",
        connection: "Grok CLI",
        memberId: PREVIEW_AI_MEMBER_ID,
        actor: { kind: "viewer" },
        when: "Yesterday",
        createdAt: "2026-11-09T18:30:00.000Z",
        state: { kind: "undone" },
    },
    {
        id: "a1000000-0000-4000-8000-000000000004",
        summary: "Removed Oat milk from the Usuals list",
        connection: "household token",
        memberId: null,
        actor: { kind: "household" },
        when: "3 days ago",
        createdAt: "2026-11-07T09:12:00.000Z",
        state: { kind: "expired" },
    },
] as const;

const PREVIEW_AI_CONNECTIONS = [
    {
        clientId: "7d3f6c2e-5b1a-4e8f-9a3d-1c2b3a4d5e6f",
        clientName: "Claude",
        firstConnectedAt: new Date("2026-10-03T12:00:00.000Z"),
        lastUsedAt: new Date("2026-11-10T08:00:00.000Z"),
    },
    {
        clientId: "2b1c0d9e-8f7a-4b6c-8d5e-4f3a2b1c0d9e",
        clientName: "Grok CLI",
        firstConnectedAt: new Date("2026-11-01T08:00:00.000Z"),
        lastUsedAt: new Date("2026-11-08T08:00:00.000Z"),
    },
    {
        clientId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
        clientName: "ChatGPT",
        firstConnectedAt: new Date("2026-11-09T18:30:00.000Z"),
        lastUsedAt: null,
    },
    {
        clientId: null,
        clientName: null,
        firstConnectedAt: new Date("2026-09-14T09:00:00.000Z"),
        lastUsedAt: new Date("2026-10-20T09:00:00.000Z"),
    },
];

const PREVIEW_GOAL_DAYS = [
    {
        user_id: "u1",
        date: "2026-11-14",
        daily_calories: 1800,
        daily_protein_g: 170,
        daily_carbs_g: null,
        daily_fat_g: null,
        daily_fiber_g: null,
        daily_sugar_g: null,
        daily_alcohol_g: null,
        daily_caffeine_mg: null,
        daily_water_ml: null,
        updated_at: "2026-11-01T00:00:00Z",
    },
    {
        user_id: "u1",
        date: "2026-11-21",
        daily_calories: 2600,
        daily_protein_g: null,
        daily_carbs_g: null,
        daily_fat_g: null,
        daily_fiber_g: null,
        daily_sugar_g: null,
        daily_alcohol_g: null,
        daily_caffeine_mg: null,
        daily_water_ml: 3000,
        updated_at: "2026-11-01T00:00:00Z",
    },
];

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

/** The full product screen; `viewer` is how its reader weights the score. */
function previewProductFull(
    chrome: ReturnType<typeof previewChrome>,
    viewer?: Parameters<typeof buildProductScoreSection>[2],
) {
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
    const fullFood = food("f-product-full", "Greek yogurt, plain 2%", 59, {
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
    });
    const score = buildProductScoreSection(
        fullFood,
        previewMemberCards(fullFood, previewMembers),
        viewer,
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
}

/** A product whose pack lists a serving in ml and whose OFF values are per 100 ml. */
function previewProductServing(chrome: ReturnType<typeof previewChrome>) {
    const halfAndHalf = food("f-product-serving", "Half & Half", 133.3, {
        brand: "Member's Mark",
        proteinG: 3.3,
        carbsG: 4.7,
        fatG: 10,
        sugarG: 4.7,
        saturatedFatG: 6.7,
        serving: { label: "1 portion (30 ml)", amount: 30, unit: "ml" },
        nutritionBasis: "100ml",
    });
    return renderProductV2Page(
        buildPreviewProductPageView(chrome, halfAndHalf, {
            barcodes: ["0193968379117"],
        }),
    );
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

/** This week for the new app's Today and Recipes: three dinners, some of it missing. */
/** A move to a day already past: the edit sheet of "pl2" re-opened with the reason. */
function previewMoveError() {
    const view = previewWeekPlan();
    return (
        withPlanEditDraft(view, {
            planId: "pl2",
            date: "2026-11-01",
            slot: "dinner",
            servings: 4,
            error: "Pick today or a later day.",
        }) ?? view
    );
}

const PREVIEW_VIEWER_ID = "preview-viewer";
const PREVIEW_SARAH_ID = "preview-sarah";

function previewWeekPlan(openSheet?: "missing" | "plan") {
    const today = "2026-11-10";
    const plan = (
        id: string,
        recipeId: string,
        date: string,
        servings: number,
    ) => ({
        id,
        householdId: H,
        recipeId,
        date,
        slot: "dinner" as const,
        servings,
        createdBy: null,
        createdAt: "2026-11-09T10:00:00.000Z",
        // Beef chili is a day of a weekly repeat; the other two are one-offs.
        ...(id === "pl2" ? { ruleId: "rl1" } : {}),
    });
    const grams = (amount: number) => ({ amount, unit: "g" });
    const view = buildWeekPlanView({
        today,
        plans: [
            plan("pl1", "pr-salmon", "2026-11-10", 2),
            plan("pl2", "pr-chili", "2026-11-11", 6),
            plan("pl3", "pr-bowl", "2026-11-12", 4),
        ],
        recipes: [
            {
                id: "pr-salmon",
                name: "Salmon, rice & spinach",
                yieldPortions: 2,
                ingredients: [
                    {
                        displayName: "Salmon",
                        foodId: "pf-salmon",
                        quantity: grams(400),
                    },
                    {
                        displayName: "Rice",
                        foodId: "pf-rice",
                        quantity: grams(300),
                    },
                    {
                        displayName: "Baby spinach",
                        foodId: "pf-spinach",
                        quantity: grams(200),
                    },
                ],
            },
            {
                id: "pr-chili",
                name: "Beef chili",
                yieldPortions: 6,
                ingredients: [
                    {
                        displayName: "Kidney beans",
                        foodId: "pf-beans",
                        quantity: grams(400),
                    },
                    {
                        displayName: "Beef mince",
                        foodId: "pf-beef",
                        quantity: grams(500),
                    },
                    {
                        displayName: "Cumin",
                        foodId: "pf-cumin",
                        quantity: null,
                    },
                ],
            },
            {
                id: "pr-bowl",
                name: "Chicken rice bowl",
                yieldPortions: 4,
                ingredients: [
                    {
                        displayName: "Chicken breast",
                        foodId: "pf-chicken",
                        quantity: grams(600),
                    },
                    {
                        displayName: "Avocado",
                        foodId: "pf-avocado",
                        quantity: { amount: 2, unit: "each" },
                    },
                ],
            },
        ],
        stock: [
            { foodId: "pf-salmon", quantity: grams(450) },
            { foodId: "pf-rice", quantity: grams(1000) },
            { foodId: "pf-spinach", quantity: grams(100) },
            { foodId: "pf-beef", quantity: grams(500) },
            { foodId: "pf-chicken", quantity: grams(300) },
            // Held by weight, and the avocado has no weight per piece: unknown.
            { foodId: "pf-avocado", quantity: grams(150) },
        ],
        foodsById: new Map(),
    });
    return {
        ...view,
        openSheet:
            openSheet === "missing"
                ? PLAN_MISSING_SHEET_ID
                : openSheet === "plan"
                  ? planEditSheetId("pl2")
                  : undefined,
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

/** Milk · Whole milk and Rice · Jasmine rice, with the design's use counts. */
function duplicatesFixture() {
    const milk = food("f-milk", "Milk", 60, { proteinG: 3.4 });
    const wholeMilk = food("f-whole-milk", "Whole milk", 64, { proteinG: 3.3 });
    const rice = food("f-rice", "Rice", 130);
    const jasmine = food("f-jasmine", "Jasmine rice", 130);
    return {
        pairs: [
            { subject: milk, related: wholeMilk, rule: "contains_words" },
            { subject: rice, related: jasmine, rule: "contains_words" },
        ] as never as PossibleDuplicatePair[],
        refCounts: new Map([
            [milk.id, 6],
            [wholeMilk.id, 2],
            [rice.id, 4],
            [jasmine.id, 1],
        ]),
    };
}

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
        serving: null,
        nutritionBasis: null,
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
        usualAddedAt: null,
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
    // Foods that are not usuals yet: what the Add a usual sheet lists.
    for (const [id, name] of [
        ["f-butter", "Butter"],
        ["f-sourdough", "Sourdough bread"],
        ["f-spinach", "Spinach"],
    ] as const) {
        catalog.push(food(id, name, null));
    }
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
                lowFoodIds: new Set(["u-eggs"]),
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

// The viewer's flags, read the way the server reads them on a deploy without a
// Railway token: FOODABLE_FLAGS switches flagged features on (for example
// FOODABLE_FLAGS=mcp-share-links:all to see the Share buttons and sheets).
await initFlags();
const PREVIEW_FLAGS = evaluateViewerFlags(
    buildFlagContext({
        auth: { kind: "user", userId: ME.userId },
        member: ME as never,
    }),
);

// What viewerChromeWithAttention loads for the shell.
const PREVIEW_IDENTITY = {
    viewerName: "Ethan Flow",
    viewerRole: "owner",
    householdName: "The Flow household",
    memberCount: 3,
} as const;

function previewChrome(theme: "light" | "dark") {
    return {
        ...viewerChromeFromProfile({ theme }),
        // The preview shows the Share buttons and sheets although
        // mcp-share-links is off on this deploy.
        flags: { ...PREVIEW_FLAGS, mcpShareLinks: true },
        identity: PREVIEW_IDENTITY,
        // The bell shows its dot, as in the design's frames.
        notificationsUnread: true,
    };
}

function previewNotificationRow(
    over: Partial<NotificationRow> & Pick<NotificationRow, "id">,
): NotificationRow {
    return {
        householdId: H,
        recipientUserId: ME.userId,
        kind: "food_expiring",
        bucket: "household",
        source: "condition",
        noticeKey: over.id,
        subjectKind: "fridge_item",
        subjectId: "fi-1",
        actorUserId: null,
        payload: {},
        createdAt: "2026-11-10T08:00:00.000Z",
        readAt: null,
        snoozedUntil: null,
        snoozedBy: null,
        dismissedAt: null,
        dismissedBy: null,
        resolvedAt: null,
        ...over,
    };
}

/** FigCraft Screens › Notifications: four open rows today and one snoozed. */
function previewNotificationsView(
    chrome: ReturnType<typeof previewChrome>,
    over: Partial<NotificationsPageView> = {},
): NotificationsPageView {
    const today = [
        previewNotificationRow({
            id: "n-yogurt",
            payload: {
                code: "fridge.expiring",
                params: {
                    name: "Greek yogurt",
                    amount: 1,
                    unit: "each",
                    expiresOn: "2026-11-11",
                    daysLeft: 1,
                    onGroceryList: "no",
                },
                related: [],
            },
        }),
        previewNotificationRow({
            id: "n-weigh",
            kind: "weigh_in_due",
            bucket: "personal",
            subjectKind: "member",
            subjectId: ME.userId,
            payload: {
                code: "nutrition.weigh_in_due",
                params: { name: "Ethan", days: 8 },
                related: [],
            },
        }),
        previewNotificationRow({
            id: "n-milk",
            kind: "running_low",
            subjectKind: "food",
            subjectId: "f-milk",
            payload: {
                code: "grocery.running_low",
                params: { name: "Milk", reason: "usually bought weekly" },
                related: [],
            },
        }),
        previewNotificationRow({
            id: "n-chili",
            kind: "recipe_changes",
            source: "event",
            subjectKind: "recipe",
            subjectId: "r-chili",
            actorUserId: PREVIEW_SARAH_ID,
            createdAt: "2026-11-10T10:00:00.000Z",
            payload: { recipeName: "Beef chili" },
        }),
    ];
    const snoozed = [
        previewNotificationRow({
            id: "n-spinach",
            snoozedUntil: "2026-11-11T09:00:00.000Z",
            payload: {
                code: "fridge.expiring",
                params: {
                    name: "Spinach",
                    amount: 1,
                    unit: "bag",
                    expiresOn: "2026-11-12",
                    daysLeft: 2,
                    onGroceryList: "no",
                },
                related: [],
            },
        }),
    ];
    return {
        chrome: chrome as never,
        inbox: { unread: today.length, today, earlier: [], snoozed },
        bucket: "all",
        canDismissEveryone: false,
        timezone: "UTC",
        now: new Date("2026-11-10T12:00:00.000Z"),
        memberNames: new Map([[PREVIEW_SARAH_ID, "Sarah"]]),
        ...over,
    };
}

/** One of each event the household writes, for the inbox's event wording. */
function previewEventRows(): NotificationRow[] {
    const base = {
        source: "event" as const,
        actorUserId: PREVIEW_SARAH_ID,
        subjectKind: "recipe",
        subjectId: "r-chili",
    };
    return [
        previewNotificationRow({
            ...base,
            id: "n-planned",
            kind: "week_plan_changes",
            createdAt: "2026-11-10T11:40:00.000Z",
            payload: {
                recipeName: "Beef chili",
                date: "2026-11-11",
                slot: "dinner",
                change: "planned",
            },
        }),
        previewNotificationRow({
            ...base,
            id: "n-moved",
            kind: "week_plan_changes",
            createdAt: "2026-11-10T10:00:00.000Z",
            payload: {
                recipeName: "Beef chili",
                date: "2026-11-13",
                slot: "dinner",
                change: "moved",
                fromDate: "2026-11-11",
                fromSlot: "dinner",
            },
        }),
        previewNotificationRow({
            ...base,
            id: "n-unplanned",
            kind: "week_plan_changes",
            createdAt: "2026-11-09T18:00:00.000Z",
            payload: {
                recipeName: "Beef chili",
                date: "2026-11-12",
                slot: "dinner",
                change: "unplanned",
            },
        }),
        previewNotificationRow({
            ...base,
            id: "n-usual",
            kind: "new_usuals",
            subjectKind: "food",
            subjectId: "f-eggs",
            createdAt: "2026-11-07T09:00:00.000Z",
            payload: { foodName: "Eggs", productName: "Large Eggs" },
        }),
        previewNotificationRow({
            ...base,
            id: "n-removed-by-gone",
            kind: "recipe_changes",
            actorUserId: null,
            createdAt: "2026-11-01T09:00:00.000Z",
            payload: { recipeName: "Lentil soup" },
        }),
    ];
}

/** The first row's menu, open (the page script does this on a tap). */
function withFirstMenuOpen(html: string): string {
    return html
        .replace(
            'data-fd-menu-trigger="" aria-haspopup="menu" aria-expanded="false"',
            'data-fd-menu-trigger="" aria-haspopup="menu" aria-expanded="true"',
        )
        .replace(
            /(<div class="fd-menu__panel" role="menu"[^>]*?) hidden>/,
            "$1>",
        );
}

/** The Detail bar's ⋯ and its desktop header twin open (the first two menus on the page). */
function withBarMenusOpen(html: string): string {
    return withFirstMenuOpen(withFirstMenuOpen(html));
}

/** Every ⋯ menu open: a Household page draws its menu in the phone's Detail bar and in the desktop header. */
function withEveryMenuOpen(html: string): string {
    return html
        .replaceAll(
            'data-fd-menu-trigger aria-haspopup="menu" aria-expanded="false"',
            'data-fd-menu-trigger aria-haspopup="menu" aria-expanded="true"',
        )
        .replaceAll(
            'data-fd-menu-trigger="" aria-haspopup="menu" aria-expanded="false"',
            'data-fd-menu-trigger="" aria-haspopup="menu" aria-expanded="true"',
        )
        .replaceAll(
            /(<div class="fd-menu__panel" role="menu"[^>]*?) hidden>/g,
            "$1>",
        );
}

/** The first pull-down on a row open (its trigger is the row, so it has no empty attribute value). */
function withFirstRowMenuOpen(html: string): string {
    return html
        .replace(
            'data-fd-menu-trigger aria-haspopup="menu" aria-expanded="false"',
            'data-fd-menu-trigger aria-haspopup="menu" aria-expanded="true"',
        )
        .replace(
            /(<div class="fd-menu__panel" role="menu"[^>]*?) hidden>/,
            "$1>",
        );
}

/** Only the nth ⋯ menu on a Settings page open (0 is the first, the Detail bar's when it has one). */
function withMenuOpen(html: string, nth: number): string {
    let at = html.indexOf("data-fd-settings-page");
    for (let i = 0; i <= nth; i++) {
        at = html.indexOf('data-fd-menu-trigger=""', at + 1);
        if (at < 0) return html;
    }
    const hidden = html.indexOf(" hidden>", at);
    if (hidden < 0) return html;
    return (
        html.slice(0, at) +
        html
            .slice(at, hidden)
            .replace('aria-expanded="false"', 'aria-expanded="true"') +
        ">" +
        html.slice(hidden + " hidden>".length)
    );
}

/**
 * The OAuth login template filled as the server fills it, one state of the
 * design's Sign in frames. The template is `public/login.html`, which
 * `bun run gen:all` writes; the page has no saved theme, so it follows the
 * colour scheme the shot emulates.
 */
async function loginPreview(
    state: "default" | "invite" | "connect" | "error",
): Promise<string> {
    const before = process.env.FOODABLE_SIGNUP_POLICY;
    process.env.FOODABLE_SIGNUP_POLICY =
        state === "invite" ? "invite" : "closed";
    resetSignupPolicyCache();
    try {
        return await renderLoginPage(
            "preview-session",
            {
                state: "preview",
                redirectUri: "https://claude.ai/api/mcp/auth_callback",
                clientId: "preview-client",
                purpose: state === "connect" ? "mcp" : "site",
            },
            state === "error" ? LOGIN_ERRORS.invalidCredentials : undefined,
        );
    } finally {
        if (before === undefined) delete process.env.FOODABLE_SIGNUP_POLICY;
        else process.env.FOODABLE_SIGNUP_POLICY = before;
        resetSignupPolicyCache();
    }
}

async function pages(theme: "light" | "dark"): Promise<Record<string, string>> {
    const chrome = previewChrome(theme);
    const { catalog, usual } = previewFoodCatalog();
    const nutrition = renderTodayV2Page({
        ...buildPreviewTodayPageData(chrome as never, "2026-11-10"),
        view: buildPreviewTodayView("2026-11-10"),
        plan: previewWeekPlan(),
    });
    const nutritionEditSheet = renderTodayV2Page({
        ...buildPreviewTodayPageData(chrome as never, "2026-11-10"),
        openEditMealId: "m3",
    });
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
    // The cook sheet: a pantry that covers most of a loaf and falls short on
    // buttermilk, so the warning row is shot too.
    const cookSheet: CookSheetView = {
        recipeId: "r1",
        recipeName: "Banana bread",
        servings: 10,
        yieldPortions: 10,
        preview: {
            totalPortions: 10,
            lines: [
                {
                    foodId: "f-eggs",
                    displayName: "Eggs",
                    fromItemId: "ri-eggs",
                    unit: "each",
                    before: 6,
                    after: 3,
                },
                {
                    foodId: "f2",
                    displayName: "All-purpose flour",
                    fromItemId: "ri-flour",
                    unit: "g",
                    before: 500,
                    after: 300,
                },
                {
                    foodId: "f3",
                    displayName: "Sugar",
                    fromItemId: "ri-sugar",
                    unit: "g",
                    before: 500,
                    after: 400,
                },
            ],
            movements: [],
            shortfalls: [
                {
                    foodId: "f-buttermilk",
                    displayName: "Buttermilk",
                    amount: 200,
                    unit: "ml",
                    unknownFactor: false,
                },
            ],
            unmeasured: [{ foodId: null, displayName: "Salt" }],
        },
        slot: "dinner",
        viewerName: "Ethan",
        places: new Map([
            ["ri-eggs", "Fridge"],
            ["ri-flour", "Pantry"],
            ["ri-sugar", "Pantry"],
        ]),
        submitKey: "preview",
    };
    const settingsHouseholdV2 = (
        // Undefined is `mcp-share-links` off: no Shared links row.
        sharedLinks: SharedLinkRow[] | undefined,
        openModalId?: string,
    ) => {
        return renderSettingsHouseholdV2Page({
            chrome,
            householdName: "The Flow household",
            members: [ME, SAM, JORDAN, RILEY, ALEX] as never,
            storeCount: PREVIEW_STORES.length,
            isOwner: true,
            canManage: true,
            canInvite: true,
            viewerUserId: ME.userId,
            socialReaders: { tiktok: true, facebook: false },
            location: "Denver, CO",
            householdTimezone: "America/Denver",
            effectiveTimezone: "America/Denver",
            restock: {
                enabled: true,
                weekday: 0,
                time: "09:00",
                lastRunOn: "2026-11-08",
                lastRunAdded: 3,
            },
            openModalId,
            sharedLinks,
        } as never);
    };
    const settingsMemberV2 = (openModalId?: string) =>
        renderSettingsMemberV2Page({
            openModalId,
            chrome,
            member: SAM as never,
            viewer: ME as never,
            todayHref: `/?member=${SAM.userId}`,
            manage: { role: true, transfer: true, remove: true },
            lastSeen: new Date("2026-11-12T16:20:00Z"),
            now: PREVIEW_NOW,
            timezone: "America/Los_Angeles",
        });
    const recipeV2 = (
        cook: CookSheetView,
        planOpen = false,
        shareOpen = false,
        // `mcp-share-links` off leaves the Share item and its sheet out.
        shareOn = true,
    ) =>
        renderRecipeDetailV2Page({
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
            favourite: true,
            cook,
            plan: {
                recipeId: recipeView.recipe.id,
                recipeName: recipeView.recipe.name,
                yieldPortions: recipeView.recipe.yieldPortions,
                today: "2026-11-10",
                date: "2026-11-11",
                slot: "dinner",
                servings: recipeView.recipe.yieldPortions,
                open: planOpen,
            },
            ...(shareOn ? { share: { open: shareOpen } } : {}),
        });
    // An imported Pad See Ew whose ingredient list never lists the egg its
    // fourth step scrambles: the warning card with Add and Dismiss.
    const padSeeEw = (
        // An import nobody has saved: the draft bar in place of Cook and Plan.
        draft?: Parameters<typeof renderRecipeDetailV2Page>[0]["draft"],
        error?: string,
    ) => {
        const instructions = [
            "Soak the rice noodles in warm water until pliable, then drain.",
            "Whisk the soy sauces, oyster sauce, sugar and white pepper into a sauce.",
            "Sear the chicken in a hot wok until golden, then add the garlic and the Chinese broccoli stems.",
            "Push the noodles to one side, pour in the lightly beaten egg and scramble 30-45 seconds.",
            "Toss everything with the sauce until the noodles char at the edges.",
            "Fold in the broccoli leaves and serve hot.",
        ].join("\n");
        const lines: [string, number, string][] = [
            ["Wide rice noodles", 7, "oz"],
            ["Dark soy sauce", 1, "tbsp"],
            ["Light soy sauce", 1, "tbsp"],
            ["Chicken thigh", 6, "oz"],
            ["Chinese broccoli", 2, "cup"],
            ["Garlic", 3, "each"],
            ["Oyster sauce", 1, "tbsp"],
            ["Sugar", 1, "tsp"],
            ["White pepper", 1, "tsp"],
            ["Vegetable oil", 2, "tbsp"],
        ];
        const ingredients = lines.map(([displayName, amount, unit], i) => ({
            id: `pse${i}`,
            recipeId: "r1",
            foodId: `f-pse${i}`,
            displayName,
            quantity: { amount, unit },
            note: null,
            sortOrder: i,
            perPortionAmount: amount / 2,
            personAmount: amount / 2,
        }));
        const recipe = {
            ...RECIPE,
            name: "Simple Pad See Ew",
            yieldPortions: 2,
            instructions,
            sourceUrl: "https://www.slowfoodmama.com/simple-pad-see-ew",
            prepMinutes: 15,
            cookMinutes: 10,
        };
        return renderRecipeDetailV2Page({
            chrome,
            recipe,
            ingredients: ingredients as never,
            ingredientGroups: groupRecipeIngredientsByPlace(
                ingredients,
                ingredients.map((ing, i) => ({
                    id: `fi-pse${i}`,
                    householdId: H,
                    locationId: "l2",
                    kind: "food" as const,
                    displayName: ing.displayName,
                    quantity: ing.quantity,
                    foodId: ing.foodId,
                    expiresOn: null,
                })),
                [{ id: "l2", householdId: H, name: "Pantry", sortOrder: 0 }],
                new Map(
                    ingredients.map((ing) => [
                        ing.foodId,
                        { id: ing.foodId, genericFoodId: null },
                    ]),
                ),
            ),
            macrosPerPortion: draft
                ? ({
                      ...MACROS,
                      calories: null,
                      protein_g: null,
                      carbs_g: null,
                      fat_g: null,
                      incomplete: true,
                  } as never)
                : ({ ...MACROS, incomplete: false } as never),
            gapReasons: draft ? ["Counts 1 of 10 ingredients"] : [],
            ...(draft ? { draft } : {}),
            ...(error ? { error } : {}),
            mentions: findMissingMentions({
                instructions,
                ingredients: ingredients.map((ing) => ({
                    name: ing.displayName,
                })),
                vocabulary: [],
            }),
            ...(draft
                ? {}
                : { cook: { ...cookSheet, recipeName: recipe.name } }),
        });
    };
    // Whose version of Chicken alfredo, as the versions frames draw it: Ethan's
    // own (one change from the base), the pull-down open, and the admin's
    // Compare versions with a person's ⋯ open. A script opens the menu after
    // load, as a person would.
    const alfredoVersions = (steps?: string) => {
        const line = (
            id: string,
            displayName: string,
            amount: number,
            unit: string,
            versionNote?: string,
        ) => ({
            id,
            recipeId: "r1",
            foodId: `f-${id}`,
            displayName,
            quantity: { amount, unit },
            note: null,
            sortOrder: 0,
            perPortionAmount: amount / 4,
            personAmount: amount / 4,
            ...(versionNote ? { versionNote } : {}),
        });
        const ingredients = [
            line("fet", "Fettuccine", 8, "oz"),
            line("chk", "Chicken breast", 8, "oz", "Yours · base 6 oz"),
            line("crm", "Heavy cream", 1, "cup"),
            line("par", "Parmesan", 0.5, "cup"),
            line("gar", "Garlic", 2, "each"),
            {
                ...line("slt", "Salt", 0, "g"),
                quantity: null,
                note: "to taste",
            },
        ];
        const places: Record<string, string> = {
            fet: "l2",
            chk: "l1",
            crm: "l1",
            par: "l1",
            gar: "l2",
            slt: "l2",
        };
        const html = renderRecipeDetailV2Page({
            chrome,
            recipe: {
                ...RECIPE,
                name: "Chicken alfredo",
                yieldPortions: 4,
                instructions:
                    "Boil the fettuccine until al dente, 10 minutes\nSear the chicken 6 minutes a side, then slice\nMelt butter with garlic, add cream and parmesan",
                sourceUrl: "https://www.seriouseats.com/chicken-alfredo",
                prepMinutes: 10,
                cookMinutes: 20,
            },
            ingredients: ingredients as never,
            ingredientGroups: groupRecipeIngredientsByPlace(
                ingredients as never,
                ingredients.map((ing) => ({
                    id: `fi-${ing.id}`,
                    householdId: H,
                    locationId: places[ing.id]!,
                    kind: "food" as const,
                    displayName: ing.displayName,
                    quantity: ing.quantity ?? { amount: 1, unit: "each" },
                    foodId: ing.foodId,
                    expiresOn: null,
                })),
                [
                    { id: "l1", householdId: H, name: "Fridge", sortOrder: 0 },
                    { id: "l2", householdId: H, name: "Pantry", sortOrder: 1 },
                ],
                new Map(
                    ingredients.map((ing) => [
                        ing.foodId,
                        { id: ing.foodId, genericFoodId: null },
                    ]),
                ),
            ),
            macrosPerPortion: {
                ...MACROS,
                calories: 690,
                protein_g: 42,
                carbs_g: 58,
                fat_g: 31,
                incomplete: true,
            } as never,
            gapReasons: ["Counts 5 of 6 ingredients"],
            favourite: false,
            cook: { ...cookSheet, recipeName: "Chicken alfredo" },
            plan: {
                recipeId: "r1",
                recipeName: "Chicken alfredo",
                yieldPortions: 4,
                today: "2026-11-10",
                date: "2026-11-11",
                slot: "dinner",
                servings: 4,
            },
            versions: {
                viewerId: "u-ethan",
                viewing: "u-ethan",
                viewingName: "Ethan",
                changeCount: 1,
                people: [
                    { userId: "u-ethan", name: "Ethan" },
                    { userId: "u-sarah", name: "Sarah" },
                    { userId: "u-mia", name: "Mia" },
                    { userId: "u-leo", name: "Leo" },
                ],
                canCompare: true,
            },
        });
        return steps
            ? html.replace(
                  "</body>",
                  () =>
                      `<script>addEventListener("load",()=>setTimeout(()=>{${steps}},400))</script></body>`,
              )
            : html;
    };
    const compareVersionsPage = (steps?: string) => {
        const oz = (amount: number) => ({ amount, unit: "oz" });
        const thighs = {
            ingredientId: "i-thighs",
            displayName: "Chicken thighs",
            base: oz(6),
        };
        const compare: VersionsCompare = {
            recipeId: "r1",
            base: [
                {
                    ingredientId: "i-thighs",
                    displayName: "Chicken thighs",
                    foodId: "f-thighs",
                    quantity: oz(6),
                },
                {
                    ingredientId: "i-fish",
                    displayName: "Fish sauce",
                    foodId: "f-fish",
                    quantity: { amount: 1, unit: "tbsp" },
                },
            ],
            versions: [
                {
                    userId: "u-ethan",
                    overrideCount: 1,
                    differences: [
                        {
                            kind: "amount",
                            ref: "i-thighs",
                            rowKey: "a@1",
                            ...thighs,
                            version: oz(8),
                        },
                    ],
                },
                {
                    userId: "u-mia",
                    overrideCount: 3,
                    differences: [
                        {
                            kind: "amount",
                            ref: "i-thighs",
                            rowKey: "b@1",
                            ...thighs,
                            version: oz(10),
                        },
                        {
                            kind: "removed",
                            ref: "i-fish",
                            rowKey: "c@1",
                            ingredientId: "i-fish",
                            displayName: "Fish sauce",
                            base: { amount: 1, unit: "tbsp" },
                        },
                        {
                            kind: "added",
                            ref: "d",
                            rowKey: "d@1",
                            ingredientId: null,
                            displayName: "Chili flakes",
                            foodId: "f-chili",
                            version: { amount: 1, unit: "tsp" },
                        },
                    ],
                },
            ],
            usingBase: ["u-sarah", "u-leo"],
        };
        const html = renderRecipeCompareV2Page({
            chrome,
            recipeId: "r1",
            recipeName: "Simple Pad See Ew",
            compare,
            people: [
                { userId: "u-ethan", name: "Ethan", resetRowKeys: ["a@1"] },
                { userId: "u-sarah", name: "Sarah" },
                {
                    userId: "u-mia",
                    name: "Mia",
                    resetRowKeys: ["b@1", "c@1", "d@1"],
                },
                { userId: "u-leo", name: "Leo" },
            ],
        });
        return steps
            ? html.replace(
                  "</body>",
                  () =>
                      `<script>addEventListener("load",()=>setTimeout(()=>{${steps}},400))</script></body>`,
              )
            : html;
    };
    const recipesListV2 = (
        extra: Partial<Parameters<typeof renderRecipesListV2Page>[0]> = {},
    ) =>
        renderRecipesListV2Page({
            chrome,
            sharedImportEnabled: true,
            query: "",
            filters: [],
            totalCount: 2,
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
                    favourite: true,
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
            ...extra,
        });
    const recipesDriven = (
        steps: string,
        extra: Partial<Parameters<typeof renderRecipesListV2Page>[0]> = {},
    ) =>
        recipesListV2(extra).replace(
            "</body>",
            () =>
                `<script>addEventListener("load",()=>setTimeout(()=>{${steps}},400))</script></body>`,
        );
    /** A page with steps a person would take run once it has loaded (a menu opened, a day picked). */
    const driven = (html: string, steps: string) =>
        html.replace(
            "</body>",
            () =>
                `<script>addEventListener("load",()=>setTimeout(()=>{${steps}},400))</script></body>`,
        );
    // The Plan sheet's row for a field, as page code: the selector is built in
    // the page, so no value is spliced into the script.
    const planRowJs = `const planRow = (name) => '#fd-recipe-plan-sheet [data-anchor="row"]:has([data-fd-menu-field][name="' + name + '"])';`;
    const fridgePage = (
        extra: Partial<
            Parameters<typeof buildPreviewKitchenFridgeView>[2]
        > = {},
    ) => {
        const snap = fridgeView(chrome);
        return renderKitchenFridgeV2Page(
            buildPreviewKitchenFridgeView(chrome as never, snap.today, {
                locations: snap.locations,
                items: snap.items as import("../src/domain/fridge.js").FridgeItem[],
                foodsById: new Map(
                    [...snap.foodsById.entries()].map(([id, row]) => [
                        id,
                        { ...row, usualAmount: null },
                    ]),
                ),
                freezeDefaultExpiry: defaultFreezeExpiry(snap.today),
                scores: new Map([
                    ["f-i3", 74],
                    ["f-i5", 52],
                    ["f-milk", 81],
                ]),
                usuals: [
                    {
                        foodId: "p-milk",
                        kind: "food",
                        name: "Milk",
                        subtitle: "Kirkland 2% · 1 gal",
                        amount: 1,
                        unit: "gal",
                    },
                    {
                        foodId: "f-i3",
                        kind: "food",
                        name: "Eggs",
                        subtitle: "Vital Farms Large · 24",
                        amount: 24,
                        unit: "each",
                    },
                    {
                        foodId: "p-yogurt",
                        kind: "food",
                        name: "Greek Yogurt",
                        subtitle: "Fage Total 2% · 1 tub",
                        amount: 1,
                        unit: "tub",
                    },
                    {
                        foodId: "p-chicken",
                        kind: "food",
                        name: "Chicken Thighs",
                        subtitle: "Kirkland Boneless · 4 lb",
                        amount: 4,
                        unit: "lb",
                    },
                ],
                ...extra,
            }),
        );
    };
    // The Fridge's own states are driven by a script after load, as a person
    // would: Select with two rows picked, a row's menu open.
    const fridgeDriven = (
        steps: string,
        extra: Parameters<typeof fridgePage>[0] = {},
    ) =>
        fridgePage(extra).replace(
            "</body>",
            () =>
                `<script>addEventListener("load",()=>setTimeout(()=>{${steps}},400))</script></body>`,
        );
    const groceryPage = (
        extra: Partial<
            import("../src/web/pages/v2/kitchen-groceries.js").KitchenGroceriesV2View
        > = {},
    ) => {
        const legacy = groceryView(chrome) as never as {
            stores: import("../src/web/pages/v2/kitchen-groceries.js").GroceryStoreView[];
            locations: { id: string; name: string }[];
        };
        const lines = legacy.stores.flatMap((st) =>
            st.sections.flatMap((sec) => sec.lines),
        );
        const names = new Map(
            legacy.stores.flatMap((st) =>
                st.sections.flatMap((sec) =>
                    sec.lines.map(
                        (row) => [row.id, [st.name, sec.name]] as const,
                    ),
                ),
            ),
        );
        const meta = (
            id: string,
        ): import("../src/web/pages/v2/kitchen-groceries.js").KitchenGroceriesLineMeta => ({
            plainFoodName: id === "g3" ? "Eggs" : null,
            isUsual: id === "g3" || id === "g4",
            allergenWarning: id === "g4" ? "Contains milk — Sam." : null,
            storeName: names.get(id)?.[0] ?? "",
            sectionName: names.get(id)?.[1] ?? "",
            productScore: id === "g3" ? 74 : null,
        });
        return renderKitchenGroceriesV2Page(
            buildPreviewKitchenGroceriesView(chrome as never, {
                shareEnabled: true,
                stores: legacy.stores,
                locations: legacy.locations,
                checkedLines: lines.filter((row) => row.checked),
                openLineCount: lines.filter((row) => !row.checked).length,
                lineMeta: new Map(lines.map((row) => [row.id, meta(row.id)])),
                usuals: [
                    {
                        foodId: "p-yogurt",
                        kind: "food",
                        name: "Greek yogurt",
                        subtitle: "Fage Total 2% · 1 tub",
                        amount: 1,
                        unit: "tub",
                        lowBelow: "2",
                    },
                    {
                        foodId: "f-bananas",
                        kind: "food",
                        name: "Coffee beans",
                        subtitle: "1 bag",
                        amount: 1,
                        unit: "bag",
                    },
                    {
                        foodId: "f-towels",
                        kind: "supply",
                        name: "Paper towels",
                        subtitle: "1 each",
                        amount: 1,
                        unit: "each",
                    },
                ],
                ...extra,
            }),
        );
    };
    // A Groceries state driven by a script after load, as a person would.
    const groceryDriven = (
        steps: string,
        extra: Parameters<typeof groceryPage>[0] = {},
    ) =>
        groceryPage(extra).replace(
            "</body>",
            () =>
                `<script>addEventListener("load",()=>setTimeout(()=>{${steps}},400))</script></body>`,
        );
    // A Usuals state driven by a script after load, as a person would.
    const usualsDriven = (
        steps: string,
        extra: Parameters<typeof previewKitchenUsualsView>[1] = {},
    ) =>
        renderKitchenUsualsV2Page(
            previewKitchenUsualsView(chrome as never, extra),
        ).replace(
            "</body>",
            () =>
                `<script>addEventListener("load",()=>setTimeout(()=>{${steps}},400))</script></body>`,
        );
    return {
        nutrition,
        "nutrition-edit-sheet": nutritionEditSheet,
        fridge: fridgePage(),
        // Cheese (frame 393340): amount, the four actions, Kept in and Expires.
        "kitchen-fridge-item": fridgePage({ openItemId: "i5" }),
        // Add to fridge (frame 393163): the usuals first.
        "kitchen-fridge-add": fridgePage({ openAdd: true }),
        // A row's menu (frame 392957).
        "kitchen-fridge-menu": fridgeDriven(
            `document.querySelector("#fd-fridge-row-i3 .fd-menu [data-fd-menu-trigger]").click()`,
        ),
        // Select mode (frame 400622) and its Discard asking in place (401198).
        "kitchen-fridge-select": fridgeDriven(
            `document.querySelector('[data-fd-select-toggle="fridge"]').click();for(const id of ["i2","i1"])document.querySelector("#fd-fridge-row-"+id+" .fd-item-row__face").click()`,
        ),
        "kitchen-fridge-discard": fridgeDriven(
            `document.querySelector('[data-fd-select-toggle="fridge"]').click();for(const id of ["i2","i1"])document.querySelector("#fd-fridge-row-"+id+" .fd-item-row__face").click();for(const b of document.querySelectorAll("[data-fd-select-ask]"))b.click()`,
        ),
        // Groceries (frames 394511, 398022): rows by section, the checked
        // ones above the dock, then each state the design draws.
        grocery: groceryPage(),
        // mcp-share-links off: no Share list in the tab row's ⋯.
        "grocery-share-off": groceryPage({ shareEnabled: false }),
        // The store filter pull-down (394677) with both stores ticked.
        "grocery-filter": groceryDriven(
            `[...document.querySelectorAll('[data-anchor="filter"] [data-fd-menu-trigger]')].find((b)=>b.offsetParent).click()`,
            { selectedStoreIds: ["s1", "s2"] },
        ),
        // The tab row's ⋯: Share list, Select, Clear checked.
        "grocery-menu": groceryDriven(
            `[...document.querySelectorAll('[aria-label="Groceries options"][data-fd-menu-trigger]')].find((b)=>b.offsetParent).click()`,
        ),
        // A row's ⋯: Check off, Edit, Delete.
        "grocery-row-menu": groceryDriven(
            `document.querySelector("#fd-grocery-row-g1 .fd-menu [data-fd-menu-trigger]").click()`,
        ),
        // Add to list (394843): the low usuals as chips, then the rest.
        "grocery-add": groceryPage({ openAdd: true }),
        // A line's sheet (398664): amount, store, section, note.
        "grocery-line": groceryPage({ openLineId: "g4" }),
        // Select mode with two rows picked.
        "grocery-select": groceryDriven(
            `document.querySelector('[data-fd-select-toggle="groceries"]').click();for(const id of ["g1","g4"])document.querySelector("#fd-grocery-row-"+id+" .fd-item-row__face").click()`,
        ),
        // Put away (395390) the checked lines.
        "grocery-put-away": groceryPage({ openPutAway: true }),
        // A noted line asks how much of it came home, in its own unit.
        "grocery-put-away-noted": groceryPage({
            openPutAway: true,
            checkedLines: (
                groceryView(chrome) as never as {
                    stores: import("../src/web/pages/v2/kitchen-groceries.js").GroceryStoreView[];
                }
            ).stores
                .flatMap((st) => st.sections.flatMap((sec) => sec.lines))
                .filter((row) => row.checked)
                .map((row, i) =>
                    i === 0
                        ? {
                              ...row,
                              note: "to taste",
                              quantity: { amount: 2, unit: "bunch" },
                          }
                        : row,
                ),
        }),
        // The Add sheet's did-you-mean question (shared buttons, an Item row
        // with a Toggle) and the line sheet's Section pull-down open.
        "grocery-did-you-mean": groceryPage({
            openAdd: true,
            didYouMean: {
                modalId: "grocery-add-food-",
                action: "/kitchen/groceries/lines",
                view: {
                    name: "yogurt",
                    heading: "Did you mean one of these?",
                    candidates: [
                        { foodId: "p-yogurt", label: "Greek yogurt" },
                        { foodId: "f-yogurt", label: "Plain yogurt" },
                    ],
                    aliasLabel:
                        "Remember yogurt as another name for the food you pick",
                    newFoodLabel: "Add yogurt as a new food",
                    hiddenFields: { kind: "food", food_name: "yogurt" },
                },
            },
        }),
        "grocery-line-section-menu": groceryDriven(
            `document.querySelector("#fd-grocery-line-g4 .fd-list-group > li:nth-child(2) [data-fd-menu-trigger]").click()`,
            { openLineId: "g4" },
        ),
        // Usuals (frames 395819, 397013): Eggs run low and say so in the
        // warning tone, Greek yogurt is on the list.
        "kitchen-usuals": renderKitchenUsualsV2Page(
            previewKitchenUsualsView(chrome as never),
        ),
        // The store filter pull-down (frame 395819's filter) with both stores ticked.
        "kitchen-usuals-filter": usualsDriven(
            `[...document.querySelectorAll('[data-anchor="filter"] [data-fd-menu-trigger]')].find((b)=>b.offsetParent).click()`,
            { selectedStoreIds: ["s-costco", "s-tj"] },
        ),
        // The tab row's ⋯ (Select), then picking and the Remove asking in place.
        "kitchen-usuals-menu": usualsDriven(
            `[...document.querySelectorAll('[aria-label="Usuals options"][data-fd-menu-trigger]')].find((b)=>b.offsetParent).click()`,
        ),
        "kitchen-usuals-select": usualsDriven(
            `document.querySelector('[data-fd-select-toggle="usuals"]').click();for(const id of ["u-oil","u-coffee"])document.querySelector("#fd-usual-row-"+id+" .fd-item-row__face").click()`,
        ),
        "kitchen-usuals-remove": usualsDriven(
            `document.querySelector('[data-fd-select-toggle="usuals"]').click();for(const id of ["u-oil","u-coffee"])document.querySelector("#fd-usual-row-"+id+" .fd-item-row__face").click();for(const b of document.querySelectorAll("[data-fd-select-ask]"))b.click()`,
        ),
        // Edit a usual (frame 395980) and the Restock sheet (397529).
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
        // The sheet's header ⋯ with Remove asking in place.
        "kitchen-usual-remove": usualsDriven(
            `document.querySelector("#fd-usual-u-milk .fd-sheet__menu [data-fd-menu-trigger]").click();document.querySelector("#fd-usual-u-milk [data-fd-menu-arm]").click()`,
            { openFoodId: "u-milk" },
        ),
        // The product picker (frame 400123), over the usual's sheet.
        "kitchen-usual-picker": usualsDriven(
            `document.getElementById("fd-usual-u-milk-product").showModal()`,
            { openFoodId: "u-milk" },
        ),
        // The unit pull-down inside the sheet.
        "kitchen-usual-unit-menu": usualsDriven(
            `document.querySelector('#fd-usual-u-milk [data-fd-menu-field][name="usual_unit"]').closest("[data-fd-menu]").querySelector("[data-fd-menu-trigger]").click()`,
            { openFoodId: "u-milk" },
        ),
        // Add a usual (frame 399135), Type it (399655), and with no camera.
        "kitchen-usuals-add": renderKitchenUsualsV2Page(
            previewKitchenUsualsView(chrome as never, {
                add: { tab: "search" },
            }),
        ),
        "kitchen-usuals-add-type": renderKitchenUsualsV2Page(
            previewKitchenUsualsView(chrome as never, {
                add: {
                    tab: "type",
                    type: {
                        values: {
                            name: "Oat milk",
                            basis: "per_100ml",
                            calories: "46",
                            protein_g: "1",
                            carbs_g: "6.7",
                            fat_g: "1.5",
                            usual_amount: "64",
                            usual_unit: "fl oz",
                        },
                    },
                },
            }),
        ),
        "kitchen-usuals-add-camera-off": renderKitchenUsualsV2Page(
            previewKitchenUsualsView(
                {
                    ...(chrome as object),
                    flags: {
                        ...(chrome as { flags: object }).flags,
                        barcodeCamera: false,
                    },
                } as never,
                { add: { tab: "search" } },
            ),
        ),
        // Eggs run low (frame 396429): the row says so under its name.
        "kitchen-fridge-low": fridgePage({
            // Two eggs left, below the level of 6, as in the frame.
            items: fridgeView(chrome).items.map((row) =>
                row.id === "i3"
                    ? { ...row, quantity: { amount: 2, unit: "each" } }
                    : row,
            ) as import("../src/domain/fridge.js").FridgeItem[],
            lowStock: new Map([["f-i3", "6"]]),
        }),
        // The week's planned recipes and the missing link (frame 404251).
        "recipes-plan-notices": recipesListV2({ week: previewWeekPlan() }),
        recipes: recipesListV2({ week: previewWeekPlan() }),
        // Empty search (401811), typing with two filters on (401943), the
        // filter pull-down open (402075) and a pasted link (402324).
        "recipes-empty-search": recipesListV2({ totalCount: 42 }),
        "recipes-typing": recipesListV2({
            query: "chick",
            filters: ["cookable", "protein"],
            totalCount: 42,
        }),
        "recipes-filter-menu": recipesDriven(
            `document.querySelector('[data-anchor="filter"] [data-fd-menu-trigger]').click()`,
            {
                query: "chick",
                filters: ["cookable", "protein"],
                totalCount: 42,
            },
        ),
        "recipes-link": recipesListV2({
            query: "https://www.instagram.com/reel/C8xYz1AbCdE/",
            totalCount: 42,
        }),
        // mcp-share-links off: no import from another Foodable.
        "recipes-share-off": recipesListV2({
            week: previewWeekPlan(),
            sharedImportEnabled: false,
        }),
        // A row's ⋯: Plan.
        "recipes-row-menu": recipesDriven(
            `document.querySelector(".fd-recipes-row .fd-menu [data-fd-menu-trigger]").click()`,
            { week: previewWeekPlan() },
        ),
        "recipes-favourites": renderRecipesListV2Page({
            chrome,
            query: "",
            filters: ["favourites"],
            totalCount: 3,
            week: previewWeekPlan(),
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
                    favourite: true,
                },
                {
                    recipe: {
                        ...RECIPE_TWO,
                        id: "r3",
                        name: "Overnight oats",
                        yieldPortions: 1,
                        prepMinutes: 5,
                        cookMinutes: 0,
                    },
                    flags: {
                        cookable: false,
                        highProtein: false,
                        quick: true,
                        missingCount: 1,
                        hasIngredients: true,
                    },
                    macrosPerPortion: RECIPE_LIST_MACROS,
                    missingNames: ["Rolled oats"],
                    favourite: true,
                },
            ],
        }),
        recipe: recipeV2(cookSheet),
        // Whose version (frames 402459, 402619, 402803): the page on Ethan's
        // version, the pull-down open, Compare versions and Mia's ⋯ open.
        "recipe-version": alfredoVersions(),
        "recipe-version-menu": alfredoVersions(
            `document.querySelector(".fd-recipe-version [data-fd-menu-trigger]").click()`,
        ),
        "recipe-compare": compareVersionsPage(),
        "recipe-compare-menu": compareVersionsPage(
            `document.querySelectorAll(".fd-recipe-compare .fd-page-layout__column:last-child .fd-item-row [data-fd-menu-trigger]")[1].click()`,
        ),
        "recipe-mentions": padSeeEw(),
        // The draft bar: Save and what is left, in place of Cook and Plan.
        "recipe-draft": padSeeEw({
            problems: ["Resolve every ingredient line.", "Add the steps."],
            expiresOn: "2026-12-01",
            canSave: true,
            canDiscard: true,
            leaveGuard: false,
        }),
        // The leave guard, on the importer's first landing: a link out asks Discard this recipe?
        "recipe-draft-leave": driven(
            padSeeEw({
                problems: ["Resolve every ingredient line.", "Add the steps."],
                expiresOn: "2026-12-01",
                canSave: true,
                canDiscard: true,
                leaveGuard: true,
            }),
            `document.querySelector('.fd-detail-bar a[href="/recipes"]').click()`,
        ),
        "recipe-draft-refused": padSeeEw(
            {
                problems: ["Add the steps."],
                expiresOn: "2026-12-01",
                canSave: true,
                canDiscard: true,
                leaveGuard: false,
            },
            "Not saved yet. Fix what is listed below, then save it again.",
        ),
        // `mcp-share-links` off: no Share item in the Detail bar's ⋯.
        "recipe-no-share": recipeV2(cookSheet, false, false, false),
        "recipe-cook": recipeV2({ ...cookSheet, open: true }),
        "recipe-plan": recipeV2(cookSheet, true),
        // The Plan sheet's Starts open on its month picker, Meal and Repeat
        // open as pull-downs, and Repeat on Pick days with three weekdays on.
        "recipe-plan-starts": driven(
            recipeV2(cookSheet, true),
            `document.querySelector("#fd-recipe-plan-sheet [data-fd-month-toggle]").click()`,
        ),
        "recipe-plan-meal": driven(
            recipeV2(cookSheet, true),
            `${planRowJs} document.querySelector(planRow("slot") + " [data-fd-menu-trigger]").click()`,
        ),
        "recipe-plan-repeat": driven(
            recipeV2(cookSheet, true),
            `${planRowJs} document.querySelector(planRow("repeat") + " [data-fd-menu-trigger]").click()`,
        ),
        "recipe-plan-days": driven(
            recipeV2(cookSheet, true),
            `${planRowJs} document.querySelector(planRow("repeat") + " [data-fd-menu-trigger]").click();
document.querySelector(planRow("repeat") + ' [data-fd-menu-value="days"]').click();
for (const day of ["1", "3", "5"]) document.querySelector('#fd-recipe-plan-sheet [data-fd-plan-days] [data-value="' + day + '"]').click();`,
        ),
        "recipe-share": recipeV2(cookSheet, false, true),
        // The one screen that shows a new share link's address.
        "share-link-made": renderShareCreatedPage({
            chrome,
            url: "https://foodable.example.com/s/Qk3vZ8mXr1TnY0aLw5uHc9DfJ2bEeSgPiVoN7xRzA4M",
            what: "recipe",
            name: recipeView.recipe.name,
            expiresAt: "2026-12-12T10:00:00.000Z",
            backHref: "/recipes/r1",
            active: "recipes",
        }),
        "share-link-made-list": renderShareCreatedPage({
            chrome,
            url: "https://foodable.example.com/s/Qk3vZ8mXr1TnY0aLw5uHc9DfJ2bEeSgPiVoN7xRzA4M",
            what: "grocery list",
            name: null,
            expiresAt: null,
            backHref: "/kitchen/groceries",
            active: "grocery",
        }),
        "recipes-import-open": recipesListV2({
            week: previewWeekPlan(),
            sharedImport: {},
        }),
        "recipes-import-error": recipesListV2({
            week: previewWeekPlan(),
            sharedImport: {
                error: "That share link doesn't work any more",
                reason: "Revoked, expired, or not a recipe link",
                input: "https://kitchen.example/s/q7Wm4xTz2LpR9vYb1KcN8dFhJ3sGaE5uOiXt6ZeBnVw",
            },
        }),
        "recipes-plan-pick": recipesListV2({
            week: previewWeekPlan(),
            planDate: "2026-11-14",
        }),
        "recipes-plan-missing": recipesListV2({
            week: previewWeekPlan("missing"),
        }),
        "recipes-plan-edit": recipesListV2({
            week: previewWeekPlan("plan"),
        }),
        "recipes-plan-move-error": recipesListV2({
            week: previewMoveError(),
        }),
        "nutrition-plan-move-error": renderTodayV2Page({
            ...buildPreviewTodayPageData(chrome as never, "2026-11-10"),
            view: buildPreviewTodayView("2026-11-10"),
            plan: previewMoveError(),
        }),
        "nutrition-plan-missing": renderTodayV2Page({
            ...buildPreviewTodayPageData(chrome as never, "2026-11-10"),
            view: buildPreviewTodayView("2026-11-10"),
            plan: previewWeekPlan("missing"),
        }),
        "nutrition-plan-edit": renderTodayV2Page({
            ...buildPreviewTodayPageData(chrome as never, "2026-11-10"),
            view: buildPreviewTodayView("2026-11-10"),
            plan: previewWeekPlan("plan"),
        }),
        settings: renderSettingsHomeV2Page({
            chrome,
            displayName: "Ethan Flow",
            email: "ethan@example.com",
        }),
        "settings-account": renderSettingsAccountV2Page({
            chrome,
            backHref: "/kitchen/fridge",
            displayName: "Ethan Flow",
            email: "ethan@example.com",
            timezone: "America/Los_Angeles",
        }),
        "settings-account-photo": renderSettingsAccountV2Page({
            chrome,
            backHref: "/kitchen/fridge",
            displayName: "Ethan Flow",
            email: "ethan@example.com",
            timezone: "America/Los_Angeles",
            photo: { userId: "u-ethan", version: new Date(1700000000000) },
        }),
        "settings-timezone": renderSettingsTimezoneV2Page({
            chrome,
            backHref: "/kitchen/fridge",
            timezone: "America/Los_Angeles",
            now: new Date("2026-11-10T12:00:00Z"),
        }),
        "settings-units": renderSettingsUnitsV2Page({
            chrome,
            weightUnit: "lb",
            drinkUnit: "us",
        }),
        // The Weight row's pull-down open.
        "settings-units-menu": withFirstRowMenuOpen(
            renderSettingsUnitsV2Page({
                chrome,
                weightUnit: "lb",
                drinkUnit: "us",
            }),
        ),
        // Sugar and alcohol off, the rest on.
        "settings-nutrients": renderSettingsNutrientsV2Page({
            chrome,
            hidden: ["sugar"],
            alcoholTrackingEnabled: false,
        }),
        "settings-household-v2": settingsHouseholdV2(PREVIEW_SHARED_LINKS),
        "settings-household-v2-empty": settingsHouseholdV2([]),
        // mcp-share-links off: the Household page has no Shared links row.
        "settings-household-v2-links-off": settingsHouseholdV2(undefined),
        "settings-household-v2-rotate": settingsHouseholdV2(
            PREVIEW_SHARED_LINKS,
            HOUSEHOLD_ROTATE_TOKEN_SHEET_ID,
        ),
        "settings-household-v2-token": renderHouseholdTokenPage({
            chrome,
            token: "nt_hh_7Qm2xR9vYb1KcN8dFhJ3sGaE5uOi",
        }),
        "settings-shared-links": renderSharedLinksPage({
            chrome,
            links: PREVIEW_SHARED_LINKS,
            timezone: "America/Los_Angeles",
            now: PREVIEW_NOW,
        }),
        "settings-shared-links-menu": withEveryMenuOpen(
            renderSharedLinksPage({
                chrome,
                links: PREVIEW_SHARED_LINKS,
                timezone: "America/Los_Angeles",
                now: PREVIEW_NOW,
            }),
        ),
        "settings-shared-links-empty": renderSharedLinksPage({
            chrome,
            links: [],
            now: PREVIEW_NOW,
        }),
        "settings-household-v2-add-member": settingsHouseholdV2(
            [],
            "fd-household-add-member",
        ),
        "settings-household-v2-timezone": renderSettingsTimezoneV2Page({
            chrome,
            household: true,
            backHref: "/settings/household",
            timezone: "",
            now: new Date("2026-11-10T12:00:00Z"),
        }),
        "settings-household-v2-member": settingsMemberV2(),
        "settings-household-v2-member-owner": settingsMemberV2(
            MEMBER_MAKE_OWNER_SHEET_ID,
        ),
        "settings-household-v2-member-menu":
            withEveryMenuOpen(settingsMemberV2()),
        "settings-goals": renderSettingsGoalsV2Page({
            chrome,
            goals: PREVIEW_NAMED_GOALS,
            today: "2026-11-10",
            weightUnit: "kg",
            alcohol: "us",
            days: PREVIEW_GOAL_DAYS,
        }),
        "settings-goals-empty": renderSettingsGoalsV2Page({
            chrome,
            goals: null,
            today: "2026-11-10",
            weightUnit: "kg",
            alcohol: null,
            days: [],
        }),
        // A refused field save: the typed text stays, with the error beside it.
        "settings-goals-error": renderSettingsGoalsV2Page({
            chrome,
            goals: PREVIEW_NAMED_GOALS,
            today: "2026-11-10",
            weightUnit: "kg",
            alcohol: "us",
            days: PREVIEW_GOAL_DAYS,
            draft: {
                ...goalsDraftFrom(PREVIEW_NAMED_GOALS, "us"),
                daily_calories: "30000",
            },
            error: "Calories must be at most 20000.",
            invalid: ["daily_calories"],
        }),
        "settings-saved": renderSettingsSavedV2Page({
            chrome,
            foods: catalog.map((f) => ({
                ...f,
                aliases: [] as string[],
            })),
            recipes: [RECIPE, RECIPE_TWO],
            duplicateCount: 2,
            searchQuery: "",
        }),
        // A food row's ⋯ open: Edit, Merge, Delete.
        // (the Detail bar's ⋯ and its desktop twin come first)
        "settings-saved-menu": withMenuOpen(
            renderSettingsSavedV2Page({
                chrome,
                foods: catalog.map((f) => ({
                    ...f,
                    aliases: [] as string[],
                })),
                recipes: [RECIPE, RECIPE_TWO],
                duplicateCount: 2,
                searchQuery: "",
            }),
            2,
        ),
        // The owner: their own switch on and the household's under it.
        "settings-ai": renderSettingsAiV2Page({
            chrome,
            connections: PREVIEW_AI_CONNECTIONS,
            destructive: { allowed: true, canChange: true },
            personal: { canDelete: true, householdOffBy: null },
            showCards: true,
            activity: PREVIEW_AI_ACTIVITY.slice(0, 2),
            now: PREVIEW_AI_NOW,
            timezone: "UTC",
            mcpUrl: "https://food.flow.home/mcp",
        }),
        // A member: their own switch off, no household switch; one change is
        // theirs to undo and one is another member's.
        "settings-ai-member": renderSettingsAiV2Page({
            chrome,
            connections: PREVIEW_AI_CONNECTIONS.slice(0, 3),
            destructive: { allowed: true, canChange: false },
            personal: { canDelete: false, householdOffBy: null },
            showCards: true,
            activity: [
                PREVIEW_AI_ACTIVITY[0],
                {
                    ...PREVIEW_AI_ACTIVITY[0],
                    id: "a1000000-0000-4000-8000-000000000005",
                    summary: "Moved 4 grocery lines to Costco",
                    state: { kind: "other", who: "Alex" },
                },
            ],
            now: PREVIEW_AI_NOW,
            timezone: "UTC",
            mcpUrl: "https://food.flow.home/mcp",
        }),
        // The owner turned the household switch off: the member's own is held Off.
        "settings-ai-household-off": renderSettingsAiV2Page({
            chrome,
            connections: PREVIEW_AI_CONNECTIONS.slice(0, 3),
            destructive: { allowed: false, canChange: false },
            personal: { canDelete: false, householdOffBy: "Ethan" },
            showCards: true,
            activity: PREVIEW_AI_ACTIVITY.slice(0, 1),
            now: PREVIEW_AI_NOW,
            timezone: "UTC",
            mcpUrl: "https://food.flow.home/mcp",
        }),
        "settings-ai-empty": renderSettingsAiV2Page({
            chrome,
            connections: [],
            destructive: { allowed: true, canChange: true },
            showCards: true,
            activity: [],
            now: PREVIEW_AI_NOW,
            timezone: "UTC",
            mcpUrl: "https://food.flow.home/mcp",
        }),
        // Changes on one app's ⋯: Recent changes narrowed to Grok CLI, with Show all.
        "settings-ai-changes": renderSettingsAiV2Page({
            chrome,
            connections: PREVIEW_AI_CONNECTIONS,
            destructive: { allowed: true, canChange: true },
            showCards: true,
            activity: PREVIEW_AI_ACTIVITY,
            appFilter: "Grok CLI",
            now: PREVIEW_AI_NOW,
            timezone: "UTC",
            mcpUrl: "https://food.flow.home/mcp",
        }),
        // The first app's ⋯ open: Disconnect confirms in place.
        "settings-ai-menu": withMenuOpen(
            renderSettingsAiV2Page({
                chrome,
                connections: PREVIEW_AI_CONNECTIONS,
                destructive: { allowed: true, canChange: true },
                showCards: true,
                activity: PREVIEW_AI_ACTIVITY,
                now: PREVIEW_AI_NOW,
                timezone: "UTC",
                mcpUrl: "https://food.flow.home/mcp",
            }),
            0,
        ),
        // The viewer is an owner who picked Balanced: the design's frame.
        "settings-score": renderSettingsScoreV2Page(previewScoreView(chrome)),
        // A member with no choice of their own: the household row is plain.
        "settings-score-member": renderSettingsScoreV2Page(
            previewScoreView(chrome, {
                preset: "planet",
                weights: SCORE_PRESETS.planet,
                followsHousehold: true,
                householdPresetLabel: "Planet",
                canEditHousehold: false,
            }),
        ),
        "settings-score-custom": renderSettingsScoreV2Page(
            previewScoreView(chrome, {
                preset: "custom",
                followsHousehold: false,
                weights: {
                    nutrition: 10,
                    processing: 70,
                    additives: 20,
                    environment: 0,
                },
                warnTraces: false,
            }),
        ),
        "settings-score-error": renderSettingsScoreV2Page(
            previewScoreView(chrome, {
                error: "Give at least one part a weight above 0.",
                draft: {
                    preset: "custom",
                    weights: {
                        nutrition: "0",
                        processing: "0",
                        additives: "0",
                        environment: "0",
                    },
                },
            }),
        ),
        // A weight's pull-down open.
        "settings-score-weight-menu": (() => {
            const html = renderSettingsScoreV2Page(previewScoreView(chrome));
            const row = html.indexOf('aria-label="Nutrition weight"');
            const at = html.lastIndexOf('<div class="fd-menu', row);
            return (
                html.slice(0, at) +
                html
                    .slice(at)
                    .replace('aria-expanded="false"', 'aria-expanded="true"')
                    .replace(
                        'role="menu" aria-label="Nutrition weight" hidden',
                        'role="menu" aria-label="Nutrition weight"',
                    )
            );
        })(),
        "settings-score-household": renderSettingsScoreHouseholdV2Page({
            chrome,
            preset: "planet",
            weights: SCORE_PRESETS.planet,
            isSet: true,
        }),
        "settings-restock": renderSettingsRestockV2Page({
            chrome,
            restock: {
                enabled: true,
                weekday: 0,
                time: "09:00",
                lastRunOn: "2026-11-08",
                lastRunAdded: 3,
            },
            canManage: true,
        }),
        "settings-restock-menu": withEveryMenuOpen(
            renderSettingsRestockV2Page({
                chrome,
                restock: {
                    enabled: true,
                    weekday: 0,
                    time: "09:00",
                    lastRunOn: "2026-11-08",
                    lastRunAdded: 3,
                },
                canManage: true,
            }),
        ),
        "settings-restock-reader": renderSettingsRestockV2Page({
            chrome,
            restock: {
                enabled: true,
                weekday: 0,
                time: "09:00",
                lastRunOn: "2026-11-08",
                lastRunAdded: 3,
            },
            canManage: false,
        }),
        "settings-readers": renderSettingsReadersV2Page({
            chrome,
            socialReaders: { tiktok: true, facebook: true },
            blockedCount: 3,
            isOwner: true,
            canManage: true,
        }),
        "settings-readers-terms": renderSettingsReadersV2Page({
            chrome,
            socialReaders: { tiktok: true, facebook: false },
            blockedCount: 3,
            isOwner: true,
            canManage: true,
            confirmReader: "facebook",
        }),
        "settings-readers-menu": withEveryMenuOpen(
            renderSettingsReadersV2Page({
                chrome,
                socialReaders: { tiktok: true, facebook: true },
                blockedCount: 3,
                isOwner: true,
                canManage: true,
            }),
        ),
        "settings-readers-member": renderSettingsReadersV2Page({
            chrome,
            socialReaders: { tiktok: true, facebook: false },
            blockedCount: 0,
            isOwner: false,
            canManage: false,
        }),
        "settings-stores": renderSettingsStoresV2Page({
            chrome,
            stores: PREVIEW_STORE_SUMMARIES,
            defaultStoreId: "s-costco",
            useUsualStore: true,
            canManage: true,
        }),
        "settings-stores-menu": withBarMenusOpen(
            renderSettingsStoresV2Page({
                chrome,
                stores: PREVIEW_STORE_SUMMARIES,
                defaultStoreId: "s-costco",
                useUsualStore: true,
                canManage: true,
            }),
        ),
        "settings-stores-default-menu": withEveryMenuOpen(
            renderSettingsStoresV2Page({
                chrome,
                stores: PREVIEW_STORE_SUMMARIES,
                defaultStoreId: "s-costco",
                useUsualStore: true,
                canManage: true,
            }),
        ),
        "settings-stores-add": renderSettingsStoresV2Page({
            chrome,
            stores: PREVIEW_STORE_SUMMARIES,
            defaultStoreId: "s-costco",
            useUsualStore: true,
            canManage: true,
            open: STORES_ADD_ID,
        }),
        "settings-stores-reorder": renderSettingsStoresV2Page({
            chrome,
            stores: PREVIEW_STORE_SUMMARIES,
            defaultStoreId: "s-costco",
            useUsualStore: true,
            canManage: true,
            reorder: true,
        }),
        "settings-stores-member": renderSettingsStoresV2Page({
            chrome,
            stores: PREVIEW_STORE_SUMMARIES,
            defaultStoreId: "s-costco",
            useUsualStore: true,
            canManage: false,
        }),
        "settings-store": renderSettingsStoreV2Page(
            previewStoreView(chrome, { lineCount: 0 }) as never,
        ),
        // FigCraft 421271: the Detail bar's ⋯ open.
        "settings-store-menu": withBarMenusOpen(
            renderSettingsStoreV2Page(previewStoreView(chrome) as never),
        ),
        "settings-store-rename": renderSettingsStoreV2Page(
            previewStoreView(chrome, { rename: true }) as never,
        ),
        "settings-store-rename-section": renderSettingsStoreV2Page(
            previewStoreView(chrome, { renameSectionId: "sec-1" }) as never,
        ),
        "settings-store-add-section": renderSettingsStoreV2Page(
            previewStoreView(chrome, { open: STORE_ADD_SECTION_ID }) as never,
        ),
        "settings-store-rules": renderSettingsStoreV2Page(
            previewStoreView(chrome, {
                rules: [
                    { id: "r1", body: "Bring your own bags" },
                    { id: "r2", body: "Closed on Sundays" },
                ],
            }) as never,
        ),
        "settings-store-member": renderSettingsStoreV2Page(
            previewStoreView(chrome, { canManage: false }) as never,
        ),
        "settings-store-delete": renderSettingsStoreV2Page(
            previewStoreView(chrome, {
                open: STORE_DELETE_SHEET_ID,
            }) as never,
        ),
        "settings-store-delete-only": renderSettingsStoreV2Page(
            previewStoreView(chrome, {
                moveTarget: null,
                open: STORE_DELETE_SHEET_ID,
            }) as never,
        ),
        // FigCraft 62847 / 63301 (the list, its first menu open) and 63177.
        "settings-duplicates": (() => {
            const { pairs, refCounts } = duplicatesFixture();
            return withMenuOpen(
                renderSettingsDuplicatesV2Page({ chrome, pairs, refCounts }),
                0,
            );
        })(),
        "settings-duplicates-closed": (() => {
            const { pairs, refCounts } = duplicatesFixture();
            return renderSettingsDuplicatesV2Page({ chrome, pairs, refCounts });
        })(),
        "settings-duplicates-compare": (() => {
            const { pairs, refCounts } = duplicatesFixture();
            return renderSettingsDuplicateCompareV2Page({
                chrome,
                pair: pairs[0]!,
                refCounts,
            });
        })(),
        help: renderSettingsHelpV2Page({ chrome }),
        // A search with matches, and one with none.
        "help-search": renderSettingsHelpV2Page({ chrome, query: "zip" }),
        "help-search-empty": renderSettingsHelpV2Page({
            chrome,
            query: "zzzz",
        }),
        // FigCraft Screens › Settings › Notifications (413107, desktop 601988):
        // the extras in their default (off) state, and a mix of choices.
        "settings-notifications": renderSettingsNotificationsV2Page({
            chrome,
            prefs: [],
        }),
        "settings-notifications-chosen": renderSettingsNotificationsV2Page({
            chrome,
            prefs: [
                { kind: "running_low", enabled: false },
                { kind: "recipe_changes", enabled: true },
                { kind: "week_plan_changes", enabled: true },
                { kind: "new_usuals", enabled: true },
            ],
        }),
        // FigCraft Screens › Notifications (387713), its ⋯ menus for a member
        // (387797) and an admin or owner (387895), and the empty inbox.
        notifications: renderNotificationsPage(
            previewNotificationsView(chrome),
        ),
        "notifications-menu-member": withFirstMenuOpen(
            renderNotificationsPage(previewNotificationsView(chrome)),
        ),
        "notifications-menu-admin": withFirstMenuOpen(
            renderNotificationsPage(
                previewNotificationsView(chrome, { canDismissEveryone: true }),
            ),
        ),
        "notifications-menu-allergens": withFirstMenuOpen(
            renderNotificationsPage(
                previewNotificationsView(chrome, {
                    inbox: {
                        unread: 1,
                        today: [
                            previewNotificationRow({
                                id: "n-allergen",
                                kind: "allergens",
                                subjectKind: "recipe",
                                subjectId: RECIPE.id,
                                payload: {
                                    code: "recipe.allergen",
                                    params: {
                                        name: RECIPE.name,
                                        allergens: ["peanut"],
                                    },
                                    related: [],
                                },
                            }),
                        ],
                        earlier: [],
                        snoozed: [],
                    },
                }),
            ),
        ),
        "notifications-events": renderNotificationsPage(
            previewNotificationsView(chrome, {
                inbox: {
                    unread: 0,
                    today: previewEventRows().slice(0, 2),
                    earlier: previewEventRows().slice(2),
                    snoozed: [],
                },
            }),
        ),
        "notifications-empty": renderNotificationsPage(
            previewNotificationsView(chrome, {
                inbox: { unread: 0, today: [], earlier: [], snoozed: [] },
            }),
        ),
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
        login: await loginPreview("default"),
        "login-invite": await loginPreview("invite"),
        "login-connect": await loginPreview("connect"),
        "login-error": await loginPreview("error"),
        "create-household": createHouseholdFormHtml(undefined, theme),
        "create-household-error": createHouseholdFormHtml(
            "Enter a household name and your name.",
            theme,
        ),
        forbidden: forbiddenDashboardHtml(theme),
        "not-allowed": notAllowedHtml(
            "Only an owner or admin can change the household default.",
            theme,
        ),
        "not-found": notFoundHtml("Page", theme),
        "dev-gallery-v2": renderDevGalleryV2Page(chrome),
        "nutrition-log-search": await logSheetPreview(theme, "empty"),
        "nutrition-log-search-no-yesterday": await logSheetPreview(
            theme,
            "empty-no-yesterday",
        ),
        "nutrition-goal-name": (() => {
            const data = buildPreviewTodayPageData(
                chrome as never,
                "2026-11-10",
            );
            return renderTodayV2Page({
                ...data,
                view: {
                    ...data.view,
                    goals: {
                        ...data.view.goals!,
                        goal_name: "Recomp",
                        goals_set_on: "2026-10-02",
                    },
                },
            });
        })(),
        "nutrition-today-yesterday": renderTodayV2Page({
            ...buildPreviewTodayPageData(chrome as never, "2026-11-10"),
            view: buildPreviewTodayViewWithYesterdayHint("2026-11-10"),
        }),
        "nutrition-today-suggestions": renderTodayV2Page({
            ...buildPreviewTodayPageData(chrome as never, "2026-11-10"),
            view: buildPreviewTodayViewWithSuggestions("2026-11-10"),
        }),
        "kitchen-fridge-use-in": (() => {
            const items = fridgeView(chrome)
                .items as import("../src/domain/fridge.js").FridgeItem[];
            return fridgePage({
                openItemId: "i1",
                // The expiring items but the milk have a recipe.
                useSoonUses: listExpiring(items, fridgeView(chrome).today, 7)
                    .filter((item) => item.id !== "i2")
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
            });
        })(),
        "nutrition-log-results": await logSheetPreview(theme, "results"),
        "nutrition-log-amount": await logSheetPreview(theme, "amount"),
        "nutrition-log-quick-cal": await logSheetPreview(theme, "quick-cal"),
        "nutrition-log-weigh-in": await logSheetPreview(theme, "weigh-in"),
        "nutrition-log-scanner": await logScannerPreview(theme),
        "nutrition-log-scanner-off": await logScannerPreview(theme, false),
        "nutrition-log-search-link": await logSheetPreview(theme, "link"),
        "nutrition-log-search-camera-off": await logSheetPreview(
            theme,
            "empty-no-camera",
        ),
        "nutrition-log-results-camera-off": await logSheetPreview(
            theme,
            "results-no-camera",
        ),
        "trends-v2": previewTrendsPage(chrome),
        // The public /s/:token pages (no shell, no session).
        "share-recipe": renderShareViewPage(
            {
                kind: "recipe",
                recipe: {
                    name: "Smoky red lentil soup",
                    portions: 4,
                    instructions:
                        "1. Soften the onion and garlic in olive oil.\n2. Stir in the lentils, smoked paprika and stock.\n3. Simmer for 25 minutes, then blend half.\n4. Finish with lemon and parsley.",
                    tags: ["Dinner", "Vegan", "Batch cook"],
                    ingredients: [
                        {
                            name: "Red lentils",
                            amount: 300,
                            unit: "g",
                            note: null,
                        },
                        {
                            name: "Onion",
                            amount: 2,
                            unit: "each",
                            note: "Finely diced",
                        },
                        {
                            name: "Vegetable stock",
                            amount: 1.2,
                            unit: "l",
                            note: null,
                        },
                        {
                            name: "Smoked paprika",
                            amount: null,
                            unit: null,
                            note: null,
                        },
                    ],
                },
            },
            theme,
        ),
        "share-groceries": renderShareViewPage(
            {
                kind: "grocery_list",
                list: {
                    stores: [
                        {
                            name: "Corner Shop",
                            lines: [
                                {
                                    name: "Leeks",
                                    amount: 3,
                                    unit: "each",
                                    checked: false,
                                },
                                {
                                    name: "Milk",
                                    amount: 2,
                                    unit: "l",
                                    checked: false,
                                },
                                {
                                    name: "Eggs",
                                    amount: 12,
                                    unit: "each",
                                    checked: true,
                                },
                            ],
                        },
                        {
                            name: "Market",
                            lines: [
                                {
                                    name: "Basmati rice",
                                    amount: 1,
                                    unit: "kg",
                                    checked: false,
                                },
                            ],
                        },
                    ],
                },
            },
            theme,
        ),
        "product-full": previewProductFull(chrome),
        "product-serving": previewProductServing(chrome),
        "product-full-custom": previewProductFull(chrome, {
            weights: {
                nutrition: 0,
                processing: 100,
                additives: 0,
                environment: 0,
            },
            preset: "custom",
        }),
        "product-partial": (() => {
            const partialFood = food("f-product-partial", "Trail mix", 120, {
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
            });
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
    };
}

async function logScannerPreview(
    theme: "light" | "dark",
    camera = true,
): Promise<string> {
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
            barcodeCamera: camera,
        },
    });
}

async function logSheetPreview(
    theme: "light" | "dark",
    mode:
        | "empty"
        | "empty-no-yesterday"
        | "empty-no-camera"
        | "link"
        | "results"
        | "results-no-camera"
        | "amount"
        | "quick-cal"
        | "weigh-in",
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
                    grams_per_each: 174,
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
    // Today's own sheet carries the Copy yesterday tile: enabled for every
    // meal, or (empty-no-yesterday) disabled because yesterday had no meals.
    const copyYesterday =
        mode === "empty" || mode === "link"
            ? {
                  slots: ["breakfast", "lunch", "snack", "dinner"],
                  returnTo: "/",
              }
            : mode === "empty-no-yesterday"
              ? { slots: [], returnTo: "/" }
              : undefined;
    // `barcode-camera` off: no Scan barcode tile, barcode button or link.
    const noCamera = mode === "empty-no-camera" || mode === "results-no-camera";
    const results = mode === "results" || mode === "results-no-camera";
    return renderAppShell({
        ...base,
        v2LogSheet: {
            searchOpenOnLoad: true,
            previewSearch: results ? "results" : "empty",
            previewQuery: results
                ? "chick"
                : mode === "link"
                  ? "https://hot-thai-kitchen.com/pad-see-ew"
                  : "",
            ...(noCamera ? { barcodeCamera: false } : {}),
            ...(copyYesterday ? { copyYesterday } : {}),
        },
    });
}

// The hashed asset hrefs the pages carry only exist once the bundles are built.
await Promise.all([getAppCss(), getAppJs(), getAppV2Css(), getAppV2Js()]);

// Every page below reads this one instant, not the machine's clock.
pinTimeZone();
pinServerClock();

const names: string[] = [];
const modalShotPages: string[] = [];
for (const theme of ["light", "dark"] as const) {
    const p = await pages(theme);
    for (const [name, html] of Object.entries(p)) {
        const file = `${name}-${theme}`;
        await Bun.write(`${OUT}/${file}.html`, pinBrowserClock(html));
        names.push(file);
    }
    modalShotPages.push(
        `recipe-${theme}`,
        `recipe-cook-${theme}`,
        `grocery-put-away-${theme}`,
        `kitchen-usual-edit-${theme}`,
        `kitchen-usual-restock-${theme}`,
        `kitchen-usuals-add-${theme}`,
        `kitchen-usuals-add-type-${theme}`,
        `kitchen-usuals-add-camera-off-${theme}`,
        `settings-store-delete-${theme}`,
        `settings-store-delete-only-${theme}`,
    );
}

const server = Bun.serve({
    port: PORT,
    async fetch(req) {
        const path = new URL(req.url).pathname;
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
    const origin = `http://localhost:${PORT}`;
    // One Chromium for the whole run, a private context per shot (see
    // scripts/app-preview-shots.ts). Always closed, whatever happens.
    const browser = await launchBrowser(chromium, `${OUT}/chrome-shots`);
    // `--only=grocery,fridge` shoots just the pages whose name starts with one
    // of those words (all of them without it).
    const only = process.argv
        .find((arg) => arg.startsWith("--only="))
        ?.slice("--only=".length)
        .split(",")
        .filter(Boolean);
    const wanted = (name: string) =>
        !only || only.some((word) => name.startsWith(word));
    try {
        for (const name of names.filter(wanted)) {
            // Bare pages follow the OS; headless Chromium defaults to dark, so
            // emulate the shot's colour scheme.
            const scheme = colorSchemeOf(name);
            // The shell's two layouts: the phone nav at 390 wide, the sidebar
            // and top bar at the design's 1440. Long pages (Today, Settings)
            // get a tall window so --shots capture every block.
            const layout = layoutOf(name);
            // The dev gallery grows with every component it shows, so it is
            // measured first and shot at its own height. The page is measured
            // in an iframe of the shot's own width, since headless Chromium
            // lays a phone-sized window out wider than the window says, and
            // only once its fonts have loaded (timers, since no animation
            // frame fires under virtual time; the colour scheme does not
            // change the layout, and forcing it crashes the renderer once a
            // page holds an iframe). Other long pages keep the fixed window:
            // their shot size is part of the no-change diff.
            const fullHeight = async (width: number): Promise<number> => {
                const probe = `${OUT}/${name}.measure.html`;
                await Bun.write(
                    probe,
                    `<!doctype html><iframe id="f" src="/${name}.html" style="width:${width}px;height:900px;border:0"></iframe><script>const wait=(ms)=>new Promise((r)=>setTimeout(r,ms));f.onload=async()=>{const d=f.contentDocument;await Promise.race([d.fonts.ready,wait(1500)]);await wait(200);document.documentElement.setAttribute("data-fd-height",String(Math.max(d.documentElement.scrollHeight,d.body.scrollHeight)))}</script>`,
                );
                try {
                    return await browser.measure({
                        url: `${origin}/${name}.measure.html`,
                        viewport: { width: Math.max(width, 500), height: 900 },
                        budgetMs: PAGE_BUDGET_MS,
                    });
                } finally {
                    await Bun.$`rm -f ${probe}`.quiet();
                }
            };
            const { phone, desktop } = windowsFor(
                layout,
                layout === "measured"
                    ? {
                          phone: await fullHeight(PHONE_WIDTH),
                          desktop: await fullHeight(DESKTOP_WIDTH),
                      }
                    : undefined,
            );
            for (const [suffix, viewport] of [
                ["390", phone],
                ["1440", desktop],
            ] as const) {
                const png = await browser.screenshot({
                    url: `${origin}/${name}.html`,
                    viewport,
                    scheme,
                    budgetMs: PAGE_BUDGET_MS,
                });
                await Bun.write(`${OUT}/${name}-${suffix}.png`, png);
                console.log(`${OUT}/${name}-${suffix}.png`);
            }
        }
        for (const name of modalShotPages.filter(wanted)) {
            const png = await browser.screenshot({
                url: `${origin}/${name}.html`,
                viewport: { width: PHONE_WIDTH, height: 844 },
                scheme: colorSchemeOf(name),
                budgetMs: MODAL_BUDGET_MS,
            });
            await Bun.write(`${OUT}/${name}.png`, png);
            console.log(`${OUT}/${name}.png`);
        }
    } finally {
        await browser.close();
        server.stop();
    }
}
