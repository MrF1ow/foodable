/**
 * The design's Chip and a group of them (FigCraft 172299): a 32 px pill with a
 * label and an optional count. Off is an outlined pill; On is filled with the
 * primary text colour.
 *
 * Classes are `fd-pill-chip*`: `.fd-chip` and `chips.ts` are the live chips
 * and stay as they are until the pages move. A chip is a toggle button
 * (`aria-pressed`), or a link when it has a `href`. In a group the mode says
 * how they act (`client/v2/chips.js` wires them):
 *
 * - `multiple`: any number can be on; a group of pressed toggles.
 * - `single`: exactly one is on, a radio group with one tab stop.
 * - `links`: a nav of links; the selected one is the current page.
 *
 * Styles: `public/app/v2/choice.css`.
 */
import { cls, dataAttrs, esc, raw, safeHref, type Html } from "./html.js";

export type ChipOptions = {
    label: string;
    /** What a screen reader says when the label is a letter ("Monday" for "M"). */
    ariaLabel?: string;
    count?: number | string;
    /** On. */
    selected?: boolean;
    disabled?: boolean;
    /** Read by the page script and the change event. */
    value?: string;
    href?: string;
    className?: string;
    data?: Readonly<Record<string, string>>;
    /** A toggle that submits the form around it (a suggestion's add chip). */
    submit?: boolean;
};

type Role = "toggle" | "radio" | "link" | "static";

function chipMarkup(opts: ChipOptions, role: Role, tabStop: boolean): string {
    const classes = cls(
        "fd-pill-chip",
        opts.selected && "fd-pill-chip--on",
        opts.className,
    );
    const count =
        opts.count != null && opts.count !== ""
            ? `<span class="fd-pill-chip__count">${esc(opts.count)}</span>`
            : "";
    const inner = `<span class="fd-pill-chip__label">${esc(opts.label)}</span>${count}`;
    const value = opts.value != null ? ` data-value="${esc(opts.value)}"` : "";
    const data = dataAttrs(opts.data);
    const name = opts.ariaLabel ? ` aria-label="${esc(opts.ariaLabel)}"` : "";
    if (role === "static") {
        return `<span class="${classes}"${name}${value}${data}>${inner}</span>`;
    }
    if (role === "link") {
        return `<a class="${classes}" href="${safeHref(opts.href ?? "#")}"${opts.selected ? ' aria-current="true"' : ""}${name}${value}${data}>${inner}</a>`;
    }
    const state =
        role === "radio"
            ? ` role="radio" aria-checked="${opts.selected ? "true" : "false"}" tabindex="${tabStop ? "0" : "-1"}"`
            : ` aria-pressed="${opts.selected ? "true" : "false"}"`;
    return `<button type="${opts.submit ? "submit" : "button"}" class="${classes}"${state}${name}${value}${opts.disabled ? " disabled" : ""}${data}>${inner}</button>`;
}

/** One chip: a toggle button, or a link with a `href`. */
export function chip(opts: ChipOptions): Html {
    return raw(chipMarkup(opts, opts.href != null ? "link" : "toggle", true));
}

export type ChipGroupOptions = {
    /** Accessible name of the group ("Meals"). */
    label: string;
    /**
     * `static` is a read-only list of labels (a recipe's tags on a page nobody
     * is signed in to): outlined pills that do nothing when pressed.
     */
    select: "single" | "multiple" | "links" | "static";
    chips: readonly ChipOptions[];
    className?: string;
    data?: Readonly<Record<string, string>>;
};

export function chipGroup(opts: ChipGroupOptions): Html {
    const classes = cls("fd-pill-chip-group", opts.className);
    const data = dataAttrs(opts.data);
    const name = `aria-label="${esc(opts.label)}"`;
    if (opts.select === "static") {
        return raw(
            `<ul class="${cls(classes, "fd-pill-chip-group--static")}" ${name}${data}>${opts.chips.map((c) => `<li>${chipMarkup(c, "static", false)}</li>`).join("")}</ul>`,
        );
    }
    if (opts.select === "links") {
        return raw(
            `<nav class="${classes}" ${name}${data}>${opts.chips.map((c) => chipMarkup(c, "link", true)).join("")}</nav>`,
        );
    }
    if (opts.select === "multiple") {
        return raw(
            `<div class="${classes}" role="group" ${name} data-fd-chips="multiple"${data}>${opts.chips.map((c) => chipMarkup(c, "toggle", true)).join("")}</div>`,
        );
    }
    // Radio group: one tab stop, the selected chip's, else the first enabled.
    const selected = opts.chips.findIndex((c) => c.selected && !c.disabled);
    const stop =
        selected >= 0 ? selected : opts.chips.findIndex((c) => !c.disabled);
    return raw(
        `<div class="${classes}" role="radiogroup" ${name} data-fd-chips="single"${data}>${opts.chips.map((c, i) => chipMarkup(c, "radio", i === stop)).join("")}</div>`,
    );
}
