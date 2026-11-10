import type { Recipe, RecipeFilterFlags } from "../../../domain/recipes.js";
import { recipeTimeLabel } from "../../../domain/recipes.js";
import type { RecipeSourceKind } from "../../../domain/recipe-import.js";
import type { AppChromeBase } from "../../attention.js";
import { fdIcon } from "../../components/fd-icons.js";
import { chipLink, chipNav } from "../../components/v2/chips.js";
import { esc } from "../../components/v2/html.js";
import { renderAppShell } from "../../shell.js";

export type V2RecipeListFilter = "" | "cookable" | "protein" | "quick";

export type V2RecipeCard = {
    recipe: Recipe;
    flags: RecipeFilterFlags;
};

export type RecipesListV2View = {
    chrome: AppChromeBase;
    query: string;
    filter: V2RecipeListFilter;
    cards: V2RecipeCard[];
    totalCount: number;
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
    if (raw === "cookable" || raw === "protein" || raw === "quick") {
        return raw;
    }
    return "";
}

function filterChip(
    label: string,
    value: V2RecipeListFilter,
    view: RecipesListV2View,
): ReturnType<typeof chipLink> {
    return chipLink({
        label,
        href: recipesListV2Href({ q: view.query, filter: value }),
        selected: view.filter === value,
    });
}

function stockLabel(flags: RecipeFilterFlags): string {
    if (!flags.hasIngredients) return "No ingredients yet";
    return flags.missingCount === 0
        ? "You have everything"
        : `Missing ${flags.missingCount}`;
}

function recipeCard(card: V2RecipeCard): string {
    const { recipe, flags } = card;
    const minutes = recipeTimeLabel(recipe);
    const stock = stockLabel(flags);
    const stockClass = !flags.hasIngredients
        ? "fd-recipes-card__stock--empty"
        : flags.missingCount === 0
          ? "fd-recipes-card__stock--ok"
          : "fd-recipes-card__stock--miss";
    const stockHtml = stock
        ? `<span class="fd-recipes-card__stock ${stockClass}">${esc(stock)}</span>`
        : "";
    return `<a class="fd-recipes-card" href="/recipes/${esc(recipe.id)}"><span class="fd-recipes-card__title">${esc(recipe.name)}</span>${
        minutes
            ? `<span class="fd-recipes-card__meta">${esc(minutes)}</span>`
            : ""
    }${stockHtml}</a>`;
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
            filterChip("Cookable now", "cookable", view),
            filterChip("High protein", "protein", view),
            chipLink({
                label: "Under 30 min",
                href: recipesListV2Href({ q: view.query, filter: "quick" }),
                selected: view.filter === "quick",
                title: "Only recipes with a known total time; unknown time is excluded.",
            }),
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
            ? `<p class="fd-recipes-empty">No recipes match this search.</p>`
            : "";
    const grid =
        view.cards.length > 0
            ? `<div class="fd-recipes-grid">${view.cards.map((card) => recipeCard(card)).join("")}</div>`
            : "";
    const importLinkBlock = `<details class="fd-recipes-import-link">
<summary class="fd-recipes-import-link__summary">Import a link</summary>
<form class="fd-recipes-import-link__form" method="post" action="/recipes/import" data-fd-recipes-import data-busy-form>
<input class="fd-recipes-import-input" name="url" type="url" inputmode="url" autocomplete="off" required placeholder="https://…" aria-label="Recipe link" value="${esc(view.importUrl ?? "")}" />
<button type="submit" class="fd-recipes-import-submit">Import</button>
</form>
</details>`;
    return `<div class="fd-recipes-page">
<header class="fd-recipes-header">
<h1 class="fd-recipes-title">Recipes</h1>
</header>
${importDuplicate}
${importErr}
${importPasteBlock(view)}
<form class="fd-recipes-search-form" id="fd-recipes-search-form" method="get" action="/recipes" data-fd-recipes-search>
<div class="fd-recipes-search-field">
${fdIcon("search")}
<input class="fd-recipes-search-input" name="q" type="search" inputmode="search" autocomplete="off" spellcheck="false" placeholder="Search recipes or paste a link" value="${q}" aria-label="Search recipes or paste a recipe link" />
</div>
${filterHidden}
<button type="submit" class="fd-sr">Search</button>
</form>
${importLinkBlock}
${chipsHtml}
${emptyAll}
${emptyFilter}
${grid}
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
        return true;
    });
}
