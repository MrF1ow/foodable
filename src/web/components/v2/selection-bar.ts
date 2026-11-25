/**
 * The design's Selection bar (FigCraft 593977): the count of what is selected
 * and the actions that apply to it (Cancel, Discard), as Small buttons.
 *
 * - `floating`: a raised bar with a shadow that hovers over the page.
 * - `inline`: the same bar flat in the page, full width.
 *
 * The toolbar is named "Selection"; the count is the live text inside it, so a
 * screen reader does not hear it twice or a stale one.
 *
 * Static markup: a page script shows it, sets the count and wires the
 * actions (`attrs`), as the select mode does for the Item row.
 *
 * Styles: `public/app/v2/layout.css`.
 */
import { button } from "./button.js";
import { cls, esc, raw, type Html } from "./html.js";

export type SelectionBarAction = {
    label: string;
    /** Default `secondary`. */
    variant?: "secondary" | "primary" | "danger";
    href?: string;
    /** `submit` posts the form named by `attrs.form`. Default `button`. */
    type?: "button" | "submit";
    attrs?: Readonly<Record<string, string>>;
};

export type SelectionBarOptions = {
    placement: "floating" | "inline";
    count: number;
    /** Replaces "<count> selected". */
    countLabel?: string;
    /**
     * Whether the count is drawn. `false` keeps it for a screen reader only
     * (the phone's floating bar is just its buttons; the page says the count).
     */
    showCount?: boolean;
    actions: readonly SelectionBarAction[];
    className?: string;
};

export function selectionBar(opts: SelectionBarOptions): Html {
    if (opts.actions.length === 0) {
        throw new Error("selectionBar: needs at least one action");
    }
    const count = opts.countLabel ?? `${opts.count} selected`;
    const actions = opts.actions
        .map((a) =>
            button({
                label: a.label,
                variant: a.variant,
                size: "md",
                href: a.href,
                type: a.type,
                attrs: a.attrs,
            }),
        )
        .join("");
    return raw(
        `<div class="${cls("fd-selection-bar", `fd-selection-bar--${opts.placement}`, opts.className)}" role="toolbar" aria-label="Selection"><span class="${cls("fd-selection-bar__count", opts.showCount === false && "fd-sr")}" aria-live="polite">${esc(count)}</span><div class="fd-selection-bar__actions">${actions}</div></div>`,
    );
}
