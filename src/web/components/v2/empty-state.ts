/**
 * The design's Empty state (FigCraft 381519): a centred title with a line of
 * help under it, and an optional slot for the action that fills the page.
 *
 * Styles: `public/app/v2/cards.css`.
 */
import { cls, esc, raw, type Html } from "./html.js";

export type EmptyStateOptions = {
    title: string;
    body?: string;
    /** A button or link, in the caller's markup. */
    action?: Html;
    className?: string;
};

export function emptyState(opts: EmptyStateOptions): Html {
    const body =
        opts.body != null
            ? `<p class="fd-empty-state__body">${esc(opts.body)}</p>`
            : "";
    const action =
        opts.action != null
            ? `<div class="fd-empty-state__action">${opts.action}</div>`
            : "";
    return raw(
        `<div class="${cls("fd-empty-state", opts.className)}"><p class="fd-empty-state__title">${esc(opts.title)}</p>${body}${action}</div>`,
    );
}
