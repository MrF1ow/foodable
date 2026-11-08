import { describe, expect, test } from "bun:test";
import { newFood } from "../domain/foods.js";
import { createHouseholdFormHtml, forbiddenDashboardHtml } from "./loaders.js";
import { findLegacyLinks } from "./route-map.js";
import { renderFridgePage } from "./pages/fridge.js";
import { renderGroceryPage } from "./pages/grocery.js";
import {
    renderRecipeDetailPage,
    renderRecipesPage,
    type RecipeDetailView,
} from "./pages/recipes.js";
import { renderSettingsPage } from "./pages/settings.js";
import { renderFoodsSettingsPage } from "./pages/foods.js";
import { renderHouseholdSettingsPage } from "./pages/household.js";
import { renderSettingsHelpPage } from "./pages/settings-help.js";
import { renderHouseholdSettingsPrefsPage } from "./pages/settings-household.js";
import { DEFAULT_RESTOCK, EMPTY_HOUSEHOLD_PREFERENCES } from "../household.js";
import {
    renderUsualProductsListPage,
    renderUsualProductsPickerPage,
} from "./pages/usual-products.js";
import { renderPossibleDuplicatesPage } from "./pages/possible-duplicates.js";
import { renderNeedsAttentionPage } from "./pages/needs-attention.js";
import { renderNutritionPage } from "./pages/nutrition.js";

const HH = "hh-fix";
const chrome = { theme: "light" as const, attention: { count: 0, tabs: {} } };
const ME = {
    householdId: HH,
    userId: "u1",
    role: "owner" as const,
    displayName: "Ethan",
};

function recipeDetail(): RecipeDetailView {
    return {
        chrome,
        recipe: {
            id: "r1",
            householdId: HH,
            creatorId: ME.userId,
            name: "Toast",
            yieldPortions: 1,
            instructions: null,
            sourceUrl: null,
            tags: [],
            notes: null,
            prepMinutes: null,
            cookMinutes: null,
            verification: "verified",
            updatedAt: "2026-01-01T00:00:00.000Z",
        },
        ingredients: [],
        notices: [],
        noticeContext: { from: "/recipes/r1", foods: new Map() },
        macros: {
            calories: 0,
            protein_g: 0,
            carbs_g: 0,
            fat_g: 0,
            fiber_g: 0,
            sugar_g: 0,
            alcohol_g: 0,
            incomplete: false,
            incompleteReasons: [],
            gaps: [],
        },
        macrosPerPortion: {
            calories: 0,
            protein_g: 0,
            carbs_g: 0,
            fat_g: 0,
            fiber_g: 0,
            sugar_g: 0,
            alcohol_g: 0,
            incomplete: false,
            incompleteReasons: [],
            gaps: [],
        },
        members: [{ userId: ME.userId, displayName: ME.displayName }],
        stores: [],
        viewerId: ME.userId,
        filterUserId: ME.userId,
        portionCount: 1,
        isOwner: true,
        problems: [],
        importRow: null,
    };
}

function assertNoLegacy(label: string, html: string) {
    const bad = findLegacyLinks(html);
    expect(bad, label).toEqual([]);
}

describe("rendered pages have no legacy links", () => {
    test("nutrition tab", async () => {
        const html = await renderNutritionPage({
            access: { ok: true, mode: "self", viewer: ME, subject: ME },
            members: [ME],
            summary: { locale: "en" },
            goals: { locale: "en" },
            trends: { locale: "en" },
            weight: { locale: "en" },
            chrome,
            cardOrder: [
                "nutrition-summary",
                "goal-progress",
                "trends",
                "weight-trends",
            ],
        } as never);
        expect(html).toContain('aria-current="page"');
        assertNoLegacy("nutrition", html);
    });

    test("kitchen and recipes tabs", () => {
        assertNoLegacy(
            "fridge",
            renderFridgePage({
                today: "2026-11-08",
                locations: [],
                items: [],
                chrome,
            }),
        );
        assertNoLegacy(
            "grocery",
            renderGroceryPage({
                chrome,
                stores: [],
                lines: [],
                checked: [],
                viewer: ME,
                members: [ME],
            } as never),
        );
        assertNoLegacy(
            "recipes list",
            renderRecipesPage({
                chrome,
                recipes: [],
                members: [ME],
                viewerId: ME.userId,
            } as never),
        );
        assertNoLegacy("recipe detail", renderRecipeDetailPage(recipeDetail()));
    });

    test("household and settings", () => {
        assertNoLegacy(
            "household members",
            renderHouseholdSettingsPage({
                chrome,
                householdName: "Home",
                location: "",
                members: [ME],
                stores: [],
                memberRules: [],
                isOwner: true,
                canManage: true,
                viewerUserId: ME.userId,
                unverifiedRecipeExpiryDays: null,
            }),
        );
        assertNoLegacy(
            "foods settings",
            renderFoodsSettingsPage({
                chrome,
                foods: [],
                stores: [],
            } as never),
        );
        assertNoLegacy(
            "usual products list",
            renderUsualProductsListPage({
                chrome,
                rows: [],
                addable: [],
            }),
        );
        const eggs = newFood({ householdId: HH, kind: "food", name: "Eggs" });
        assertNoLegacy(
            "usual products picker",
            renderUsualProductsPickerPage({
                chrome,
                food: eggs,
                products: [],
                usualProductId: null,
                prefillStoreId: null,
                prefillAmount: null,
                stores: [],
                from: "/kitchen/groceries",
            }),
        );
        assertNoLegacy(
            "possible duplicates",
            renderPossibleDuplicatesPage({
                chrome,
                pairs: [],
                stores: [],
            } as never),
        );
        assertNoLegacy(
            "settings account",
            renderSettingsPage({
                chrome,
                backHref: "/kitchen/fridge",
                displayName: "Ethan",
                timezone: "UTC",
                weightUnit: "kg",
                widgetsEnabled: true,
                alcoholTrackingEnabled: false,
                drinkUnit: "",
            }),
        );
        assertNoLegacy(
            "settings help",
            renderSettingsHelpPage({ chrome, backHref: "/kitchen/fridge" }),
        );
        assertNoLegacy(
            "settings household prefs",
            renderHouseholdSettingsPrefsPage({
                chrome,
                backHref: "/kitchen/fridge",
                member: ME,
                preferences: {
                    ...EMPTY_HOUSEHOLD_PREFERENCES,
                    restock: { ...DEFAULT_RESTOCK },
                },
                ownerTimezoneLabel: "UTC",
            }),
        );
    });

    test("attention and gate pages", () => {
        assertNoLegacy(
            "needs attention",
            renderNeedsAttentionPage({
                chrome,
                showDismissed: false,
                result: {
                    notices: [],
                    dismissals: [],
                    subjectNames: new Map(),
                    subjectTimes: new Map(),
                    noticeFoods: new Map(),
                },
            } as never),
        );
        assertNoLegacy(
            "create household",
            createHouseholdFormHtml(undefined, "light"),
        );
        assertNoLegacy("forbidden", forbiddenDashboardHtml("light"));
    });
});
