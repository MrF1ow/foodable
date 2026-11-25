/**
 * The design's Mini card (FigCraft 172377): a small raised card with a coloured
 * label above a title and an optional meta line, as in the use-soon strip. It
 * is a link when it has a `href`.
 *
 * Styles: `public/app/v2/cards.css`.
 */
import { cls, dataAttrs, esc, raw, safeHref, type Html } from "./html.js";

export type MiniCardTone = "over" | "warn" | "muted";

export type MiniCardOptions = {
    /** The line above the title ("Tomorrow"). */
    label: string;
    title: string;
    /** Show meta off when left out. */
    meta?: string;
    /** The label's colour; the design's default is `over`. */
    tone?: MiniCardTone;
    href?: string;
    /** Instead of `href`: the card is a button that opens the sheet with this id. */
    opens?: string;
    className?: string;
    /** `data-*` on the card (what a script that opens something reads). */
    data?: Readonly<Record<string, string>>;
};

export function miniCard(opts: MiniCardOptions): Html {
    const inner =
        `<span class="fd-mini-card__label fd-mini-card__label--${opts.tone ?? "over"}">${esc(opts.label)}</span>` +
        `<span class="fd-mini-card__title">${esc(opts.title)}</span>` +
        (opts.meta != null
            ? `<span class="fd-mini-card__meta">${esc(opts.meta)}</span>`
            : "");
    const classes = cls("fd-mini-card", opts.className);
    if (opts.opens != null) {
        return raw(
            `<button type="button" class="${classes}" commandfor="${esc(opts.opens)}" command="show-modal"${dataAttrs(opts.data)}>${inner}</button>`,
        );
    }
    return raw(
        opts.href != null
            ? `<a class="${classes}" href="${safeHref(opts.href)}"${dataAttrs(opts.data)}>${inner}</a>`
            : `<div class="${classes}"${dataAttrs(opts.data)}>${inner}</div>`,
    );
}
