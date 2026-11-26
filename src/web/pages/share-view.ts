// The public page behind /s/:token: one shared recipe or the grocery list,
// read-only, for someone who is not signed in. It is a bare document on
// purpose: no navigation, no account chip, no sign-out link, no scripts, and
// no toast region (the flash-toast middleware only touches pages that have
// one, so a visitor's own cookie never paints onto it). It takes only a
// `ShareView`, which already holds nothing but what a visitor may see.

import type { ShareView } from "../../domain/sharing.js";
import { recipeSteps } from "../../domain/recipes.js";
import { appStylesheetHref, appV2StylesheetHref } from "../../widgets.js";
import { formatQuantityDisplayParts } from "../display-quantity.js";
import { chipGroup } from "../components/v2/chip.js";
import { emptyState } from "../components/v2/empty-state.js";
import { esc, join, raw, type Html } from "../components/v2/html.js";
import { itemRow } from "../components/v2/item-row.js";
import { listGroup } from "../components/v2/list-group.js";
import { pageLayout } from "../components/v2/page-layout.js";
import { sectionHeader } from "../components/v2/section-header.js";
import { htmlOpen, themeColorMeta, type ThemePref } from "../shell.js";

function servingsLabel(portions: number): string {
    return portions === 1 ? "1 serving" : `${portions} servings`;
}

function amountLabel(amount: number | null, unit: string | null): string {
    if (amount === null || unit === null) return "To taste";
    return formatQuantityDisplayParts(amount, unit);
}

/** The wordmark, the kind of page and its title and one line under it. */
function head(kicker: string, title: string, meta: string): Html {
    return raw(
        `<p class="fd-share-brand">Foodable</p><p class="fd-share-kicker">${esc(kicker)}</p><h1 class="fd-share-title">${esc(title)}</h1><p class="fd-share-meta">${esc(meta)}</p>`,
    );
}

function recipeBody(view: Extract<ShareView, { kind: "recipe" }>): {
    title: string;
    head: Html;
    content: Html;
} {
    const { recipe } = view;
    const tags =
        recipe.tags.length > 0
            ? chipGroup({
                  label: "Tags",
                  select: "static",
                  chips: recipe.tags.map((tag) => ({ label: tag })),
              })
            : "";
    const ingredients =
        recipe.ingredients.length === 0
            ? emptyState({ title: "No ingredients listed." })
            : listGroup({
                  label: "Ingredients",
                  rows: recipe.ingredients.map((ingredient) =>
                      itemRow({
                          title: ingredient.name,
                          subtitle: ingredient.note?.trim() || undefined,
                          value: amountLabel(
                              ingredient.amount,
                              ingredient.unit,
                          ),
                      }),
                  ),
              });
    const steps = recipeSteps(recipe.instructions);
    const method =
        steps.length === 0
            ? emptyState({ title: "No steps yet." })
            : listGroup({
                  label: "Method",
                  rows: steps.map((step, i) =>
                      itemRow({
                          title: `${i + 1}. ${step}`,
                          className: "fd-item-row--wrap",
                      }),
                  ),
              });
    return {
        title: recipe.name,
        head: head(
            "Shared recipe",
            recipe.name,
            servingsLabel(recipe.portions),
        ),
        content: raw(
            join([
                tags,
                sectionHeader({
                    label: "Ingredients",
                    count: recipe.ingredients.length,
                    rule: false,
                }),
                ingredients,
                sectionHeader({ label: "Method", rule: false }),
                method,
            ]),
        ),
    };
}

function groceryBody(view: Extract<ShareView, { kind: "grocery_list" }>): {
    title: string;
    head: Html;
    content: Html;
} {
    const stores = view.list.stores;
    const lineCount = stores.reduce((n, store) => n + store.lines.length, 0);
    const groups =
        stores.length === 0
            ? emptyState({ title: "Nothing on the list." })
            : raw(
                  join(
                      stores.map((store) =>
                          join([
                              sectionHeader({
                                  label: store.name,
                                  count: store.lines.length,
                                  rule: false,
                              }),
                              listGroup({
                                  label: store.name,
                                  rows: store.lines.map((line) =>
                                      itemRow({
                                          title: line.name,
                                          value: formatQuantityDisplayParts(
                                              line.amount,
                                              line.unit,
                                          ),
                                          lead: line.checked
                                              ? {
                                                    kind: "done",
                                                    label: "Checked off",
                                                }
                                              : {
                                                    kind: "ring",
                                                    label: "Not checked off",
                                                },
                                      }),
                                  ),
                              }),
                          ]),
                      ),
                  ),
              );
    return {
        title: "Grocery list",
        head: head(
            "Shared list",
            "Grocery list",
            lineCount === 1 ? "1 item" : `${lineCount} items`,
        ),
        content: raw(join([groups, `<p class="fd-share-foot">Read-only</p>`])),
    };
}

/**
 * The whole document. `theme` is "system" because a visitor has no saved
 * preference; the stylesheet follows the OS.
 */
export function renderShareViewPage(
    view: ShareView,
    theme: ThemePref = "system",
): string {
    const { title, head, content } =
        view.kind === "recipe" ? recipeBody(view) : groceryBody(view);
    return `<!doctype html>
${htmlOpen(theme)}
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex, nofollow" />
<meta name="referrer" content="no-referrer" />
${themeColorMeta(theme, "page")}
<title>${esc(title)} · Foodable</title>
<link rel="icon" href="/favicon.ico" sizes="32x32" />
<link rel="icon" href="/brand/icon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="stylesheet" href="${appStylesheetHref()}" />
<link rel="stylesheet" href="${appV2StylesheetHref()}" />
</head>
<body class="fd-body fd-share-body">
<main class="fd-share native">
${pageLayout({ layout: "single", header: head, content, className: "fd-share-layout" })}
</main>
</body>
</html>`;
}
