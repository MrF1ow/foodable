import { escapeHtml } from "../shell.js";
import type { Notice } from "../../domain/notices.js";
import { iconArrowDown, iconArrowUp, iconPencil, iconTrash } from "./icons.js";
import { disclosure, modalTrigger, type ModalFill } from "./ui.js";
import { noticeBadge } from "./notices.js";

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
    usualProductName?: string | null;
    extraActionsHtml?: string;
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
${opts.usualProductName ? `<p class="grocery-line-usual muted">${escapeHtml(opts.usualProductName)}</p>` : ""}
<p class="grocery-line-meta row-meta">${meta}</p>
${opts.extraActionsHtml || opts.putAwayHtml ? `<div class="grocery-line-put-away row-actions">${opts.extraActionsHtml ?? ""}${opts.putAwayHtml ?? ""}</div>` : ""}
</div>
</div>
</li>`;
}

export function renderFridgeItemRow(opts: {
    id: string;
    kind: string;
    displayName: string;
    quantityLabel: string;
    expiresOn?: string | null;
    notices: readonly Notice[];
    rowActions: string;
}): string {
    const id = escapeHtml(opts.id);
    const expiredNotice = opts.notices.find((n) => n.code === "fridge.expired");
    const expired = expiredNotice != null;
    const expiryAttr = expired ? ` data-expiry="expired"` : "";
    const pill =
        expiredNotice != null
            ? noticeBadge(expiredNotice, { className: "expiry-pill" })
            : "";
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
    verification?: "verified" | "unverified";
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
    const badge =
        opts.verification === "unverified"
            ? `<span class="recipe-verification pill pill-warn">Unverified</span>`
            : "";
    return `<li class="recipe-card" data-recipe-id="${escapeHtml(opts.id)}">
<div class="row">
<a class="row-title" href="/recipes/${escapeHtml(opts.id)}">${escapeHtml(opts.name)}</a>
<p class="recipe-yield row-meta">${badge}Yield ${escapeHtml(String(opts.yieldPortions))}</p>
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
    perPortionAmount: number | null;
    personAmount: number | null;
    totalAmount: number | null;
    note?: string | null;
    editModalId: string;
    deleteModalId: string;
    editFill?: ModalFill;
    deleteFill?: ModalFill;
    usualProductActionHtml?: string;
}): string {
    const note = opts.note
        ? `<p class="recipe-ingredient-note muted">${escapeHtml(opts.note)}</p>`
        : "";
    const pickUsual = opts.usualProductActionHtml
        ? `<p class="recipe-ingredient-usual">${opts.usualProductActionHtml}</p>`
        : "";
    const id = escapeHtml(opts.id);
    const recipeId = escapeHtml(opts.recipeId);
    const name = escapeHtml(opts.displayName);
    const moveUpLabel = escapeHtml(`Move ${opts.displayName} up`);
    const moveDownLabel = escapeHtml(`Move ${opts.displayName} down`);
    const editLabel = escapeHtml(`Edit ${opts.displayName}`);
    const removeLabel = escapeHtml(`Remove ${opts.displayName}`);
    let meta = `Total ${escapeHtml(opts.totalLabel)} · Per portion ${escapeHtml(opts.perPortionLabel)}`;
    if (opts.personPortionLabel) {
        meta += ` · Your portion ${escapeHtml(opts.personPortionLabel)}`;
    }
    return `<li class="recipe-ingredient" data-ingredient-id="${id}" data-per-portion="${escapeHtml(opts.perPortionAmount == null ? "" : String(opts.perPortionAmount))}" data-person-amount="${escapeHtml(opts.personAmount == null ? "" : String(opts.personAmount))}">
<div class="list-row recipe-ingredient-row">
<div class="list-row-main">
<p class="recipe-ingredient-name row-title">${name}</p>
<p class="recipe-ingredient-meta row-meta">${meta}</p>
</div>
<div class="row-actions">
<form class="recipe-ingredient-move" method="post" action="/recipes/${recipeId}/ingredients/${id}/move">
<button type="submit" name="direction" value="up" class="btn-sm btn-icon" aria-label="${moveUpLabel}" title="${moveUpLabel}">${iconArrowUp()}</button>
<button type="submit" name="direction" value="down" class="btn-sm btn-icon" aria-label="${moveDownLabel}" title="${moveDownLabel}">${iconArrowDown()}</button>
</form>
${modalTrigger({
    target: opts.editModalId,
    label: `Edit ${opts.displayName}`,
    className: "btn-sm btn-icon",
    icon: iconPencil(),
    fill: opts.editFill,
})}
${modalTrigger({
    target: opts.deleteModalId,
    label: `Remove ${opts.displayName}`,
    className: "btn-sm btn-icon btn-danger",
    icon: iconTrash(),
    fill: opts.deleteFill,
})}
</div>
</div>
${pickUsual}
${note}
</li>`;
}
