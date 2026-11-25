import { peekSiteMembership } from "../db/actor.js";
import {
    canManageHousehold,
    checkManagedMember,
    dashboardAccess,
    householdTimezone,
    type HouseholdMember,
} from "../household.js";
import { can } from "../domain/permissions.js";
import { type AlcoholDisplay } from "../mcp/shared.js";
import {
    alcoholTrackingEnabledFromProfile,
    getProfile,
    hiddenNutrientsFromProfile,
    preferredDrinkUnitFromProfile,
    preferredWeightUnitFromProfile,
    widgetsEnabledFromProfile,
} from "../db/profiles.js";
import {
    getHouseholdConfig,
    getHouseholdMembership,
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
import { formatQuantityDisplayParts } from "./display-quantity.js";
import { liveScoreSettingsStore } from "../db/score-settings.js";
import { liveGroceryStore } from "../db/grocery.js";
import { liveRecipesStore, liveRecipeVariantsStore } from "../db/recipes.js";
import { compareVersions, previewReset } from "../domain/recipe-variants.js";
import { liveRulesStore } from "../db/rules.js";
import { liveSettingsStore } from "../db/settings.js";
import {
    effectiveFoodsByIds,
    isUsualGroceryLine,
    matchFoodsByWords,
    usualProductRows,
    type Food,
    type MergePairPickField,
} from "../domain/foods.js";
import {
    findDuplicatePair,
    renderSettingsDuplicateCompareV2Page,
    renderSettingsDuplicatesV2Page,
    type DuplicateMergePost,
} from "./pages/v2/settings-duplicates.js";
import {
    plainFoodIdForUsualPicker,
    usualProductsPickerHref,
} from "./usual-products-path.js";
import type { Notice } from "../domain/notices.js";
import { defaultFreezeExpiry, listFridge } from "../domain/fridge.js";
import {
    groceryAllergenWarning,
    groceryFamilyOf,
    listGrocery,
    matchGroceryAllergens,
} from "../domain/grocery.js";
import { alreadyHaveTag } from "../domain/linking.js";
import {
    gapFromNotice,
    getRecipeView,
    isRecipeDraft,
    type RecipeIngredient,
    type RecipeView,
    listRecipes,
    macrosForPerson,
    RecipeInputError,
    recipeFilters,
    recipeNotices,
} from "../domain/recipes.js";
import { verifyRecipe } from "../domain/recipe-import.js";
import { renderRecipesListV2Page } from "./pages/v2/recipes-list.js";
import {
    applyFilters,
    matchesRecipeQuery,
    parseFilterParam,
} from "../domain/recipe-filters.js";
import {
    lowStockLevels,
    renderKitchenFridgeV2Page,
    type FridgeAddUsual,
    type KitchenFridgeFoodMeta,
} from "./pages/v2/kitchen-fridge.js";
import {
    groceryOpenLineCount,
    addStoreIdFromModal,
    isGroceryAddModal,
    lowLeftFromReason,
    renderKitchenGroceriesV2Page,
    type GroceryAllergenRetry,
    type GroceryLineView,
    type GroceryAddUsual,
    type KitchenGroceriesLineMeta,
    type PutAwayDraft,
} from "./pages/v2/kitchen-groceries.js";
import {
    usualAddFoundView,
    type UsualAddFound,
    type UsualAddTab,
    type UsualAddView,
} from "./pages/v2/kitchen-usuals-add.js";
import {
    kitchenUsualRowMeta,
    parseUsualsStoreFilter,
    renderKitchenUsualsV2Page,
    restockWeekdayLabel,
    type KitchenUsualsRowMeta,
} from "./pages/v2/kitchen-usuals.js";
import { renderSettingsHouseholdV2Page } from "./pages/v2/settings-household.js";
import { renderSettingsRestockV2Page } from "./pages/v2/settings-restock.js";
import { renderSettingsReadersV2Page } from "./pages/v2/settings-readers.js";
import type { SocialReaderId } from "../copy/social-readers.js";
import { recipeFetchMemory } from "../db/fetch-memory.js";
import type { FetchMemoryStore } from "../domain/fetch-memory.js";
import { renderSettingsStoresV2Page } from "./pages/v2/settings-stores.js";
import { renderSettingsStoreV2Page } from "./pages/v2/settings-stores-detail.js";
import {
    deleteMoveTarget,
    groceryLineCounts,
} from "../domain/grocery-sections.js";
import { renderSettingsMemberV2Page } from "./pages/v2/settings-member.js";
import { recipeMentionWarnings } from "../domain/recipe-mentions-check.js";
import type { MentionWarning } from "../domain/recipe-mentions.js";
import {
    groupRecipeIngredientsByPlace,
    ingredientVersionNote,
    renderRecipeDetailV2Page,
    type RecipeVersionPicker,
} from "./pages/v2/recipes-page.js";
import { renderRecipeCompareV2Page } from "./pages/v2/recipes-page-compare.js";
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
    renderSharedLinksPage,
    type SharedLinkRow,
} from "./pages/v2/settings-household-shared-links.js";
import { renderHouseholdTokenPage } from "./pages/v2/settings-household-token.js";
import { liveShareLinkStore } from "../db/share-links.js";
import {
    dateInTz,
    guessMealType,
    shiftLocalDate,
    todayInTz,
    validateTz,
} from "../domain/tz.js";
import { fromGrams } from "../domain/units.js";
import { getLatestWeight } from "../db/nutrition.js";
import type { WeighInPrefill } from "./pages/v2/log-sheet.js";
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
import { householdClock, householdToday } from "../db/restock.js";
import { loadWeekPlanView } from "./loaders-plan.js";
import { isPlanDate, type PlanSlot } from "../domain/plan.js";
import { liveRecipePlansStore } from "../db/plans.js";
import {
    PLAN_SHEET_ID,
    withPlanEditDraft,
    type PlanEditDraft,
    type PlanSheetView,
} from "./pages/v2/recipes-plan.js";
import { liveNoticeDismissalsStore } from "../db/notice-dismissals.js";
import { dismissedKeySet, isDismissedIn } from "../domain/notice-dismissals.js";
import { groceryRestockNotices } from "../domain/restock.js";
import { maybeOne, run } from "../db/sql.js";
import { renderSettingsHomeV2Page } from "./pages/v2/settings-home.js";
import { renderSettingsAccountV2Page } from "./pages/v2/settings-account.js";
import { renderSettingsTimezoneV2Page } from "./pages/v2/settings-account-timezone.js";
import { renderSettingsUnitsV2Page } from "./pages/v2/settings-units.js";
import { renderSettingsNutrientsV2Page } from "./pages/v2/settings-nutrients.js";
import { renderSettingsGoalsV2Page } from "./pages/v2/settings-goals.js";
import type {
    GoalsFormDraft,
    GoalsFormField,
} from "./pages/v2/settings-goals-form.js";
import { renderSettingsSavedV2Page } from "./pages/v2/settings-saved.js";
import {
    AI_ACTIVITY_LIMIT,
    agentActivityRows,
    renderSettingsAiV2Page,
    resolveAppFilter,
} from "./pages/v2/settings-ai.js";
import { listAgentActions } from "../domain/agent-actions.js";
import { liveAgentActionDeps } from "../db/agent-actions.js";
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

export function forbiddenDashboardHtml(
    theme: ThemePref = "system",
    message = "You need a household membership to view this dashboard.",
): string {
    return renderBarePage("Household", emptyState(message), theme);
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
        todayView,
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
    const [snapshot, allFoods, grocerySnapshot, today, { weights }] =
        await Promise.all([
            listFridge(liveFridgeStore(), householdId),
            liveFoodsStore().listFoods(householdId),
            listGrocery(liveGroceryStore(), liveSettingsStore(), householdId),
            householdToday(householdId),
            scoreSettingsForViewer(
                liveScoreSettingsStore(),
                householdId,
                viewerUserId,
            ),
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
    const stocked = new Set(snapshot.items.flatMap((i) => i.foodId ?? []));
    const scores = new Map<string, number>();
    for (const row of allFoods) {
        if (!stocked.has(row.id)) continue;
        const score = foodDisplayScore(row, weights);
        if (score != null) scores.set(row.id, score);
    }
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
            lowStock: lowStockLevels(noticeResult.notices, allFoods),
            scores,
            usuals: addableUsuals(allFoods),
        }),
    };
}

/** The usuals the Add sheets offer, each with the plain food it belongs to. */
function addableUsualRows(
    foods: readonly Food[],
): { plainId: string; storeId: string | null; add: FridgeAddUsual }[] {
    return usualProductRows({ foods }).rows.map(({ food, usual }) => {
        const amount = food.usualAmount;
        const unit = amount?.unit?.trim() || "each";
        const qty =
            amount?.amount != null && amount.amount > 0 ? amount.amount : 1;
        const label = formatQuantityDisplayParts(qty, unit);
        return {
            plainId: food.id,
            // The store the usual goes to by its own settings: its product's
            // first, as the domain reads them.
            storeId: usual?.usualStoreId ?? food.usualStoreId ?? null,
            add: {
                foodId: (usual ?? food).id,
                kind: (usual ?? food).kind === "supply" ? "supply" : "food",
                name: food.name,
                subtitle: usual ? `${usual.name} · ${label}` : label,
                amount: qty,
                unit,
            },
        };
    });
}

/** The usuals the fridge's Add sheet offers: each as its usual product, with its usual amount. */
function addableUsuals(foods: readonly Food[]): FridgeAddUsual[] {
    return addableUsualRows(foods).map((row) => row.add);
}

/**
 * The usuals the grocery Add sheet offers: those not on the list yet, the ones
 * running low first, each with the level it is below.
 */
function groceryAddUsuals(
    foods: readonly Food[],
    lines: readonly import("../domain/grocery.js").GroceryLine[],
    low: {
        below: ReadonlyMap<string, string>;
        left: ReadonlyMap<string, string>;
    },
    storeNames: ReadonlyMap<string, string>,
): GroceryAddUsual[] {
    const onList = new Set(
        lines.flatMap((line) => (line.foodId ? [line.foodId] : [])),
    );
    return addableUsualRows(foods)
        .filter(
            (row) => !onList.has(row.plainId) && !onList.has(row.add.foodId),
        )
        .map((row): GroceryAddUsual => {
            const below = low.below.get(row.plainId);
            const left = low.left.get(row.plainId);
            const storeName =
                row.storeId != null ? storeNames.get(row.storeId) : undefined;
            return {
                ...row.add,
                ...(below != null ? { lowBelow: below } : {}),
                ...(below != null && left != null ? { lowLeft: left } : {}),
                ...(storeName != null ? { storeName } : {}),
            };
        })
        .sort(
            (a, b) =>
                Number(b.lowBelow != null) - Number(a.lowBelow != null) ||
                a.name.localeCompare(b.name),
        );
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
        /** The stores to show (a store id, or several); none shows every store. */
        storeFilter?: string | readonly string[];
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
    const asked =
        typeof opts.storeFilter === "string"
            ? [opts.storeFilter]
            : (opts.storeFilter ?? []);
    const selectedStoreIds = stores
        .map((store) => store.id)
        .filter((id) => asked.includes(id));
    const chromeWithCount = chromeWithKitchenGroceriesCount(
        chrome,
        snapshot.lines,
    );
    const addStoreId = addStoreIdFromModal(opts.openModalId);
    const lowLeft = new Map<string, string>();
    for (const notice of noticeResult.notices) {
        if (notice.code !== "grocery.running_low") continue;
        const left = lowLeftFromReason(notice.params.reason);
        if (left != null) lowLeft.set(notice.subject.id, left);
    }
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
            selectedStoreIds,
            error: opts.error,
            unknownAllergen: unknownAllergen && !opts.allergenNotices?.length,
            openLineId: opts.openLineId,
            openPutAway: opts.openPutAway,
            putAwayDraft: opts.putAwayDraft,
            openAdd: isGroceryAddModal(opts.openModalId),
            shareEnabled: chrome.flags.mcpShareLinks,
            openShare: opts.openModalId === GROCERY_SHARE_SHEET_ID,
            addStoreId,
            usuals: groceryAddUsuals(
                allFoods,
                snapshot.lines,
                {
                    below: lowStockLevels(noticeResult.notices, allFoods),
                    left: lowLeft,
                },
                new Map(snapshot.stores.map((store) => [store.id, store.name])),
            ),
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

async function settingsViewerEmail(userId: string): Promise<string | null> {
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
            return row?.email ?? null;
        });
    } catch {
        return null;
    }
}

export async function renderSettingsHomeRoute(
    viewerUserId: string,
    opts: { error?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const chrome = await viewerChromeWithAttention(profile, gate.viewer);
    const email = (await settingsViewerEmail(viewerUserId)) ?? "";
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
            error: opts.error,
        }),
    };
}

export async function renderSettingsAccountV2Route(
    viewerUserId: string,
    opts: { error?: string; backHref?: string; openSheetId?: string } = {},
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
            email: await settingsViewerEmail(viewerUserId),
            timezone: profile?.timezone ?? "",
            error: opts.error,
            openSheetId: opts.openSheetId,
            photo: {
                userId: gate.viewer.userId,
                version:
                    chrome.identity?.avatarVersions?.get(gate.viewer.userId) ??
                    null,
            },
        }),
    };
}

export async function renderSettingsTimezoneV2Route(
    viewerUserId: string,
    opts: { error?: string; backHref?: string; q?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const chrome = await viewerChromeWithAttention(profile, gate.viewer);
    return {
        status: 200,
        html: renderSettingsTimezoneV2Page({
            chrome,
            backHref: opts.backHref ?? "/",
            timezone: profile?.timezone ?? "",
            query: opts.q,
            error: opts.error,
        }),
    };
}

/** Settings › Household › Time zone: the household's zone, for a manager. */
export async function renderHouseholdTimezoneRoute(
    viewerUserId: string,
    opts: { error?: string; q?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    if (!canManageHousehold(gate.viewer)) {
        return { status: 403, html: forbiddenDashboardHtml() };
    }
    const profile = await getProfile(viewerUserId);
    const config = await getHouseholdConfig(gate.viewer.householdId);
    const chrome = await viewerChromeWithAttention(profile, gate.viewer);
    return {
        status: 200,
        html: renderSettingsTimezoneV2Page({
            chrome,
            household: true,
            backHref: "/settings/household",
            timezone: config.preferences.timezone ?? "",
            query: opts.q,
            error: opts.error,
        }),
    };
}

export async function renderSettingsUnitsV2Route(
    viewerUserId: string,
    opts: { error?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const chrome = await viewerChromeWithAttention(profile, gate.viewer);
    return {
        status: 200,
        html: renderSettingsUnitsV2Page({
            chrome,
            weightUnit: preferredWeightUnitFromProfile(profile) ?? "",
            drinkUnit: preferredDrinkUnitFromProfile(profile) ?? "",
            error: opts.error,
        }),
    };
}

export async function renderSettingsNutrientsV2Route(
    viewerUserId: string,
    opts: { error?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const chrome = await viewerChromeWithAttention(profile, gate.viewer);
    return {
        status: 200,
        html: renderSettingsNutrientsV2Page({
            chrome,
            hidden: hiddenNutrientsFromProfile(profile),
            alcoholTrackingEnabled: alcoholTrackingEnabledFromProfile(profile),
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
        typed?: Record<string, string | string[]>;
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
            duplicateCount: noticeResult.possibleDuplicatePairs.length,
            searchQuery: q,
            error: opts.error,
            openModalId: opts.openModalId,
            typed: opts.typed,
        }),
    };
}

export async function renderSettingsAiV2Route(
    viewerUserId: string,
    opts: { mcpUrl: string; error?: string; app?: string },
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const householdId = gate.viewer.householdId;
    const isOwner = can(gate.viewer, "agents.household_switch").ok;
    const profile = await getProfile(viewerUserId);
    const timezone = profile?.timezone?.trim() || "UTC";
    const now = new Date();
    const chrome = await viewerChromeWithAttention(profile, gate.viewer);
    const [connections, allowed, canDelete, entries, members] =
        await Promise.all([
            // Only the caller's own connections: the id is the session's.
            listConnections(viewerUserId),
            liveSettingsStore().getAgentDestructiveAllowed(householdId),
            liveSettingsStore().getMemberAgentsCanDelete(
                householdId,
                viewerUserId,
            ),
            listAgentActions(liveAgentActionDeps(), householdId, {
                limit: AI_ACTIVITY_LIMIT,
                now,
            }),
            listHouseholdMembers(householdId),
        ]);
    return {
        status: 200,
        html: renderSettingsAiV2Page({
            chrome,
            connections,
            destructive: { allowed, canChange: isOwner },
            personal: {
                canDelete,
                // The owner turned it off themselves, so only others are told who did.
                householdOffBy:
                    allowed || isOwner
                        ? null
                        : (members.find(
                              (m) => can(m, "household.owner_only").ok,
                          )?.displayName ?? ""),
            },
            showCards: widgetsEnabledFromProfile(profile),
            activity: agentActivityRows(entries, {
                viewerUserId,
                isOwner: can(gate.viewer, "agents.undo_any").ok,
                names: new Map(members.map((m) => [m.userId, m.displayName])),
                undoAnyIds: new Set(
                    members
                        .filter((m) => can(m, "agents.undo_any").ok)
                        .map((m) => m.userId),
                ),
                now,
                timezone,
            }),
            // Only narrows the list this viewer already sees.
            appFilter: resolveAppFilter(opts.app, connections),
            now,
            timezone,
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
    opts: { error?: string; backHref?: string; openSheetId?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    return renderSettingsAccountV2Route(viewerUserId, opts);
}

export async function renderSettingsHelpRoute(
    viewerUserId: string,
    opts: { q?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const chrome = await viewerChromeWithAttention(profile, gate.viewer);
    return {
        status: 200,
        html: renderSettingsHelpV2Page({ chrome, query: opts.q }),
    };
}

/** What the Add a usual sheet should show: set by its routes, built into a view here. */
export type UsualAddRequest = {
    tab?: UsualAddTab;
    /** A search of foods (the Search tab). */
    search?: string;
    scan?:
        | ({ kind: "found" } & UsualAddFound)
        | {
              kind: "miss";
              code: string;
              lookupFailed: boolean;
              paused?: boolean;
          }
        | { kind: "invalid"; code: string };
    type?: { values: Record<string, string> };
    error?: { message: string; field: string | null };
};

export async function renderUsualProductsListPage(
    viewerUserId: string,
    opts: {
        error?: string;
        from?: string;
        q?: string;
        storeFilter?: string;
        openFoodId?: string;
        openRestock?: boolean;
        add?: UsualAddRequest;
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
    const q = (opts.add?.search ?? opts.q)?.trim() ?? "";
    const request = opts.add;
    let add: UsualAddView | undefined;
    if (request || q) {
        const aliases = await store.listAllAliases(householdId);
        add = {
            tab: request?.tab ?? "scan",
            type: request?.type,
            error: request?.error,
        };
        if (q) {
            const matched = matchFoodsByWords(q, addable, aliases);
            add.search = {
                q,
                results: matched.slice(0, 20),
                truncated: matched.length > 20,
            };
            if (!request?.tab) add.tab = "search";
        }
        if (request?.scan?.kind === "found") {
            const found = usualAddFoundView(request.scan, foods, aliases);
            if (found) add.scan = found;
        } else if (request?.scan) {
            add.scan = request.scan;
        }
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
    const selectedStoreIds = parseUsualsStoreFilter(opts.storeFilter, stores);
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
            selectedStoreIds,
            error,
            openFoodId: knownOpen,
            openRestock: opts.openRestock,
            restockDay: config.preferences.restock.enabled
                ? restockWeekdayLabel(config.preferences.restock.weekday)
                : null,
            add,
            openGroceriesCount: groceryOpenLineCount(groceryLines),
        }),
    };
}

/** Settings › Household › Shared links: the active links with the names they show. */
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

/** The owner first, then everyone else in the order given. */
export function ownerFirst<T extends { role: string }>(
    members: readonly T[],
): T[] {
    // oxlint-disable-next-line foodable/no-raw-role-check -- orders the list for display; a data lookup, not a permission decision
    const owners = members.filter((m) => m.role === "owner");
    // oxlint-disable-next-line foodable/no-raw-role-check -- orders the list for display; a data lookup, not a permission decision
    return [...owners, ...members.filter((m) => m.role !== "owner")];
}

export async function renderHouseholdSettingsRoute(
    viewerUserId: string,
    opts: {
        error?: string;
        openModalId?: string;
    } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const householdId = gate.viewer.householdId;
    const [config, listed, stores, location] = await Promise.all([
        getHouseholdConfig(householdId),
        listHouseholdMembers(householdId),
        liveSettingsStore().listStores(householdId),
        liveSettingsStore().getLocation(householdId),
    ]);
    const members = ownerFirst(listed);
    // oxlint-disable-next-line foodable/no-raw-role-check -- finds the owner's row; a data lookup, not a permission decision
    const ownerId = members.find((m) => m.role === "owner")?.userId;
    const ownerProfile =
        ownerId === viewerUserId
            ? profile
            : ownerId
              ? await getProfile(ownerId)
              : null;
    const effectiveTimezone = householdTimezone(
        config.preferences,
        ownerProfile,
    );
    // UTC here is only the fallback when neither side has a valid zone.
    const ownerZone = ownerProfile?.timezone;
    const effectiveTimezoneDefaulted =
        !(
            config.preferences.timezone != null &&
            validateTz(config.preferences.timezone)
        ) && !(ownerZone != null && validateTz(ownerZone));

    const noticeResult = await loadViewerNotices(gate.viewer);
    const chrome = await viewerChromeWithAttention(
        profile,
        gate.viewer,
        noticeResult,
    );
    // No catch: the Shared links row counts them, and the page behind it is the
    // only place on the web to revoke a public link, so a failed read must fail
    // the page, not hide it. With `mcp-share-links` off there are no links to
    // list and no row.
    const sharedLinks = chrome.flags.mcpShareLinks
        ? await loadSharedLinkRows(householdId, members)
        : undefined;
    return {
        status: 200,
        html: renderSettingsHouseholdV2Page({
            chrome,
            householdName: config.name,
            members,
            storeCount: stores.length,
            isOwner: can(gate.viewer, "household.owner_only").ok,
            canManage: canManageHousehold(gate.viewer),
            canInvite: can(gate.viewer, "member.manage").ok,
            viewerUserId: gate.viewer.userId,
            error: opts.error,
            openModalId: opts.openModalId,
            socialReaders: config.preferences.socialReaders,
            location,
            householdTimezone: config.preferences.timezone,
            effectiveTimezone,
            effectiveTimezoneDefaulted,
            restock: config.preferences.restock,
            unverifiedRecipeExpiryDays:
                config.preferences.unverifiedRecipeExpiryDays,
            sharedLinks,
        }),
    };
}

/** The page that shows a freshly rotated household token (owner only, once). */
export async function renderHouseholdTokenRoute(
    viewerUserId: string,
    token: string,
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const noticeResult = await loadViewerNotices(gate.viewer);
    const chrome = await viewerChromeWithAttention(
        profile,
        gate.viewer,
        noticeResult,
    );
    return { status: 200, html: renderHouseholdTokenPage({ chrome, token }) };
}

/**
 * Settings › Household › Shared links. With `mcp-share-links` off the page is
 * not there (a 404), as are the links it would list.
 */
export async function renderSharedLinksRoute(
    viewerUserId: string,
    opts: { error?: string } = {},
): Promise<{ status: 200 | 403 | 404; html: string }> {
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
    if (!chrome.flags.mcpShareLinks) {
        return {
            status: 404,
            html: renderBarePage("Not found", emptyState("Page not found.")),
        };
    }
    const [{ timezone }, members] = await Promise.all([
        householdClock(householdId),
        listHouseholdMembers(householdId),
    ]);
    return {
        status: 200,
        html: renderSharedLinksPage({
            chrome,
            links: await loadSharedLinkRows(householdId, members),
            timezone,
            error: opts.error,
        }),
    };
}

/** Every unexpired refusal host, paged with `after` until a page comes back empty. */
export async function listAllRefusalHosts(
    memory: FetchMemoryStore,
    householdId: string,
    now = new Date(),
): Promise<string[]> {
    const hosts: string[] = [];
    let after: { refusedAt: string; host: string } | undefined;
    for (;;) {
        const page = await memory.listRefusals(householdId, {
            limit: 200,
            after,
            now,
        });
        if (page.length === 0) return hosts;
        for (const row of page) hosts.push(row.host);
        const last = page[page.length - 1]!;
        after = { refusedAt: last.refusedAt, host: last.host };
    }
}

export async function renderHouseholdRestockRoute(
    viewerUserId: string,
    opts: { error?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const config = await getHouseholdConfig(gate.viewer.householdId);
    const noticeResult = await loadViewerNotices(gate.viewer);
    return {
        status: 200,
        html: renderSettingsRestockV2Page({
            chrome: await viewerChromeWithAttention(
                profile,
                gate.viewer,
                noticeResult,
            ),
            restock: config.preferences.restock,
            canManage: canManageHousehold(gate.viewer),
            error: opts.error,
        }),
    };
}

export async function renderHouseholdReadersRoute(
    viewerUserId: string,
    opts: { error?: string; confirmReader?: SocialReaderId } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const householdId = gate.viewer.householdId;
    const [config, blocked] = await Promise.all([
        getHouseholdConfig(householdId),
        listAllRefusalHosts(recipeFetchMemory(), householdId),
    ]);
    const noticeResult = await loadViewerNotices(gate.viewer);
    return {
        status: 200,
        html: renderSettingsReadersV2Page({
            chrome: await viewerChromeWithAttention(
                profile,
                gate.viewer,
                noticeResult,
            ),
            socialReaders: config.preferences.socialReaders,
            blockedCount: blocked.length,
            isOwner: can(gate.viewer, "household.recipe_link_readers").ok,
            canManage: canManageHousehold(gate.viewer),
            error: opts.error,
            confirmReader: opts.confirmReader,
        }),
    };
}

export async function renderSettingsStoresV2Route(
    viewerUserId: string,
    opts: { error?: string; open?: string; reorder?: boolean } = {},
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
            reorder: opts.reorder,
            error: opts.error,
            open: opts.open,
        }),
    };
}

export async function renderSettingsStoreV2Route(
    viewerUserId: string,
    storeId: string,
    opts: {
        error?: string;
        open?: string;
        rename?: boolean;
        renameSectionId?: string;
    } = {},
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
            rename: opts.rename,
            renameSectionId: opts.renameSectionId,
            error: opts.error,
            open: opts.open,
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
    // Last active is a nicety: if the read fails the page still renders.
    const lastSeen = await listMembersLastSeen(gate.viewer.householdId)
        .then((seen) => seen.get(target.userId) ?? null)
        .catch(() => undefined);
    // What the viewer may do to this person, decided as the routes decide it.
    const manage = {
        role: checkManagedMember(gate.viewer, target, "role").ok,
        transfer: checkManagedMember(gate.viewer, target, "transfer").ok,
        remove: checkManagedMember(gate.viewer, target, "remove").ok,
    };
    return {
        status: 200,
        html: renderSettingsMemberV2Page({
            chrome,
            member: target,
            viewer: gate.viewer,
            todayHref,
            error: opts.error,
            manage,
            lastSeen,
            timezone: profile?.timezone ?? "UTC",
        }),
    };
}

export async function renderRecipesListPage(
    viewerUserId: string,
    opts: {
        error?: string;
        q?: string;
        filter?: string;
        importUrl?: string;
        importError?: string;
        importErrorReason?: string;
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
        /** v2: a recipe pasted from another Foodable that could not be imported. */
        sharedImport?: {
            error?: string;
            reason?: string;
            input?: string;
            via?: "field" | "form";
        };
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
    const v2Filters = parseFilterParam(filter.filter);
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
    const kept = new Set(
        applyFilters(
            recipes.filter((recipe) => matchesRecipeQuery(recipe, v2Query)),
            v2Filters,
            {
                flags: new Map(
                    cards.map((card) => [card.recipe.id, card.flags]),
                ),
                favouriteIds,
            },
        ).map((recipe) => recipe.id),
    );
    const filtered = cards.filter((card) => kept.has(card.recipe.id));
    const loadedWeek = await loadWeekPlanView(householdId);
    const week = opts.planEdit
        ? (withPlanEditDraft(loadedWeek, opts.planEdit) ?? loadedWeek)
        : loadedWeek;
    return {
        status: 200,
        html: renderRecipesListV2Page({
            chrome,
            query: v2Query,
            filters: v2Filters,
            cards: filtered,
            totalCount: recipes.length,
            week,
            planDate:
                opts.planDate && isPlanDate(opts.planDate)
                    ? opts.planDate
                    : undefined,
            importError: opts.importError,
            importErrorReason: opts.importErrorReason,
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
            drafts: await viewerDrafts(
                householdId,
                viewerUserId,
                can(gate.viewer, "recipe.delete_any").ok,
            ),
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
    /** The member whose version is cooked; absent cooks the base. */
    version?: string,
): Promise<{
    preview: CookPreview | null;
    error?: string;
    /** Where each fridge item the cook takes from is kept, by item id. */
    places: Map<string, string>;
}> {
    try {
        const preview = await previewCookRecipe(
            liveRecipesStore(),
            liveFridgeStore(),
            liveFoodsStore(),
            {
                householdId,
                recipeId,
                totalPortions: servings,
                ...(version
                    ? {
                          memberPortions: [
                              { userId: version, portions: servings },
                          ],
                          variants: liveRecipeVariantsStore(),
                      }
                    : {}),
            },
        );
        const places = new Map<string, string>();
        if (preview.lines.length > 0) {
            const fridge = await listFridge(liveFridgeStore(), householdId);
            const locations = new Map(
                fridge.locations.map((loc) => [loc.id, loc.name]),
            );
            for (const item of fridge.items) {
                const name = locations.get(item.locationId);
                if (name) places.set(item.id, name);
            }
        }
        return { preview, places };
    } catch (err) {
        if (isCookPreviewUnavailable(err)) {
            return { preview: null, error: err.message, places: new Map() };
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

/**
 * This recipe's plans from the household's today on, for the "Planned" line.
 * The Add to plan sheet takes any day, so this reads every upcoming plan, not
 * only the week the Recipes strip shows; the page names the first few.
 */
/** How far ahead the recipe page looks for this recipe's plan entries. */
const UPCOMING_PLAN_DAYS = 56;

async function upcomingPlansOf(
    householdId: string,
    recipeId: string,
): Promise<{ date: string; slot: PlanSlot }[]> {
    const today = await householdToday(householdId);
    // A bounded read: plan entries further out than this are rare, and an
    // open-ended range would make every page load walk a repeating plan's
    // whole future.
    const plans = await liveRecipePlansStore().listPlans(
        householdId,
        today,
        shiftLocalDate(today, UPCOMING_PLAN_DAYS),
    );
    return plans
        .filter((p) => p.recipeId === recipeId)
        .map((p) => ({ date: p.date, slot: p.slot }));
}

/**
 * What the steps mention that the ingredients lack, for the recipe page. It is
 * advice beside a page that works without it, so a lookup that fails is logged
 * and the page renders without the cards.
 */
async function recipeMentionsForPage(
    householdId: string,
    view: RecipeView,
): Promise<MentionWarning[]> {
    try {
        return await recipeMentionWarnings(
            { recipes: liveRecipesStore(), foods: liveFoodsStore() },
            householdId,
            view.id,
            { recipe: view, ingredients: view.ingredients },
        );
    } catch (err) {
        console.error(
            `[recipes] mention warnings for ${view.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [];
    }
}

/**
 * The whose-version pull-down's data. A household of one with no changes of
 * their own has nothing to pick, so the caption stays plain; viewing the base
 * always keeps the way back.
 */
function versionPicker(input: {
    viewerId: string;
    viewing: string;
    viewingName: string;
    changeCount: number;
    members: readonly { userId: string; displayName: string }[];
    canCompare: boolean;
}): RecipeVersionPicker | undefined {
    if (
        input.members.length < 2 &&
        input.changeCount === 0 &&
        input.viewing !== "base"
    ) {
        return undefined;
    }
    return {
        viewerId: input.viewerId,
        viewing: input.viewing,
        viewingName: input.viewingName,
        changeCount: input.changeCount,
        people: input.members.map((member) => ({
            userId: member.userId,
            name: member.displayName,
        })),
        canCompare: input.canCompare,
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
    // Whose version is shown: the viewer's own unless the address names
    // another member, or `base` for the recipe as everyone starts from it.
    const asked = (opts.member ?? "").toLowerCase();
    const named = members.find(
        (member) => member.userId.toLowerCase() === asked,
    );
    const viewing = asked === "base" ? "base" : (named?.userId ?? viewerUserId);
    let view;
    try {
        view = await getRecipeView(
            liveRecipesStore(),
            householdId,
            recipeId,
            viewing === "base" ? viewerUserId : viewing,
            viewing === "base" ? undefined : liveRecipeVariantsStore(),
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
    // What a line of the shown version says about the base: the person who
    // changed it, and what it was.
    const baseLines = view.variant
        ? new Map(
              (
                  await liveRecipesStore().listIngredients(
                      householdId,
                      recipeId,
                  )
              ).map((row) => [row.id, row]),
          )
        : new Map<string, RecipeIngredient>();
    const viewingName =
        viewing === "base"
            ? "Base"
            : (members.find((member) => member.userId === viewing)
                  ?.displayName ?? "");
    const ingredientRows = view.ingredients.map((row) => {
        const effective = row.foodId ? catalog.get(row.foodId) : null;
        let displayName = row.displayName;
        if (effective?.product) {
            displayName = `${row.displayName} · ${effective.product.name}`;
        }
        const versionNote = row.change
            ? ingredientVersionNote(
                  viewing === viewerUserId ? "Yours" : `${viewingName}'s`,
                  row.change,
                  baseLines.get(row.id),
              )
            : undefined;
        return {
            ...row,
            displayName,
            defaultUnit: effective?.defaultUnit ?? "g",
            ...(versionNote ? { versionNote } : {}),
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
    const listedFoodIds = new Set(
        (await liveGroceryStore().listLines(householdId))
            .filter((line) => !line.checked && line.foodId)
            .map((line) => line.foodId!),
    );
    const onList = ingredientRows.flatMap((row) => {
        const id = row.foodId;
        if (!id) return [];
        const food = foodsById.get(id);
        const covered = food
            ? groceryFamilyOf(food, allFoods).foodIds.some((member) =>
                  listedFoodIds.has(member),
              )
            : listedFoodIds.has(id);
        return covered ? [id] : [];
    });
    let cook: CookSheetView | undefined;
    // The cook follows the version shown: that person's amounts come off the
    // kitchen, and the portion logged is worked out from them too.
    const cookVersion = viewing === "base" ? undefined : viewing;
    if (view.verification !== "unverified") {
        const servings =
            opts.cookServings != null &&
            Number.isFinite(opts.cookServings) &&
            opts.cookServings > 0
                ? opts.cookServings
                : view.yieldPortions;
        const {
            preview,
            error: previewError,
            places,
        } = await loadCookPreview(householdId, recipeId, servings, cookVersion);
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
            viewerName:
                members.find((member) => member.userId === viewerUserId)
                    ?.displayName ?? "You",
            version: cookVersion,
            places,
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
            onList,
            macrosPerPortion: macrosPerPortion ?? macros,
            portionCount: view.portionCount,
            versions: isRecipeDraft(view)
                ? undefined
                : versionPicker({
                      viewerId: viewerUserId,
                      viewing,
                      viewingName,
                      changeCount: view.variant?.overrideCount ?? 0,
                      members,
                      canCompare: can(
                          gate.viewer,
                          "household.align_recipe_versions",
                      ).ok,
                  }),
            gapReasons: [
                ...new Set(
                    notices.map((notice) => gapFromNotice(notice).message),
                ),
            ],
            favourite: (
                await liveRecipesStore().listFavourites(
                    householdId,
                    viewerUserId,
                )
            ).includes(recipeId),
            mentions: await recipeMentionsForPage(householdId, view),
            cook,
            draft: isRecipeDraft(view)
                ? {
                      // Save needs recipe.edit; Discard is the importer's or
                      // the owner's, as on the discard route.
                      canSave: can(gate.viewer, "recipe.edit").ok,
                      canDiscard:
                          view.creatorId === viewerUserId ||
                          can(gate.viewer, "recipe.delete_any").ok,
                      problems: await draftProblems(householdId, recipeId),
                      expiresOn: await draftExpiryDay(
                          householdId,
                          view.draftExpiresAt,
                      ),
                  }
                : undefined,
            share: chrome.flags.mcpShareLinks
                ? { open: opts.openModalId === RECIPE_SHARE_SHEET_ID }
                : undefined,
            planned: await upcomingPlansOf(householdId, recipeId),
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

const UUID_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Compare versions: how each member's version of a recipe differs from the
 * base, for the owner and admins (`household.align_recipe_versions`). A member
 * who asks anyway is refused on the recipe's own page.
 */
export async function renderRecipeCompareRoute(
    viewerUserId: string,
    recipeId: string,
    opts: {
        error?: string;
        /** Whose Make-theirs-the-base sheet opens, when they still have changes to use. */
        openFor?: string;
    } = {},
): Promise<{ status: 200 | 403 | 404; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const allowed = can(gate.viewer, "household.align_recipe_versions");
    if (!allowed.ok) {
        const page = await renderRecipeDetailRoute(viewerUserId, recipeId, {
            error: allowed.reason,
        });
        return {
            status: page.status === 200 ? 403 : page.status,
            html: page.html,
        };
    }
    const householdId = gate.viewer.householdId;
    const recipes = liveRecipesStore();
    const recipe = UUID_ID.test(recipeId)
        ? await recipes.getRecipe(householdId, recipeId)
        : null;
    if (!recipe) {
        const page = await renderRecipesListPage(viewerUserId, {
            error: "Unknown recipe.",
        });
        return { status: 404, html: page.html };
    }
    const variants = liveRecipeVariantsStore();
    const [ingredients, overrides, members, profile] = await Promise.all([
        recipes.listIngredients(householdId, recipe.id),
        variants.listOverrides(householdId, recipe.id),
        listHouseholdMembers(householdId),
        getProfile(viewerUserId),
    ]);
    const compare = compareVersions(
        { id: recipe.id, ingredients },
        overrides,
        members.map((member) => member.userId),
    );
    const noticeResult = await loadViewerNotices(gate.viewer);
    const chrome = await viewerChromeWithAttention(
        profile,
        gate.viewer,
        noticeResult,
    );
    const resetKeys = new Map<string, readonly string[]>();
    for (const version of compare.versions) {
        const preview = await previewReset(recipes, variants, {
            householdId,
            recipeId: recipe.id,
            userId: version.userId,
        });
        resetKeys.set(version.userId, preview.rowKeys);
    }
    return {
        status: 200,
        html: renderRecipeCompareV2Page({
            chrome,
            recipeId: recipe.id,
            recipeName: recipe.name,
            compare,
            people: members.map((member) => ({
                userId: member.userId,
                name: member.displayName,
                picture: chrome.identity?.avatarVersions?.get(member.userId),
                resetRowKeys: resetKeys.get(member.userId),
            })),
            error: opts.error,
            openFor: opts.error ? undefined : opts.openFor?.toLowerCase(),
        }),
    };
}

/**
 * The household's local day a draft is deleted on, or null when it has no
 * expiry. A UTC date would be a day off for a household west of UTC.
 */
async function draftExpiryDay(
    householdId: string,
    expiresAt: string | null | undefined,
    timezone?: string,
): Promise<string | null> {
    if (!expiresAt) return null;
    const tz = timezone ?? (await householdClock(householdId)).timezone;
    return dateInTz(new Date(expiresAt), tz);
}

/**
 * The drafts the Recipes list shows, each with its expiry day: the viewer's
 * own, or every draft in the household for the owner, who may discard any
 * (one another member or an agent imported has no other way in).
 */
async function viewerDrafts(
    householdId: string,
    viewerUserId: string,
    seesAll: boolean,
): Promise<{ id: string; name: string; expiresOn: string | null }[]> {
    const drafts = (
        await liveRecipesStore().listDraftRecipes(householdId)
    ).filter((recipe) => seesAll || recipe.creatorId === viewerUserId);
    if (drafts.length === 0) return [];
    const { timezone } = await householdClock(householdId);
    return Promise.all(
        drafts.map(async (recipe) => ({
            id: recipe.id,
            name: recipe.name,
            expiresOn: await draftExpiryDay(
                householdId,
                recipe.draftExpiresAt,
                timezone,
            ),
        })),
    );
}

/** What the check finds on a draft's base recipe now, one sentence each. */
async function draftProblems(
    householdId: string,
    recipeId: string,
): Promise<string[]> {
    const store = liveRecipesStore();
    const [recipe, ingredients, importRow] = await Promise.all([
        store.getRecipe(householdId, recipeId),
        store.listIngredients(householdId, recipeId),
        store.getImport(householdId, recipeId),
    ]);
    if (!recipe) return [];
    return verifyRecipe(recipe, ingredients, importRow).problems.map(
        (p) => p.message,
    );
}

/** What the two Possible duplicates pages read: the current pairs and each food's use count. */
async function loadDuplicatesData(viewer: HouseholdMember) {
    const refCounts = await liveFoodsStore().countFoodRefs(viewer.householdId);
    const noticeResult = await loadViewerNotices(viewer, { refCounts });
    return {
        refCounts,
        noticeResult,
        pairs: noticeResult.possibleDuplicatePairs,
    };
}

export async function renderSettingsDuplicatesRoute(
    viewerUserId: string,
    opts: { error?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const { refCounts, noticeResult, pairs } = await loadDuplicatesData(
        gate.viewer,
    );
    return {
        status: 200,
        html: renderSettingsDuplicatesV2Page({
            chrome: await viewerChromeWithAttention(
                profile,
                gate.viewer,
                noticeResult,
            ),
            pairs,
            refCounts,
            error: opts.error,
        }),
    };
}

/** The compare page of one pair; 404 when the two foods are not a current suggestion. */
export async function renderSettingsDuplicateCompareRoute(
    viewerUserId: string,
    foodA: string,
    foodB: string,
    opts: { error?: string; mergePost?: DuplicateMergePost } = {},
): Promise<{ status: 200 | 403 | 404; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const { refCounts, noticeResult, pairs } = await loadDuplicatesData(
        gate.viewer,
    );
    const pair = findDuplicatePair(pairs, foodA, foodB);
    if (!pair) {
        return {
            status: 404,
            html: renderBarePage("Not found", emptyState("Pair not found.")),
        };
    }
    return {
        status: 200,
        html: renderSettingsDuplicateCompareV2Page({
            chrome: await viewerChromeWithAttention(
                profile,
                gate.viewer,
                noticeResult,
            ),
            pair,
            refCounts,
            error: opts.error,
            mergePost: opts.mergePost,
        }),
    };
}
