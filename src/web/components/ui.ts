import { escapeHtml } from "../../html.js";

export function pageHeader(opts: {
    title: string;
    sub?: string;
    actions?: string;
}): string {
    const h1 = `<h1>${escapeHtml(opts.title)}</h1>`;
    if (!opts.sub && !opts.actions) return h1;
    const parts = [h1];
    if (opts.sub) parts.push(opts.sub);
    if (opts.actions) {
        parts.push(`<div class="page-actions">\n${opts.actions}\n</div>`);
    }
    return `<header class="dash-head">
${parts.join("\n")}
</header>`;
}

export function panel(opts: {
    title?: string;
    body: string;
    className?: string;
}): string {
    const cls = opts.className ? `panel ${opts.className}` : "panel";
    const heading = opts.title ? `<h2>${escapeHtml(opts.title)}</h2>\n` : "";
    return `<section class="${cls}">
${heading}${opts.body}
</section>`;
}

export function disclosure(opts: {
    summary: string;
    body: string;
    open?: boolean;
}): string {
    const open = opts.open ? " open" : "";
    return `<details class="more"${open}>
<summary>${opts.summary}</summary>
${opts.body}
</details>`;
}

export function errorBanner(error?: string): string {
    return error ? `<p class="error-banner">${escapeHtml(error)}</p>` : "";
}

/** Banner when the error is not shown inside a modal (missing or unknown openModalId). */
export function pageLevelErrorBanner(
    view: { error?: string; openModalId?: string },
    renderedModalIds: readonly string[],
): string {
    if (!view.error) return "";
    const openId = view.openModalId;
    if (openId && renderedModalIds.includes(openId)) return "";
    return errorBanner(view.error);
}

export function emptyState(text: string, className = "empty"): string {
    return `<p class="${className}">${escapeHtml(text)}</p>`;
}

export function modal(opts: {
    id: string;
    title: string;
    body: string;
    size?: string;
    openOnLoad?: boolean;
}): string {
    const id = escapeHtml(opts.id);
    const titleId = `${id}-title`;
    const sizeCls = opts.size ? ` modal--${escapeHtml(opts.size)}` : "";
    const reopen = opts.openOnLoad ? " data-modal-open-on-load" : "";
    return `<dialog class="modal${sizeCls}" id="${id}" aria-labelledby="${titleId}"${reopen}>
<div class="modal-sheet">
<div class="modal-handle" aria-hidden="true"></div>
<header class="modal-head">
<h2 class="modal-title" id="${titleId}">${escapeHtml(opts.title)}</h2>
<button type="button" class="modal-close" command="close" commandfor="${id}" aria-label="Close"><span aria-hidden="true">×</span></button>
</header>
<div class="modal-body">
${opts.body}
</div>
</div>
</dialog>`;
}

export function modalTrigger(opts: {
    target: string;
    label: string;
    className?: string;
    /** When set, used as button inner HTML (label still drives aria-label / title). */
    icon?: string;
}): string {
    const cls = opts.className ?? "btn-primary";
    const aria = escapeHtml(opts.label);
    const inner = opts.icon ?? escapeHtml(opts.label);
    const title = opts.icon ? ` title="${aria}" aria-label="${aria}"` : "";
    return `<button type="button" class="${escapeHtml(cls)}" commandfor="${escapeHtml(opts.target)}" command="show-modal"${title}>${inner}</button>`;
}

export function confirmModal(opts: {
    id: string;
    title: string;
    message: string;
    action: string;
    confirmLabel: string;
    hiddenFields?: Record<string, string>;
    openOnLoad?: boolean;
    formClass?: string;
    /** Pre-escaped HTML before the confirm form (same contract as {@link modal}'s `body`). */
    bodyPrefix?: string;
}): string {
    const id = escapeHtml(opts.id);
    const formClass = escapeHtml(opts.formClass ?? "modal-confirm");
    const hidden =
        opts.hiddenFields &&
        Object.entries(opts.hiddenFields)
            .map(
                ([name, value]) =>
                    `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`,
            )
            .join("\n");
    const body = `<form class="${formClass}" method="post" action="${escapeHtml(opts.action)}">
${hidden ? `${hidden}\n` : ""}<p class="modal-message">${escapeHtml(opts.message)}</p>
<div class="modal-actions">
<button type="button" command="close" commandfor="${id}">Cancel</button>
<button type="submit" class="btn-danger">${escapeHtml(opts.confirmLabel)}</button>
</div>
</form>`;
    return modal({
        id: opts.id,
        title: opts.title,
        body: `${opts.bodyPrefix ?? ""}${body}`,
        openOnLoad: opts.openOnLoad,
    });
}

export function row(opts: {
    title: string;
    meta?: string;
    actions?: string;
}): string {
    const meta = opts.meta
        ? `<span class="row-meta">${escapeHtml(opts.meta)}</span>`
        : "";
    const actions = opts.actions
        ? `<div class="row-actions">
${opts.actions}
</div>`
        : "";
    return `<div class="row"><span class="row-title">${escapeHtml(opts.title)}</span>${meta}</div>${actions}`;
}
