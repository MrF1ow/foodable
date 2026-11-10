import { escapeHtml } from "../../../html.js";

/**
 * The redesign's one sheet component (UI-6). A native `<dialog>` whose form
 * the breakpoint decides, not the caller:
 *
 *   below 1024px  every kind is a bottom sheet (grab handle, drag to dismiss)
 *   1024px and up `edit` is a 480px panel from the right over a dimmed page,
 *                 `confirm` is a centred dialog
 *
 * Styles: `public/app/v2/sheet.css`. Behaviour: `src/web/client/v2/sheet.js`.
 * The old `modal` / `confirmModal` in `../ui.ts` are untouched and stay in use
 * on every page that has not been redesigned.
 *
 * Forms: a sheet's action row is a sibling of its scrolling body, so the
 * submit button cannot sit inside the form it submits. The form goes in `body`
 * with an `id`, and the submit button in `actions` names it with
 * `form="<that id>"`. `confirmSheet` does exactly that.
 */

export type SheetKind = "edit" | "confirm";

export function sheet(opts: {
    id: string;
    kind: SheetKind;
    title: string;
    subtitle?: string;
    /** Pre-escaped HTML (same contract as `modal`'s `body`). */
    body: string;
    /** Pre-escaped HTML for the sticky action row. */
    actions?: string;
    /** A 4xx re-render reopens the sheet on load. */
    openOnLoad?: boolean;
    /** Accessible name of the close button. Default "Close". */
    closeLabel?: string;
    /** When false, the sheet has no close button (grabber/backdrop/Esc still close). */
    showClose?: boolean;
}): string {
    const id = escapeHtml(opts.id);
    const titleId = `${id}-title`;
    const subId = `${id}-sub`;
    const kind = opts.kind === "confirm" ? "confirm" : "edit";
    const describedBy = opts.subtitle ? ` aria-describedby="${subId}"` : "";
    const reopen = opts.openOnLoad ? " data-sheet-open-on-load" : "";
    const subtitle = opts.subtitle
        ? `\n<p class="fd-sheet-sub" id="${subId}">${escapeHtml(opts.subtitle)}</p>`
        : "";
    const actions = opts.actions
        ? `\n<div class="fd-sheet-actions">\n${opts.actions}\n</div>`
        : "";
    const closeLabel = escapeHtml(opts.closeLabel ?? "Close");
    const showClose = opts.showClose !== false;
    const closeBtn = showClose
        ? `<button type="button" class="fd-sheet-close" command="close" commandfor="${id}" aria-label="${closeLabel}"><svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>`
        : "";
    return `<dialog class="fd-sheet fd-sheet--${kind}" id="${id}" aria-labelledby="${titleId}"${describedBy}${reopen}>
<div class="fd-sheet-panel" tabindex="-1">
<div class="fd-sheet-handle" aria-hidden="true"></div>
<header class="fd-sheet-head">
<div class="fd-sheet-heading">
<h2 class="fd-sheet-title" id="${titleId}">${escapeHtml(opts.title)}</h2>${subtitle}
</div>
${closeBtn}
</header>
<div class="fd-sheet-body">
${opts.body}
</div>${actions}
</div>
</dialog>`;
}

export function sheetTrigger(opts: {
    target: string;
    label: string;
    className?: string;
    /** When set, used as button inner HTML (label still drives aria-label / title). */
    icon?: string;
    /** Extra `data-*` attributes. Both the key and the value are escaped. */
    data?: Record<string, string>;
}): string {
    const aria = escapeHtml(opts.label);
    const inner = opts.icon ?? aria;
    const cls = opts.className ? ` class="${escapeHtml(opts.className)}"` : "";
    const title = opts.icon ? ` title="${aria}" aria-label="${aria}"` : "";
    const data = opts.data
        ? Object.entries(opts.data)
              .map(
                  ([key, value]) =>
                      ` data-${escapeHtml(key)}="${escapeHtml(value)}"`,
              )
              .join("")
        : "";
    return `<button type="button"${cls} commandfor="${escapeHtml(opts.target)}" command="show-modal"${title}${data}>${inner}</button>`;
}

export function confirmSheet(opts: {
    id: string;
    title: string;
    subtitle?: string;
    message: string;
    action: string;
    confirmLabel: string;
    cancelLabel?: string;
    hiddenFields?: Record<string, string>;
    openOnLoad?: boolean;
    /** The confirm form opts out of Turbo (non-redirect success HTML). */
    turboFalse?: boolean;
}): string {
    const id = escapeHtml(opts.id);
    const formId = `${id}-form`;
    const turboOpt = opts.turboFalse ? ' data-turbo="false"' : "";
    const hidden = opts.hiddenFields
        ? Object.entries(opts.hiddenFields)
              .map(
                  ([name, value]) =>
                      `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />\n`,
              )
              .join("")
        : "";
    const body = `<form id="${formId}" method="post" action="${escapeHtml(opts.action)}"${turboOpt}>
${hidden}<p class="fd-sheet-message">${escapeHtml(opts.message)}</p>
</form>`;
    const actions = `<button type="button" class="fd-btn" command="close" commandfor="${id}">${escapeHtml(opts.cancelLabel ?? "Cancel")}</button>
<button type="submit" class="fd-btn fd-btn--danger" form="${formId}">${escapeHtml(opts.confirmLabel)}</button>`;
    return sheet({
        id: opts.id,
        kind: "confirm",
        title: opts.title,
        subtitle: opts.subtitle,
        body,
        actions,
        openOnLoad: opts.openOnLoad,
    });
}
