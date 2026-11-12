import { peekSiteMembership } from "../db/actor.js";
import {
    canManageHousehold,
    dashboardAccess,
    type HouseholdMember,
} from "../household.js";
import {
    getGoalProgressPayload,
    getNutritionSummaryPayload,
    getTrendsPayload,
    getWeightTrendsPayload,
    type AlcoholDisplay,
} from "../dashboard-data.js";
import {
    alcoholTrackingEnabledFromProfile,
    getProfile,
    preferredDrinkUnitFromProfile,
    preferredWeightUnitFromProfile,
    widgetsEnabledFromProfile,
} from "../db/profiles.js";
import {
    getHouseholdConfig,
    getPluralsSameFood,
    getHouseholdMembership,
    getHouseholdOwnerProfile,
    householdExists,
    listHouseholdMembers,
} from "../db/household.js";
import { authUserCount } from "../db/users.js";
import {
    canSignUp,
    getSignupPolicy,
    signupPolicyForRoutes,
} from "../domain/signup.js";
import { liveFridgeStore } from "../db/fridge.js";
import { liveFoodsStore } from "../db/foods.js";
import { foodDisplayScore } from "../domain/product-screen.js";
import { liveGroceryStore } from "../db/grocery.js";
import { liveRecipesStore } from "../db/recipes.js";
import { liveSocialReaderStatusStore } from "../db/social-readers.js";
import { recipeFetchMemory } from "../db/fetch-memory.js";
import { parseRefusalCursor } from "../domain/fetch-memory.js";
import { liveRulesStore } from "../db/rules.js";
import { liveSettingsStore } from "../db/settings.js";
import { renderFridgePage } from "./pages/fridge.js";
import {
    renderGroceryPage,
    type GroceryAllergenRetry,
} from "./pages/grocery.js";
import { renderRecipeDetailPage, renderRecipesPage } from "./pages/recipes.js";
import { renderSettingsPage } from "./pages/settings.js";
import { renderFoodsSettingsPage } from "./pages/foods.js";
import {
    renderUsualProductsListPage as renderUsualProductsListHtml,
    renderUsualProductsPickerPage as renderUsualProductsPickerHtml,
} from "./pages/usual-products.js";
import type { LinkProductPromptView } from "./components/link-product-prompt.js";
import { renderHouseholdSettingsPage } from "./pages/household.js";
import { renderSettingsHelpPage as renderSettingsHelpPageHtml } from "./pages/settings-help.js";
import {
    ownerTimezoneLabelForSelect,
    renderHouseholdSettingsPrefsPage,
} from "./pages/settings-household.js";
import {
    effectiveFoodsByIds,
    matchFoodsByWords,
    suggestFoodFor,
    usualProductRows,
    type Food,
    type MergePairPickField,
} from "../domain/foods.js";
import { possibleDuplicateNoticesByFoodId } from "../domain/notices-for.js";
import { renderPossibleDuplicatesPage } from "./pages/possible-duplicates.js";
import {
    plainFoodIdForUsualPicker,
    safeReturnPath,
    usualProductsPickerHref,
} from "./usual-products-path.js";
import type { Notice } from "../domain/notices.js";
import { defaultFreezeExpiry, listFridge } from "../domain/fridge.js";
import {
    allergenNotices,
    groceryAllergenWarning,
    listGrocery,
    matchGroceryAllergens,
} from "../domain/grocery.js";
import { alreadyHaveTag } from "../domain/linking.js";
import {
    gapFromNotice,
    getRecipeView,
    listRecipes,
    listRecipesFiltered,
    macrosForPerson,
    RecipeInputError,
    RecipeUnverifiedError,
    recipeDislikeNote,
    recipeFilters,
    recipeNotices,
} from "../domain/recipes.js";
import {
    applyV2RecipeListFilters,
    parseV2RecipeListFilter,
    renderRecipesListV2Page,
} from "./pages/v2/recipes-list.js";
import {
    renderKitchenFridgeV2Page,
    type KitchenFridgeFoodMeta,
} from "./pages/v2/kitchen-fridge.js";
import { buildKitchenFridgeGroceryOverview } from "./pages/v2/kitchen-overview.js";
import {
    groceryOpenLineCount,
    addStoreIdFromModal,
    renderKitchenGroceriesV2Page,
    type KitchenGroceriesLineMeta,
    type PutAwayDraft,
} from "./pages/v2/kitchen-groceries.js";
import {
    kitchenUsualRowMeta,
    renderKitchenUsualsV2Page,
    restockWeekdayLabel,
    type KitchenUsualsRowMeta,
} from "./pages/v2/kitchen-usuals.js";
import type { GroceryLineView } from "./pages/grocery.js";
import { renderSettingsHouseholdV2Page } from "./pages/v2/settings-household.js";
import { renderSettingsStoresV2Page } from "./pages/v2/settings-stores.js";
import { renderSettingsStoreV2Page } from "./pages/v2/settings-stores-detail.js";
import {
    deleteMoveTarget,
    groceryLineCounts,
} from "../domain/grocery-sections.js";
import { renderSettingsMemberV2Page } from "./pages/v2/settings-member.js";
import {
    groupRecipeIngredientsByPlace,
    renderRecipeDetailV2Page,
} from "./pages/v2/recipes-page.js";
import {
    COOK_SHEET_ID,
    type CookSheetView,
} from "./pages/v2/recipes-page-cook.js";
import { guessMealType } from "./pages/v2/log-sheet.js";
import { orderCards } from "../domain/layout.js";
import { todayInTz, validateTz } from "../domain/tz.js";
import { fromGrams } from "../domain/units.js";
import { getLatestWeight } from "../db/nutrition.js";
import type { WeighInPrefill } from "./pages/v2/log-sheet.js";
import {
    renderNutritionPage,
    viewerChromeFromProfile,
    type NutritionView,
} from "./pages/nutrition.js";
import { loadToday, useSoonFor } from "./loaders-today.js";
import {
    listExpiring,
    previewCookRecipe,
    StockInputError,
    type CookPreview,
} from "../domain/stock.js";
import { FoodsInputError } from "../domain/foods.js";
import { parseTodayDateParam, renderTodayV2Page } from "./pages/v2/today.js";
import {
    loadHouseholdNotices,
    loadViewerNotices,
    viewerChromeWithAttention,
    viewerFlagsFor,
} from "./attention.js";
import { errorBanner, emptyState, pageHeader, field } from "./components/ui.js";
import { renderBarePage, type ThemePref } from "./shell.js";
import { householdToday } from "../db/restock.js";
import { loadWeekPlanView } from "./loaders-plan.js";
import { isPlanDate } from "../domain/plan.js";
import {
    PLAN_SHEET_ID,
    withPlanEditDraft,
    type PlanEditDraft,
    type PlanSheetView,
} from "./pages/v2/recipes-plan.js";
import { liveNoticeDismissalsStore } from "../db/notice-dismissals.js";
import { dismissedKeySet, isDismissedIn } from "../domain/notice-dismissals.js";
import { groceryRestockNotices } from "../domain/restock.js";
import {
    dismissNotice,
    undoDismissal,
    type NoticesForDeps,
} from "../domain/notices-for.js";
import { NoticeDismissError } from "../domain/notice-dismissals.js";
import type { NoticeCode } from "../domain/notices.js";
import type { NoticeSubjectKind } from "../domain/notice-dismissals.js";
import { renderNeedsAttentionPage } from "./pages/needs-attention.js";
import { maybeOne, run } from "../db/sql.js";
import { renderSettingsHomeV2Page } from "./pages/v2/settings-home.js";
import { renderSettingsAccountV2Page } from "./pages/v2/settings-account.js";
import { renderSettingsDisplayV2Page } from "./pages/v2/settings-display.js";
import { renderSettingsGoalsV2Page } from "./pages/v2/settings-goals.js";
import type {
    GoalsFormDraft,
    GoalsFormField,
} from "./pages/v2/settings-goals-form.js";
import { renderSettingsSavedV2Page } from "./pages/v2/settings-saved.js";
import { renderSettingsExportV2Page } from "./pages/v2/settings-export.js";
import { renderSettingsAiV2Page } from "./pages/v2/settings-ai.js";
import { listConnections } from "../db/tokens.js";
import { getAllGoalDays, getNutritionGoals } from "../db/nutrition.js";
import { renderSettingsHelpV2Page } from "./pages/v2/settings-help.js";

/** The member's drink unit, or null when alcohol tracking is off. */
export function alcoholOf(
    profile: Parameters<typeof alcoholTrackingEnabledFromProfile>[0],
): AlcoholDisplay {
    if (!alcoholTrackingEnabledFromProfile(profile)) return null;
    return preferredDrinkUnitFromProfile(profile) ?? "us";
}

/** Latest weight prefill for the member who is logging (always the viewer). */
export async function weighInPrefillForUser(
    userId: string,
): Promise<WeighInPrefill> {
    const [profile, latest] = await Promise.all([
        getProfile(userId),
        getLatestWeight(userId),
    ]);
    const unit = preferredWeightUnitFromProfile(profile) ?? "kg";
    const start =
        latest != null
            ? fromGrams(latest.weight_g, unit)
            : unit === "lb"
              ? 165
              : 75;
    return {
        weight: start,
        unit,
        preferredUnit: unit,
        lastWeightG: latest?.weight_g ?? null,
        lastLoggedAt: latest?.logged_at ?? null,
    };
}

export type DashboardView = NutritionView;

export function forbiddenDashboardHtml(theme: ThemePref = "system"): string {
    return renderBarePage(
        "Household",
        emptyState("You need a household membership to view this dashboard."),
        theme,
    );
}

export function createHouseholdFormHtml(
    error?: string,
    theme: ThemePref = "system",
): string {
    return renderBarePage(
        "Create household",
        `${pageHeader({
            title: "Create household",
            sub: `<p class="muted">Name the household. Everyone else is added from Household.</p>`,
        })}
        ${errorBanner(error)}
        <form method="POST" action="/create-household" class="create-household panel">
            ${field({ id: "household_name", label: "Household name", control: `<input id="household_name" name="household_name" required maxlength="80" />` })}
            ${field({ id: "display_name", label: "Your name", control: `<input id="display_name" name="display_name" required maxlength="80" />` })}
            <button type="submit" class="btn-primary">Create household</button>
        </form>`,
        theme,
    );
}

export async function renderDashboardHtml(
    view: DashboardView,
): Promise<string> {
    return renderNutritionPage(view);
}

type MemberGate =
    | { status: 200; viewer: HouseholdMember }
    | { status: 403; html: string }
    | { status: 200; html: string; create: true };

async function memberGate(viewerUserId: string): Promise<MemberGate> {
    const stashed = peekSiteMembership();
    // Reuse the middleware's lookup only for the same user and only when it
    // found a membership: a request can create a household after the lookup.
    const viewer =
        stashed && stashed.userId === viewerUserId
            ? stashed
            : await getHouseholdMembership(viewerUserId);
    if (viewer == null) {
        const policy = signupPolicyForRoutes(getSignupPolicy());
        const createHousehold = canSignUp(policy, {
            userCount: await authUserCount(),
            householdExists: await householdExists(),
            mode: "create-household",
            callerHasHousehold: false,
        });
        if (createHousehold.ok) {
            return {
                status: 200,
                html: createHouseholdFormHtml(),
                create: true,
            };
        }
        return { status: 403, html: forbiddenDashboardHtml() };
    }
    return { status: 200, viewer };
}

export type V2TodayRenderOpts = {
    openEditMealId?: string;
    editError?: string;
    /** A plan move that failed its checks: its edit sheet opens with this. */
    planEdit?: PlanEditDraft;
};

export async function renderDashboardPage(
    viewerUserId: string,
    requestedMember: string | undefined,
    error?: string,
    openModalId?: string,
    v2LogSheet?: Omit<
        import("./pages/v2/log-sheet.js").RenderLogSheetsOpts,
        "timezone"
    >,
    requestedDate?: string,
    v2Today?: V2TodayRenderOpts,
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };

    let subject = gate.viewer;
    if (requestedMember && requestedMember !== viewerUserId) {
        const requested = await getHouseholdMembership(requestedMember);
        if (requested == null) {
            return { status: 403, html: forbiddenDashboardHtml() };
        }
        subject = requested;
    }
    const access = dashboardAccess(gate.viewer, subject);
    if (!access.ok) {
        return { status: 403, html: forbiddenDashboardHtml() };
    }

    const viewerProfile = await getProfile(access.viewer.userId);
    const subjectProfile =
        access.subject.userId === access.viewer.userId
            ? viewerProfile
            : await getProfile(access.subject.userId);
    const alcohol = alcoholOf(subjectProfile);
    const members = await listHouseholdMembers(access.viewer.householdId);

    const subjectTz =
        subjectProfile?.timezone && validateTz(subjectProfile.timezone)
            ? subjectProfile.timezone
            : "UTC";

    const calendarToday = todayInTz(subjectTz);
    const selectedDate = parseTodayDateParam(requestedDate, calendarToday);

    const viewMemberId =
        requestedMember && requestedMember !== viewerUserId
            ? requestedMember
            : undefined;

    // The new Today loads the household's notices itself; the chrome reuses
    // them instead of loading them again. The flags need no query.
    const flags = await viewerFlagsFor(access.viewer);
    const todayView = flags.uiV2
        ? await loadToday(access.subject, selectedDate, undefined, {
              readOnly: access.subject.userId !== access.viewer.userId,
          })
        : null;
    const chrome = await viewerChromeWithAttention(
        viewerProfile,
        access.viewer,
        todayView?.attention,
    );

    if (todayView) {
        const weighInPrefill = await weighInPrefillForUser(
            access.viewer.userId,
        );
        const mergedLogSheet =
            v2LogSheet == null
                ? { weighIn: weighInPrefill }
                : {
                      ...v2LogSheet,
                      weighIn: v2LogSheet?.weighIn ?? weighInPrefill,
                  };
        const view = todayView;
        const subjectLabel =
            access.subject.userId !== access.viewer.userId
                ? members.find((m) => m.userId === access.subject.userId)
                      ?.displayName
                : undefined;
        // The week plan is the household's, so a peer's read-only day has none.
        const week = subjectLabel
            ? undefined
            : await loadWeekPlanView(
                  access.viewer.householdId,
                  view.householdDate,
              );
        const plan =
            week && v2Today?.planEdit
                ? (withPlanEditDraft(week, v2Today.planEdit) ?? week)
                : week;
        return {
            status: 200,
            html: renderTodayV2Page({
                chrome: { ...chrome, subjectLabel },
                view,
                plan,
                today: calendarToday,
                memberQuery: viewMemberId,
                logSheet: mergedLogSheet,
                error,
                openEditMealId: v2Today?.openEditMealId,
                editError: v2Today?.editError,
            }),
        };
    }

    const [summary, goals, trends, weight, weighInPrefill] = await Promise.all([
        getNutritionSummaryPayload(access.subject.userId, alcohol, 7),
        getGoalProgressPayload(access.subject.userId, alcohol),
        getTrendsPayload(access.subject.userId, alcohol),
        getWeightTrendsPayload(access.subject.userId),
        weighInPrefillForUser(access.viewer.userId),
    ]);

    const mergedLogSheet =
        v2LogSheet == null
            ? { weighIn: weighInPrefill }
            : {
                  ...v2LogSheet,
                  weighIn: v2LogSheet?.weighIn ?? weighInPrefill,
              };

    return {
        status: 200,
        html: await renderDashboardHtml({
            access,
            members,
            summary,
            goals,
            trends,
            weight,
            chrome,
            cardOrder: orderCards(viewerProfile?.nutrition_layout),
            viewMemberId,
            error,
            openModalId,
            v2LogSheet: mergedLogSheet,
            weightUnit: preferredWeightUnitFromProfile(viewerProfile) ?? "kg",
        }),
    };
}

function openFridgeItemId(
    openModalId: string | undefined,
    openItemId: string | undefined,
    knownItemIds: ReadonlySet<string>,
): string | undefined {
    let raw: string | undefined;
    if (openItemId?.trim()) raw = openItemId.trim();
    else if (openModalId?.startsWith("fridge-edit-")) {
        raw = openModalId.slice("fridge-edit-".length);
    } else if (openModalId?.startsWith("fd-fridge-item-")) {
        raw = openModalId.slice("fd-fridge-item-".length);
    }
    if (!raw) return undefined;
    return knownItemIds.has(raw) ? raw : undefined;
}

function openFridgeAddSheet(
    openModalId: string | undefined,
    openAdd?: boolean,
): boolean {
    if (openAdd) return true;
    return (
        openModalId?.startsWith("fridge-add-food-") === true ||
        openModalId?.startsWith("fridge-add-supply-") === true
    );
}

export async function renderFridgeInventoryPage(
    viewerUserId: string,
    error?: string,
    openModalId?: string,
    linkProductId?: string,
    extras?: {
        didYouMean?: import("./components/did-you-mean.js").DidYouMeanModal;
    },
    opts: { openItemId?: string; openAdd?: boolean } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const householdId = gate.viewer.householdId;
    const flags = await viewerFlagsFor(gate.viewer);
    // Only the new shell's Overview shows the grocery card (stores and
    // sections); the old page needs just the lines.
    const [snapshot, allFoods, grocerySnapshot, today] = await Promise.all([
        listFridge(liveFridgeStore(), householdId),
        liveFoodsStore().listFoods(householdId),
        flags.uiV2
            ? listGrocery(liveGroceryStore(), liveSettingsStore(), householdId)
            : liveGroceryStore()
                  .listLines(householdId)
                  .then((lines) => ({ lines, stores: [], sections: [] })),
        householdToday(householdId),
    ]);
    const groceryLines = grocerySnapshot.lines;
    const foodsById = new Map<string, KitchenFridgeFoodMeta>(
        allFoods.map((row) => [
            row.id,
            {
                id: row.id,
                genericFoodId: row.genericFoodId,
                usualAmount: row.usualAmount,
            },
        ]),
    );
    const noticeResult = await loadViewerNotices(gate.viewer, { today });
    const chrome = await viewerChromeWithAttention(
        profile,
        gate.viewer,
        noticeResult,
    );
    if (flags.uiV2) {
        const knownIds = new Set(snapshot.items.map((row) => row.id));
        const itemId = openFridgeItemId(openModalId, opts.openItemId, knownIds);
        const chromeWithCount = chromeWithKitchenGroceriesCount(
            chrome,
            groceryLines,
        );
        return {
            status: 200,
            html: renderKitchenFridgeV2Page({
                ...snapshot,
                today,
                chrome: chromeWithCount,
                error,
                openItemId: itemId,
                openAdd: openFridgeAddSheet(openModalId, opts.openAdd),
                openModalId,
                didYouMean: extras?.didYouMean,
                foodsById,
                // From the recipes the notices already loaded: no extra query.
                useSoonUses: useSoonFor(
                    noticeResult.recipesListPrefetch,
                    listExpiring(snapshot.items, today, 7),
                ).uses,
                freezeDefaultExpiry: defaultFreezeExpiry(today),
                notices: noticeResult.notices,
                groceryLines,
                groceryOverview:
                    buildKitchenFridgeGroceryOverview(grocerySnapshot),
            }),
        };
    }
    const linkProductPrompt = linkProductId
        ? linkProductPromptFromFoods(
              allFoods,
              linkProductId,
              "/kitchen/fridge",
              true,
              error,
          )
        : null;
    return {
        status: 200,
        html: renderFridgePage({
            ...snapshot,
            today,
            chrome,
            error,
            openModalId,
            didYouMean: extras?.didYouMean,
            linkProductPrompt,
            groceryLines,
            foodsById,
        }),
    };
}

function chromeWithKitchenGroceriesCount<
    T extends import("./attention.js").AppChromeBase,
>(chrome: T, lines: import("../domain/grocery.js").GroceryLine[]): T {
    if (!chrome.flags.uiV2) return chrome;
    return {
        ...chrome,
        v2KitchenGroceriesCount: groceryOpenLineCount(lines),
    };
}

function kitchenGroceryLineMeta(
    line: GroceryLineView,
    ctx: {
        allFoods: Food[];
        catalog: Awaited<ReturnType<typeof effectiveFoodsByIds>>;
        memberAllergens: Awaited<ReturnType<typeof groceryAllergenMembers>>;
        storeName: string;
        sectionName: string;
    },
): KitchenGroceriesLineMeta {
    const foodRow = line.foodId
        ? ctx.allFoods.find((row) => row.id === line.foodId)
        : null;
    const eff = line.foodId ? ctx.catalog.get(line.foodId) : null;
    const genericFood = foodRow?.genericFoodId
        ? ctx.allFoods.find((row) => row.id === foodRow.genericFoodId)
        : foodRow;
    const usualProductId = genericFood?.usualProductId ?? null;
    const isUsual = !!(
        usualProductId &&
        (line.foodId === usualProductId || eff?.product?.id === usualProductId)
    );
    let plainFoodName: string | null = null;
    if (genericFood && foodRow?.genericFoodId) {
        plainFoodName = genericFood.name;
    } else if (
        genericFood &&
        usualProductId &&
        line.foodId === genericFood.id
    ) {
        plainFoodName = genericFood.name;
    }
    const warning = groceryAllergenWarning(
        line.displayName,
        ctx.memberAllergens,
        eff?.allergens ?? null,
    );
    const productScore = foodRow ? foodDisplayScore(foodRow) : null;
    return {
        plainFoodName,
        isUsual,
        allergenWarning: warning?.text ?? null,
        storeName: ctx.storeName,
        sectionName: ctx.sectionName,
        productScore,
    };
}

export async function renderGroceryListPage(
    viewerUserId: string,
    opts: {
        error?: string;
        allergenNotices?: Notice[];
        allergenRetry?: GroceryAllergenRetry;
        didYouMean?: import("./components/did-you-mean.js").DidYouMeanModal;
        openModalId?: string;
        linkProductId?: string;
        openLineId?: string;
        openPutAway?: boolean;
        putAwayDraft?: PutAwayDraft;
        storeFilter?: string;
    } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const householdId = gate.viewer.householdId;
    const profile = await getProfile(viewerUserId);
    const [snapshot, fridge, members] = await Promise.all([
        listGrocery(liveGroceryStore(), liveSettingsStore(), householdId),
        listFridge(liveFridgeStore(), householdId),
        listHouseholdMembers(householdId),
    ]);
    const rules = liveRulesStore();
    const memberAllergens = await Promise.all(
        members.map(async (member) => ({
            displayName: member.displayName,
            userId: member.userId,
            allergens: await rules.listAllergens(householdId, member.userId),
        })),
    );
    const storeRules = await Promise.all(
        snapshot.stores.map(async (store) => ({
            storeId: store.id,
            rules: await rules.listStoreRules(store.id),
        })),
    );
    const rulesByStore = new Map(
        storeRules.map((row) => [row.storeId, row.rules]),
    );
    const foodsStore = liveFoodsStore();
    const allFoods = await foodsStore.listFoods(householdId);
    const productsByPlain = new Map<string, Food[]>();
    for (const row of allFoods) {
        if (!row.genericFoodId || row.archivedAt) continue;
        const list = productsByPlain.get(row.genericFoodId) ?? [];
        list.push(row);
        productsByPlain.set(row.genericFoodId, list);
    }
    const catalog = await effectiveFoodsByIds(foodsStore, householdId, [
        ...snapshot.lines.map((line) => line.foodId),
        ...fridge.items.map((item) => item.foodId),
    ]);
    const today = await householdToday(householdId);
    const dismissals =
        await liveNoticeDismissalsStore().listForHousehold(householdId);
    const dismissed = dismissedKeySet(dismissals);
    const restockByLine = new Map<string, Notice[]>();
    for (const notice of groceryRestockNotices(
        snapshot.lines,
        fridge.items,
        today,
    )) {
        if (isDismissedIn(notice, dismissed)) continue;
        restockByLine.set(notice.subject.id, [notice]);
    }
    const stores = snapshot.stores.map((store) => {
        const storeLines = snapshot.lines.filter(
            (line) => line.storeId === store.id,
        );
        const sections = snapshot.sections
            .filter(
                (section) =>
                    section.storeId === store.id &&
                    (!section.hidden ||
                        storeLines.some(
                            (line) => line.sectionId === section.id,
                        )),
            )
            .map((section) => ({
                ...section,
                lines: storeLines
                    .filter((line) => line.sectionId === section.id)
                    .map((line) => {
                        const effective = line.foodId
                            ? catalog.get(line.foodId)
                            : null;
                        const products = line.foodId
                            ? (productsByPlain.get(line.foodId) ?? [])
                            : [];
                        const plain = line.foodId
                            ? allFoods.find((row) => row.id === line.foodId)
                            : null;
                        const usualId = plain?.usualProductId ?? null;
                        const putAwayProducts =
                            products.length > 0 && plain
                                ? [
                                      {
                                          id: plain.id,
                                          label: plain.name,
                                      },
                                      ...products.map((product) => ({
                                          id: product.id,
                                          label: product.brand
                                              ? `${product.name} · ${product.brand}`
                                              : product.name,
                                      })),
                                  ]
                                : null;
                        return {
                            ...line,
                            notices: restockByLine.get(line.id) ?? [],
                            alreadyHave: alreadyHaveTag(
                                line,
                                fridge.items,
                                catalog,
                            ),
                            lastLocationId:
                                fridge.items
                                    .filter(
                                        (item) =>
                                            item.foodId &&
                                            item.foodId === line.foodId,
                                    )
                                    .at(-1)?.locationId ??
                                fridge.locations[0]?.id ??
                                null,
                            usualProductName: effective?.product?.name ?? null,
                            usualPickerHref: line.foodId
                                ? usualProductsPickerHref(
                                      plainFoodIdForUsualPicker(
                                          line.foodId,
                                          allFoods.find(
                                              (row) => row.id === line.foodId,
                                          ),
                                      ),
                                      "/kitchen/groceries",
                                  )
                                : null,
                            putAwayProducts,
                            putAwayProductId: usualId ?? plain?.id ?? null,
                        };
                    }),
            }));
        return {
            ...store,
            sections,
            rules: rulesByStore.get(store.id) ?? [],
        };
    });
    const unknownAllergen = snapshot.lines.some((line) => {
        const food = line.foodId ? catalog.get(line.foodId) : null;
        return (
            matchGroceryAllergens(
                line.displayName,
                memberAllergens,
                food ? food.allergens : null,
            ) === "unknown"
        );
    });
    const linkProductPrompt = opts.linkProductId
        ? linkProductPromptFromFoods(
              allFoods,
              opts.linkProductId,
              "/kitchen/groceries",
              true,
              opts.error,
          )
        : null;
    const noticeResult = await loadViewerNotices(gate.viewer, { today });
    const foodDuplicateNotices = possibleDuplicateNoticesByFoodId(
        noticeResult.notices,
    );
    const chrome = await viewerChromeWithAttention(
        profile,
        gate.viewer,
        noticeResult,
    );
    const locations = fridge.locations.map((loc) => ({
        id: loc.id,
        name: loc.name,
    }));
    if (chrome.flags.uiV2) {
        const storeIds = new Set(stores.map((row) => row.id));
        const sectionNameById = new Map(
            stores.flatMap((store) =>
                store.sections.map((section) => [section.id, section.name]),
            ),
        );
        const storeNameById = new Map(
            stores.map((store) => [store.id, store.name]),
        );
        const metaCtx = {
            allFoods,
            catalog,
            memberAllergens,
        };
        const lineMeta = new Map<string, KitchenGroceriesLineMeta>();
        const enrich = (line: GroceryLineView): GroceryLineView => {
            const name = kitchenGroceryLineMeta(line, {
                ...metaCtx,
                storeName: storeNameById.get(line.storeId) ?? "No store",
                sectionName: sectionNameById.get(line.sectionId) ?? "Other",
            });
            lineMeta.set(line.id, name);
            return line;
        };
        for (const store of stores) {
            for (const section of store.sections) {
                section.lines = section.lines.map(
                    enrich,
                ) as typeof section.lines;
            }
        }
        const orphanRaw = snapshot.lines.filter(
            (line) => !storeIds.has(line.storeId),
        );
        const noStoreLines: GroceryLineView[] = orphanRaw.map((line) => {
            const effective = line.foodId ? catalog.get(line.foodId) : null;
            const products = line.foodId
                ? (productsByPlain.get(line.foodId) ?? [])
                : [];
            const plain = line.foodId
                ? allFoods.find((row) => row.id === line.foodId)
                : null;
            const usualId = plain?.usualProductId ?? null;
            return enrich({
                ...line,
                notices: restockByLine.get(line.id) ?? [],
                alreadyHave: alreadyHaveTag(line, fridge.items, catalog),
                lastLocationId:
                    fridge.items
                        .filter(
                            (item) =>
                                item.foodId && item.foodId === line.foodId,
                        )
                        .at(-1)?.locationId ??
                    fridge.locations[0]?.id ??
                    null,
                usualProductName: effective?.product?.name ?? null,
                usualPickerHref: null,
                putAwayProducts: null,
                putAwayProductId: usualId ?? plain?.id ?? null,
            });
        });
        const checkedLines: GroceryLineView[] = snapshot.lines
            .filter((line) => line.checked)
            .map((line) => {
                const inStore = stores
                    .flatMap((s) => s.sections)
                    .flatMap((s) => s.lines)
                    .find((row) => row.id === line.id);
                if (inStore) return inStore;
                return (
                    noStoreLines.find((row) => row.id === line.id) ??
                    enrich({
                        ...line,
                        notices: restockByLine.get(line.id) ?? [],
                        alreadyHave: alreadyHaveTag(
                            line,
                            fridge.items,
                            catalog,
                        ),
                        lastLocationId:
                            fridge.items
                                .filter(
                                    (item) =>
                                        item.foodId &&
                                        item.foodId === line.foodId,
                                )
                                .at(-1)?.locationId ??
                            fridge.locations[0]?.id ??
                            null,
                        usualProductName: line.foodId
                            ? (catalog.get(line.foodId)?.product?.name ?? null)
                            : null,
                        usualPickerHref: null,
                        putAwayProducts: null,
                        putAwayProductId: null,
                    })
                );
            });
        const selectedStoreId =
            opts.storeFilter &&
            stores.some((store) => store.id === opts.storeFilter)
                ? opts.storeFilter
                : null;
        const chromeWithCount = chromeWithKitchenGroceriesCount(
            chrome,
            snapshot.lines,
        );
        const addStoreId = addStoreIdFromModal(opts.openModalId);
        return {
            status: 200,
            html: renderKitchenGroceriesV2Page({
                chrome: chromeWithCount,
                stores,
                noStoreLines,
                checkedLines,
                locations,
                lineMeta,
                openLineCount: groceryOpenLineCount(snapshot.lines),
                selectedStoreId,
                error: opts.error,
                unknownAllergen:
                    unknownAllergen && !opts.allergenNotices?.length,
                openLineId: opts.openLineId,
                openPutAway: opts.openPutAway,
                putAwayDraft: opts.putAwayDraft,
                openAdd: addStoreId != null,
                addStoreId: addStoreId ?? selectedStoreId,
                allergenNotices: opts.allergenNotices,
                allergenRetry: opts.allergenRetry,
                didYouMean: opts.didYouMean,
            }),
        };
    }
    return {
        status: 200,
        html: renderGroceryPage({
            chrome,
            foodDuplicateNotices,
            stores,
            canManage: canManageHousehold(gate.viewer),
            error: opts.error,
            allergenNotices: opts.allergenNotices,
            allergenRetry: opts.allergenRetry,
            didYouMean: opts.didYouMean,
            unknownAllergen: unknownAllergen && !opts.allergenNotices?.length,
            openModalId: opts.openModalId,
            locations,
            linkProductPrompt,
        }),
    };
}

export async function groceryAllergenMembers(householdId: string) {
    const members = await listHouseholdMembers(householdId);
    const rules = liveRulesStore();
    return Promise.all(
        members.map(async (member) => ({
            displayName: member.displayName,
            userId: member.userId,
            allergens: await rules.listAllergens(householdId, member.userId),
        })),
    );
}

async function settingsViewerEmail(userId: string): Promise<string> {
    try {
        return await run(async (tx) => {
            const row = await maybeOne<{ email: string }>(
                tx,
                tx`
                    select email
                    from public.users
                    where id = ${userId}
                `,
                "settings viewer email",
            );
            return row?.email ?? "";
        });
    } catch {
        return "";
    }
}

export async function renderSettingsHomeRoute(
    viewerUserId: string,
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const chrome = await viewerChromeWithAttention(profile, gate.viewer);
    const email = await settingsViewerEmail(viewerUserId);
    return {
        status: 200,
        html: renderSettingsHomeV2Page({
            chrome,
            displayName: gate.viewer.displayName,
            email,
            storedTheme:
                profile?.theme === "light" || profile?.theme === "dark"
                    ? profile.theme
                    : null,
        }),
    };
}

export async function renderSettingsAccountV2Route(
    viewerUserId: string,
    opts: { error?: string; backHref?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const chrome = await viewerChromeWithAttention(profile, gate.viewer);
    return {
        status: 200,
        html: renderSettingsAccountV2Page({
            chrome,
            backHref: opts.backHref ?? "/",
            displayName: gate.viewer.displayName,
            timezone: profile?.timezone ?? "",
            weightUnit: preferredWeightUnitFromProfile(profile) ?? "",
            widgetsEnabled: widgetsEnabledFromProfile(profile),
            alcoholTrackingEnabled: alcoholTrackingEnabledFromProfile(profile),
            drinkUnit: preferredDrinkUnitFromProfile(profile) ?? "",
            error: opts.error,
        }),
    };
}

export async function renderSettingsDisplayV2Route(
    viewerUserId: string,
    opts: { error?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const chrome = await viewerChromeWithAttention(profile, gate.viewer);
    const stored =
        profile?.theme === "light" || profile?.theme === "dark"
            ? profile.theme
            : null;
    return {
        status: 200,
        html: renderSettingsDisplayV2Page({
            chrome,
            storedTheme: stored,
            error: opts.error,
        }),
    };
}

export async function renderSettingsGoalsV2Route(
    viewerUserId: string,
    opts: {
        error?: string;
        draft?: GoalsFormDraft;
        invalid?: readonly GoalsFormField[];
    } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const chrome = await viewerChromeWithAttention(profile, gate.viewer);
    const tz = profile?.timezone?.trim() || "UTC";
    const today = todayInTz(tz);
    // The form edits the standing goals; a day's override is listed apart.
    const goals = await getNutritionGoals(viewerUserId);
    const days = (await getAllGoalDays(viewerUserId)).filter(
        (d) => d.date >= today,
    );
    const weightUnit = preferredWeightUnitFromProfile(profile) ?? "kg";
    const alcohol = alcoholTrackingEnabledFromProfile(profile)
        ? (preferredDrinkUnitFromProfile(profile) ?? "us")
        : null;
    return {
        status: 200,
        html: renderSettingsGoalsV2Page({
            chrome,
            goals,
            today,
            weightUnit,
            alcohol,
            days,
            draft: opts.draft,
            error: opts.error,
            invalid: opts.invalid,
        }),
    };
}

export async function renderSettingsSavedV2Route(
    viewerUserId: string,
    opts: {
        error?: string;
        openModalId?: string;
        q?: string;
    } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const householdId = gate.viewer.householdId;
    const store = liveFoodsStore();
    const foods = await store.listFoods(householdId);
    const aliasMap = await store.listAllAliases(householdId);
    const withAliases = foods.map((food) => ({
        ...food,
        aliases: aliasMap.get(food.id) ?? [],
    }));
    const q = opts.q?.trim() ?? "";
    let filteredFoods = withAliases;
    let recipes = await listRecipes(liveRecipesStore(), householdId);
    if (q) {
        const searchable = withAliases.filter((f) => !f.archivedAt);
        const matched = matchFoodsByWords(q, searchable, aliasMap);
        const keepIds = new Set<string>();
        for (const food of matched) {
            keepIds.add(food.id);
            if (food.genericFoodId) keepIds.add(food.genericFoodId);
        }
        for (const food of searchable) {
            if (food.genericFoodId && keepIds.has(food.genericFoodId)) {
                keepIds.add(food.id);
            }
        }
        filteredFoods = withAliases.filter((f) => keepIds.has(f.id));
        const lower = q.toLowerCase();
        recipes = recipes.filter((r) => r.name.toLowerCase().includes(lower));
    }
    const noticeResult = await loadViewerNotices(gate.viewer);
    return {
        status: 200,
        html: renderSettingsSavedV2Page({
            chrome: await viewerChromeWithAttention(
                profile,
                gate.viewer,
                noticeResult,
            ),
            foods: filteredFoods,
            recipes,
            searchQuery: q,
            error: opts.error,
            openModalId: opts.openModalId,
        }),
    };
}

export async function renderSettingsExportV2Route(
    viewerUserId: string,
    opts: { error?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const chrome = await viewerChromeWithAttention(profile, gate.viewer);
    return {
        status: 200,
        html: renderSettingsExportV2Page({
            chrome,
            error: opts.error,
        }),
    };
}

export async function renderSettingsAiV2Route(
    viewerUserId: string,
    opts: { mcpUrl: string; error?: string },
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const chrome = await viewerChromeWithAttention(profile, gate.viewer);
    // Only the caller's own connections: the id is the session's.
    const connections = await listConnections(viewerUserId);
    return {
        status: 200,
        html: renderSettingsAiV2Page({
            chrome,
            connections,
            now: new Date(),
            timezone: profile?.timezone?.trim() || "UTC",
            mcpUrl: opts.mcpUrl,
            error: opts.error,
        }),
    };
}

export async function renderSettingsAccountPage(
    viewerUserId: string,
    opts: { error?: string; backHref?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const flags = await viewerFlagsFor(gate.viewer);
    if (flags.uiV2) {
        return renderSettingsAccountV2Route(viewerUserId, opts);
    }
    const profile = await getProfile(viewerUserId);
    const chrome = viewerChromeFromProfile(profile);
    return {
        status: 200,
        html: renderSettingsPage({
            chrome,
            flags,
            backHref: opts.backHref ?? "/",
            displayName: gate.viewer.displayName,
            timezone: profile?.timezone ?? "",
            weightUnit: preferredWeightUnitFromProfile(profile) ?? "",
            widgetsEnabled: widgetsEnabledFromProfile(profile),
            alcoholTrackingEnabled: alcoholTrackingEnabledFromProfile(profile),
            drinkUnit: preferredDrinkUnitFromProfile(profile) ?? "",
            error: opts.error,
        }),
    };
}

export async function renderSettingsHelpRoute(
    viewerUserId: string,
    opts: { backHref?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const flags = await viewerFlagsFor(gate.viewer);
    if (flags.uiV2) {
        const chrome = await viewerChromeWithAttention(profile, gate.viewer);
        return {
            status: 200,
            html: renderSettingsHelpV2Page({ chrome }),
        };
    }
    return {
        status: 200,
        html: renderSettingsHelpPageHtml({
            chrome: viewerChromeFromProfile(profile),
            flags,
            backHref: opts.backHref ?? "/",
        }),
    };
}

export async function renderSettingsHouseholdRoute(
    viewerUserId: string,
    opts: {
        backHref?: string;
        error?: string;
        draft?: {
            timezone: string | null;
            restockEnabled: boolean;
            restockWeekday: string;
            restockTime: string;
        };
    } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const householdId = gate.viewer.householdId;
    const [config, ownerProfile] = await Promise.all([
        getHouseholdConfig(householdId),
        getHouseholdOwnerProfile(householdId),
    ]);
    return {
        status: 200,
        html: renderHouseholdSettingsPrefsPage({
            chrome: viewerChromeFromProfile(profile),
            flags: await viewerFlagsFor(gate.viewer),
            backHref: opts.backHref ?? "/",
            member: gate.viewer,
            preferences: config.preferences,
            ownerTimezoneLabel: ownerTimezoneLabelForSelect(ownerProfile),
            draft: opts.draft,
            error: opts.error,
        }),
    };
}

function linkProductPromptFromFoods(
    foods: Food[],
    productId: string,
    from: string,
    openOnLoad: boolean,
    error?: string,
): LinkProductPromptView | null {
    const product = foods.find((row) => row.id === productId);
    if (!product || product.archivedAt || product.genericFoodId) {
        return null;
    }
    const plains = foods.filter(
        (row) =>
            !row.archivedAt &&
            !row.genericFoodId &&
            row.kind === product.kind &&
            row.id !== product.id,
    );
    const suggested = suggestFoodFor(product.name, plains);
    if (!suggested) return null;
    return {
        product: {
            id: product.id,
            name: product.name,
            brand: product.brand,
        },
        plainOptions: plains.map((row) => ({
            id: row.id,
            name: row.name,
        })),
        suggestedId: suggested.id,
        from,
        openOnLoad,
        error,
    };
}

export async function renderSettingsFoodsPage(
    viewerUserId: string,
    opts: {
        error?: string;
        openModalId?: string;
        linkProductId?: string;
        from?: string;
    } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const householdId = gate.viewer.householdId;
    const store = liveFoodsStore();
    const foods = await store.listFoods(householdId);
    const aliasMap = await store.listAllAliases(householdId);
    const withAliases = foods.map((food) => ({
        ...food,
        aliases: aliasMap.get(food.id) ?? [],
    }));
    const from = safeReturnPath(opts.from, "/settings/household/items");
    const linkProductPrompt = opts.linkProductId
        ? linkProductPromptFromFoods(
              foods,
              opts.linkProductId,
              from,
              true,
              opts.error,
          )
        : null;
    const settings = liveSettingsStore();
    const stores = await settings.listStores(householdId);
    const noticeResult = await loadViewerNotices(gate.viewer);
    return {
        status: 200,
        html: renderFoodsSettingsPage({
            chrome: await viewerChromeWithAttention(
                profile,
                gate.viewer,
                noticeResult,
            ),
            foods: withAliases,
            stores,
            error: opts.error,
            openModalId: opts.openModalId,
            linkProductPrompt,
        }),
    };
}

export async function renderUsualProductsListPage(
    viewerUserId: string,
    opts: {
        error?: string;
        from?: string;
        q?: string;
        storeFilter?: string;
        openFoodId?: string;
        openRestock?: boolean;
    } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const householdId = gate.viewer.householdId;
    const store = liveFoodsStore();
    const foods = await store.listFoods(householdId);
    const barcodedFoodIds = await store.listBarcodedFoodIds(householdId);
    const { rows, addable } = usualProductRows({ foods, barcodedFoodIds });
    const q = opts.q?.trim() ?? "";
    let addSearch:
        { q: string; results: Food[]; truncated: boolean } | undefined;
    if (q) {
        const aliases = await store.listAllAliases(householdId);
        const matched = matchFoodsByWords(q, addable, aliases);
        addSearch = {
            q,
            results: matched.slice(0, 20),
            truncated: matched.length > 20,
        };
    }
    const [noticeResult, groceryLines] = await Promise.all([
        loadViewerNotices(gate.viewer),
        liveGroceryStore().listLines(householdId),
    ]);
    const chrome = await viewerChromeWithAttention(
        profile,
        gate.viewer,
        noticeResult,
    );
    const chromeWithCount = chromeWithKitchenGroceriesCount(
        chrome,
        groceryLines,
    );
    if (chromeWithCount.flags.uiV2) {
        const [stores, config] = await Promise.all([
            liveSettingsStore().listStores(householdId),
            getHouseholdConfig(householdId),
        ]);
        const storesById = new Map(stores.map((row) => [row.id, row]));
        const foodsById = new Map(
            foods.map((row) => [
                row.id,
                { id: row.id, genericFoodId: row.genericFoodId },
            ]),
        );
        const lowFoodIds = new Set(
            noticeResult.notices
                .filter((notice) => notice.code === "grocery.running_low")
                .map((notice) => notice.subject.id),
        );
        const rowMeta = new Map<string, KitchenUsualsRowMeta>();
        for (const row of rows) {
            rowMeta.set(
                row.food.id,
                kitchenUsualRowMeta(row, {
                    storesById,
                    groceryLines,
                    foodsById,
                    lowFoodIds,
                }),
            );
        }
        const selectedStoreId =
            opts.storeFilter &&
            stores.some((store) => store.id === opts.storeFilter)
                ? opts.storeFilter
                : null;
        const knownOpen =
            opts.openFoodId &&
            rows.some((row) => row.food.id === opts.openFoodId)
                ? opts.openFoodId
                : undefined;
        let error = opts.error;
        if (opts.openFoodId && !knownOpen && !error) {
            error = "Unknown food.";
        }
        return {
            status: 200,
            html: renderKitchenUsualsV2Page({
                chrome: chromeWithCount,
                rows,
                stores,
                rowMeta,
                addable,
                selectedStoreId,
                error,
                openFoodId: knownOpen,
                openRestock: opts.openRestock,
                restockDay: config.preferences.restock.enabled
                    ? restockWeekdayLabel(config.preferences.restock.weekday)
                    : null,
                addSearch,
                openGroceriesCount: groceryOpenLineCount(groceryLines),
                notices: noticeResult.notices,
            }),
        };
    }
    return {
        status: 200,
        html: renderUsualProductsListHtml({
            chrome: chromeWithCount,
            rows,
            addable,
            from: opts.from,
            error: opts.error,
            addSearch,
        }),
    };
}

export async function renderUsualProductsPickerPage(
    viewerUserId: string,
    foodId: string,
    opts: { error?: string; from?: string } = {},
): Promise<{ status: 200 | 403 | 404; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const householdId = gate.viewer.householdId;
    const store = liveFoodsStore();
    const food = await store.getFood(householdId, foodId);
    if (!food || food.archivedAt || food.genericFoodId) {
        const page = await renderUsualProductsListPage(viewerUserId, {
            error: "Unknown food.",
        });
        return { status: 404, html: page.html };
    }
    const foods = await store.listFoods(householdId);
    const products = foods
        .filter((row) => row.genericFoodId === foodId && !row.archivedAt)
        .sort((a, b) => a.name.localeCompare(b.name));
    const from = safeReturnPath(opts.from, "/kitchen/usuals");
    const listed = foods;
    const catalog = new Map(listed.map((row) => [row.id, row]));
    const usualId = food.usualProductId;
    const usualProduct =
        usualId != null
            ? (products.find((row) => row.id === usualId) ??
              catalog.get(usualId) ??
              null)
            : null;
    const prefillFromProduct =
        usualProduct != null &&
        usualProduct.genericFoodId === food.id &&
        !usualProduct.archivedAt;
    const prefillStoreId = prefillFromProduct
        ? usualProduct.usualStoreId
        : food.usualStoreId;
    const prefillAmount = prefillFromProduct
        ? usualProduct.usualAmount
        : food.usualAmount;
    const stores = await liveSettingsStore().listStores(householdId);
    const noticeResult = await loadViewerNotices(gate.viewer);
    return {
        status: 200,
        html: renderUsualProductsPickerHtml({
            chrome: await viewerChromeWithAttention(
                profile,
                gate.viewer,
                noticeResult,
            ),
            food,
            products,
            usualProductId: food.usualProductId,
            prefillStoreId,
            prefillAmount,
            stores,
            from,
            error: opts.error,
        }),
    };
}

export async function renderHouseholdSettingsRoute(
    viewerUserId: string,
    opts: {
        error?: string;
        issuedToken?: string;
        openModalId?: string;
        refusalsAfter?: string | null;
        mergePost?: {
            foodA: string;
            foodB: string;
            keepId: string;
            picks: Partial<Record<MergePairPickField, string>>;
        };
    } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const householdId = gate.viewer.householdId;
    const refusalsAfter = parseRefusalCursor(opts.refusalsAfter);
    const store = liveFoodsStore();
    const refCounts = await store.countFoodRefs(householdId);
    const [config, members, location, stores, socialReaderStatus] =
        await Promise.all([
            getHouseholdConfig(householdId),
            listHouseholdMembers(householdId),
            liveSettingsStore().getLocation(householdId),
            liveSettingsStore().listStores(householdId),
            liveSocialReaderStatusStore().get(householdId),
        ]);
    const memory = recipeFetchMemory();
    const refusalsBatch = await memory.listRefusals(householdId, {
        limit: 21,
        after: refusalsAfter ?? undefined,
        now: new Date(),
    });
    const settings = liveSettingsStore();
    const rules = liveRulesStore();
    const storeViews = await Promise.all(
        stores.map(async (store) => ({
            ...store,
            sections: await settings.listSections(store.id),
            rules: await rules.listStoreRules(store.id),
        })),
    );
    const memberRules = await Promise.all(
        members.map(async (member) => ({
            member,
            rules: await rules.listPersonRules(householdId, member.userId),
            allergens: await rules.listAllergens(householdId, member.userId),
            dislikes: await rules.listDislikes(householdId, member.userId),
        })),
    );
    const fetchRefusals = refusalsBatch.slice(0, 20);
    const fetchRefusalsShowMore =
        refusalsBatch.length > 20
            ? `/settings/household?refusals_after=${encodeURIComponent(
                  `${fetchRefusals.at(-1)!.refusedAt}|${fetchRefusals.at(-1)!.host}`,
              )}`
            : null;

    const noticeResult = await loadViewerNotices(gate.viewer, {
        refCounts,
    });
    const chrome = await viewerChromeWithAttention(
        profile,
        gate.viewer,
        noticeResult,
    );
    if (chrome.flags.uiV2) {
        const pluralsSameFood = await getPluralsSameFood(householdId);
        return {
            status: 200,
            html: renderSettingsHouseholdV2Page({
                chrome,
                householdName: config.name,
                members,
                stores: storeViews.map((row) => ({
                    id: row.id,
                    householdId: row.householdId,
                    name: row.name,
                    sortOrder: row.sortOrder,
                })),
                isOwner: gate.viewer.role === "owner",
                canManage: canManageHousehold(gate.viewer),
                viewerUserId: gate.viewer.userId,
                error: opts.error,
                issuedToken: opts.issuedToken,
                openModalId: opts.openModalId,
                socialReaders: config.preferences.socialReaders,
                socialReaderStatus,
                timezone: profile?.timezone ?? "UTC",
                noticeResult,
                duplicatePairs: noticeResult.possibleDuplicatePairs,
                refCounts,
                mergePost: opts.mergePost,
                pluralsSameFood,
            }),
        };
    }
    return {
        status: 200,
        html: renderHouseholdSettingsPage({
            chrome,
            householdName: config.name,
            location: location ?? "",
            members,
            stores: storeViews,
            memberRules,
            isOwner: gate.viewer.role === "owner",
            canManage: canManageHousehold(gate.viewer),
            viewerUserId: gate.viewer.userId,
            error: opts.error,
            issuedToken: opts.issuedToken,
            openModalId: opts.openModalId,
            unverifiedRecipeExpiryDays:
                config.preferences.unverifiedRecipeExpiryDays,
            socialReaders: config.preferences.socialReaders,
            socialReaderStatus,
            timezone: profile?.timezone ?? "UTC",
            fetchRefusals,
            fetchRefusalsShowMore,
            fetchRefusalsPaged: refusalsAfter != null,
        }),
    };
}

export async function renderSettingsStoresV2Route(
    viewerUserId: string,
    opts: { error?: string; openModalId?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const householdId = gate.viewer.householdId;
    const settings = liveSettingsStore();
    const [stores, prefs, lines] = await Promise.all([
        settings.listStores(householdId),
        settings.getGroceryPreferences(householdId),
        liveGroceryStore().listLines(householdId),
    ]);
    const sectionLists = await Promise.all(
        stores.map((row) => settings.listSections(row.id)),
    );
    const counts = groceryLineCounts(lines);
    const noticeResult = await loadViewerNotices(gate.viewer);
    return {
        status: 200,
        html: renderSettingsStoresV2Page({
            chrome: await viewerChromeWithAttention(
                profile,
                gate.viewer,
                noticeResult,
            ),
            stores: stores.map((row, index) => ({
                id: row.id,
                name: row.name,
                sectionCount: sectionLists[index]!.filter((s) => !s.hidden)
                    .length,
                lineCount: counts.byStore.get(row.id) ?? 0,
            })),
            defaultStoreId: prefs.defaultStoreId,
            useUsualStore: prefs.useUsualStore,
            canManage: canManageHousehold(gate.viewer),
            error: opts.error,
            openModalId: opts.openModalId,
        }),
    };
}

export async function renderSettingsStoreV2Route(
    viewerUserId: string,
    storeId: string,
    opts: { error?: string; openModalId?: string } = {},
): Promise<{ status: 200 | 403 | 404; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const householdId = gate.viewer.householdId;
    const settings = liveSettingsStore();
    const stores = await settings.listStores(householdId);
    const store = stores.find((row) => row.id === storeId);
    if (!store) {
        return {
            status: 404,
            html: renderBarePage("Not found", emptyState("Store not found.")),
        };
    }
    const profile = await getProfile(viewerUserId);
    const [sections, rules, prefs, lines] = await Promise.all([
        settings.listSections(store.id),
        liveRulesStore().listStoreRules(store.id),
        settings.getGroceryPreferences(householdId),
        liveGroceryStore().listLines(householdId),
    ]);
    const counts = groceryLineCounts(lines);
    const noticeResult = await loadViewerNotices(gate.viewer);
    return {
        status: 200,
        html: renderSettingsStoreV2Page({
            chrome: await viewerChromeWithAttention(
                profile,
                gate.viewer,
                noticeResult,
            ),
            store,
            sections,
            sectionLineCounts: counts.bySection,
            lineCount: counts.byStore.get(store.id) ?? 0,
            rules,
            moveTarget: deleteMoveTarget(
                stores,
                store.id,
                prefs.defaultStoreId,
            ),
            canManage: canManageHousehold(gate.viewer),
            error: opts.error,
            openModalId: opts.openModalId,
        }),
    };
}

export async function renderHouseholdMemberRoute(
    viewerUserId: string,
    memberUserId: string,
    opts: { error?: string } = {},
): Promise<{ status: 200 | 403 | 404; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const flags = await viewerFlagsFor(gate.viewer);
    if (!flags.uiV2) {
        return {
            status: 404,
            html: renderBarePage("Not found", emptyState("Page not found.")),
        };
    }
    // A non-uuid id names no member and would fail the uuid cast (a 500).
    if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            memberUserId,
        )
    ) {
        return {
            status: 404,
            html: renderBarePage("Not found", emptyState("Page not found.")),
        };
    }
    const target = await getHouseholdMembership(memberUserId);
    if (target == null || target.householdId !== gate.viewer.householdId) {
        return { status: 403, html: forbiddenDashboardHtml() };
    }
    const access = dashboardAccess(gate.viewer, target);
    if (!access.ok) {
        return { status: 403, html: forbiddenDashboardHtml() };
    }
    const noticeResult = await loadViewerNotices(gate.viewer);
    const chrome = await viewerChromeWithAttention(
        profile,
        gate.viewer,
        noticeResult,
    );
    const todayHref =
        access.subject.userId === gate.viewer.userId
            ? "/"
            : `/?member=${encodeURIComponent(access.subject.userId)}`;
    return {
        status: 200,
        html: renderSettingsMemberV2Page({
            chrome,
            member: target,
            viewer: gate.viewer,
            todayHref,
            error: opts.error,
        }),
    };
}

export async function renderRecipesListPage(
    viewerUserId: string,
    opts: {
        error?: string;
        openModalId?: string;
        tag?: string;
        canMakeNow?: boolean;
        safeFor?: string;
        verification?: string;
        q?: string;
        filter?: string;
        importUrl?: string;
        importError?: string;
        importDuplicateRecipeId?: string;
        importPasteStep?: boolean;
        importPasteText?: string;
        importCredit?: string;
        importWebsiteError?: string;
        importSourceKind?: import("../domain/recipe-import.js").RecipeSourceKind;
        importSourceLabel?: string;
        importTextOrigin?: "shared" | "pasted";
        importTextOnly?: boolean;
        importWebsiteUrl?: string;
        importShowRetry?: boolean;
        importRetryDisabled?: boolean;
        shareArrived?: import("../domain/share.js").ReadShareResult;
        shareArrivedOpen?: boolean;
        /** v2: picking a recipe for this day (`?plan_date=`). */
        planDate?: string;
        /** v2: a plan move that failed its checks: its edit sheet opens with this. */
        planEdit?: PlanEditDraft;
    } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const filter = opts;
    const error = opts.error;
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const householdId = gate.viewer.householdId;
    const noticeResult = await loadViewerNotices(gate.viewer);
    const chrome = await viewerChromeWithAttention(
        profile,
        gate.viewer,
        noticeResult,
    );
    const v2Query = filter.q?.trim() ?? "";
    const v2Filter = parseV2RecipeListFilter(filter.filter);
    if (chrome.flags.uiV2) {
        const { recipes, allIngredients, fridgeItems, foodsById } =
            noticeResult.recipesListPrefetch;
        const ingredientsByRecipe = new Map<string, typeof allIngredients>();
        for (const row of allIngredients) {
            const list = ingredientsByRecipe.get(row.recipeId) ?? [];
            list.push(row);
            ingredientsByRecipe.set(row.recipeId, list);
        }
        const stock = fridgeItems.map((item) => ({
            quantity: item.quantity,
            foodId: item.foodId,
        }));
        const rows = recipes.map((recipe) => {
            const ingredients = ingredientsByRecipe.get(recipe.id) ?? [];
            return {
                recipe,
                ingredients,
                macrosPerPortion: macrosForPerson(
                    ingredients,
                    recipe.yieldPortions,
                    1,
                    foodsById,
                ),
            };
        });
        const flags = recipeFilters(rows, stock, foodsById);
        const favouriteIds = new Set(
            await liveRecipesStore().listFavourites(householdId, viewerUserId),
        );
        const cards = rows.map((row, index) => ({
            recipe: row.recipe,
            flags: flags[index]!,
            favourite: favouriteIds.has(row.recipe.id),
            macrosPerPortion: row.macrosPerPortion,
            missingNames: row.ingredients
                .filter((ingredient) => {
                    const tag = alreadyHaveTag(
                        {
                            quantity: ingredient.quantity,
                            foodId: ingredient.foodId,
                        },
                        stock,
                        foodsById,
                    );
                    return tag?.cover !== "full";
                })
                .map((ingredient) => ingredient.displayName),
        }));
        const cookableCount = cards.filter(
            (card) => card.flags.cookable,
        ).length;
        const filtered = applyV2RecipeListFilters(cards, v2Query, v2Filter);
        const loadedWeek = await loadWeekPlanView(householdId);
        const week = opts.planEdit
            ? (withPlanEditDraft(loadedWeek, opts.planEdit) ?? loadedWeek)
            : loadedWeek;
        return {
            status: 200,
            html: renderRecipesListV2Page({
                chrome,
                query: v2Query,
                filter: v2Filter,
                cards: filtered,
                cookableCount,
                totalCount: recipes.length,
                week,
                notices: noticeResult.notices,
                planDate:
                    opts.planDate && isPlanDate(opts.planDate)
                        ? opts.planDate
                        : undefined,
                importError: opts.importError,
                importPasteStep: opts.importPasteStep,
                importUrl: opts.importUrl,
                importPasteText: opts.importPasteText,
                importWebsiteError: opts.importWebsiteError,
                importWebsiteUrl: opts.importWebsiteUrl,
                importShowRetry: opts.importShowRetry,
                importRetryDisabled: opts.importRetryDisabled,
                importTextOnly: opts.importTextOnly,
                importTextOrigin: opts.importTextOrigin,
                importDuplicateRecipeId: opts.importDuplicateRecipeId,
                importCredit: opts.importCredit,
                importSourceKind: opts.importSourceKind,
                importSourceLabel: opts.importSourceLabel,
            }),
        };
    }
    const members = await listHouseholdMembers(householdId);
    const tag = filter.tag?.trim() ?? "";
    const canMakeNow = filter.canMakeNow === true;
    const safeForId =
        filter.safeFor &&
        members.some((member) => member.userId === filter.safeFor)
            ? filter.safeFor
            : "";
    const verificationRaw = filter.verification?.trim() ?? "";
    const verification =
        verificationRaw === "verified" || verificationRaw === "unverified"
            ? verificationRaw
            : "";
    let recipes;
    if (tag || canMakeNow || safeForId || verification) {
        const fridge = await listFridge(liveFridgeStore(), householdId);
        const allFoods = await liveFoodsStore().listFoods(householdId);
        const foodsById = await effectiveFoodsByIds(
            liveFoodsStore(),
            householdId,
            allFoods.map((food) => food.id),
        );
        let safeFor = null;
        if (safeForId) {
            const rules = liveRulesStore();
            const [allergens, dislikes] = await Promise.all([
                rules.listAllergens(householdId, safeForId),
                rules.listDislikes(householdId, safeForId),
            ]);
            safeFor = { allergens, dislikes };
        }
        recipes = await listRecipesFiltered(
            liveRecipesStore(),
            householdId,
            foodsById,
            fridge.items.map((item) => ({
                quantity: item.quantity,
                foodId: item.foodId,
            })),
            {
                tag: tag || null,
                canMakeNow,
                safeFor,
                verification: verification || null,
            },
        );
    } else {
        recipes = await listRecipes(liveRecipesStore(), householdId);
    }
    const store = liveRecipesStore();
    const imports = await store.listImports(householdId);
    const importByRecipeId: Record<
        string,
        {
            recipeId: string;
            sourceKind: (typeof imports)[0]["sourceKind"];
            sourceUrl: string | null;
        }
    > = {};
    for (const row of imports) {
        importByRecipeId[row.recipeId] = {
            recipeId: row.recipeId,
            sourceKind: row.sourceKind,
            sourceUrl: row.sourceUrl,
        };
    }
    return {
        status: 200,
        html: renderRecipesPage({
            chrome,
            recipes,
            members: members.map((member) => ({
                userId: member.userId,
                displayName: member.displayName,
            })),
            viewerId: viewerUserId,
            filter: {
                tag,
                canMakeNow,
                safeFor: safeForId,
                verification,
            },
            error,
            openModalId: opts.openModalId,
            importByRecipeId,
            importUrl: opts.importUrl,
            importError: opts.importError,
            importDuplicateRecipeId: opts.importDuplicateRecipeId,
            importPasteStep: opts.importPasteStep,
            importPasteText: opts.importPasteText,
            importCredit: opts.importCredit,
            importWebsiteError: opts.importWebsiteError,
            importSourceKind: opts.importSourceKind,
            importSourceLabel: opts.importSourceLabel,
            importTextOrigin: opts.importTextOrigin,
            importTextOnly: opts.importTextOnly,
            importWebsiteUrl: opts.importWebsiteUrl,
            importShowRetry: opts.importShowRetry,
            importRetryDisabled: opts.importRetryDisabled,
            shareArrived: opts.shareArrived,
            shareArrivedOpen: opts.shareArrivedOpen,
        }),
    };
}

/**
 * What cooking `servings` portions of a recipe takes from the kitchen, as the
 * cook sheet shows it. A recipe or ingredient the cook cannot run on is a
 * message, not a thrown page: the sheet says so and the confirm reports it too.
 */
export async function loadCookPreview(
    householdId: string,
    recipeId: string,
    servings: number,
): Promise<{ preview: CookPreview | null; error?: string }> {
    try {
        const preview = await previewCookRecipe(
            liveRecipesStore(),
            liveFridgeStore(),
            liveFoodsStore(),
            { householdId, recipeId, totalPortions: servings },
        );
        return { preview };
    } catch (err) {
        if (
            err instanceof StockInputError ||
            err instanceof RecipeInputError ||
            err instanceof RecipeUnverifiedError ||
            err instanceof FoodsInputError
        ) {
            return { preview: null, error: err.message };
        }
        throw err;
    }
}

async function planSheetView(
    householdId: string,
    recipeId: string,
    recipe: { name: string; yieldPortions: number },
    values: {
        open?: boolean;
        date?: string;
        slot?: string;
        servings?: number;
    } = {},
    error: string | undefined,
    failed: boolean,
): Promise<PlanSheetView> {
    const today = await householdToday(householdId);
    const date = values.date ?? today;
    return {
        recipeId,
        recipeName: recipe.name,
        yieldPortions: recipe.yieldPortions,
        today,
        date: isPlanDate(date) || failed ? date : today,
        slot: values.slot ?? "dinner",
        servings:
            values.servings != null &&
            Number.isFinite(values.servings) &&
            values.servings > 0
                ? values.servings
                : recipe.yieldPortions,
        open: values.open === true || failed,
        error,
    };
}

export async function renderRecipeDetailRoute(
    viewerUserId: string,
    recipeId: string,
    opts: {
        member?: string;
        error?: string;
        openModalId?: string;
        /** v2: open the cook sheet on load (`?cook=1`, or after a failed confirm). */
        openCook?: boolean;
        /** v2: the stepper value a failed confirm re-renders with. */
        cookServings?: number;
        /** v2: the Add to plan sheet: open on load (`?plan=1`, or after a failed add), and the values a failed add re-renders with. */
        plan?: {
            open?: boolean;
            date?: string;
            slot?: string;
            servings?: number;
        };
        linkProductId?: string;
        didYouMean?: import("./components/did-you-mean.js").DidYouMeanModal;
    } = {},
): Promise<{ status: 200 | 403 | 404; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const householdId = gate.viewer.householdId;
    const profile = await getProfile(viewerUserId);
    const members = await listHouseholdMembers(householdId);
    const filterUserId =
        opts.member && members.some((member) => member.userId === opts.member)
            ? opts.member
            : viewerUserId;
    let view;
    try {
        view = await getRecipeView(
            liveRecipesStore(),
            householdId,
            recipeId,
            filterUserId,
        );
    } catch (err) {
        if (err instanceof RecipeInputError) {
            const page = await renderRecipesListPage(viewerUserId, {
                error: err.message,
            });
            return { status: 404, html: page.html };
        }
        throw err;
    }
    const catalog = await effectiveFoodsByIds(
        liveFoodsStore(),
        householdId,
        view.ingredients.map((row) => row.foodId),
    );
    const macros = macrosForPerson(
        view.ingredients,
        view.yieldPortions,
        view.portionCount,
        catalog,
    );
    const macrosPerPortion = macrosForPerson(
        view.ingredients,
        view.yieldPortions,
        1,
        catalog,
    );
    const rules = liveRulesStore();
    const person = members.find((member) => member.userId === filterUserId);
    const [allergens, dislikes, stores] = await Promise.all([
        rules.listAllergens(householdId, filterUserId),
        rules.listDislikes(householdId, filterUserId),
        liveSettingsStore().listStores(householdId),
    ]);
    const allCatalogued = view.ingredients.every(
        (row) => row.foodId && catalog.has(row.foodId),
    );
    const allergenNoticesForPage = allergenNotices(
        { kind: "recipe", id: recipeId },
        view.ingredients.map((row) => row.displayName).join(" "),
        person
            ? [
                  {
                      displayName: person.displayName,
                      userId: person.userId,
                      allergens,
                  },
              ]
            : [],
        allCatalogued
            ? [...catalog.values()].flatMap((food) => food.allergens)
            : null,
    );
    const allFoods = await liveFoodsStore().listFoods(householdId);
    const linkProductPrompt = opts.linkProductId
        ? linkProductPromptFromFoods(
              allFoods,
              opts.linkProductId,
              `/recipes/${recipeId}`,
              true,
              opts.error,
          )
        : null;
    const foodsByIdForNoticeCtx = new Map(
        allFoods.map((f) => [f.id, { genericFoodId: f.genericFoodId }]),
    );
    const notices = recipeNotices(recipeId, view.ingredients, catalog);
    const ingredientRows = view.ingredients.map((row) => {
        const effective = row.foodId ? catalog.get(row.foodId) : null;
        let displayName = row.displayName;
        if (effective?.product) {
            displayName = `${row.displayName} · ${effective.product.name}`;
        }
        return {
            ...row,
            displayName,
            defaultUnit: effective?.defaultUnit ?? "g",
        };
    });
    const importRow = await liveRecipesStore().getImport(householdId, recipeId);
    const noticeResult = await loadViewerNotices(gate.viewer);
    const foodDuplicateNotices = possibleDuplicateNoticesByFoodId(
        noticeResult.notices,
    );
    const chrome = await viewerChromeWithAttention(
        profile,
        gate.viewer,
        noticeResult,
    );
    if (chrome.flags.uiV2) {
        const fridge = await listFridge(liveFridgeStore(), householdId);
        const foodsById = new Map(allFoods.map((f) => [f.id, f]));
        const familyIds = new Set<string>(catalog.keys());
        for (const item of fridge.items) {
            if (item.foodId) familyIds.add(item.foodId);
        }
        const familyFoodMap = new Map(
            [...familyIds]
                .map((id) => foodsById.get(id))
                .filter((f): f is NonNullable<typeof f> => f != null)
                .map((f) => [f.id, f]),
        );
        const ingredientGroups = groupRecipeIngredientsByPlace(
            ingredientRows,
            fridge.items,
            fridge.locations,
            familyFoodMap,
        );
        let cook: CookSheetView | undefined;
        if (view.verification !== "unverified") {
            const servings =
                opts.cookServings != null &&
                Number.isFinite(opts.cookServings) &&
                opts.cookServings > 0
                    ? opts.cookServings
                    : view.yieldPortions;
            const { preview, error: previewError } = await loadCookPreview(
                householdId,
                recipeId,
                servings,
            );
            const open =
                opts.openCook === true || opts.openModalId === COOK_SHEET_ID;
            cook = {
                recipeId,
                recipeName: view.name,
                servings,
                yieldPortions: view.yieldPortions,
                preview,
                previewError,
                slot: guessMealType(
                    profile?.timezone && validateTz(profile.timezone)
                        ? profile.timezone
                        : "UTC",
                ) as CookSheetView["slot"],
                macrosPerPortion: macrosPerPortion ?? macros,
                submitKey: crypto.randomUUID(),
                open,
                error: open ? opts.error : undefined,
            };
        }
        return {
            status: 200,
            html: renderRecipeDetailV2Page({
                chrome,
                recipe: view,
                ingredients: ingredientRows,
                ingredientGroups,
                macrosPerPortion: macrosPerPortion ?? macros,
                gapReasons: [
                    ...new Set(
                        notices.map((notice) => gapFromNotice(notice).message),
                    ),
                ],
                members: members.map((member) => ({
                    userId: member.userId,
                    displayName: member.displayName,
                })),
                viewerId: viewerUserId,
                portionCount: view.portionCount,
                favourite: (
                    await liveRecipesStore().listFavourites(
                        householdId,
                        viewerUserId,
                    )
                ).includes(recipeId),
                cook,
                plan: await planSheetView(
                    householdId,
                    recipeId,
                    view,
                    opts.plan,
                    opts.openModalId === PLAN_SHEET_ID ? opts.error : undefined,
                    opts.openModalId === PLAN_SHEET_ID,
                ),
                error: opts.error,
            }),
        };
    }
    return {
        status: 200,
        html: renderRecipeDetailPage({
            chrome,
            foodDuplicateNotices,
            recipe: view,
            notices,
            noticeContext: {
                from: `/recipes/${recipeId}`,
                foods: foodsByIdForNoticeCtx,
            },
            problems: importRow?.problems ?? [],
            importRow,
            ingredients: ingredientRows,
            members: members.map((member) => ({
                userId: member.userId,
                displayName: member.displayName,
            })),
            stores: stores.map((store) => ({
                id: store.id,
                name: store.name,
            })),
            viewerId: viewerUserId,
            filterUserId,
            portionCount: view.portionCount,
            macros,
            macrosPerPortion,
            allergenNotices: allergenNoticesForPage,
            dislikeNote: person
                ? (recipeDislikeNote(
                      view.ingredients.map((row) => row.displayName),
                      dislikes,
                      person.displayName,
                  ) ?? undefined)
                : undefined,
            isOwner: gate.viewer.role === "owner",
            error: opts.error,
            openModalId: opts.openModalId,
            didYouMean: opts.didYouMean,
            linkProductPrompt,
        }),
    };
}

function noticeDeps(): NoticesForDeps {
    return {
        foods: liveFoodsStore(),
        fridge: liveFridgeStore(),
        recipes: liveRecipesStore(),
        dismissals: liveNoticeDismissalsStore(),
        grocery: liveGroceryStore(),
    };
}

export async function renderNeedsAttentionInventoryPage(
    viewerUserId: string,
    error?: string,
    showDismissed?: boolean,
    post?: {
        code?: string;
        subjectKind?: string;
        subjectId?: string;
        relatedId?: string;
        undoDismissalId?: string;
        member?: HouseholdMember;
    },
): Promise<{ status: 200 | 303 | 400 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const householdId = gate.viewer.householdId;
    let pageError = error;
    let redirect = false;
    let today: string | undefined;

    if (post?.member) {
        const deps = noticeDeps();
        try {
            if (post.undoDismissalId) {
                await undoDismissal(deps, householdId, post.undoDismissalId);
                redirect = true;
            } else if (post.code && post.subjectKind && post.subjectId) {
                today = await householdToday(householdId);
                await dismissNotice(
                    deps,
                    householdId,
                    post.member.userId,
                    {
                        code: post.code as NoticeCode,
                        subjectKind: post.subjectKind as NoticeSubjectKind,
                        subjectId: post.subjectId,
                        relatedId: post.relatedId,
                    },
                    { today },
                );
                redirect = true;
            }
        } catch (err) {
            pageError =
                err instanceof NoticeDismissError
                    ? err.message
                    : err instanceof Error
                      ? err.message
                      : "Could not update notices.";
        }
    }

    // The same notices the Today card counts: the one-tap ones are listed for
    // a viewer on the new app and left out for everyone else.
    const result = await loadViewerNotices(gate.viewer, { today });
    const chrome = await viewerChromeWithAttention(
        profile,
        gate.viewer,
        result,
    );
    const html = renderNeedsAttentionPage({
        chrome,
        viewerUserId: gate.viewer.userId,
        result,
        showDismissed,
        error: pageError,
    });
    if (redirect && !pageError) {
        return { status: 303, html };
    }
    return {
        status: pageError ? 400 : 200,
        html,
    };
}

export async function renderPossibleDuplicatesRoute(
    viewerUserId: string,
    opts: {
        error?: string;
        openModalId?: string;
        mergePost?: {
            foodA: string;
            foodB: string;
            keepId: string;
            picks: Partial<Record<MergePairPickField, string>>;
        };
    } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const householdId = gate.viewer.householdId;
    const store = liveFoodsStore();
    const refCounts = await store.countFoodRefs(householdId);
    const noticeResult = await loadHouseholdNotices(householdId, {
        refCounts,
    });
    const pairs = noticeResult.possibleDuplicatePairs;
    return {
        status: 200,
        html: renderPossibleDuplicatesPage({
            chrome: await viewerChromeWithAttention(
                profile,
                gate.viewer,
                noticeResult,
            ),
            pairs,
            refCounts,
            error: opts.error,
            openModalId: opts.openModalId,
            mergePost: opts.mergePost,
        }),
    };
}
