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
import { disclosure, errorBanner, pageHeader } from "../components/ui.js";
import type { MealFormItem } from "../form.js";

export type NutritionView = {
    access: Extract<DashboardAccess, { ok: true }>;
    members: HouseholdMember[];
    summary: unknown;
    goals: unknown;
    trends: unknown;
    weight: unknown;
    chrome: ViewerChrome;
    error?: string;
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

function logForms(): string {
    return `<section class="panel log-panel" aria-label="Log">
${disclosure({
    summary: "Log meal",
    body: `<form class="meal-log" method="post" action="/log-meal">
${mealTypeSelect()}
<div class="meal-items" data-meal-items>
<div class="meal-item" data-meal-item>
<label class="meal-item-name">Food<input name="item_name" type="text" autocomplete="off" data-meal-item-name /></label>
<ul class="food-picker-results meal-item-results" data-meal-item-results></ul>
<input name="item_food_id" type="hidden" data-meal-item-food-id />
<label>Amount<input name="item_amount" type="number" min="0" step="any" inputmode="decimal" /></label>
<label>Unit<select name="item_unit">
<option value="g">g</option>
<option value="each" selected>each</option>
<option value="oz">oz</option>
<option value="ml">ml</option>
<option value="cup">cup</option>
</select></label>
</div>
</div>
<button type="button" class="btn-sm" data-add-meal-item>Add another food</button>
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
</form>`,
})}
${disclosure({
    summary: "Log water",
    body: `<form class="log-water inline-form" method="post" action="/log-water">
<label for="log-water-amount">Water (ml)</label>
<input id="log-water-amount" name="amount_ml" type="number" step="any" inputmode="decimal" />
<button type="submit" class="btn-primary">Log water</button>
</form>`,
})}
${disclosure({
    summary: "Log weight",
    body: `<form class="log-weight inline-form" method="post" action="/log-weight">
<label for="log-weight-amount">Weight (kg)</label>
<input id="log-weight-amount" name="weight" type="number" step="any" inputmode="decimal" />
<input type="hidden" name="unit" value="kg" />
<button type="submit" class="btn-primary">Log weight</button>
</form>`,
})}
</section>`;
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

export async function renderNutritionPage(
    view: NutritionView,
): Promise<string> {
    const cards = await Promise.all([
        widgetCard("nutrition-summary", view.summary, view.chrome),
        widgetCard("goal-progress", view.goals, view.chrome),
        widgetCard("trends", view.trends, view.chrome),
        widgetCard("weight-trends", view.weight, view.chrome),
    ]);

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

    const peerNote =
        view.access.mode === "peer"
            ? `<p class="peer-note">Viewing ${escapeHtml(view.access.subject.displayName)}. You can look, not edit. Only they (or a household bot) can change these records.</p>`
            : "";

    const forms = view.access.mode === "peer" ? "" : logForms();

    const body = `
        ${pageHeader({
            title: view.access.subject.displayName,
            sub: peerNote || undefined,
            actions: `<nav class="member-switch" aria-label="Household members">${memberNav}</nav>`,
        })}
        ${errorBanner(view.error)}
        ${forms}
        ${cards.join("\n")}
    `;
    return renderAppShell({
        title: "Nutrition",
        active: "nutrition",
        theme: view.chrome.theme,
        body,
    });
}
