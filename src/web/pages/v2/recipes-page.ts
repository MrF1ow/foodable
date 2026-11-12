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
import {
    formatLogMacroGrams,
    formatLogMacroKcal,
} from "../../../domain/log-macro-format.js";
import type { AppChromeBase } from "../../attention.js";
import { formatQuantityDisplayParts } from "../../display-quantity.js";
import { esc } from "../../components/v2/html.js";
import { statTiles, type StatTile } from "../../components/v2/stat-tiles.js";
import { renderAppShell } from "../../shell.js";
import { favouriteStarForm } from "./recipes-favourite.js";
import {
    renderCookSheet,
    renderCookTrigger,
    type CookSheetView,
} from "./recipes-page-cook.js";
import {
    renderPlanSheet,
    renderPlanTrigger,
    type PlanSheetView,
} from "./recipes-plan.js";

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
    /** The viewer has starred this recipe. Absent means not. */
    favourite?: boolean;
    /** The cook sheet. Absent when the recipe cannot be cooked (unverified). */
    cook?: CookSheetView;
    /** The Add to plan sheet. */
    plan?: PlanSheetView;
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
    const tiles: StatTile[] = [];
    if (macros.calories != null) {
        tiles.push({
            label: "kcal",
            value: formatLogMacroKcal(macros.calories),
            dot: "calories",
        });
    }
    if (macros.protein_g != null) {
        tiles.push({
            label: "Protein",
            value: formatLogMacroGrams(macros.protein_g),
            unit: "g",
            dot: "protein",
        });
    }
    if (macros.carbs_g != null) {
        tiles.push({
            label: "Carbs",
            value: formatLogMacroGrams(macros.carbs_g),
            unit: "g",
            dot: "carbs",
        });
    }
    if (macros.fat_g != null) {
        tiles.push({
            label: "Fat",
            value: formatLogMacroGrams(macros.fat_g),
            unit: "g",
            dot: "fat",
        });
    }
    const kicker =
        tiles.length > 0
            ? `<p class="fd-recipe-macros-kicker">Per serving</p>`
            : "";
    const grid =
        tiles.length > 0
            ? String(
                  statTiles(tiles, {
                      label: "Per serving",
                      className: "fd-recipe-macro-tiles",
                  }),
              )
            : "";
    const gaps =
        macros.incomplete && gapReasons.length > 0
            ? `<ul class="fd-recipe-macro-gaps">${gapReasons
                  .map((r) => `<li>${esc(r)}</li>`)
                  .join("")}</ul>`
            : "";
    return `${kicker}${grid}${gaps}`;
}

function ingredientSubline(
    group: RecipeIngredientPlaceGroup,
    line: RecipeIngredientPlaceLine,
): string {
    if (group.placeId === RECIPE_NOT_IN_STOCK_ID) {
        return "Not in stock";
    }
    if (line.expiresOn) {
        return `${group.placeName} · expires ${line.expiresOn}`;
    }
    return group.placeName;
}

function ingredientGroupsHtml(groups: RecipeIngredientPlaceGroup[]): string {
    if (groups.length === 0) {
        return `<p class="fd-recipe-empty">No ingredients yet.</p>`;
    }
    const count = groups.reduce((n, g) => n + g.lines.length, 0);
    const body = groups
        .map((group) => {
            const rows = group.lines
                .map((line) => {
                    const sub = ingredientSubline(group, line);
                    const inStock = group.placeId !== RECIPE_NOT_IN_STOCK_ID;
                    const dotClass = inStock
                        ? "fd-recipe-ing__dot"
                        : "fd-recipe-ing__dot fd-recipe-ing__dot--miss";
                    const noteClass = inStock
                        ? "fd-recipe-ing__note"
                        : "fd-recipe-ing__note fd-recipe-ing__note--miss";
                    return `<li class="fd-recipe-ing"><span class="${dotClass}" aria-hidden="true"></span><span class="fd-recipe-ing__body"><span class="fd-recipe-ing__name">${esc(line.displayName)}</span><span class="${noteClass}">${esc(sub)}</span></span><span class="fd-recipe-ing__amount">${esc(line.amountLabel)}</span></li>`;
                })
                .join("");
            return `<section class="fd-recipe-place" aria-label="${esc(group.placeName)}">
<h3 class="fd-recipe-place__title">${esc(group.placeName)}</h3>
<ul class="fd-recipe-ing-list">${rows}</ul>
</section>`;
        })
        .join("");
    return `<div class="fd-recipe-section-head"><h2 class="fd-recipe-section-head__title">Ingredients</h2><span class="fd-recipe-section-head__count">${esc(String(count))}</span></div>${body}`;
}

function instructionsHtml(instructions: string | null): string {
    const steps = recipeSteps(instructions);
    if (steps.length === 0) {
        return `<p class="fd-recipe-empty">No steps yet.</p>`;
    }
    return `<ol class="fd-recipe-steps">${steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>`;
}

function recipeSourceHint(sourceUrl: string | null): string {
    if (!sourceUrl?.trim()) return "";
    try {
        const host = new URL(sourceUrl).hostname.replace(/^www\./, "");
        return host ? `from ${host}` : "";
    } catch {
        return "";
    }
}

function servingsMeta(portions: number): string {
    return portions === 1 ? "1 serving" : `${portions} servings`;
}

export function renderRecipeDetailBody(view: RecipeDetailV2View): string {
    const time = recipeTimeLabel(view.recipe);
    const metaParts = [servingsMeta(view.recipe.yieldPortions)];
    if (time) metaParts.push(time);
    const source = recipeSourceHint(view.recipe.sourceUrl);
    if (source) metaParts.push(source);
    const metaRow = metaParts.map((p) => esc(p)).join(" · ");
    const portionNote =
        view.portionCount === 1
            ? "1 portion for you"
            : `${view.portionCount} portions for you`;
    const backChevron = `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18 9 12 15 6"/></svg>`;
    const backRound = `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 18 9 12 15 6"/></svg>`;
    // The heading id is the anchor Today's "Cook it" link has always used.
    const actions =
        view.cook || view.plan
            ? `<div class="fd-recipe-actions" id="fd-recipe-cook-heading">${view.cook ? String(renderCookTrigger()) : ""}${view.plan ? String(renderPlanTrigger()) : ""}</div>`
            : "";
    const pageError =
        view.error && !view.cook?.open && !view.plan?.open
            ? `<p class="fd-recipe-error" role="alert">${esc(view.error)}</p>`
            : "";
    return `<div class="fd-recipe-detail">
${pageError}<p class="fd-recipe-back"><a class="fd-recipe-back__btn fd-settings-phone-back" href="/recipes" data-turbo="false" aria-label="Back to recipes">${backRound}</a><a class="fd-recipe-back__link" href="/recipes">${backChevron}<span>Recipes</span></a></p>
${favouriteStarForm({
    recipeId: view.recipe.id,
    recipeName: view.recipe.name,
    on: view.favourite === true,
    back: { kind: "recipe" },
    className: "fd-recipe-star",
})}
<header class="fd-recipe-header">
<h1 class="fd-recipe-title">${esc(view.recipe.name)}</h1>
${metaRow ? `<p class="fd-recipe-meta">${metaRow}</p>` : ""}
<p class="fd-recipe-meta fd-recipe-meta--you">${esc(portionNote)}</p>
</header>
<div class="fd-recipe-layout">
<div class="fd-recipe-col fd-recipe-col--primary">
<section class="fd-recipe-section fd-recipe-section--macros" aria-label="Per serving">
${macrosBlock(view.macrosPerPortion, view.gapReasons)}
</section>
<section class="fd-recipe-section" aria-labelledby="fd-recipe-ingredients-heading">
<span class="fd-sr" id="fd-recipe-ingredients-heading">Ingredients</span>
${ingredientGroupsHtml(view.ingredientGroups)}
</section>
</div>
<div class="fd-recipe-col fd-recipe-col--secondary">
<section class="fd-recipe-section" aria-labelledby="fd-recipe-method-heading">
<div class="fd-recipe-section-head"><h2 class="fd-recipe-section-head__title" id="fd-recipe-method-heading">Steps</h2></div>
${instructionsHtml(view.recipe.instructions)}
</section>
</div>
</div>
${actions}
</div>
${view.cook ? renderCookSheet(view.cook) : ""}
${view.plan ? renderPlanSheet(view.plan) : ""}`;
}

export function renderRecipeDetailV2Page(view: RecipeDetailV2View): string {
    return renderAppShell({
        ...view.chrome,
        title: view.recipe.name,
        active: "recipes",
        body: renderRecipeDetailBody(view),
    });
}
