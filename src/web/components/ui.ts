import { escapeHtml } from "../../html.js";

export function pageHeader(opts: {
    title: string;
    sub?: string;
    /** Controls on the same line as the page title (wrap under on narrow screens). */
    titleActions?: string;
    actions?: string;
}): string {
    const h1 = `<h1>${escapeHtml(opts.title)}</h1>`;
    const titleBlock = opts.titleActions
        ? `<div class="dash-head-title-row">
${h1}
<div class="dash-head-title-actions">
${opts.titleActions}
</div>
</div>`
        : h1;
    if (!opts.sub && !opts.titleActions && !opts.actions) return h1;
    const parts = [titleBlock];
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

/**
 * A label above its control, wrapped in one `.field` grid. The label-to-control
 * gap belongs to the field itself, so it holds in any container: a modal body,
 * a disclosure, a form, or plain block flow. `control` is pre-escaped HTML
 * whose control carries `id`; `label` is plain text.
 */
export function field(opts: {
    id: string;
    label: string;
    control: string;
    className?: string;
}): string {
    const cls = opts.className ? `field ${opts.className}` : "field";
    return `<div class="${escapeHtml(cls)}">
<label for="${escapeHtml(opts.id)}">${escapeHtml(opts.label)}</label>
${opts.control}
</div>`;
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
