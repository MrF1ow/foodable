import { peekSiteMembership } from "../db/actor.js";
import {
    canManageHousehold,
    dashboardAccess,
    type HouseholdMember,
} from "../household.js";
import { type AlcoholDisplay } from "../dashboard-data.js";
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
import { authUserCount, listMembersLastSeen } from "../db/users.js";
import {
    canSignUp,
    getSignupPolicy,
    signupPolicyForRoutes,
} from "../domain/signup.js";
import { liveFridgeStore } from "../db/fridge.js";
import { liveFoodsStore } from "../db/foods.js";
import { foodDisplayScore } from "../domain/product-screen.js";
import {
    DEFAULT_SCORE_PRESET,
    SCORE_PRESET_LABELS,
    type ScoreWeights,
} from "../domain/product-score.js";
import {
    isUsableChoice,
    scoreSettingsForHousehold,
    scoreSettingsForViewer,
} from "../domain/score-settings.js";
import { ALLERGEN_LABELS } from "../domain/rules.js";
import {
    renderSettingsScoreHouseholdV2Page,
    renderSettingsScoreV2Page,
    type ScoreFormDraft,
} from "./pages/v2/settings-score.js";
import { liveScoreSettingsStore } from "../db/score-settings.js";
import { liveGroceryStore } from "../db/grocery.js";
import { liveRecipesStore } from "../db/recipes.js";
import { liveSocialReaderStatusStore } from "../db/social-readers.js";
import { liveRulesStore } from "../db/rules.js";
import { liveSettingsStore } from "../db/settings.js";
import { type GroceryAllergenRetry } from "./pages/grocery.js";
import {
    ownerTimezoneLabelForSelect,
    renderHouseholdSettingsPrefsPage,
} from "./pages/settings-household.js";
import {
    effectiveFoodsByIds,
    isUsualGroceryLine,
    matchFoodsByWords,
    usualProductRows,
    type Food,
    type MergePairPickField,
} from "../domain/foods.js";
import { renderPossibleDuplicatesPage } from "./pages/possible-duplicates.js";
import {
    plainFoodIdForUsualPicker,
    usualProductsPickerHref,
} from "./usual-products-path.js";
import type { Notice } from "../domain/notices.js";
import { defaultFreezeExpiry, listFridge } from "../domain/fridge.js";
import {
    groceryAllergenWarning,
    listGrocery,
    matchGroceryAllergens,
} from "../domain/grocery.js";
import { alreadyHaveTag } from "../domain/linking.js";
import {
    gapFromNotice,
    getRecipeView,
    listRecipes,
    macrosForPerson,
    RecipeInputError,
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
import {
    GROCERY_SHARE_SHEET_ID,
    RECIPE_SHARE_SHEET_ID,
} from "./pages/v2/share-sheet.js";
import {
    buildSharedLinkRows,
    type SharedLinkRow,
} from "./pages/v2/settings-household-shared-links.js";
import { liveShareLinkStore } from "../db/share-links.js";
import { guessMealType, todayInTz, validateTz } from "../domain/tz.js";
import { fromGrams } from "../domain/units.js";
import { getLatestWeight } from "../db/nutrition.js";
import type { WeighInPrefill } from "./pages/v2/log-sheet.js";
import { viewerChromeFromProfile } from "./pages/nutrition.js";
import { loadToday, useSoonFor } from "./loaders-today.js";
import {
    listExpiring,
    previewCookRecipe,
    isCookPreviewUnavailable,
    type CookPreview,
} from "../domain/stock.js";
import { parseTodayDateParam, renderTodayV2Page } from "./pages/v2/today.js";
import {
    loadHouseholdNotices,
    loadViewerNotices,
    viewerChromeWithAttention,
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
    /** Ignored: Today opens its sheets from `v2LogSheet`. */
    _openModalId?: string,
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

    // Today loads the household's notices itself; the chrome reuses them
    // instead of loading them again.
    const todayView = await loadToday(access.subject, selectedDate, undefined, {
        readOnly: access.subject.userId !== access.viewer.userId,
    });
    const chrome = await viewerChromeWithAttention(
        viewerProfile,
        access.viewer,
        todayView.attention,
    );

    const weighInPrefill = await weighInPrefillForUser(access.viewer.userId);
    const mergedLogSheet =
        v2LogSheet == null
            ? { weighIn: weighInPrefill }
            : {
                  ...v2LogSheet,
                  weighIn: v2LogSheet?.weighIn ?? weighInPrefill,
              };
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
              todayView.householdDate,
          );
    const plan =
        week && v2Today?.planEdit
            ? (withPlanEditDraft(week, v2Today.planEdit) ?? week)
            : week;
    return {
        status: 200,
        html: renderTodayV2Page({
            chrome: { ...chrome, subjectLabel },
            view: todayView,
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
    extras?: {
        didYouMean?: import("./components/did-you-mean.js").DidYouMeanModal;
    },
    opts: { openItemId?: string; openAdd?: boolean } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const householdId = gate.viewer.householdId;
    const [snapshot, allFoods, grocerySnapshot, today] = await Promise.all([
        listFridge(liveFridgeStore(), householdId),
        liveFoodsStore().listFoods(householdId),
        listGrocery(liveGroceryStore(), liveSettingsStore(), householdId),
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
            groceryOverview: buildKitchenFridgeGroceryOverview(grocerySnapshot),
        }),
    };
}

function chromeWithKitchenGroceriesCount<
    T extends import("./attention.js").AppChromeBase,
>(chrome: T, lines: import("../domain/grocery.js").GroceryLine[]): T {
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
        /** The viewer's score weights: the badge on the line uses them. */
        scoreWeights: ScoreWeights;
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
    const isUsual = isUsualGroceryLine({
        lineFoodId: line.foodId,
        effectiveProductId: eff?.product?.id,
        food: foodRow,
        genericOf: (id) => ctx.allFoods.find((row) => row.id === id),
    });
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
    const productScore = foodRow
        ? foodDisplayScore(foodRow, ctx.scoreWeights)
        : null;
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
    const noticeResult = await loadViewerNotices(gate.viewer, { today });
    const chrome = await viewerChromeWithAttention(
        profile,
        gate.viewer,
        noticeResult,
    );
    const locations = fridge.locations.map((loc) => ({
        id: loc.id,
        name: loc.name,
    }));
    const storeIds = new Set(stores.map((row) => row.id));
    const sectionNameById = new Map(
        stores.flatMap((store) =>
            store.sections.map((section) => [section.id, section.name]),
        ),
    );
    const storeNameById = new Map(
        stores.map((store) => [store.id, store.name]),
    );
    const { weights: scoreWeights } = await scoreSettingsForViewer(
        liveScoreSettingsStore(),
        householdId,
        viewerUserId,
    );
    const metaCtx = {
        allFoods,
        catalog,
        memberAllergens,
        scoreWeights,
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
            section.lines = section.lines.map(enrich) as typeof section.lines;
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
                        (item) => item.foodId && item.foodId === line.foodId,
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
            unknownAllergen: unknownAllergen && !opts.allergenNotices?.length,
            openLineId: opts.openLineId,
            openPutAway: opts.openPutAway,
            putAwayDraft: opts.putAwayDraft,
            openAdd: addStoreId != null,
            shareEnabled: chrome.flags.mcpShareLinks,
            openShare: opts.openModalId === GROCERY_SHARE_SHEET_ID,
            addStoreId: addStoreId ?? selectedStoreId,
            allergenNotices: opts.allergenNotices,
            allergenRetry: opts.allergenRetry,
            didYouMean: opts.didYouMean,
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

export async function renderSettingsScoreV2Route(
    viewerUserId: string,
    opts: { error?: string; draft?: ScoreFormDraft } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const householdId = gate.viewer.householdId;
    const profile = await getProfile(viewerUserId);
    const chrome = await viewerChromeWithAttention(profile, gate.viewer);
    const [settings, allergens] = await Promise.all([
        scoreSettingsForViewer(
            liveScoreSettingsStore(),
            householdId,
            viewerUserId,
        ),
        liveRulesStore().listAllergens(householdId, viewerUserId),
    ]);
    const householdPreset = isUsableChoice(settings.householdDefault)
        ? settings.householdDefault.preset
        : DEFAULT_SCORE_PRESET;
    return {
        status: 200,
        html: renderSettingsScoreV2Page({
            chrome,
            preset: settings.preset,
            weights: settings.weights,
            followsHousehold: settings.member == null,
            householdPresetLabel: SCORE_PRESET_LABELS[householdPreset],
            canEditHousehold: canManageHousehold(gate.viewer),
            warnTraces: settings.warnTraces,
            compareGoals: settings.compareGoals,
            allergensText:
                allergens.length > 0
                    ? allergens
                          .map((row) => ALLERGEN_LABELS[row.allergen])
                          .join(", ")
                    : "None set",
            allergensHref: `/settings/household/members/${viewerUserId}`,
            error: opts.error,
            draft: opts.draft,
        }),
    };
}

export async function renderSettingsScoreHouseholdV2Route(
    viewerUserId: string,
    opts: { error?: string; draft?: ScoreFormDraft } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    // Reading the default's editor is for the people who may change it.
    if (!canManageHousehold(gate.viewer)) {
        return { status: 403, html: forbiddenDashboardHtml() };
    }
    const profile = await getProfile(viewerUserId);
    const chrome = await viewerChromeWithAttention(profile, gate.viewer);
    // The default alone: the viewer's own choice must not stand in for it.
    const settings = await scoreSettingsForHousehold(
        liveScoreSettingsStore(),
        gate.viewer.householdId,
    );
    const current = settings.householdDefault;
    const usable = isUsableChoice(current);
    return {
        status: 200,
        html: renderSettingsScoreHouseholdV2Page({
            chrome,
            preset: usable ? current.preset : DEFAULT_SCORE_PRESET,
            weights: settings.weights,
            isSet: usable,
            error: opts.error,
            draft: opts.draft,
        }),
    };
}

export async function renderSettingsAccountPage(
    viewerUserId: string,
    opts: { error?: string; backHref?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    return renderSettingsAccountV2Route(viewerUserId, opts);
}

export async function renderSettingsHelpRoute(
    viewerUserId: string,
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const chrome = await viewerChromeWithAttention(profile, gate.viewer);
    return {
        status: 200,
        html: renderSettingsHelpV2Page({ chrome }),
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
            backHref: opts.backHref ?? "/",
            member: gate.viewer,
            preferences: config.preferences,
            ownerTimezoneLabel: ownerTimezoneLabelForSelect(ownerProfile),
            draft: opts.draft,
            error: opts.error,
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
        opts.openFoodId && rows.some((row) => row.food.id === opts.openFoodId)
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

/** Settings › Household's Shared links: the active links with the names they show. */
async function loadSharedLinkRows(
    householdId: string,
    members: readonly { userId: string; displayName: string }[],
): Promise<SharedLinkRow[]> {
    const links = await liveShareLinkStore().listForHousehold(householdId);
    const recipes = links.some((link) => link.kind === "recipe")
        ? await liveRecipesStore().listRecipes(householdId)
        : [];
    return buildSharedLinkRows(
        links,
        new Map(members.map((m) => [m.userId, m.displayName])),
        new Map(recipes.map((r) => [r.id, r.name])),
    );
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
    const store = liveFoodsStore();
    const refCounts = await store.countFoodRefs(householdId);
    const [config, members, stores, socialReaderStatus] = await Promise.all([
        getHouseholdConfig(householdId),
        listHouseholdMembers(householdId),
        liveSettingsStore().listStores(householdId),
        liveSocialReaderStatusStore().get(householdId),
    ]);

    const noticeResult = await loadViewerNotices(gate.viewer, {
        refCounts,
    });
    const chrome = await viewerChromeWithAttention(
        profile,
        gate.viewer,
        noticeResult,
    );
    const pluralsSameFood = await getPluralsSameFood(householdId);
    // No catch: this section is the only place on the web to revoke a
    // public link, so a failed read must fail the page, not hide it. With
    // `mcp-share-links` off there are no links to list and no section.
    const sharedLinks = chrome.flags.mcpShareLinks
        ? await loadSharedLinkRows(householdId, members)
        : undefined;
    // The Last active column is a nicety: if the read fails the page still renders.
    const lastSeen = await listMembersLastSeen(householdId).catch(
        () => undefined,
    );
    return {
        status: 200,
        html: renderSettingsHouseholdV2Page({
            chrome,
            householdName: config.name,
            lastSeen,
            members,
            stores: stores.map((row) => ({
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
            sharedLinks,
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
        /** v2: a recipe pasted from another Foodable that could not be imported. */
        sharedImport?: { error?: string; input?: string };
        /** v2: picking a recipe for this day (`?plan_date=`). */
        planDate?: string;
        /** v2: a plan move that failed its checks: its edit sheet opens with this. */
        planEdit?: PlanEditDraft;
    } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const filter = opts;
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
    const cookableCount = cards.filter((card) => card.flags.cookable).length;
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
            sharedImport: opts.sharedImport,
            sharedImportEnabled: chrome.flags.mcpShareLinks,
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
        if (isCookPreviewUnavailable(err)) {
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
    const allFoods = await liveFoodsStore().listFoods(householdId);
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
    const noticeResult = await loadViewerNotices(gate.viewer);
    const chrome = await viewerChromeWithAttention(
        profile,
        gate.viewer,
        noticeResult,
    );
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
            share: chrome.flags.mcpShareLinks
                ? { open: opts.openModalId === RECIPE_SHARE_SHEET_ID }
                : undefined,
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
