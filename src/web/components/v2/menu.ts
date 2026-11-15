/**
 * A "⋯" menu on a list row (FigCraft 63301): a round trigger that opens a small
 * panel of actions. Built on `<details>`, so it opens, tabs and submits with no
 * script. An open menu is closed by a tap anywhere else (the trigger carries a
 * page-sized transparent backdrop in CSS), by the trigger again, or by choosing
 * an action, which leaves the page.
 *
 * The panel is a labelled group of plain buttons and links, not `role="menu"`:
 * it has no arrow-key or Esc handling, and `<summary>` already exposes the
 * expanded state. Styles: `.fd-menu*` in `public/app/v2/components.css`. An action is either a POST form (a
 * button) or a link; `hint` is a second, quieter line under the label.
 */
import { cls, dataAttrs, esc, raw, safeHref, type Html } from "./html.js";

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
      };

const DOTS = `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></svg>`;

function itemInner(item: { label: string; hint?: string }): string {
    const hint = item.hint
        ? `<span class="fd-menu__hint">${esc(item.hint)}</span>`
        : "";
    return `<span class="fd-menu__label">${esc(item.label)}</span>${hint}`;
}

function itemMarkup(item: MenuItem): string {
    if (item.kind === "separator") {
        return `<hr class="fd-menu__sep">`;
    }
    if (item.kind === "link") {
        return `<a class="fd-menu__item" href="${safeHref(item.href)}">${itemInner(item)}</a>`;
    }
    const fields = Object.entries(item.fields ?? {})
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`,
        )
        .join("");
    return `<form class="fd-menu__form" method="post" action="${esc(item.action)}">${fields}<button type="submit" class="${cls("fd-menu__item", item.danger && "fd-menu__item--danger")}">${itemInner(item)}</button></form>`;
}

export function menu(opts: {
    /** Accessible name of the trigger ("Actions for Milk · Whole milk"). */
    label: string;
    items: readonly MenuItem[];
    className?: string;
    data?: Readonly<Record<string, string>>;
}): Html {
    return raw(
        `<details class="${cls("fd-menu", opts.className)}"${dataAttrs(opts.data)}><summary class="fd-menu__trigger" aria-label="${esc(opts.label)}" title="${esc(opts.label)}">${DOTS}</summary><div class="fd-menu__panel" role="group" aria-label="${esc(opts.label)}">${opts.items.map(itemMarkup).join("")}</div></details>`,
    );
}
