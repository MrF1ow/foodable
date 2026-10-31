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
import { renderHouseholdSettingsPage } from "./pages/household.js";
import { renderSettingsHelpPage as renderSettingsHelpPageHtml } from "./pages/settings-help.js";
import { foodsByIds } from "../domain/foods.js";
import { listFridge } from "../domain/fridge.js";
import { groceryAllergenWarning, listGrocery } from "../domain/grocery.js";
import { alreadyHaveTag } from "../domain/linking.js";
import {
    getRecipeView,
    listRecipes,
    listRecipesFiltered,
    macrosForPerson,
    RecipeInputError,
    recipeDislikeNote,
} from "../domain/recipes.js";
import { orderCards } from "../domain/layout.js";
import {
    renderNutritionPage,
    viewerChromeFromProfile,
    type NutritionView,
} from "./pages/nutrition.js";
import { errorBanner, emptyState, pageHeader, field } from "./components/ui.js";
import { renderBarePage, type ThemePref } from "./shell.js";

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
            sub: `<p class="muted">Name the household. Everyone else is added from Settings.</p>`,
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
            chrome: viewerChromeFromProfile(viewerProfile),
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
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const snapshot = await listFridge(
        liveFridgeStore(),
        gate.viewer.householdId,
    );
    return {
        status: 200,
        html: renderFridgePage({
            ...snapshot,
            chrome: viewerChromeFromProfile(profile),
            error,
            openModalId,
        }),
    };
}

export async function renderGroceryListPage(
    viewerUserId: string,
    opts: {
        error?: string;
        allergenWarning?: string;
        allergenRetry?: GroceryAllergenRetry;
        openModalId?: string;
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
    const catalog = await foodsByIds(liveFoodsStore(), householdId, [
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
                    .map((line) => ({
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
                    })),
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
    return {
        status: 200,
        html: renderGroceryPage({
            chrome: viewerChromeFromProfile(profile),
            stores,
            canManage: canManageHousehold(gate.viewer),
            error: opts.error,
            allergenWarning: opts.allergenWarning,
            allergenRetry: opts.allergenRetry,
            unknownAllergen: unknownAllergen && !opts.allergenWarning,
            openModalId: opts.openModalId,
            locations: fridge.locations.map((loc) => ({
                id: loc.id,
                name: loc.name,
            })),
        }),
    };
}

export async function groceryAllergenMembers(householdId: string) {
    const members = await listHouseholdMembers(householdId);
    const rules = liveRulesStore();
    return Promise.all(
        members.map(async (member) => ({
            displayName: member.displayName,
            allergens: await rules.listAllergens(householdId, member.userId),
        })),
    );
}

export async function renderSettingsAccountPage(
    viewerUserId: string,
    error?: string,
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    const chrome = viewerChromeFromProfile(profile);
    return {
        status: 200,
        html: renderSettingsPage({
            chrome,
            displayName: gate.viewer.displayName,
            timezone: profile?.timezone ?? "",
            weightUnit: preferredWeightUnitFromProfile(profile) ?? "",
            widgetsEnabled: widgetsEnabledFromProfile(profile),
            alcoholTrackingEnabled: alcoholTrackingEnabledFromProfile(profile),
            drinkUnit: preferredDrinkUnitFromProfile(profile) ?? "",
            error,
        }),
    };
}

export async function renderSettingsHelpRoute(
    viewerUserId: string,
): Promise<{ status: 200 | 403; html: string }> {
    const gate = await memberGate(viewerUserId);
    if ("html" in gate) return { status: gate.status, html: gate.html };
    const profile = await getProfile(viewerUserId);
    return {
        status: 200,
        html: renderSettingsHelpPageHtml({
            chrome: viewerChromeFromProfile(profile),
        }),
    };
}

export async function renderSettingsFoodsPage(
    viewerUserId: string,
    opts: { error?: string; openModalId?: string } = {},
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
    return {
        status: 200,
        html: renderFoodsSettingsPage({
            chrome: viewerChromeFromProfile(profile),
            foods: withAliases,
            error: opts.error,
            openModalId: opts.openModalId,
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
            chrome: viewerChromeFromProfile(profile),
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
        const foods = await liveFoodsStore().listFoods(householdId);
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
            new Map(foods.map((food) => [food.id, food])),
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
            chrome: viewerChromeFromProfile(profile),
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
    const catalog = await foodsByIds(
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
    const warning = groceryAllergenWarning(
        view.ingredients.map((row) => row.displayName).join(" "),
        person ? [{ displayName: person.displayName, allergens }] : [],
        allCatalogued
            ? [...catalog.values()].flatMap((food) => food.allergens)
            : null,
    );
    return {
        status: 200,
        html: renderRecipeDetailPage({
            chrome: viewerChromeFromProfile(profile),
            recipe: view,
            ingredients: view.ingredients,
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
            allergenWarning: warning?.blocking ? warning.text : undefined,
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
        }),
    };
}
