import { escapeHtml } from "../shell.js";
import type { ExpiryLevel } from "../../domain/stock.js";
import { disclosure, modalTrigger } from "./ui.js";

function expiryPillExpired(): string {
    return `<span class="pill pill-bad expiry-pill">Expired</span>`;
}

export function renderExpiringStrip(
    items: { id: string; displayName: string; expiresOn: string }[],
): string {
    if (items.length === 0) return "";
    const n = items.length;
    const rows = items
        .map(
            (item) =>
                `<li data-item-id="${escapeHtml(item.id)}"><div class="row"><span class="row-title">${escapeHtml(item.displayName)}</span><span class="row-meta">${escapeHtml(item.expiresOn)}</span></div></li>`,
        )
        .join("");
    return disclosure({
        summary: `Expiring soon <span class="count">${n}</span>`,
        body: `<section class="fridge-expiring panel">
<ul class="list">${rows}</ul>
</section>`,
    });
}

export function renderGroceryLineRow(opts: {
    id: string;
    kind: string;
    checked: boolean;
    displayName: string;
    quantityLabel: string;
    alreadyHaveHtml: string;
    putAwayHtml?: string;
}): string {
    const checked = opts.checked ? "true" : "false";
    const next = opts.checked ? "0" : "1";
    const verb = opts.checked ? "Uncheck" : "Check";
    const metaParts = [escapeHtml(opts.quantityLabel)];
    if (opts.alreadyHaveHtml) {
        metaParts.push(opts.alreadyHaveHtml);
    }
    const meta = metaParts.join(" · ");
    return `<li class="grocery-line${opts.checked ? " is-checked" : ""}" data-line-id="${escapeHtml(opts.id)}" data-checked="${checked}" data-kind="${opts.kind}">
<div class="list-row grocery-line-row">
<form class="grocery-line-check" method="post" action="/grocery/lines/${escapeHtml(opts.id)}/check">
<input type="hidden" name="checked" value="${next}" />
<button type="submit" class="check-btn" aria-pressed="${checked}"><span class="visually-hidden">${verb} ${escapeHtml(opts.displayName)}</span></button>
</form>
<div class="list-row-main">
<p class="grocery-line-name row-title">${escapeHtml(opts.displayName)}</p>
<p class="grocery-line-meta row-meta">${meta}</p>
</div>
${opts.putAwayHtml ? `<div class="row-actions">${opts.putAwayHtml}</div>` : ""}
</div>
</li>`;
}

export function renderFridgeItemRow(opts: {
    id: string;
    kind: string;
    displayName: string;
    quantityLabel: string;
    expiresOn?: string | null;
    expiryLevel?: ExpiryLevel | null;
    rowActions: string;
}): string {
    const id = escapeHtml(opts.id);
    const expired = opts.expiryLevel === "expired";
    const expiryAttr = expired ? ` data-expiry="expired"` : "";
    const pill = expired ? expiryPillExpired() : "";
    const expiryText = opts.expiresOn
        ? `Expires ${escapeHtml(opts.expiresOn)}`
        : "No expiry";
    const meta = `${escapeHtml(opts.quantityLabel)} · ${expiryText}`;
    const titleLine = `<div class="row-title-line"><p class="fridge-item-name row-title">${escapeHtml(opts.displayName)}</p>${pill}</div>`;
    return `<li class="fridge-item" data-item-id="${id}" data-kind="${opts.kind}"${expiryAttr}>
<div class="list-row fridge-item-row">
<div class="list-row-main">
${titleLine}
<p class="fridge-item-qty row-meta">${meta}</p>
</div>
<div class="row-actions">
${opts.rowActions}
</div>
</div>
</li>`;
}

export function renderRecipeCard(opts: {
    id: string;
    name: string;
    yieldPortions: number;
    tags?: string[];
}): string {
    const tags =
        opts.tags && opts.tags.length > 0
            ? `<p class="recipe-tags">${opts.tags
                  .map(
                      (tag) =>
                          `<span class="recipe-tag pill pill-dim">${escapeHtml(tag)}</span>`,
                  )
                  .join("")}</p>`
            : "";
    return `<li class="recipe-card" data-recipe-id="${escapeHtml(opts.id)}">
<div class="row">
<a class="row-title" href="/recipes/${escapeHtml(opts.id)}">${escapeHtml(opts.name)}</a>
<p class="recipe-yield row-meta">Yield ${escapeHtml(String(opts.yieldPortions))}</p>
</div>
${tags}
</li>`;
}

export function renderRecipeIngredientRow(opts: {
    id: string;
    recipeId: string;
    displayName: string;
    totalLabel: string;
    perPortionLabel: string;
    personPortionLabel?: string | null;
    perPortionAmount: number;
    personAmount: number;
    totalAmount: number;
    note?: string | null;
    editModalId: string;
    deleteModalId: string;
}): string {
    const note = opts.note
        ? `<p class="recipe-ingredient-note muted">${escapeHtml(opts.note)}</p>`
        : "";
    const id = escapeHtml(opts.id);
    const recipeId = escapeHtml(opts.recipeId);
    const name = escapeHtml(opts.displayName);
    let meta = `Total ${escapeHtml(opts.totalLabel)} · Per portion ${escapeHtml(opts.perPortionLabel)}`;
    if (opts.personPortionLabel) {
        meta += ` · Your portion ${escapeHtml(opts.personPortionLabel)}`;
    }
    return `<li class="recipe-ingredient" data-ingredient-id="${id}" data-per-portion="${escapeHtml(String(opts.perPortionAmount))}" data-person-amount="${escapeHtml(String(opts.personAmount))}">
<div class="list-row recipe-ingredient-row">
<div class="list-row-main">
<p class="recipe-ingredient-name row-title">${name}</p>
<p class="recipe-ingredient-meta row-meta">${meta}</p>
</div>
<div class="row-actions">
<form class="recipe-ingredient-move" method="post" action="/recipes/${recipeId}/ingredients/${id}/move">
<button type="submit" name="direction" value="up" class="btn-sm" aria-label="Move ${name} up">↑</button>
<button type="submit" name="direction" value="down" class="btn-sm" aria-label="Move ${name} down">↓</button>
</form>
${modalTrigger({
    target: opts.editModalId,
    label: "Edit",
    className: "btn-sm",
})}
${modalTrigger({
    target: opts.deleteModalId,
    label: "Remove",
    className: "btn-sm btn-danger",
})}
</div>
</div>
${note}
</li>`;
}
