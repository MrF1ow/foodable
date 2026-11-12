import {
    recipeTimeLabel,
    type Recipe,
    type RecipeFilterFlags,
    type RecipeMacros,
} from "../../../domain/recipes.js";
import { formatLogMacroGrams } from "../../../domain/log-macro-format.js";
import type { RecipeSourceKind } from "../../../domain/recipe-import.js";
import type { Notice } from "../../../domain/notices.js";
import type { AppChromeBase } from "../../attention.js";
import { fdIcon } from "../../components/fd-icons.js";
import { chipLink, chipNav } from "../../components/v2/chips.js";
import { esc, srOnly } from "../../components/v2/html.js";
import { renderAppShell } from "../../shell.js";
import { noticeStrip, stripNotices } from "./notice-strip.js";
import { favouriteStarForm } from "./recipes-favourite.js";
import {
    planDayLabel,
    renderMissingSheet,
    renderPlanEditSheets,
    renderWeekStrip,
    type WeekPlanView,
} from "./recipes-plan.js";

export type V2RecipeListFilter =
    "" | "cookable" | "protein" | "quick" | "favourites";

export type V2RecipeCard = {
    recipe: Recipe;
    flags: RecipeFilterFlags;
    macrosPerPortion: RecipeMacros;
    missingNames: string[];
    /** The viewer has starred it. Absent means not. */
    favourite?: boolean;
};

export type RecipesListV2View = {
    chrome: AppChromeBase;
    query: string;
    filter: V2RecipeListFilter;
    cards: V2RecipeCard[];
    cookableCount?: number;
    totalCount: number;
    /** This week's plan: the strip, and the sheets its buttons open. */
    week?: WeekPlanView;
    /** The household's open notices; what the plan is missing shows under the week. */
    notices?: readonly Notice[];
    /** Picking a recipe for this day (`?plan_date=`): each card's Plan goes to it. */
    planDate?: string;
    importError?: string;
    importPasteStep?: boolean;
    importUrl?: string;
    importPasteText?: string;
    importWebsiteError?: string;
    importWebsiteUrl?: string;
    importShowRetry?: boolean;
    importRetryDisabled?: boolean;
    importTextOnly?: boolean;
    importTextOrigin?: "shared" | "pasted";
    importDuplicateRecipeId?: string;
    importCredit?: string;
    importSourceKind?: RecipeSourceKind;
    importSourceLabel?: string;
    /**
     * A recipe pasted from another Foodable (its share link or its JSON) that
     * could not be imported: what was pasted, and why. Reopens the import panel.
     */
    sharedImport?: { error?: string; input?: string };
};

export function recipesListV2Href(opts: {
    q?: string;
    filter?: V2RecipeListFilter;
}): string {
    const params = new URLSearchParams();
    const q = opts.q?.trim() ?? "";
    if (q) params.set("q", q);
    if (opts.filter) params.set("filter", opts.filter);
    const query = params.toString();
    return query ? `/recipes?${query}` : "/recipes";
}

export function parseV2RecipeListFilter(
    raw: string | undefined,
): V2RecipeListFilter {
    if (
        raw === "cookable" ||
        raw === "protein" ||
        raw === "quick" ||
        raw === "favourites"
    ) {
        return raw;
    }
    return "";
}

function filterChip(
    label: string,
    value: V2RecipeListFilter,
    view: RecipesListV2View,
    count?: number,
): ReturnType<typeof chipLink> {
    return chipLink({
        label,
        href: recipesListV2Href({ q: view.query, filter: value }),
        selected: view.filter === value,
        count: count != null && count > 0 ? count : undefined,
    });
}

function servingsLabel(portions: number): string {
    return portions === 1 ? "1 serving" : `${portions} servings`;
}

function stockLabel(flags: RecipeFilterFlags, missingNames: string[]): string {
    if (!flags.hasIngredients) return "No ingredients yet";
    if (flags.missingCount === 0) return "You have everything";
    const names =
        missingNames.length > 0
            ? ` · ${missingNames.slice(0, 4).join(", ")}`
            : "";
    return `Missing ${flags.missingCount}${names}`;
}

function listMacroLine(macros: RecipeMacros): string {
    const one = (
        key: "protein" | "carbs" | "fat",
        letter: string,
        name: string,
        value: number | null,
    ) => {
        if (value == null) return "";
        return `<span class="fd-macro fd-macro--${key}"><span aria-hidden="true">${letter} </span>${srOnly(`${name} `)}${esc(formatLogMacroGrams(value))}</span>`;
    };
    const parts = [
        one("protein", "P", "Protein", macros.protein_g),
        one("carbs", "C", "Carbs", macros.carbs_g),
        one("fat", "F", "Fat", macros.fat_g),
    ].filter(Boolean);
    return parts.length > 0
        ? `<span class="fd-macros">${parts.join("")}</span>`
        : "";
}

function recipeCard(card: V2RecipeCard, view: RecipesListV2View): string {
    const { recipe, flags, macrosPerPortion, missingNames } = card;
    const minutes = recipeTimeLabel(recipe);
    const metaParts = [servingsLabel(recipe.yieldPortions)];
    if (minutes) metaParts.push(minutes);
    const macroHtml = listMacroLine(macrosPerPortion);
    const metaRow = macroHtml
        ? `${esc(metaParts.join(" · "))}<span class="fd-recipes-card__meta-sep" aria-hidden="true"> · </span>${macroHtml}`
        : esc(metaParts.join(" · "));
    const stock = stockLabel(flags, missingNames);
    const stockClass = !flags.hasIngredients
        ? "fd-recipes-card__stock--empty"
        : flags.missingCount === 0
          ? "fd-recipes-card__stock--ok"
          : "fd-recipes-card__stock--miss";
    const dot =
        flags.hasIngredients && flags.missingCount === 0
            ? `<span class="fd-recipes-card__dot" aria-hidden="true"></span>`
            : flags.hasIngredients && flags.missingCount > 0
              ? `<span class="fd-recipes-card__dot fd-recipes-card__dot--warn" aria-hidden="true"></span>`
              : "";
    const kcal =
        macrosPerPortion.calories != null
            ? `<span class="fd-recipes-card__kcal">${esc(String(Math.round(macrosPerPortion.calories)))} kcal</span>`
            : "";
    // The star is a form, so it sits beside the card's link, not inside it.
    const star = favouriteStarForm({
        recipeId: recipe.id,
        recipeName: recipe.name,
        on: card.favourite === true,
        back: { kind: "list", query: view.query.trim(), filter: view.filter },
        className: "fd-recipes-card__star",
    });
    const planDay = view.planDate
        ? `&date=${encodeURIComponent(view.planDate)}`
        : "";
    const plan = view.week
        ? `<a class="fd-recipes-card__plan" href="/recipes/${esc(recipe.id)}?plan=1${esc(planDay)}" aria-label="Plan ${esc(recipe.name)}">Plan</a>`
        : "";
    return `<li class="fd-row fd-row--recipe" id="recipe-${esc(recipe.id)}"><a class="fd-recipes-card" href="/recipes/${esc(recipe.id)}"><span class="fd-recipes-card__title">${esc(recipe.name)}</span><span class="fd-recipes-card__meta">${metaRow}</span>${kcal}${
        stock
            ? `<span class="fd-recipes-card__stock ${stockClass}">${dot}<span class="fd-recipes-card__stock-text">${esc(stock)}</span></span>`
            : ""
    }</a>${star}${plan}</li>`;
}

function importPasteBlock(view: RecipesListV2View): string {
    if (!view.importPasteStep) return "";
    const url = esc(view.importUrl ?? "");
    const text = esc(view.importPasteText ?? "");
    const website = esc(view.importWebsiteUrl ?? "");
    const websiteErr = view.importWebsiteError
        ? `<p class="fd-recipes-import-error" role="alert">${esc(view.importWebsiteError)}</p>`
        : "";
    const textOrigin =
        view.importTextOrigin === "shared"
            ? `<input type="hidden" name="text_origin" value="shared" />`
            : "";
    const creditValue = esc(view.importCredit ?? "");
    const creditField =
        view.importSourceKind === "website" || view.importTextOnly
            ? ""
            : `<label class="fd-recipes-import-credit-label">Creator<input class="fd-recipes-import-input" name="credit" type="text" maxlength="120" autocomplete="off" value="${creditValue}" /></label>`;
    const retry = view.importShowRetry
        ? `<button type="submit" name="retry" value="1" formnovalidate class="fd-recipes-import-retry"${view.importRetryDisabled ? " disabled" : ""}>Check again</button>`
        : "";
    if (view.importTextOnly) {
        return `<section class="fd-recipes-import-paste" aria-label="Paste recipe">
<form method="post" action="/recipes/import" data-busy-form>
<input type="hidden" name="import_step" value="paste" />
<input type="hidden" name="text_only" value="1" />
${textOrigin}
<input class="fd-recipes-import-input" name="url" type="url" inputmode="url" autocomplete="off" placeholder="https://… (optional)" aria-label="Recipe link" value="${url}" />
<textarea class="fd-recipes-import-text" name="text" rows="8" required aria-label="Recipe text">${text}</textarea>
<button type="submit" class="fd-recipes-import-submit">Import</button>
${retry}
</form></section>`;
    }
    const kind = view.importSourceKind ?? "website";
    const textRequired = kind === "pinterest" ? "" : " required";
    const websiteFields =
        kind === "pinterest"
            ? `${websiteErr}<input class="fd-recipes-import-input" name="website_url" type="url" inputmode="url" autocomplete="off" value="${website}" placeholder="https://… recipe page" aria-label="Recipe website" />
<p class="fd-recipes-import-note">Pins usually lead to the recipe website. Paste that link here.</p>`
            : "";
    return `<section class="fd-recipes-import-paste" aria-label="Paste recipe">
<form method="post" action="/recipes/import" data-busy-form>
<input type="hidden" name="import_step" value="paste" />
<input type="hidden" name="url" value="${url}" />
${textOrigin}
${websiteFields}
<textarea class="fd-recipes-import-text" name="text" rows="8" aria-label="Recipe text"${textRequired}>${text}</textarea>
${creditField}
<button type="submit" class="fd-recipes-import-submit">Import</button>
${retry}
</form></section>`;
}

function searchFieldValue(view: RecipesListV2View): string {
    const q = view.query.trim();
    if (q) return q;
    if (!view.importPasteStep && view.importUrl?.trim()) {
        return view.importUrl.trim();
    }
    return "";
}

export function renderRecipesListBody(view: RecipesListV2View): string {
    const q = esc(searchFieldValue(view));
    const filterHidden = view.filter
        ? `<input type="hidden" name="filter" value="${esc(view.filter)}" />`
        : "";
    const importDuplicate =
        view.importDuplicateRecipeId != null
            ? `<p class="fd-recipes-import-error" role="alert">You already have this recipe. <a href="/recipes/${esc(view.importDuplicateRecipeId)}">Open it</a></p>`
            : "";
    const importErr =
        view.importError && view.importDuplicateRecipeId == null
            ? `<p class="fd-recipes-import-error" role="alert">${esc(view.importError)}</p>`
            : "";
    const chips = chipNav(
        [
            filterChip("Cookable now", "cookable", view, view.cookableCount),
            filterChip("High protein", "protein", view),
            chipLink({
                label: "Under 30 min",
                href: recipesListV2Href({ q: view.query, filter: "quick" }),
                selected: view.filter === "quick",
                title: "Only recipes with a known total time; unknown time is excluded.",
            }),
            filterChip("Favourites", "favourites", view),
        ],
        { label: "Recipe filters", className: "fd-recipes-chips" },
    );
    const chipsHtml = String(chips);
    const emptyAll =
        view.totalCount === 0
            ? `<p class="fd-recipes-empty">No recipes yet. Paste a link above to import one.</p>`
            : "";
    const emptyFilter =
        view.totalCount > 0 && view.cards.length === 0
            ? view.filter === "favourites" && !view.query.trim()
                ? `<p class="fd-recipes-empty">No favourites yet. Tap the star on a recipe to keep it here.</p>`
                : `<p class="fd-recipes-empty">No recipes match this search.</p>`
            : "";
    const grid =
        view.cards.length > 0
            ? `<section class="fd-recipes-all" aria-labelledby="fd-recipes-all-heading">
<div class="fd-recipes-section-head"><h2 class="fd-recipes-section-head__title" id="fd-recipes-all-heading">All recipes</h2></div>
<ul class="fd-list fd-recipes-list${view.planDate ? " fd-recipes-list--planning" : ""}">${view.cards.map((card) => recipeCard(card, view)).join("")}</ul>
</section>`
            : "";
    const shared = view.sharedImport;
    const sharedError = shared?.error
        ? `<p class="fd-recipes-import-error fd-recipes-import-shared-error" role="alert">${esc(shared.error)}</p>`
        : "";
    const importLinkBlock = `<details class="fd-recipes-import-link"${shared ? " open" : ""}>
<summary class="fd-recipes-import-link__summary">Import a link</summary>
<form class="fd-recipes-import-link__form" method="post" action="/recipes/import" data-fd-recipes-import data-busy-form>
<input class="fd-recipes-import-input" name="url" type="url" inputmode="url" autocomplete="off" required placeholder="https://…" aria-label="Recipe link" value="${esc(view.importUrl ?? "")}" />
<button type="submit" class="fd-recipes-import-submit">Import</button>
</form>
<form class="fd-recipes-import-link__form fd-recipes-import-shared" method="post" action="/recipes/import-shared" data-fd-recipes-shared data-busy-form>
<p class="fd-recipes-import-note">Got a recipe from another Foodable? Paste its share link, or the recipe's JSON.</p>
${sharedError}
<textarea class="fd-recipes-import-text" name="shared" rows="4" required spellcheck="false" autocomplete="off" placeholder="https://…/s/… or {…}" aria-label="Shared recipe link or JSON">${esc(shared?.input ?? "")}</textarea>
<button type="submit" class="fd-recipes-import-submit">Import recipe</button>
</form>
</details>`;
    const planPick = view.planDate
        ? `<p class="fd-plan-pick" role="status">Pick a recipe for ${esc(planDayLabel(view.planDate))}. <a href="/recipes">Cancel</a></p>`
        : "";
    const weekStrip = view.week
        ? `${renderWeekStrip(view.week)}${String(
              noticeStrip(
                  stripNotices(
                      view.notices ?? [],
                      ["plan.missing_ingredient"],
                      undefined,
                  ),
                  { back: "/recipes", label: "Missing for the plan" },
              ),
          )}`
        : "";
    const weekSheets = view.week
        ? `${renderPlanEditSheets(view.week, "recipes")}\n${renderMissingSheet(view.week, "recipes")}`
        : "";
    const savedLabel =
        view.totalCount === 1 ? "1 saved" : `${view.totalCount} saved`;
    const cookableSuffix =
        view.cookableCount != null && view.cookableCount > 0
            ? `<span class="fd-recipes-subtitle__cookable"> · ${esc(String(view.cookableCount))} cookable now</span>`
            : "";
    const recipesLinkIcon = `<svg class="fd-icon fd-recipes-search-link__icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 13a5 5 0 0 1 7.07 0l1.42 1.42a5 5 0 0 1-7.08 7.07l-1.41-1.41"/><path d="M14 11a5 5 0 0 1-7.07 0L5.51 9.59a5 5 0 1 1 7.07-7.07l1.42 1.41"/></svg>`;
    return `<div class="fd-recipes-page">
<header class="fd-recipes-header">
<div class="fd-recipes-header__top">
<div class="fd-recipes-header__titles">
<h1 class="fd-recipes-title">Recipes</h1>
<p class="fd-recipes-subtitle">${esc(savedLabel)}${cookableSuffix}</p>
</div>
<button type="button" class="fd-recipes-add-link" data-fd-recipes-add-link>${recipesLinkIcon}<span>Add from link</span></button>
</div>
</header>
${importDuplicate}
${importErr}
${importPasteBlock(view)}
<div class="fd-recipes-toolbar">
<form class="fd-recipes-search-form" id="fd-recipes-search-form" method="get" action="/recipes" data-fd-recipes-search>
<div class="fd-recipes-search-field">
${fdIcon("search")}
<input class="fd-recipes-search-input fd-recipes-search-input--phone" name="q" type="search" inputmode="search" autocomplete="off" spellcheck="false" placeholder="Search or paste a link" value="${q}" aria-label="Search or paste a recipe link" />
<input class="fd-recipes-search-input fd-recipes-search-input--desk" type="search" inputmode="search" autocomplete="off" spellcheck="false" placeholder="Search recipes or paste a link" value="${q}" aria-label="Search recipes or paste a link" disabled />
<button type="button" class="fd-recipes-search-link" data-fd-recipes-add-link aria-label="Add from link">${recipesLinkIcon}</button>
</div>
${filterHidden}
<button type="submit" class="fd-sr">Search</button>
</form>
${chipsHtml}
</div>
${planPick}${weekStrip}${importLinkBlock}
${emptyAll}
${emptyFilter}
${grid}
${weekSheets}
</div>`;
}

export function renderRecipesListV2Page(view: RecipesListV2View): string {
    return renderAppShell({
        ...view.chrome,
        title: "Recipes",
        active: "recipes",
        body: renderRecipesListBody(view),
    });
}

export function applyV2RecipeListFilters(
    cards: V2RecipeCard[],
    query: string,
    filter: V2RecipeListFilter,
): V2RecipeCard[] {
    const needle = query.trim().toLowerCase();
    return cards.filter((card) => {
        if (needle && !card.recipe.name.toLowerCase().includes(needle)) {
            return false;
        }
        if (filter === "cookable" && !card.flags.cookable) return false;
        if (filter === "protein" && !card.flags.highProtein) return false;
        if (filter === "quick" && !card.flags.quick) return false;
        if (filter === "favourites" && card.favourite !== true) return false;
        return true;
    });
}
