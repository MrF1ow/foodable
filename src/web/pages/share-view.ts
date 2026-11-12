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
import { esc } from "../components/v2/html.js";
import { pageHeader } from "../components/ui.js";
import { htmlOpen, themeColorMeta, type ThemePref } from "../shell.js";

function servingsLabel(portions: number): string {
    return portions === 1 ? "1 serving" : `${portions} servings`;
}

function amountLabel(amount: number | null, unit: string | null): string {
    if (amount === null || unit === null) return "to taste";
    return formatQuantityDisplayParts(amount, unit);
}

function sectionHead(title: string, count?: number): string {
    const tail =
        count === undefined
            ? ""
            : `<span class="fd-recipe-section-head__count">${esc(count)}</span>`;
    return `<div class="fd-recipe-section-head"><h2 class="fd-recipe-section-head__title">${esc(title)}</h2>${tail}</div>`;
}

function recipeBody(view: Extract<ShareView, { kind: "recipe" }>): {
    title: string;
    body: string;
} {
    const { recipe } = view;
    const tags =
        recipe.tags.length > 0
            ? `<ul class="fd-share-tags" aria-label="Tags">${recipe.tags.map((tag) => `<li class="fd-share-tag">${esc(tag)}</li>`).join("")}</ul>`
            : "";
    const ingredients =
        recipe.ingredients.length === 0
            ? `<p class="fd-recipe-empty">No ingredients listed.</p>`
            : `<ul class="fd-share-rows">${recipe.ingredients
                  .map((ingredient) => {
                      const note = ingredient.note?.trim();
                      return `<li class="fd-share-row"><span class="fd-share-row__body"><span class="fd-share-row__name">${esc(ingredient.name)}</span>${note ? `<span class="fd-share-row__note">${esc(note)}</span>` : ""}</span><span class="fd-share-row__amount">${esc(amountLabel(ingredient.amount, ingredient.unit))}</span></li>`;
                  })
                  .join("")}</ul>`;
    const steps = recipeSteps(recipe.instructions);
    const method =
        steps.length === 0
            ? `<p class="fd-recipe-empty">No steps yet.</p>`
            : `<ol class="fd-recipe-steps">${steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>`;
    return {
        title: recipe.name,
        body: `<div class="fd-share-head">
<p class="fd-share-kicker">Shared recipe</p>
${pageHeader({ title: recipe.name, sub: `<p class="fd-recipe-meta">${esc(servingsLabel(recipe.portions))}</p>${tags}` })}
</div>
<section class="fd-share-section" aria-label="Ingredients">
${sectionHead("Ingredients", recipe.ingredients.length)}
${ingredients}
</section>
<section class="fd-share-section" aria-label="Method">
${sectionHead("Method")}
${method}
</section>`,
    };
}

function groceryBody(view: Extract<ShareView, { kind: "grocery_list" }>): {
    title: string;
    body: string;
} {
    const stores = view.list.stores;
    const lineCount = stores.reduce((n, store) => n + store.lines.length, 0);
    const groups =
        stores.length === 0
            ? `<p class="fd-recipe-empty">Nothing on the list.</p>`
            : stores
                  .map(
                      (
                          store,
                      ) => `<section class="fd-share-section" aria-label="${esc(store.name)}">
${sectionHead(store.name, store.lines.length)}
<ul class="fd-share-rows">${store.lines
                          .map(
                              (line) =>
                                  `<li class="fd-share-row${line.checked ? " fd-share-line--checked" : ""}"><span class="fd-share-row__body"><span class="fd-share-row__name">${esc(line.name)}</span></span><span class="fd-share-row__amount">${esc(formatQuantityDisplayParts(line.amount, line.unit))}</span></li>`,
                          )
                          .join("")}</ul>
</section>`,
                  )
                  .join("\n");
    return {
        title: "Grocery list",
        body: `<div class="fd-share-head">
<p class="fd-share-kicker">Shared list</p>
${pageHeader({ title: "Grocery list", sub: `<p class="fd-recipe-meta">${esc(lineCount === 1 ? "1 item" : `${lineCount} items`)}</p>` })}
</div>
${groups}`,
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
    const { title, body } =
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
<p class="fd-share-brand"><img src="/brand/mark.svg" width="22" height="21" alt="" /><span>Foodable</span></p>
<article class="fd-share-card">
${body}
</article>
<p class="fd-share-foot">A read-only copy, shared with you from a Foodable household.</p>
</main>
</body>
</html>`;
}
