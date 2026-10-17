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
    if (opts.actions) parts.push(opts.actions);
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
