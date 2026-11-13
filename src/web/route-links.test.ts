import { describe, expect, test } from "bun:test";
import { createHouseholdFormHtml, forbiddenDashboardHtml } from "./loaders.js";
import { findLegacyLinks } from "./route-map.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../test-support/chrome-flags.js";
import { renderPossibleDuplicatesPage } from "./pages/possible-duplicates.js";
import { renderNeedsAttentionPage } from "./pages/needs-attention.js";
import {
    buildPreviewKitchenFridgeView,
    renderKitchenFridgeV2Page,
} from "./pages/v2/kitchen-fridge.js";
import {
    buildPreviewKitchenGroceriesView,
    renderKitchenGroceriesV2Page,
} from "./pages/v2/kitchen-groceries.js";
import { renderRecipesListV2Page } from "./pages/v2/recipes-list.js";
import { renderSettingsHelpV2Page } from "./pages/v2/settings-help.js";
import { renderSettingsHouseholdV2Page } from "./pages/v2/settings-household.js";
import {
    buildPreviewTodayPageData,
    renderTodayV2Page,
} from "./pages/v2/today.js";

const HH = "hh-fix";
const chrome = {
    theme: "light" as const,
    attention: { count: 0, tabs: {} },
    flags: FIXTURE_APP_CHROME_FLAGS,
    identity: {
        viewerName: "Ethan",
        viewerRole: "owner" as const,
        householdName: "Home",
        memberCount: 1,
    },
};
const ME = {
    householdId: HH,
    userId: "u1",
    role: "owner" as const,
    displayName: "Ethan",
};

function assertNoLegacy(label: string, html: string) {
    const bad = findLegacyLinks(html);
    expect(bad, label).toEqual([]);
}

describe("rendered pages have no legacy links", () => {
    test("today, kitchen and recipes tabs", () => {
        const today = renderTodayV2Page(
            buildPreviewTodayPageData(chrome as never, "2026-11-10"),
        );
        expect(today).toContain('aria-current="page"');
        assertNoLegacy("today", today);
        assertNoLegacy(
            "fridge",
            renderKitchenFridgeV2Page(
                buildPreviewKitchenFridgeView(chrome as never, "2026-11-10"),
            ),
        );
        assertNoLegacy(
            "grocery",
            renderKitchenGroceriesV2Page(
                buildPreviewKitchenGroceriesView(chrome as never),
            ),
        );
        assertNoLegacy(
            "recipes list",
            renderRecipesListV2Page({
                chrome,
                query: "",
                filter: "",
                totalCount: 0,
                cards: [],
            } as never),
        );
    });

    test("household and settings", () => {
        assertNoLegacy(
            "household members",
            renderSettingsHouseholdV2Page({
                chrome,
                householdName: "Home",
                members: [ME],
                stores: [],
                isOwner: true,
                canManage: true,
                viewerUserId: ME.userId,
                noticeResult: {
                    notices: [],
                    dismissals: [],
                    subjectNames: new Map(),
                    subjectTimes: new Map(),
                    noticeFoods: new Map(),
                    catalogFoods: [],
                    aliasMap: new Map(),
                    barcodedIds: new Set(),
                    possibleDuplicatePairs: [],
                    recipesListPrefetch: {
                        recipes: [],
                        allIngredients: [],
                        fridgeItems: [],
                        foodsById: new Map(),
                    },
                },
                duplicatePairs: [],
                refCounts: new Map(),
            } as never),
        );
        assertNoLegacy(
            "possible duplicates",
            renderPossibleDuplicatesPage({
                chrome,
                pairs: [],
                stores: [],
            } as never),
        );
        assertNoLegacy("settings help", renderSettingsHelpV2Page({ chrome }));
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
