/**
 * The design's Menu and Menu item (FigCraft 172271, 172270), in two forms.
 *
 * Without `anchor` (and with only `separator`, `link` and `post` items) it is
 * the "⋯" menu on a list row: a round trigger that opens a small panel of
 * actions, built on `<details>` so it opens, tabs and submits with no script.
 * An open menu is closed by a tap anywhere else (the trigger carries a
 * page-sized transparent backdrop in CSS), by the trigger again, or by choosing
 * an action, which leaves the page. The panel is a labelled group of plain
 * buttons and links, not `role="menu"`: that form has no arrow-key or Esc
 * handling.
 *
 * With `anchor` ("more" or "filter"), or any `checked` or `destructive` item,
 * it is the redesign's menu: anchored to a visible control (the ⋯ Icon button
 * or the Filter button), `role="menu"`, closed with Escape or a tap outside,
 * arrow keys between items, focus back on the trigger. A `destructive` item
 * confirms in place: it turns into Cancel and the same verb ("Discard 3"),
 * with no "Yes" and no second popup. That form needs `client/v2/menu.js`.
 *
 * Styles: `public/app/v2/menu.css`. An action is either a POST form (a button)
 * or a link; `hint` is a second, quieter line under the label.
 */
import { button, filterButton } from "./button.js";
import { cls, dataAttrs, esc, raw, safeHref, type Html } from "./html.js";
import { icon } from "./icon.js";

export type MenuItem =
    | { kind: "separator" }
    | {
          kind: "link";
          label: string;
          hint?: string;
          href: string;
      }
    | {
          kind: "post";
          label: string;
          hint?: string;
          action: string;
          /** Hidden fields posted with the button. */
          fields?: Readonly<Record<string, string>>;
          /** Colours the label as a destructive action. */
          danger?: boolean;
      }
    /** A selectable option with a tick (the filter pull-down). */
    | {
          kind: "checked";
          label: string;
          hint?: string;
          checked: boolean;
          /** Where choosing it goes; without one the item is a button the page script reads (`fd-menu-select`). */
          href?: string;
      }
    /** Deletes, clears or overwrites: confirms in place as Cancel + the same verb. */
    | {
          kind: "destructive";
          label: string;
          /** The verb on the confirming button ("Discard 3"); defaults to `label`. */
          confirmLabel?: string;
          action: string;
          fields?: Readonly<Record<string, string>>;
      };

export type MenuAnchor = "more" | "filter";

const DOTS = `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></svg>`;

function itemInner(item: { label: string; hint?: string }): string {
    const hint = item.hint
        ? `<span class="fd-menu__hint">${esc(item.hint)}</span>`
        : "";
    return `<span class="fd-menu__label">${esc(item.label)}</span>${hint}`;
}

/** The kinds the `<details>` menu draws; any other kind makes the menu anchored. */
type PlainItem = Extract<MenuItem, { kind: "separator" | "link" | "post" }>;

function itemMarkup(item: PlainItem): string {
    if (item.kind === "separator") {
        return `<hr class="fd-menu__sep">`;
    }
    if (item.kind === "link") {
        return `<a class="fd-menu__item" href="${safeHref(item.href)}">${itemInner(item)}</a>`;
    }
    return `<form class="fd-menu__form" method="post" action="${esc(item.action)}">${hiddenFields(item.fields)}<button type="submit" class="${cls("fd-menu__item", item.danger && "fd-menu__item--danger")}">${itemInner(item)}</button></form>`;
}

const isPlain = (item: MenuItem): item is PlainItem =>
    item.kind === "separator" || item.kind === "link" || item.kind === "post";

function hiddenFields(fields?: Readonly<Record<string, string>>): string {
    return Object.entries(fields ?? {})
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`,
        )
        .join("");
}

/** The anchored form's item body: an optional check column, then label and hint. */
function anchoredBody(
    item: { label: string; hint?: string },
    checks: boolean,
    ticked?: boolean,
): string {
    const column = !checks
        ? ""
        : `<span class="fd-menu__check" aria-hidden="true">${ticked === undefined ? "" : icon("check")}</span>`;
    return `${column}<span class="fd-menu__text">${itemInner(item)}</span>`;
}

function anchoredItem(item: MenuItem, checks: boolean): string {
    switch (item.kind) {
        case "separator":
            return `<hr class="fd-menu__sep">`;
        case "link":
            return `<a class="fd-menu__item" role="menuitem" href="${safeHref(item.href)}">${anchoredBody(item, checks)}</a>`;
        case "post":
            return `<form class="fd-menu__form" method="post" action="${esc(item.action)}">${hiddenFields(item.fields)}<button type="submit" class="fd-menu__item" role="menuitem">${anchoredBody(item, checks)}</button></form>`;
        case "checked": {
            const state = `role="menuitemcheckbox" aria-checked="${item.checked ? "true" : "false"}"`;
            const body = anchoredBody(item, checks, item.checked);
            return item.href == null
                ? `<button type="button" class="fd-menu__item" ${state}>${body}</button>`
                : `<a class="fd-menu__item" ${state} href="${safeHref(item.href)}">${body}</a>`;
        }
        case "destructive": {
            const verb = item.confirmLabel ?? item.label;
            return `<div class="fd-menu__confirm" data-fd-menu-confirm><button type="button" class="fd-menu__item fd-menu__item--danger" role="menuitem" data-fd-menu-arm>${anchoredBody(item, checks)}</button><div class="fd-menu__confirm-row" role="group" aria-label="Confirm ${esc(verb)}" hidden><button type="button" class="fd-menu__item" role="menuitem" data-fd-menu-cancel>${anchoredBody({ label: "Cancel" }, checks)}</button><form class="fd-menu__form" method="post" action="${esc(item.action)}">${hiddenFields(item.fields)}<button type="submit" class="fd-menu__item fd-menu__item--danger" role="menuitem">${anchoredBody({ label: verb }, checks)}</button></form></div></div>`;
        }
    }
}

/**
 * Draws a menu. Which form you get follows from the items: `anchor`, or any
 * `checked` or `destructive` item, selects the anchored form (script-driven,
 * `role="menu"`); otherwise it is the `<details>` menu. A `post` item with
 * `danger` has no confirm step, so an anchored menu refuses it: use a
 * `destructive` item, which confirms in place.
 */
export function menu(opts: {
    /** Accessible name of the trigger ("Actions for Milk · Whole milk"). */
    label: string;
    items: readonly MenuItem[];
    className?: string;
    data?: Readonly<Record<string, string>>;
    /**
     * Anchors the menu to the design's ⋯ Icon button ("more") or Filter button
     * ("filter"). Without it, a menu of only separator, link and post items is
     * the `<details>` menu; any `checked` or `destructive` item makes it "more".
     */
    anchor?: MenuAnchor;
    /** How many filters are on (the Filter button's badge). */
    filterCount?: number;
}): Html {
    const anchor =
        opts.anchor ??
        (opts.items.some(
            (i) => i.kind === "checked" || i.kind === "destructive",
        )
            ? "more"
            : undefined);
    if (anchor === undefined) {
        return raw(
            `<details class="${cls("fd-menu", opts.className)}"${dataAttrs(opts.data)}><summary class="fd-menu__trigger" aria-label="${esc(opts.label)}" title="${esc(opts.label)}">${DOTS}</summary><div class="fd-menu__panel" role="group" aria-label="${esc(opts.label)}">${opts.items.filter(isPlain).map(itemMarkup).join("")}</div></details>`,
        );
    }
    if (opts.items.some((i) => i.kind === "post" && i.danger)) {
        throw new Error(
            "menu: a danger post item has no confirm step in an anchored menu; use a destructive item",
        );
    }
    const attrs = {
        "data-fd-menu-trigger": "",
        "aria-haspopup": "menu",
        "aria-expanded": "false",
    };
    const trigger =
        anchor === "filter"
            ? filterButton({
                  label: opts.label,
                  count: opts.filterCount,
                  attrs,
              })
            : button({
                  label: opts.label,
                  icon: "more",
                  round: true,
                  attrs,
              });
    const checks = opts.items.some((i) => i.kind === "checked");
    return raw(
        `<div class="${cls("fd-menu fd-menu--anchored", `fd-menu--${anchor}`, opts.className)}" data-fd-menu data-anchor="${anchor}"${dataAttrs(opts.data)}>${trigger}<div class="fd-menu__panel" role="menu" aria-label="${esc(opts.label)}" hidden>${opts.items.map((i) => anchoredItem(i, checks)).join("")}</div></div>`,
    );
}
