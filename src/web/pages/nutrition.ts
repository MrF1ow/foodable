import type { DashboardAccess, HouseholdMember } from "../../household.js";
import type {
    MealInput,
    MealInsertResult,
    WaterInput,
    WaterInsertResult,
    WeightInput,
    WeightInsertResult,
} from "../../db/nutrition.js";
import { snapshotToMealItemWrite } from "../../db/nutrition.js";
import type { FoodsStore } from "../../domain/foods.js";
import type { RecipesStore } from "../../domain/recipes.js";
import {
    descriptionFromItems,
    itemListDigest,
    MealItemsError,
    resolveAndBuildMeal,
} from "../../domain/meals.js";
import { isWeightUnit, toGrams, type WeightUnit } from "../../domain/units.js";
import { getEmbedCss, getWidgetHtml, withWidgetData } from "../../widgets.js";
import {
    escapeHtml,
    renderAppShell,
    resolveTheme,
    type ViewerChrome,
} from "../shell.js";
import { iconEye } from "../components/icons.js";
import { quantityUnitOptionLabel } from "../display-quantity.js";
import {
    errorBanner,
    modal,
    modalTrigger,
    pageHeader,
    pageLevelErrorBanner,
} from "../components/ui.js";
import type { MealFormItem } from "../form.js";
import type { NutritionCard } from "../../domain/layout.js";

export const NUTRITION_ARRANGE_MODAL_ID = "nutrition-arrange";
export const NUTRITION_LOG_MEAL_MODAL_ID = "nutrition-log-meal";
export const NUTRITION_LOG_WATER_MODAL_ID = "nutrition-log-water";
export const NUTRITION_LOG_WEIGHT_MODAL_ID = "nutrition-log-weight";

const CARD_LABELS: Record<NutritionCard, string> = {
    "nutrition-summary": "Nutrition summary",
    "goal-progress": "Goal progress",
    trends: "Trends",
    "weight-trends": "Weight trends",
};

export type NutritionView = {
    access: Extract<DashboardAccess, { ok: true }>;
    members: HouseholdMember[];
    summary: unknown;
    goals: unknown;
    trends: unknown;
    weight: unknown;
    chrome: ViewerChrome;
    cardOrder: NutritionCard[];
    viewMemberId?: string;
    error?: string;
    openModalId?: string;
    /** The viewer's preferred weight unit; the log-weight form writes as the viewer. */
    weightUnit?: WeightUnit;
};

export type LogFormResult = { ok: true } | { ok: false; error: string };

export function viewerChromeFromProfile(
    profile: { theme?: string | null } | null,
): ViewerChrome {
    return { theme: resolveTheme(profile?.theme) };
}

async function widgetCard(
    key: string,
    data: unknown,
    chrome: ViewerChrome,
): Promise<string> {
    const html = withWidgetData(await getWidgetHtml(key), data, {
        theme: chrome.theme,
        skin: await getEmbedCss(),
    });
    return `<iframe class="widget-frame" title="${escapeHtml(key)}" srcdoc="${escapeHtml(html)}"></iframe>`;
}

function mealTypeSelect(): string {
    return `<label for="log-meal-type">Meal type</label>
            <select id="log-meal-type" name="meal_type">
                <option value="breakfast">Breakfast</option>
                <option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option>
                <option value="snack" selected>Snack</option>
            </select>`;
}

const MEAL_ITEM_UNITS = ["g", "each", "oz", "ml", "cup"] as const;

function mealItemUnitOptions(selected: string): string {
    return MEAL_ITEM_UNITS.map((unit) => {
        const sel = unit === selected ? " selected" : "";
        const label = quantityUnitOptionLabel(unit);
        return `<option value="${escapeHtml(unit)}"${sel}>${escapeHtml(label)}</option>`;
    }).join("");
}

function mealItemRowHtml(): string {
    return `<div class="meal-item" data-meal-item>
<label class="meal-item-name">Food<input name="item_name" type="text" autocomplete="off" data-meal-item-name /></label>
<ul class="food-picker-results meal-item-results" data-meal-item-results></ul>
<input name="item_food_id" type="hidden" data-meal-item-food-id />
<label>Amount<input name="item_amount" type="number" min="0" step="any" inputmode="decimal" /></label>
<label>Unit<select name="item_unit">${mealItemUnitOptions("each")}</select></label>
<button type="button" class="btn-sm meal-item-remove" data-meal-item-remove aria-label="Remove food" hidden>Remove</button>
</div>`;
}

function logMealFormBody(): string {
    return `<form class="meal-log" method="post" action="/log-meal">
${mealTypeSelect()}
<div class="meal-items" data-meal-items>
${mealItemRowHtml()}
<button type="button" class="btn-sm" data-add-meal-item>Add another food</button>
</div>
<p class="muted">Or describe it</p>
<label for="log-meal-description">Description</label>
<input id="log-meal-description" name="description" type="text" autocomplete="off" />
<div class="field-grid">
<label>Calories<input id="log-meal-calories" name="calories" type="number" min="0" step="any" inputmode="decimal" /></label>
<label>Protein (g)<input id="log-meal-protein" name="protein_g" type="number" min="0" step="any" inputmode="decimal" /></label>
<label>Carbs (g)<input id="log-meal-carbs" name="carbs_g" type="number" min="0" step="any" inputmode="decimal" /></label>
<label>Fat (g)<input id="log-meal-fat" name="fat_g" type="number" min="0" step="any" inputmode="decimal" /></label>
</div>
<button type="submit" class="btn-primary">Log meal</button>
</form>`;
}

function logWaterFormBody(): string {
    return `<form class="log-water inline-form" method="post" action="/log-water">
<label for="log-water-amount">Water (ml)</label>
<input id="log-water-amount" name="amount_ml" type="number" step="any" inputmode="decimal" />
<button type="submit" class="btn-primary">Log water</button>
</form>`;
}

function logWeightFormBody(unit: WeightUnit): string {
    return `<form class="log-weight inline-form" method="post" action="/log-weight">
<label for="log-weight-amount">Weight (${unit})</label>
<input id="log-weight-amount" name="weight" type="number" step="any" inputmode="decimal" />
<input type="hidden" name="unit" value="${unit}" />
<button type="submit" class="btn-primary">Log weight</button>
</form>`;
}

function modalFormError(view: NutritionView, modalId: string): string {
    if (view.error && view.openModalId === modalId) {
        return errorBanner(view.error);
    }
    return "";
}

function logModals(view: NutritionView): string {
    if (view.access.mode === "peer") return "";
    return [
        modal({
            id: NUTRITION_LOG_MEAL_MODAL_ID,
            title: "Log meal",
            openOnLoad: view.openModalId === NUTRITION_LOG_MEAL_MODAL_ID,
            body: `${modalFormError(view, NUTRITION_LOG_MEAL_MODAL_ID)}${logMealFormBody()}`,
        }),
        modal({
            id: NUTRITION_LOG_WATER_MODAL_ID,
            title: "Log water",
            openOnLoad: view.openModalId === NUTRITION_LOG_WATER_MODAL_ID,
            body: `${modalFormError(view, NUTRITION_LOG_WATER_MODAL_ID)}${logWaterFormBody()}`,
        }),
        modal({
            id: NUTRITION_LOG_WEIGHT_MODAL_ID,
            title: "Log weight",
            openOnLoad: view.openModalId === NUTRITION_LOG_WEIGHT_MODAL_ID,
            body: `${modalFormError(view, NUTRITION_LOG_WEIGHT_MODAL_ID)}${logWeightFormBody(view.weightUnit ?? "kg")}`,
        }),
    ].join("");
}

function logTriggers(): string {
    return `${modalTrigger({
        target: NUTRITION_LOG_MEAL_MODAL_ID,
        label: "Log meal",
        className: "btn-sm",
    })}
${modalTrigger({
    target: NUTRITION_LOG_WATER_MODAL_ID,
    label: "Log water",
    className: "btn-sm",
})}
${modalTrigger({
    target: NUTRITION_LOG_WEIGHT_MODAL_ID,
    label: "Log weight",
    className: "btn-sm",
})}`;
}

function peerViewTag(displayName: string): string {
    const name = escapeHtml(displayName);
    const aria = escapeHtml(`Viewing ${displayName}'s nutrition (read-only)`);
    return `<p class="peer-view-tag" role="status" aria-label="${aria}"><span class="peer-view-tag-inner">${iconEye()} Viewing ${name}</span></p>`;
}

const MEAL_TYPES = new Set(["breakfast", "lunch", "dinner", "snack"]);

function parseMealType(value: string | undefined): MealInput["meal_type"] {
    const trimmed = value?.trim().toLowerCase() ?? "";
    return MEAL_TYPES.has(trimmed)
        ? (trimmed as MealInput["meal_type"])
        : "snack";
}

function parseOptionalNumber(value: string | undefined): number | undefined {
    if (value == null || value.trim() === "") return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

export async function logMealFromForm(
    userId: string,
    fields: {
        description?: string;
        meal_type?: string;
        calories?: string;
        protein_g?: string;
        carbs_g?: string;
        fat_g?: string;
        fiber_g?: string;
        sugar_g?: string;
        alcohol_g?: string;
        caffeine_mg?: string;
        items?: MealFormItem[];
    },
    insert: (userId: string, input: MealInput) => Promise<MealInsertResult>,
    catalog?: {
        householdId: string;
        foods: FoodsStore;
        recipes: RecipesStore;
    },
): Promise<LogFormResult> {
    const description = fields.description?.trim() ?? "";
    const items = (fields.items ?? []).filter(
        (item) => item.food_id?.trim() || item.name?.trim(),
    );
    if (!description && items.length === 0) {
        return { ok: false, error: "Enter a meal description or add a food." };
    }
    const meal_type = parseMealType(fields.meal_type);
    if (items.length > 0) {
        if (!catalog) {
            return { ok: false, error: "Food-backed meals need a household." };
        }
        try {
            const { built, specs } = await resolveAndBuildMeal({
                householdId: catalog.householdId,
                foods: catalog.foods,
                recipes: catalog.recipes,
                items: items.map((item) => ({
                    foodId: item.food_id,
                    name: item.name,
                    amount: parseOptionalNumber(item.amount),
                    unit: item.unit,
                })),
            });
            const totals = built.totals;
            await insert(userId, {
                description: description || descriptionFromItems(built.items),
                meal_type,
                calories: totals.calories ?? undefined,
                protein_g: totals.protein_g ?? undefined,
                carbs_g: totals.carbs_g ?? undefined,
                fat_g: totals.fat_g ?? undefined,
                fiber_g: totals.fiber_g ?? undefined,
                sugar_g: totals.sugar_g ?? undefined,
                alcohol_g: totals.alcohol_g ?? undefined,
                caffeine_mg: totals.caffeine_mg ?? undefined,
                items: built.items.map((item) =>
                    snapshotToMealItemWrite(item, catalog.householdId),
                ),
                item_digest: itemListDigest(specs),
            });
            return { ok: true };
        } catch (err) {
            if (err instanceof MealItemsError) {
                return { ok: false, error: err.message };
            }
            throw err;
        }
    }
    await insert(userId, {
        description,
        meal_type,
        calories: parseOptionalNumber(fields.calories),
        protein_g: parseOptionalNumber(fields.protein_g),
        carbs_g: parseOptionalNumber(fields.carbs_g),
        fat_g: parseOptionalNumber(fields.fat_g),
        fiber_g: parseOptionalNumber(fields.fiber_g),
        sugar_g: parseOptionalNumber(fields.sugar_g),
        alcohol_g: parseOptionalNumber(fields.alcohol_g),
        caffeine_mg: parseOptionalNumber(fields.caffeine_mg),
    });
    return { ok: true };
}

export async function logWaterFromForm(
    userId: string,
    fields: { amount_ml?: string },
    insert: (userId: string, input: WaterInput) => Promise<WaterInsertResult>,
): Promise<LogFormResult> {
    const amount_ml = Number(fields.amount_ml);
    if (!Number.isFinite(amount_ml) || amount_ml <= 0) {
        return { ok: false, error: "Enter a water amount greater than zero." };
    }
    await insert(userId, { amount_ml: Math.round(amount_ml) });
    return { ok: true };
}

export async function logWeightFromForm(
    userId: string,
    fields: { weight?: string; unit?: string },
    insert: (userId: string, input: WeightInput) => Promise<WeightInsertResult>,
): Promise<LogFormResult> {
    const weight = Number(fields.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
        return { ok: false, error: "Enter a weight greater than zero." };
    }
    const unit: WeightUnit = isWeightUnit(fields.unit) ? fields.unit : "kg";
    await insert(userId, { weight_g: toGrams(weight, unit) });
    return { ok: true };
}

function memberHiddenField(viewMemberId?: string): string {
    if (!viewMemberId) return "";
    return `<input type="hidden" name="member" value="${escapeHtml(viewMemberId)}" />`;
}

function arrangeLegacyMoveFormId(
    key: NutritionCard,
    direction: "up" | "down",
): string {
    return `nutrition-arrange-move-${key}-${direction}`;
}

function arrangeLegacyMoveButton(
    key: NutritionCard,
    direction: "up" | "down",
): string {
    const label = CARD_LABELS[key];
    const verb = direction === "up" ? "up" : "down";
    const arrow = direction === "up" ? "↑" : "↓";
    const formId = arrangeLegacyMoveFormId(key, direction);
    return `<button type="submit" class="btn-sm arrange-legacy-move" form="${formId}" aria-label="Move ${escapeHtml(label)} ${verb}">${arrow}</button>`;
}

function arrangeLegacyMoveForm(
    key: NutritionCard,
    direction: "up" | "down",
    view: NutritionView,
): string {
    const formId = arrangeLegacyMoveFormId(key, direction);
    return `<form id="${formId}" class="arrange-legacy-move-form" method="post" action="/nutrition/layout">
${memberHiddenField(view.viewMemberId)}
<input type="hidden" name="card" value="${escapeHtml(key)}" />
<input type="hidden" name="direction" value="${direction}" />
</form>`;
}

function arrangeModal(view: NutritionView): string {
    const order = view.cardOrder;
    const legacyForms: string[] = [];
    const rows = order
        .map((key, index) => {
            const label = CARD_LABELS[key];
            const upDisabled = index === 0;
            const downDisabled = index === order.length - 1;
            const upBtn = `<button type="button" class="btn-sm arrange-up" aria-label="Move ${escapeHtml(label)} up"${upDisabled ? " disabled" : ""}>↑</button>`;
            const downBtn = `<button type="button" class="btn-sm arrange-down" aria-label="Move ${escapeHtml(label)} down"${downDisabled ? " disabled" : ""}>↓</button>`;
            const legacy =
                !upDisabled || !downDisabled
                    ? `${upDisabled ? "" : arrangeLegacyMoveButton(key, "up")}${downDisabled ? "" : arrangeLegacyMoveButton(key, "down")}`
                    : "";
            if (!upDisabled) {
                legacyForms.push(arrangeLegacyMoveForm(key, "up", view));
            }
            if (!downDisabled) {
                legacyForms.push(arrangeLegacyMoveForm(key, "down", view));
            }
            return `<li class="row arrange-row" data-card="${escapeHtml(key)}">
<input type="hidden" name="order" value="${escapeHtml(key)}" />
<span class="row-title">${escapeHtml(label)}</span>
<span class="row-actions">${upBtn}${downBtn}${legacy}</span>
</li>`;
        })
        .join("");
    const modalError =
        view.error && view.openModalId === NUTRITION_ARRANGE_MODAL_ID
            ? errorBanner(view.error)
            : "";
    const body = `${modalError}<form id="nutrition-arrange-save" class="nutrition-arrange-form" method="post" action="/nutrition/layout">
${memberHiddenField(view.viewMemberId)}
<ul class="list nutrition-arrange-list">${rows}</ul>
<div class="modal-actions">
<button type="button" class="arrange-reset" command="close" commandfor="${NUTRITION_ARRANGE_MODAL_ID}">Cancel</button>
<button type="submit" class="btn-primary">Save</button>
</div>
</form>${legacyForms.join("")}`;
    return modal({
        id: NUTRITION_ARRANGE_MODAL_ID,
        title: "Arrange cards",
        openOnLoad: view.openModalId === NUTRITION_ARRANGE_MODAL_ID,
        body,
    });
}

export async function renderNutritionPage(
    view: NutritionView,
): Promise<string> {
    const [summaryCard, goalsCard, trendsCard, weightCard] = await Promise.all([
        widgetCard("nutrition-summary", view.summary, view.chrome),
        widgetCard("goal-progress", view.goals, view.chrome),
        widgetCard("trends", view.trends, view.chrome),
        widgetCard("weight-trends", view.weight, view.chrome),
    ]);

    const fragments: Record<NutritionCard, string> = {
        "nutrition-summary": summaryCard,
        "goal-progress": goalsCard,
        trends: trendsCard,
        "weight-trends": weightCard,
    };
    const orderedCards = view.cardOrder
        .map((key) => {
            const html = fragments[key];
            if (!html) return "";
            return `<div class="nutrition-card" data-nutrition-card="${escapeHtml(key)}">${html}</div>`;
        })
        .filter((html) => html.length > 0)
        .join("\n");

    const memberNav = view.members
        .map((m) => {
            const current = m.userId === view.access.subject.userId;
            const href =
                m.userId === view.access.viewer.userId
                    ? "/"
                    : `/?member=${encodeURIComponent(m.userId)}`;
            const label = escapeHtml(m.displayName);
            const attrs = current ? ' aria-current="page"' : "";
            return `<a href="${escapeHtml(href)}"${attrs}>${label}</a>`;
        })
        .join("");

    const isPeer = view.access.mode === "peer";
    const peerTag = isPeer ? peerViewTag(view.access.subject.displayName) : "";

    const memberSwitch = `<nav class="member-switch" aria-label="Household members">${memberNav}</nav>`;
    const pageActions: string[] = [];
    if (!isPeer) {
        pageActions.push(logTriggers());
        pageActions.push(
            modalTrigger({
                target: NUTRITION_ARRANGE_MODAL_ID,
                label: "Arrange",
                className: "btn-sm",
            }),
        );
    }

    const modalIds = [
        NUTRITION_LOG_MEAL_MODAL_ID,
        NUTRITION_LOG_WATER_MODAL_ID,
        NUTRITION_LOG_WEIGHT_MODAL_ID,
        ...(isPeer ? [] : [NUTRITION_ARRANGE_MODAL_ID]),
    ];
    const pageError = pageLevelErrorBanner(view, modalIds);

    const body = `
        ${pageHeader({
            title: view.access.subject.displayName,
            titleActions: memberSwitch,
            sub: peerTag || undefined,
            actions: pageActions.length ? pageActions.join("\n") : undefined,
        })}
        ${pageError}
        ${orderedCards}
        ${isPeer ? "" : arrangeModal(view)}
        ${logModals(view)}
    `;
    return renderAppShell({
        title: "Nutrition",
        active: "nutrition",
        theme: view.chrome.theme,
        body,
    });
}
