import { escapeHtml } from "../../../html.js";
import { button } from "./button.js";
import { esc, join, raw, type Html } from "./html.js";
import { icon } from "./icon.js";

/**
 * The redesign's one sheet component (UI-6). A native `<dialog>` whose form
 * the breakpoint decides, not the caller:
 *
 *   below 1024px  every sheet is a bottom sheet (grab handle, drag to dismiss)
 *   1024px and up a `dialog` is a centred card (480 wide, 600 for a search
 *                 sheet) and a `side` sheet is a 480px panel from the right
 *                 over a dimmed page
 *
 * Two ways to build one. The old signature (`kind: "edit" | "confirm"`, with
 * a pre-built `body` and `actions`) stays for every page that has not moved:
 * `edit` places like `side` and `confirm` like `dialog`, and its markup is
 * unchanged. The design's Sheet is built from parts: `placement` picks the
 * form, `header` is a `sheetHeader`, `body` is `sheetSection`s and `actions`
 * is a `sheetActions` (the design's Sheet header, Sheet section and Sheet
 * actions).
 *
 * Styles: `public/app/v2/sheet.css`. Behaviour: `src/web/client/v2/sheet.js`.
 * The old `modal` / `confirmModal` of `../ui.ts` are gone; every page builds
 * its dialogs with this component.
 *
 * Forms: a sheet's action row is a sibling of its scrolling body, so the
 * submit button cannot sit inside the form it submits. The form goes in `body`
 * with an `id`, and the submit button in `actions` names it with
 * `form="<that id>"`. `confirmSheet` does exactly that.
 */

export type SheetKind = "edit" | "confirm";

type LegacySheetOptions = {
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
    /** Extra classes after `fd-sheet fd-sheet--<kind>`. Escaped. */
    className?: string;
    /**
     * Where focus lands on open. `"panel"` parks it on the sheet panel, so a
     * first field does not raise the keyboard or draw a ring. Default: the
     * first field.
     */
    focus?: "panel";
};

function legacySheet(opts: LegacySheetOptions): string {
    const id = escapeHtml(opts.id);
    const titleId = `${id}-title`;
    const subId = `${id}-sub`;
    const kind = opts.kind === "confirm" ? "confirm" : "edit";
    const describedBy = opts.subtitle ? ` aria-describedby="${subId}"` : "";
    const reopen = opts.openOnLoad ? " data-sheet-open-on-load" : "";
    const classes = opts.className
        ? `fd-sheet fd-sheet--${kind} ${escapeHtml(opts.className)}`
        : `fd-sheet fd-sheet--${kind}`;
    const focus = opts.focus === "panel" ? ' data-fd-sheet-focus="panel"' : "";
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
    return `<dialog class="${classes}" id="${id}"${focus} aria-labelledby="${titleId}"${describedBy}${reopen}>
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

export type SheetPlacement = "bottom" | "dialog" | "side";

export type SheetHeaderOptions = {
    /**
     * `title` is the title row with an optional subtitle and a close button.
     * `search` swaps it for a search box (the log sheet's header); the title
     * is then only the sheet's accessible name.
     */
    kind: "title" | "search";
    /** The visible title; for `search`, the accessible name of the sheet. */
    title: string;
    subtitle?: string;
    /** The close button. Default on; `{ label }` renames it ("Close"). */
    close?: boolean | { label: string };
    /** The search box of `kind: "search"`. */
    search?: SheetSearchOptions;
};

export type SheetSearchOptions = {
    /** Field name. */
    name: string;
    /** The input's id (a label or a test can name it). */
    id?: string;
    /** Accessible name of the field. */
    label: string;
    placeholder: string;
    value?: string;
    /** A clear button shown inside the box; the caller wires it. */
    clear?: { label: string; attrs?: Readonly<Record<string, string>> };
    /**
     * The Go button of the link-detected state, hidden until the caller's
     * script sets `data-link-detected` on the box (it swaps the lead icon for
     * the link icon and shows Go).
     */
    go?: { label: string; attrs?: Readonly<Record<string, string>> };
    /** A barcode button at the end of the box; a link when it has `href`. */
    scan?: {
        label: string;
        href?: string;
        attrs?: Readonly<Record<string, string>>;
    };
};

/** One button of a sheet's action row. */
export type SheetAction = {
    label: string;
    /** `submit` posts the form named by `form`. Default `button`. */
    type?: "button" | "submit";
    /** The id of the form a submit button posts (it sits outside the form). */
    form?: string;
    attrs?: Readonly<Record<string, string>>;
};

export type SheetActionsOptions =
    | { kind: "single"; primary: SheetAction }
    | {
          kind: "pair";
          /** Default: a "Cancel" that closes the sheet. */
          cancel?: SheetAction;
          primary: SheetAction;
      }
    | {
          kind: "destructive";
          cancel?: SheetAction;
          danger: SheetAction;
      }
    | {
          kind: "link";
          link: {
              label: string;
              href?: string;
              attrs?: Readonly<Record<string, string>>;
          };
      };

export type SheetSectionKind =
    | "amount"
    | "fields"
    | "choice"
    | "rows"
    | "message"
    | "chips"
    | "tiles"
    | "results"
    | "empty"
    | "custom";

export type SheetSectionOptions =
    | {
          /** A sentence: the kinds that hold text only. */
          kind: "message" | "empty";
          /** ALL CAPS above the content; written as given. */
          label?: string;
          text: string;
      }
    | {
          kind: Exclude<SheetSectionKind, "message" | "empty">;
          label?: string;
          content: Html;
      };

type SheetPartsOptions = {
    id: string;
    placement: SheetPlacement;
    header: SheetHeaderOptions;
    /** `sheetSection`s. */
    body: Html;
    /** A `sheetActions`. */
    actions?: SheetActionsOptions;
    /** A 4xx re-render reopens the sheet on load. */
    openOnLoad?: boolean;
    /** Extra classes after the sheet's own. Escaped. */
    className?: string;
    /** Where focus lands on open; `"panel"` keeps the keyboard down. */
    focus?: "panel";
};

export type SheetOptions = LegacySheetOptions | SheetPartsOptions;

const HANDLE = '<div class="fd-sheet-handle" aria-hidden="true"></div>';

function closeButton(sheetId: string, label: string): Html {
    return button({
        label,
        round: true,
        icon: "close",
        attrs: { command: "close", commandfor: sheetId },
    });
}

/** What the search box writes on its action buttons itself (the first copy of an attribute wins in HTML). */
const SEARCH_RESERVED_ATTRS = new Set([
    "class",
    "type",
    "href",
    "aria-label",
    "style",
    "disabled",
    "tabindex",
]);

function searchBox(search: SheetSearchOptions): Html {
    const value =
        search.value != null && search.value !== ""
            ? ` value="${esc(search.value)}"`
            : "";
    const attrs = (extra?: Readonly<Record<string, string>>) =>
        extra
            ? Object.entries(extra)
                  .map(([key, v]) => {
                      if (
                          !/^[a-z][a-z0-9-]*$/.test(key) ||
                          SEARCH_RESERVED_ATTRS.has(key) ||
                          key.startsWith("on")
                      )
                          throw new Error(
                              `sheet: attribute not allowed: ${key}`,
                          );
                      return ` ${key}="${esc(v)}"`;
                  })
                  .join("")
            : "";
    const go = search.go
        ? button({
              variant: "go",
              label: search.go.label,
              attrs: { ...search.go.attrs, hidden: "" },
          })
        : "";
    const clear = search.clear
        ? `<button type="button" class="fd-sheet__search-action" aria-label="${esc(search.clear.label)}"${attrs(search.clear.attrs)}>${icon("close")}</button>`
        : "";
    const scan = search.scan
        ? search.scan.href != null
            ? `<a class="fd-sheet__search-action" href="${esc(search.scan.href)}" aria-label="${esc(search.scan.label)}"${attrs(search.scan.attrs)}>${icon("scan")}</a>`
            : `<button type="button" class="fd-sheet__search-action" aria-label="${esc(search.scan.label)}"${attrs(search.scan.attrs)}>${icon("scan")}</button>`
        : "";
    const id = search.id != null ? ` id="${esc(search.id)}"` : "";
    const lead = search.go
        ? `<span class="fd-sheet__search-icon" aria-hidden="true"><span class="fd-sheet__search-icon--search">${icon("search")}</span><span class="fd-sheet__search-icon--link">${icon("link")}</span></span>`
        : `<span class="fd-sheet__search-icon" aria-hidden="true">${icon("search")}</span>`;
    return raw(
        `<div class="fd-sheet__search">${lead}<input class="fd-sheet__search-input"${id} type="search" name="${esc(search.name)}"${value} placeholder="${esc(search.placeholder)}" aria-label="${esc(search.label)}" autocomplete="off" enterkeyhint="search">${clear}${scan}${go}</div>`,
    );
}

/**
 * The design's Sheet header: the grabber, then either the title row (title,
 * optional subtitle, close) or a search box. `sheetId` is the id of the
 * dialog it goes in: the title's id is `<sheetId>-title` (what the dialog's
 * `aria-labelledby` names) and the close button closes that dialog. The
 * grabber is hidden from 1024px up, where a dialog or side sheet has none.
 */
export function sheetHeader(
    opts: SheetHeaderOptions & { sheetId: string },
): Html {
    const sheetId = opts.sheetId;
    const titleId = `${sheetId}-title`;
    if (opts.kind === "search") {
        if (!opts.search)
            throw new Error("sheetHeader: a search header needs search");
        return raw(
            `<header class="fd-sheet__header fd-sheet__header--search">\n${HANDLE}\n<h2 class="fd-sr" id="${esc(titleId)}">${esc(opts.title)}</h2>\n${searchBox(opts.search)}\n</header>`,
        );
    }
    const subtitle = opts.subtitle
        ? `\n<p class="fd-sheet__subtitle" id="${esc(sheetId)}-sub">${esc(opts.subtitle)}</p>`
        : "";
    const showClose = opts.close !== false;
    const closeLabel =
        typeof opts.close === "object" ? opts.close.label : "Close";
    return raw(
        `<header class="fd-sheet__header fd-sheet__header--title">\n${HANDLE}\n<div class="fd-sheet__row">\n<div class="fd-sheet__titles">\n<h2 class="fd-sheet__title" id="${esc(titleId)}">${esc(opts.title)}</h2>${subtitle}\n</div>\n${showClose ? closeButton(sheetId, closeLabel) : ""}\n</div>\n</header>`,
    );
}

/**
 * The design's Sheet section: an optional ALL CAPS label above one block of
 * content. `kind` names the content (Amount, Fields, Choice, Rows, Message,
 * Chips, Tiles, Results, Empty, Custom) and gives its container the layout
 * that content needs; what goes inside is the caller's: today's builders
 * until the Stepper, Macro tiles, Field, Segmented, Chips, Search field and
 * Empty state components replace them. `message` and `empty` hold a sentence.
 */
export function sheetSection(opts: SheetSectionOptions): Html {
    const label = opts.label
        ? `<h3 class="fd-sheet__label">${esc(opts.label)}</h3>\n`
        : "";
    const content =
        "text" in opts
            ? `<p class="fd-sheet__text">${esc(opts.text)}</p>`
            : opts.content;
    return raw(
        `<div class="fd-sheet__section fd-sheet__section--${opts.kind}">\n${label}<div class="fd-sheet__content">\n${content}\n</div>\n</div>`,
    );
}

function actionButton(
    action: SheetAction,
    variant: "secondary" | "primary" | "danger",
): Html {
    const attrs: Record<string, string> = { ...action.attrs };
    if (action.form != null) attrs.form = action.form;
    return button({
        label: action.label,
        variant,
        type: action.type ?? "button",
        attrs,
    });
}

/**
 * The design's Sheet actions, one row under the body: Single (one primary),
 * Pair (Cancel and a primary), Destructive (Cancel and a danger button) and
 * Link (one centred link button). The Cancel of a pair closes the dialog
 * named by `sheetId` unless the caller gives its own.
 */
export function sheetActions(
    opts: SheetActionsOptions & { sheetId: string },
): Html {
    const cancel = (action?: SheetAction): Html =>
        action
            ? actionButton(action, "secondary")
            : button({
                  label: "Cancel",
                  attrs: { command: "close", commandfor: opts.sheetId },
              });
    let buttons: Html;
    switch (opts.kind) {
        case "single":
            buttons = actionButton(opts.primary, "primary");
            break;
        case "pair":
            buttons = join(
                [cancel(opts.cancel), actionButton(opts.primary, "primary")],
                "\n",
            );
            break;
        case "destructive":
            buttons = join(
                [cancel(opts.cancel), actionButton(opts.danger, "danger")],
                "\n",
            );
            break;
        case "link":
            buttons = button({
                label: opts.link.label,
                variant: "link",
                size: "md",
                icon: "scan",
                href: opts.link.href,
                attrs: opts.link.attrs,
            });
            break;
    }
    return raw(
        `<div class="fd-sheet__actions fd-sheet__actions--${opts.kind}">\n${buttons}\n</div>`,
    );
}

function partsSheet(opts: SheetPartsOptions): string {
    const id = esc(opts.id);
    const header = opts.header;
    const describedBy =
        header.kind === "title" && header.subtitle
            ? ` aria-describedby="${id}-sub"`
            : "";
    const classes = [
        "fd-sheet",
        `fd-sheet--${opts.placement}`,
        header.kind === "search" && "fd-sheet--search",
        opts.className && esc(opts.className),
    ]
        .filter(Boolean)
        .join(" ");
    const reopen = opts.openOnLoad ? " data-sheet-open-on-load" : "";
    const focus = opts.focus === "panel" ? ' data-fd-sheet-focus="panel"' : "";
    const actions = opts.actions
        ? `\n${sheetActions({ ...opts.actions, sheetId: opts.id })}`
        : "";
    return `<dialog class="${classes}" id="${id}"${focus} aria-labelledby="${id}-title"${describedBy}${reopen}>
<div class="fd-sheet-panel" tabindex="-1">
${sheetHeader({ ...header, sheetId: opts.id })}
<div class="fd-sheet-body">
${opts.body}
</div>${actions}
</div>
</dialog>`;
}

export function sheet(opts: SheetOptions): string {
    return "placement" in opts ? partsSheet(opts) : legacySheet(opts);
}

export function sheetTrigger(opts: {
    target: string;
    label: string;
    className?: string;
    /**
     * Accessible name when it should say more than the visible `label`
     * ("Disconnect Claude" on a button that reads "Disconnect"). Escaped here.
     * Default: none for a text button, the `label` for an icon button.
     */
    ariaLabel?: string;
    /** When set, used as button inner HTML (label still drives aria-label / title). */
    icon?: string;
    /** Extra `data-*` attributes. Both the key and the value are escaped. */
    data?: Record<string, string>;
}): string {
    const label = escapeHtml(opts.label);
    const inner = opts.icon ?? label;
    const cls = opts.className ? ` class="${escapeHtml(opts.className)}"` : "";
    const name =
        opts.ariaLabel != null
            ? escapeHtml(opts.ariaLabel)
            : opts.icon
              ? label
              : null;
    const title = opts.icon ? ` title="${label}"` : "";
    const aria = name != null ? ` aria-label="${name}"` : "";
    const data = opts.data
        ? Object.entries(opts.data)
              .map(
                  ([key, value]) =>
                      ` data-${escapeHtml(key)}="${escapeHtml(value)}"`,
              )
              .join("")
        : "";
    return `<button type="button"${cls} commandfor="${escapeHtml(opts.target)}" command="show-modal"${title}${aria}${data}>${inner}</button>`;
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
