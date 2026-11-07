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
    getHouseholdMembership,
    householdExists,
    listHouseholdMembers,
} from "../db/household.js";
import { liveFridgeStore } from "../db/fridge.js";
import { liveFoodsStore } from "../db/foods.js";
import { liveGroceryStore } from "../db/grocery.js";
import { liveRecipesStore } from "../db/recipes.js";
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
    effectiveFoodsByIds,
    matchFoodsByWords,
    suggestFoodFor,
    usualProductRows,
    type Food,
} from "../domain/foods.js";
import {
    plainFoodIdForUsualPicker,
    safeReturnPath,
    usualProductsPickerHref,
} from "./usual-products-path.js";
import type { Notice } from "../domain/notices.js";
import { listFridge } from "../domain/fridge.js";
import {
    allergenNotices,
    groceryAllergenWarning,
    listGrocery,
} from "../domain/grocery.js";
import { alreadyHaveTag } from "../domain/linking.js";
import {
    getRecipeView,
    listRecipes,
    listRecipesFiltered,
    macrosForPerson,
    RecipeInputError,
    recipeDislikeNote,
    recipeNotices,
} from "../domain/recipes.js";
import { orderCards } from "../domain/layout.js";
import {
    renderNutritionPage,
    viewerChromeFromProfile,
    type NutritionView,
} from "./pages/nutrition.js";
import {
    loadHouseholdNotices,
    viewerChromeWithAttention,
} from "./attention.js";
import { errorBanner, emptyState, pageHeader, field } from "./components/ui.js";
import { renderBarePage, type ThemePref } from "./shell.js";
import { liveNoticeDismissalsStore } from "../db/notice-dismissals.js";
import {
    dismissNotice,
    undoDismissal,
    type NoticesForDeps,
} from "../domain/notices-for.js";
import { NoticeDismissError } from "../domain/notice-dismissals.js";
import type { NoticeCode } from "../domain/notices.js";
import type { NoticeSubjectKind } from "../domain/notice-dismissals.js";
import { renderNeedsAttentionPage } from "./pages/needs-attention.js";

function alcoholOf(
    profile: Parameters<typeof alcoholTrackingEnabledFromProfile>[0],
): AlcoholDisplay {
    if (!alcoholTrackingEnabledFromProfile(profile)) return null;
    return preferredDrinkUnitFromProfile(profile) ?? "us";
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
    const viewer = await getHouseholdMembership(viewerUserId);
    if (viewer == null) {
        if (!(await householdExists())) {
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

export async function renderDashboardPage(
    viewerUserId: string,
    requestedMember: string | undefined,
    error?: string,
    openModalId?: string,
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

    const [summary, goals, trends, weight] = await Promise.all([
        getNutritionSummaryPayload(access.subject.userId, alcohol, 7),
        getGoalProgressPayload(access.subject.userId, alcohol),
        getTrendsPayload(access.subject.userId, alcohol),
        getWeightTrendsPayload(access.subject.userId),
    ]);

    const viewMemberId =
        requestedMember && requestedMember !== viewerUserId
            ? requestedMember
            : undefined;

    return {
        status: 200,
        html: await renderDashboardHtml({
            access,
            members,
            summary,
            goals,
            trends,
            weight,
            chrome: await viewerChromeWithAttention(
                viewerProfile,
                access.subject.householdId,
            ),
            cardOrder: orderCards(viewerProfile?.nutrition_layout),
            viewMemberId,
            error,
            openModalId,
            weightUnit: preferredWeightUnitFromProfile(viewerProfile) ?? "kg",
        }),
    };
}

export async function renderFridgeInventoryPage(
    viewerUserId: string,
    error?: string,
    openModalId?: string,
    linkProductId?: string,
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const householdId = gate.viewer.householdId;
    const snapshot = await listFridge(liveFridgeStore(), householdId);
    const allFoods = await liveFoodsStore().listFoods(householdId);
    const groceryLines = await liveGroceryStore().listLines(householdId);
    const foodsById = new Map(
        allFoods.map((row) => [
            row.id,
            { id: row.id, genericFoodId: row.genericFoodId },
        ]),
    );
    const linkProductPrompt = linkProductId
        ? linkProductPromptFromFoods(
              allFoods,
              linkProductId,
              "/fridge",
              true,
              error,
          )
        : null;
    return {
        status: 200,
        html: renderFridgePage({
            ...snapshot,
            chrome: await viewerChromeWithAttention(profile, householdId),
            error,
            openModalId,
            linkProductPrompt,
            groceryLines,
            foodsById,
        }),
    };
}

export async function renderGroceryListPage(
    viewerUserId: string,
    opts: {
        error?: string;
        allergenNotices?: Notice[];
        allergenRetry?: GroceryAllergenRetry;
        openModalId?: string;
        linkProductId?: string;
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
                                      "/grocery",
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
        const warning = groceryAllergenWarning(
            line.displayName,
            memberAllergens,
            food ? food.allergens : null,
        );
        return warning != null && !warning.blocking;
    });
    const linkProductPrompt = opts.linkProductId
        ? linkProductPromptFromFoods(
              allFoods,
              opts.linkProductId,
              "/grocery",
              true,
              opts.error,
          )
        : null;
    return {
        status: 200,
        html: renderGroceryPage({
            chrome: await viewerChromeWithAttention(profile, householdId),
            stores,
            canManage: canManageHousehold(gate.viewer),
            error: opts.error,
            allergenNotices: opts.allergenNotices,
            allergenRetry: opts.allergenRetry,
            unknownAllergen: unknownAllergen && !opts.allergenNotices?.length,
            openModalId: opts.openModalId,
            locations: fridge.locations.map((loc) => ({
                id: loc.id,
                name: loc.name,
            })),
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

export async function renderSettingsAccountPage(
    viewerUserId: string,
    opts: { error?: string; backHref?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const chrome = viewerChromeFromProfile(profile);
    return {
        status: 200,
        html: renderSettingsPage({
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

export async function renderSettingsHelpRoute(
    viewerUserId: string,
    opts: { backHref?: string } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    return {
        status: 200,
        html: renderSettingsHelpPageHtml({
            chrome: viewerChromeFromProfile(profile),
            backHref: opts.backHref ?? "/",
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
    const from = safeReturnPath(opts.from, "/household/items");
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
    return {
        status: 200,
        html: renderFoodsSettingsPage({
            chrome: await viewerChromeWithAttention(profile, householdId),
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
    opts: { error?: string; from?: string; q?: string } = {},
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
    return {
        status: 200,
        html: renderUsualProductsListHtml({
            chrome: await viewerChromeWithAttention(profile, householdId),
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
    const from = safeReturnPath(opts.from, "/household/usual-products");
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
    return {
        status: 200,
        html: renderUsualProductsPickerHtml({
            chrome: await viewerChromeWithAttention(profile, householdId),
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
    } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const householdId = gate.viewer.householdId;
    const [config, members, location, stores] = await Promise.all([
        getHouseholdConfig(householdId),
        listHouseholdMembers(householdId),
        liveSettingsStore().getLocation(householdId),
        liveSettingsStore().listStores(householdId),
    ]);
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
    return {
        status: 200,
        html: renderHouseholdSettingsPage({
            chrome: await viewerChromeWithAttention(profile, householdId),
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
    } = {},
): Promise<{ status: 200 | 403; html: string }> {
    const filter = opts;
    const error = opts.error;
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const householdId = gate.viewer.householdId;
    const members = await listHouseholdMembers(householdId);
    const tag = filter.tag?.trim() ?? "";
    const canMakeNow = filter.canMakeNow === true;
    const safeForId =
        filter.safeFor &&
        members.some((member) => member.userId === filter.safeFor)
            ? filter.safeFor
            : "";
    let recipes;
    if (tag || canMakeNow || safeForId) {
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
            },
        );
    } else {
        recipes = await listRecipes(liveRecipesStore(), householdId);
    }
    return {
        status: 200,
        html: renderRecipesPage({
            chrome: await viewerChromeWithAttention(profile, householdId),
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
            },
            error,
            openModalId: opts.openModalId,
        }),
    };
}

export async function renderRecipeDetailRoute(
    viewerUserId: string,
    recipeId: string,
    opts: {
        member?: string;
        error?: string;
        openModalId?: string;
        linkProductId?: string;
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
        return { ...row, displayName };
    });
    return {
        status: 200,
        html: renderRecipeDetailPage({
            chrome: await viewerChromeWithAttention(profile, householdId),
            recipe: view,
            notices,
            noticeContext: {
                from: `/recipes/${recipeId}`,
                foods: foodsByIdForNoticeCtx,
            },
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

    if (post?.member) {
        const deps = noticeDeps();
        try {
            if (post.undoDismissalId) {
                await undoDismissal(deps, householdId, post.undoDismissalId);
                redirect = true;
            } else if (post.code && post.subjectKind && post.subjectId) {
                await dismissNotice(deps, householdId, post.member.userId, {
                    code: post.code as NoticeCode,
                    subjectKind: post.subjectKind as NoticeSubjectKind,
                    subjectId: post.subjectId,
                    relatedId: post.relatedId,
                });
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

    const result = await loadHouseholdNotices(householdId);
    const chrome = await viewerChromeWithAttention(
        profile,
        householdId,
        result,
    );
    const html = renderNeedsAttentionPage({
        chrome,
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
