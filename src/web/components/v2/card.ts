/**
 * The design's Card (FigCraft 381516): a panel with a 16 px inset around a
 * content frame. It holds whatever the caller puts in it; the cards that have
 * a fixed anatomy (score, profile) are their own builders.
 *
 * `valueText` is shared by the display components: an unknown figure is a dash
 * with a spoken "no data", never a zero.
 *
 * Styles: `public/app/v2/cards.css`.
 */
import { cls, esc, raw, srOnly, type Html } from "./html.js";

export type CardOptions = {
    children: Html | readonly Html[];
    /** A name for the group, for a screen reader. */
    label?: string;
    className?: string;
};

export function card(opts: CardOptions): Html {
    const children = Array.isArray(opts.children)
        ? opts.children.join("")
        : String(opts.children);
    const name =
        opts.label != null
            ? ` role="group" aria-label="${esc(opts.label)}"`
            : "";
    return raw(
        `<div class="${cls("fd-card", opts.className)}"${name}><div class="fd-card__content">${children}</div></div>`,
    );
}

/** A figure as markup: the escaped text, or a dash for an unknown one. */
export function valueText(value: string | number | null | undefined): string {
    if (
        value == null ||
        (typeof value === "string" && value.trim() === "") ||
        (typeof value === "number" && !Number.isFinite(value))
    ) {
        return `<span aria-hidden="true">—</span>${srOnly("no data")}`;
    }
    return esc(value);
}
