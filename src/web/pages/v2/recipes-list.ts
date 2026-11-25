/**
 * The Recipes list, built from the design's components: a Page header, the
 * Search field with its filter pull-down (and, for a pasted link, Go), the
 * week's planned recipes as Mini cards, and the recipes as Item rows in a
 * flat List group.
 *
 * What the search field does depends on what is typed. Text filters the list
 * (a GET of this page); a recipe link shows the link icon and Go, and posts
 * the import (`client/v2/recipes.js`). A failed import shows its reason in a
 * Card under the field and keeps the link in the field.
 */
import {
    recipeTimeLabel,
    type Recipe,
    type RecipeFilterFlags,
    type RecipeMacros,
} from "../../../domain/recipes.js";
import {
    filterParamValue,
    RECIPE_FILTERS,
} from "../../../domain/recipe-filters.js";
import { formatLogMacroGrams } from "../../../domain/log-macro-format.js";
import type { RecipeSourceKind } from "../../../domain/recipe-import.js";
import type { AppChromeBase } from "../../attention.js";
import { button } from "../../components/v2/button.js";
import { card } from "../../components/v2/card.js";
import { emptyState } from "../../components/v2/empty-state.js";
import { field } from "../../components/v2/field.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, type MenuItem } from "../../components/v2/menu.js";
import { pageHeader } from "../../components/v2/page-header.js";
import { pageLayout } from "../../components/v2/page-layout.js";
import { searchField } from "../../components/v2/search-field.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { renderAppShell } from "../../shell.js";
import { favouriteStarForm } from "./recipes-favourite.js";
import {
    planDayLabel,
    renderMissingSheet,
    renderPlanEditSheets,
    renderPlannedWeek,
    type WeekPlanView,
} from "./recipes-plan.js";

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
    /** The filters in force (`?filter=a,b`), known ids only. */
    filters?: string[];
    cards: V2RecipeCard[];
    totalCount: number;
    /** This week's plan: the planned cards, and the sheets they open. */
    week?: WeekPlanView;
    /** Picking a recipe for this day (`?plan_date=`): each row's plus goes to it. */
    planDate?: string;
    /** The headline of the inline import error card. */
    importError?: string;
    /** Under the headline: why, or what to do next. */
    importErrorReason?: string;
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
     * could not be imported: what was pasted, and why.
     */
    sharedImport?: {
        error?: string;
        reason?: string;
        input?: string;
        /**
         * Where the input was typed: the search field (the link shows there
         * once) or the shared-recipe form (it shows there once). Absent is the form.
         */
        via?: "field" | "form";
    };
    /**
     * Whether the page offers pasting a recipe from another Foodable (the
     * `mcp-share-links` flag). Absent or false leaves that form out.
     */
    sharedImportEnabled?: boolean;
    /**
     * The viewer's own drafts (imports nobody has saved), with the
     * household's local day each is deleted on. Absent or empty leaves the
     * Drafts section out.
     */
    drafts?: readonly { id: string; name: string; expiresOn: string | null }[];
};

export function recipesListV2Href(opts: {
    q?: string;
    filters?: readonly string[];
    /** Keeps picking a recipe for this day (`?plan_date=`). */
    planDate?: string;
}): string {
    const params = new URLSearchParams();
    if (opts.planDate) params.set("plan_date", opts.planDate);
    const q = opts.q?.trim() ?? "";
    if (q) params.set("q", q);
    const filter = filterParamValue(opts.filters ?? []);
    if (filter) params.set("filter", filter);
    // A comma is legal in a query; keep `?filter=a,b` readable.
    const query = params.toString().replaceAll("%2C", ",");
    return query ? `/recipes?${query}` : "/recipes";
}

/** The same test `client/v2/recipes.js` makes on what is typed. */
function looksLikeLink(text: string): boolean {
    return /^https?:\/\/\S+$/i.test(text.trim());
}

function servingsLabel(portions: number): string {
    return portions === 1 ? "1 serving" : `${portions} servings`;
}

/** "Missing 2 · Avocado, Lime": the row's words when the kitchen falls short. */
function missingLabel(
    flags: RecipeFilterFlags,
    names: string[],
): string | null {
    if (!flags.hasIngredients || flags.missingCount === 0) return null;
    const list = names.length > 0 ? ` · ${names.slice(0, 4).join(", ")}` : "";
    return `Missing ${flags.missingCount}${list}`;
}

/** P / C / F for a row; a macro nobody knows is a dash, never a zero. */
function rowMacros(macros: RecipeMacros) {
    if (
        macros.protein_g == null &&
        macros.carbs_g == null &&
        macros.fat_g == null
    ) {
        return undefined;
    }
    const grams = (value: number | null) =>
        value == null ? "–" : formatLogMacroGrams(value);
    return {
        protein: grams(macros.protein_g),
        carbs: grams(macros.carbs_g),
        fat: grams(macros.fat_g),
    };
}

function planHref(recipeId: string, date?: string): string {
    const day = date ? `&date=${encodeURIComponent(date)}` : "";
    return `/recipes/${encodeURIComponent(recipeId)}?plan=1${day}`;
}

function recipeRow(card: V2RecipeCard, view: RecipesListV2View): Html {
    const { recipe, flags, macrosPerPortion, missingNames } = card;
    const missing = missingLabel(flags, missingNames);
    const minutes = recipeTimeLabel(recipe);
    const subtitle =
        missing ??
        [servingsLabel(recipe.yieldPortions), minutes]
            .filter(Boolean)
            .join(" · ");
    const common = {
        title: recipe.name,
        subtitle,
        macros: rowMacros(macrosPerPortion),
        state: missing ? ("warning" as const) : ("default" as const),
        href: `/recipes/${recipe.id}`,
        id: `recipe-${recipe.id}`,
        className: "fd-recipes-row",
    };
    // Picking a day: the plus plans the recipe for it, nothing else on the row.
    if (view.planDate) {
        return itemRow({
            ...common,
            add: {
                kind: "add",
                label: `Plan ${recipe.name}`,
                href: planHref(recipe.id, view.planDate),
            },
        });
    }
    const star = favouriteStarForm({
        recipeId: recipe.id,
        recipeName: recipe.name,
        on: card.favourite === true,
        back: {
            kind: "list",
            query: view.query.trim(),
            filter: filterParamValue(view.filters ?? []),
        },
        className: "fd-recipes-row__star",
    });
    // Every row's ⋯ has Plan, which opens the recipe's Add to plan sheet.
    const items: MenuItem[] = [
        { kind: "link", label: "Plan", href: planHref(recipe.id) },
    ];
    return itemRow({
        ...common,
        beside: {
            lead: raw(star),
            trailing: menu({
                label: `Actions for ${recipe.name}`,
                anchor: "more",
                items,
                className: "fd-recipes-row__menu",
            }),
        },
    });
}

/** The filter pull-down on the search field: a tick per filter in force, and Clear. */
function filterMenu(view: RecipesListV2View, filters: string[]): Html {
    const items: MenuItem[] = RECIPE_FILTERS.map((entry) => {
        const on = filters.includes(entry.id);
        return {
            kind: "checked" as const,
            label: entry.label,
            checked: on,
            href: recipesListV2Href({
                q: view.query,
                planDate: view.planDate,
                filters: on
                    ? filters.filter((other) => other !== entry.id)
                    : [...filters, entry.id],
            }),
        };
    });
    if (filters.length > 0) {
        items.push({
            kind: "link",
            label: "Clear",
            href: recipesListV2Href({
                q: view.query,
                planDate: view.planDate,
            }),
        });
    }
    return menu({
        label: "Filter recipes",
        anchor: "filter",
        filterCount: filters.length,
        items,
        data: {
            "fd-search-filter": "",
            "fd-recipes-filter-count": String(filters.length),
        },
    });
}

function hiddenInput(name: string, value: string): string {
    return `<input type="hidden" name="${esc(name)}" value="${esc(value)}" />`;
}

/** What the search field holds: the search, else the link whose import failed. */
function searchFieldValue(view: RecipesListV2View): string {
    const q = view.query.trim();
    if (q) return q;
    // Also on the paste step (a page that would not give its recipe up): the
    // link stays, so the person can fix it or try another. The text-only step
    // has a link box of its own.
    if (!view.importTextOnly && view.importUrl?.trim()) {
        return view.importUrl.trim();
    }
    const shared = view.sharedImportEnabled ? view.sharedImport : undefined;
    if (shared?.via === "field" && shared.input && looksLikeLink(shared.input))
        return shared.input.trim();
    return "";
}

function searchBlock(view: RecipesListV2View, filters: string[]): Html {
    const value = searchFieldValue(view);
    const link = looksLikeLink(value);
    const picking = view.planDate != null;
    const fieldHtml = searchField({
        label: picking ? "Search recipes" : "Search recipes or paste a link",
        placeholder: picking
            ? "Search recipes"
            : "Search recipes or paste a link",
        value,
        id: "fd-recipes-q",
        clear: "auto",
        filterMenu: filterMenu(view, filters),
        leadSwap: !picking,
        go: picking
            ? undefined
            : {
                  label: "Import recipe",
                  hidden: !link,
                  attrs: { "data-fd-recipes-import-go": "" },
              },
        linkDetected: link && !picking,
        data: { "fd-recipes-field": "" },
    });
    const importForm = picking
        ? ""
        : `<form method="post" action="/recipes/import" data-fd-recipes-import data-busy-form hidden>${hiddenInput("url", "")}</form>`;
    return raw(
        `<form class="fd-recipes-search" id="fd-recipes-search-form" method="get" action="/recipes" data-fd-recipes-search>${fieldHtml}${view.planDate ? hiddenInput("plan_date", view.planDate) : ""}${filters.length > 0 ? hiddenInput("filter", filterParamValue(filters)) : ""}<button type="submit" class="fd-sr">Search</button></form>${importForm}`,
    );
}

/** The inline import error: a Card with the headline and, when there is one, the reason under it. */
function importErrorCard(parts: {
    headline: string;
    reason?: string;
    /** A reason that is already markup (the duplicate's Open link). */
    reasonHtml?: string;
    className?: string;
}): Html {
    const reason = parts.reasonHtml ?? (parts.reason ? esc(parts.reason) : "");
    return card({
        className: `fd-recipes-import-error${parts.className ? ` ${parts.className}` : ""}`,
        children: raw(
            `<div role="alert"><p class="fd-recipes-import-error__headline">${esc(parts.headline)}</p>${reason ? `<p class="fd-recipes-import-error__reason">${reason}</p>` : ""}</div>`,
        ),
    });
}

/** The paste step of an import that needs the caption or the page text. */
function importPasteBlock(view: RecipesListV2View): Html {
    if (!view.importPasteStep) return raw("");
    const retry = view.importShowRetry
        ? button({
              variant: "secondary",
              type: "submit",
              label: "Check again",
              disabled: view.importRetryDisabled,
              attrs: { name: "retry", value: "1", formnovalidate: "" },
          })
        : "";
    const origin =
        view.importTextOrigin === "shared"
            ? hiddenInput("text_origin", "shared")
            : "";
    const submit = button({
        variant: "primary",
        type: "submit",
        label: "Import",
    });
    if (view.importTextOnly) {
        return card({
            label: "Paste recipe",
            className: "fd-recipes-import-paste",
            children: raw(
                `<form method="post" action="/recipes/import" data-busy-form>${hiddenInput("import_step", "paste")}${hiddenInput("text_only", "1")}${origin}${field(
                    {
                        id: "fd-recipes-paste-url",
                        label: "Recipe link",
                        name: "url",
                        type: "url",
                        autocomplete: "off",
                        placeholder: "https://… (optional)",
                        value: view.importUrl ?? "",
                        labelHidden: true,
                    },
                )}${field({
                    id: "fd-recipes-paste-text",
                    label: "Recipe text",
                    name: "text",
                    rows: 8,
                    required: true,
                    value: view.importPasteText ?? "",
                    labelHidden: true,
                })}<div class="fd-recipes-import-actions">${submit}${retry}</div></form>`,
            ),
        });
    }
    const kind = view.importSourceKind ?? "website";
    const website =
        kind === "pinterest"
            ? `${view.importWebsiteError ? `<p class="fd-recipes-import-error__reason" role="alert">${esc(view.importWebsiteError)}</p>` : ""}${field(
                  {
                      id: "fd-recipes-paste-website",
                      label: "Recipe website",
                      name: "website_url",
                      type: "url",
                      autocomplete: "off",
                      placeholder: "https://… recipe page",
                      value: view.importWebsiteUrl ?? "",
                      labelHidden: true,
                  },
              )}`
            : "";
    const credit =
        view.importSourceKind === "website"
            ? ""
            : field({
                  id: "fd-recipes-paste-credit",
                  label: "Creator",
                  name: "credit",
                  maxlength: 120,
                  autocomplete: "off",
                  value: view.importCredit ?? "",
              });
    return card({
        label: "Paste recipe",
        className: "fd-recipes-import-paste",
        children: raw(
            `<form method="post" action="/recipes/import" data-busy-form>${hiddenInput("import_step", "paste")}${hiddenInput("url", view.importUrl ?? "")}${origin}${website}${field(
                {
                    id: "fd-recipes-paste-text",
                    label: "Recipe text",
                    name: "text",
                    rows: 8,
                    required: kind !== "pinterest",
                    value: view.importPasteText ?? "",
                    labelHidden: true,
                },
            )}${credit}<div class="fd-recipes-import-actions">${submit}${retry}</div></form>`,
        ),
    });
}

/** Pasting a recipe from another Foodable (the `mcp-share-links` flag). */
function sharedImportBlock(view: RecipesListV2View): Html {
    // Picking a day has nothing to import.
    if (!view.sharedImportEnabled || view.planDate) return raw("");
    // What came through the search field shows there, not here: the box stays
    // closed and empty.
    const shared =
        view.sharedImport?.via === "field" ? undefined : view.sharedImport;
    // Its failure shows inside the open box, above the field it is about.
    const failure = shared?.error
        ? String(
              importErrorCard({
                  headline: shared.error,
                  reason: shared.reason,
                  className: "fd-recipes-import-shared-error",
              }),
          )
        : "";
    return raw(
        `<details class="fd-recipes-shared"${shared ? " open" : ""}><summary class="fd-recipes-shared__summary">Import from another Foodable</summary>${failure}<form method="post" action="/recipes/import-shared" data-fd-recipes-shared data-busy-form>${field(
            {
                id: "fd-recipes-shared",
                label: "Shared recipe link or JSON",
                name: "shared",
                rows: 4,
                required: true,
                spellcheck: false,
                autocomplete: "off",
                placeholder: "https://…/s/… or {…}",
                value: shared?.input ?? "",
                labelHidden: true,
            },
        )}${button({ variant: "primary", type: "submit", label: "Import recipe" })}</form></details>`,
    );
}

/** "Wed 11 Nov", as the app's other days read; anything else as it came. */
function dayLabel(day: string): string {
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? planDayLabel(day) : day;
}

/** The viewer's drafts: each opens its recipe page, where Save is. */
function draftsSection(view: RecipesListV2View): Html {
    const drafts = view.drafts ?? [];
    if (drafts.length === 0) return raw("");
    const rows = drafts.map((draft) =>
        itemRow({
            title: draft.name,
            subtitle: draft.expiresOn
                ? `Draft · deleted ${dayLabel(draft.expiresOn)} unless saved`
                : "Draft",
            href: `/recipes/${draft.id}`,
            trailing: { kind: "chevron" },
            id: `draft-${draft.id}`,
        }),
    );
    return raw(
        `<section class="fd-recipes-drafts" id="fd-recipes-drafts" aria-label="Drafts">${sectionHeader({ label: "Drafts", count: drafts.length, rule: false })}${listGroup({ rows, label: "Drafts" })}</section>`,
    );
}

function allRecipes(view: RecipesListV2View, filters: string[]): Html {
    // Typing narrows "All recipes" to "N of M"; a filter alone keeps the heading.
    const searching = view.query.trim() !== "";
    if (view.totalCount === 0) {
        // Picking a day with nothing to pick still offers the way out.
        if (view.planDate) {
            return raw(
                `${sectionHeader({
                    label: "All recipes",
                    rule: false,
                    action: { label: "Cancel", href: "/recipes" },
                })}${emptyState({
                    title: "No recipes yet",
                    body: "Import a recipe first, then pick it for a day.",
                })}`,
            );
        }
        // Drafts alone make the page not empty.
        if ((view.drafts ?? []).length > 0) return raw("");
        return emptyState({
            title: "No recipes yet",
            body: "Paste a recipe link in the search field to import one.",
        });
    }
    const label = searching
        ? `${view.cards.length} of ${view.totalCount} recipes`
        : "All recipes";
    const head = sectionHeader({
        label,
        count: searching ? undefined : view.cards.length,
        rule: false,
        id: "fd-recipes-all-heading",
        action: view.planDate
            ? { label: "Cancel", href: "/recipes" }
            : undefined,
    });
    if (view.cards.length === 0) {
        const onlyFavourites =
            filters.length === 1 &&
            filters[0] === "favourites" &&
            !view.query.trim();
        return raw(
            `${head}${emptyState(
                onlyFavourites
                    ? {
                          title: "No favourites yet",
                          body: "Tap the star on a recipe to keep it here.",
                      }
                    : { title: "No recipes match" },
            )}`,
        );
    }
    return raw(
        `<section class="fd-recipes-all" aria-labelledby="fd-recipes-all-heading" data-fd-recipes-total="${view.totalCount}">${head}${listGroup(
            {
                rows: view.cards.map((c) => recipeRow(c, view)),
                label: "Recipes",
                className: "fd-recipes-list",
            },
        )}</section>`,
    );
}

export function renderRecipesListBody(view: RecipesListV2View): string {
    const filters = view.filters ?? [];
    const importDuplicate =
        view.importDuplicateRecipeId != null
            ? importErrorCard({
                  headline: "You already have this recipe.",
                  reasonHtml: `<a href="/recipes/${esc(view.importDuplicateRecipeId)}">Open it</a>`,
              })
            : raw("");
    const importErr =
        view.importError && view.importDuplicateRecipeId == null
            ? importErrorCard({
                  headline: view.importError,
                  reason: view.importErrorReason,
              })
            : raw("");
    // A link that failed from the search field answers under the field; one
    // that failed in the shared-recipe box answers in that box.
    const shared =
        view.sharedImportEnabled && view.sharedImport?.via === "field"
            ? view.sharedImport
            : undefined;
    const sharedError = shared?.error
        ? importErrorCard({
              headline: shared.error,
              reason: shared.reason,
              className: "fd-recipes-import-shared-error",
          })
        : raw("");
    const notices = join([
        importDuplicate,
        importErr,
        sharedError,
        importPasteBlock(view),
    ]);
    const planned =
        view.week && !view.planDate ? renderPlannedWeek(view.week) : "";
    const header = pageHeader({
        title: "Recipes",
        subtitle: view.planDate
            ? `Pick one for ${planDayLabel(view.planDate)}`
            : `${view.totalCount} saved`,
        className: "fd-recipes-head",
    });
    const head = raw(`${header}${searchBlock(view, filters)}`);
    const list = join([allRecipes(view, filters)]);
    // A draft cannot be planned, so picking a day leaves them out.
    const drafts = view.planDate ? raw("") : draftsSection(view);
    // An import answer takes a column of its own beside the list (the design's
    // Two columns); otherwise the page is one column.
    const layout =
        notices !== ""
            ? pageLayout({
                  layout: "two-columns",
                  header: head,
                  left: raw(`${notices}${planned}`),
                  right: raw(
                      `${drafts}${list}${String(sharedImportBlock(view))}`,
                  ),
                  className: "fd-recipes-layout",
              })
            : pageLayout({
                  layout: "single",
                  header: head,
                  content: raw(
                      `${planned}${drafts}${list}${String(sharedImportBlock(view))}`,
                  ),
                  className: "fd-recipes-layout",
              });
    const sheets = view.week
        ? `${renderPlanEditSheets(view.week, "recipes")}\n${renderMissingSheet(view.week, "recipes")}`
        : "";
    return `<div class="fd-recipes-page"${view.planDate ? " data-fd-recipes-picking" : ""}>
${String(layout)}
${sheets}
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
