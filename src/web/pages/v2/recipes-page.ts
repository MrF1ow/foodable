import type { FridgeItem, FridgeLocation } from "../../../domain/fridge.js";
import {
    recipeSteps,
    recipeTimeLabel,
    type Recipe,
    type RecipeIngredient,
    type RecipeMacros,
} from "../../../domain/recipes.js";
import {
    fridgeItemMatchesFood,
    type FamilyFoodRow,
} from "../../../domain/stock.js";
import type { AppChromeBase } from "../../attention.js";
import { formatQuantityDisplayParts } from "../../display-quantity.js";
import { esc } from "../../components/v2/html.js";
import { renderAppShell } from "../../shell.js";

export const RECIPE_NOT_IN_STOCK_ID = "__not_in_stock__";

export type RecipeIngredientPlaceLine = {
    ingredientId: string;
    displayName: string;
    amountLabel: string;
    expiresOn: string | null;
};

export type RecipeIngredientPlaceGroup = {
    placeId: string;
    placeName: string;
    lines: RecipeIngredientPlaceLine[];
};

export type RecipeDetailV2Member = { userId: string; displayName: string };

export type RecipeDetailV2View = {
    chrome: AppChromeBase;
    recipe: Recipe;
    ingredients: RecipeIngredient[];
    ingredientGroups: RecipeIngredientPlaceGroup[];
    macrosPerPortion: RecipeMacros;
    /** One sentence per reason the macros are incomplete (from the recipe's notices). */
    gapReasons: string[];
    members: RecipeDetailV2Member[];
    viewerId: string;
    portionCount: number;
    error?: string;
};

type IngredientRow = Pick<
    RecipeIngredient,
    "id" | "foodId" | "displayName" | "quantity" | "note"
>;

function ingredientAmountLabel(
    quantity: RecipeIngredient["quantity"],
    note: string | null,
): string {
    if (quantity == null) return note?.trim() || "to taste";
    return formatQuantityDisplayParts(quantity.amount, quantity.unit);
}

function soonestExpiry(dates: Array<string | null | undefined>): string | null {
    const set = dates.filter((d): d is string => Boolean(d?.trim()));
    if (set.length === 0) return null;
    return set.slice().sort()[0]!;
}

export function groupRecipeIngredientsByPlace(
    ingredients: IngredientRow[],
    fridgeItems: FridgeItem[],
    locations: FridgeLocation[],
    familyFoodMap: ReadonlyMap<string, FamilyFoodRow>,
): RecipeIngredientPlaceGroup[] {
    const sortedLocations = locations
        .slice()
        .sort(
            (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
        );
    const groupMap = new Map<string, RecipeIngredientPlaceGroup>();
    for (const loc of sortedLocations) {
        groupMap.set(loc.id, {
            placeId: loc.id,
            placeName: loc.name,
            lines: [],
        });
    }
    const notInStock: RecipeIngredientPlaceLine[] = [];

    for (const ingredient of ingredients) {
        const needFoodId = ingredient.foodId;
        const matches =
            needFoodId == null
                ? []
                : fridgeItems.filter((item) =>
                      fridgeItemMatchesFood(
                          item.foodId,
                          needFoodId,
                          familyFoodMap,
                      ),
                  );
        const amountLabel = ingredientAmountLabel(
            ingredient.quantity,
            ingredient.note,
        );
        if (matches.length === 0) {
            notInStock.push({
                ingredientId: ingredient.id,
                displayName: ingredient.displayName,
                amountLabel,
                expiresOn: null,
            });
            continue;
        }
        const placed = new Set<string>();
        for (const loc of sortedLocations) {
            const inLoc = matches.filter((item) => item.locationId === loc.id);
            if (inLoc.length === 0) continue;
            placed.add(loc.id);
            const group = groupMap.get(loc.id)!;
            group.lines.push({
                ingredientId: ingredient.id,
                displayName: ingredient.displayName,
                amountLabel,
                expiresOn: soonestExpiry(inLoc.map((item) => item.expiresOn)),
            });
        }
        const unlocated = matches.filter(
            (item) =>
                !sortedLocations.some((loc) => loc.id === item.locationId),
        );
        if (unlocated.length > 0 && placed.size === 0) {
            notInStock.push({
                ingredientId: ingredient.id,
                displayName: ingredient.displayName,
                amountLabel,
                expiresOn: soonestExpiry(
                    unlocated.map((item) => item.expiresOn),
                ),
            });
        }
    }

    const out: RecipeIngredientPlaceGroup[] = [];
    for (const loc of sortedLocations) {
        const group = groupMap.get(loc.id)!;
        if (group.lines.length > 0) out.push(group);
    }
    if (notInStock.length > 0) {
        out.push({
            placeId: RECIPE_NOT_IN_STOCK_ID,
            placeName: "Not in stock",
            lines: notInStock,
        });
    }
    return out;
}

function macroCell(label: string, value: number | null, unit = ""): string {
    const valueText = value == null ? "—" : String(value);
    const valueHtml =
        unit && value != null
            ? `<span class="fd-recipe-macro__value-wrap"><span class="fd-recipe-macro__value">${esc(valueText)}</span><span class="fd-recipe-macro__unit">${esc(unit)}</span></span>`
            : `<span class="fd-recipe-macro__value">${esc(valueText)}</span>`;
    return `<div class="fd-recipe-macro">
<span class="fd-recipe-macro__label">${esc(label)}</span>
${valueHtml}
</div>`;
}

function macrosBlock(macros: RecipeMacros, gapReasons: string[]): string {
    if (macros.incomplete && macros.calories == null) {
        const reasons =
            gapReasons.length > 0
                ? `<ul class="fd-recipe-macro-gaps">${gapReasons
                      .map((r) => `<li>${esc(r)}</li>`)
                      .join("")}</ul>`
                : "";
        return `<p class="fd-recipe-macros-incomplete">Macros incomplete per portion</p>${reasons}`;
    }
    const grid = `<div class="fd-recipe-macro-grid">${macroCell("Calories", macros.calories, "kcal")}${macroCell("Protein", macros.protein_g, "g")}${macroCell("Carbs", macros.carbs_g, "g")}${macroCell("Fat", macros.fat_g, "g")}</div>`;
    const gaps =
        macros.incomplete && gapReasons.length > 0
            ? `<ul class="fd-recipe-macro-gaps">${gapReasons
                  .map((r) => `<li>${esc(r)}</li>`)
                  .join("")}</ul>`
            : "";
    return `${grid}${gaps}`;
}

function ingredientGroupsHtml(groups: RecipeIngredientPlaceGroup[]): string {
    if (groups.length === 0) {
        return `<p class="fd-recipe-empty">No ingredients yet.</p>`;
    }
    return groups
        .map((group) => {
            const rows = group.lines
                .map((line) => {
                    const expiry = line.expiresOn
                        ? `<span class="fd-recipe-ing__expiry">Expires ${esc(line.expiresOn)}</span>`
                        : "";
                    return `<li class="fd-recipe-ing"><span class="fd-recipe-ing__name">${esc(line.displayName)}</span><span class="fd-recipe-ing__amount">${esc(line.amountLabel)}</span>${expiry}</li>`;
                })
                .join("");
            return `<section class="fd-recipe-place" aria-label="${esc(group.placeName)}">
<h2 class="fd-recipe-place__title">${esc(group.placeName)}</h2>
<ul class="fd-recipe-ing-list">${rows}</ul>
</section>`;
        })
        .join("");
}

function instructionsHtml(instructions: string | null): string {
    const steps = recipeSteps(instructions);
    if (steps.length === 0) {
        return `<p class="fd-recipe-empty">No steps yet.</p>`;
    }
    return `<ol class="fd-recipe-steps">${steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>`;
}

function cookForm(view: RecipeDetailV2View): string {
    if (view.recipe.verification === "unverified") return "";
    const recipeId = esc(view.recipe.id);
    const memberFields = view.members
        .map((member) => {
            const value =
                member.userId === view.viewerId
                    ? String(view.portionCount)
                    : "1";
            return `<label class="fd-recipe-cook-field"><span class="fd-recipe-cook-field__label">${esc(member.displayName)}</span><input class="fd-recipe-cook-input" name="portion:${esc(member.userId)}" type="number" min="0" step="any" value="${esc(value)}" /></label>`;
        })
        .join("");
    const err = view.error
        ? `<p class="fd-recipe-cook-error" role="alert">${esc(view.error)}</p>`
        : "";
    return `${err}<form class="fd-recipe-cook" method="post" action="/recipes/${recipeId}/cook">
${memberFields}
<label class="fd-recipe-cook-field"><span class="fd-recipe-cook-field__label">Total portions</span><input class="fd-recipe-cook-input" name="total_portions" type="number" min="0" step="any" placeholder="${esc(String(view.recipe.yieldPortions))} for the whole recipe" /></label>
<label class="fd-recipe-cook-field"><span class="fd-recipe-cook-field__label">Meal type</span>
<select class="fd-recipe-cook-select" name="meal_type">
<option value="breakfast">Breakfast</option>
<option value="lunch">Lunch</option>
<option value="dinner" selected>Dinner</option>
<option value="snack">Snack</option>
</select></label>
<fieldset class="fd-recipe-cook-options">
<legend class="fd-sr">Also</legend>
<label class="fd-recipe-cook-check"><input type="checkbox" name="deduct_stock" value="1" checked /> Deduct stock</label>
<label class="fd-recipe-cook-check"><input type="checkbox" name="log_meals" value="1" checked /> Log meals</label>
</fieldset>
<button type="submit" class="fd-btn fd-btn--primary fd-recipe-cook-submit">Cooked it</button>
</form>`;
}

export function renderRecipeDetailBody(view: RecipeDetailV2View): string {
    const time = recipeTimeLabel(view.recipe);
    const metaBits = [
        time ? `<span class="fd-recipe-meta__item">${esc(time)}</span>` : "",
        `<span class="fd-recipe-meta__item">Yield ${esc(String(view.recipe.yieldPortions))}</span>`,
        `<span class="fd-recipe-meta__item">${
            view.portionCount === 1
                ? "1 portion for you"
                : `${esc(String(view.portionCount))} portions for you`
        }</span>`,
    ].filter(Boolean);
    const metaRow = metaBits.join(
        '<span class="fd-recipe-meta__sep" aria-hidden="true"> · </span>',
    );
    return `<div class="fd-recipe-detail">
<p class="fd-recipe-back"><a class="fd-recipe-back__link" href="/recipes">← Recipes</a></p>
<header class="fd-recipe-header">
<h1 class="fd-recipe-title">${esc(view.recipe.name)}</h1>
${metaRow ? `<p class="fd-recipe-meta">${metaRow}</p>` : ""}
</header>
<div class="fd-recipe-layout">
<div class="fd-recipe-col fd-recipe-col--primary">
<section class="fd-recipe-section" aria-labelledby="fd-recipe-ingredients-heading">
<h2 class="fd-recipe-section__title" id="fd-recipe-ingredients-heading">Ingredients</h2>
${ingredientGroupsHtml(view.ingredientGroups)}
</section>
<section class="fd-recipe-section" aria-labelledby="fd-recipe-cook-heading">
<h2 class="fd-recipe-section__title" id="fd-recipe-cook-heading">Cook</h2>
${cookForm(view)}
</section>
</div>
<div class="fd-recipe-col fd-recipe-col--secondary">
<section class="fd-recipe-section" aria-labelledby="fd-recipe-macros-heading">
<h2 class="fd-recipe-section__title" id="fd-recipe-macros-heading">Per portion</h2>
${macrosBlock(view.macrosPerPortion, view.gapReasons)}
</section>
<section class="fd-recipe-section" aria-labelledby="fd-recipe-method-heading">
<h2 class="fd-recipe-section__title" id="fd-recipe-method-heading">Instructions</h2>
${instructionsHtml(view.recipe.instructions)}
</section>
</div>
</div>
</div>`;
}

export function renderRecipeDetailV2Page(view: RecipeDetailV2View): string {
    return renderAppShell({
        ...view.chrome,
        title: view.recipe.name,
        active: "recipes",
        body: renderRecipeDetailBody(view),
    });
}
