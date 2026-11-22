/**
 * The design's Bell (FigCraft 69107): the bell icon in a 32 px box, and a
 * small green dot when something is new. It never shows a number: the dot is
 * "there is something", and the notification list says how much.
 *
 * Styles: `public/app/v2/header.css`. A bell with `href` is a link, otherwise
 * a button for the page script to wire.
 */
import { cls, dataAttrs, esc, raw, safeHref, type Html } from "./html.js";
import { icon } from "./icon.js";

export type BellOptions = {
    /** Accessible name; default "Notifications". */
    label?: string;
    /** Something is new: draws the dot and adds ", new" to the name. */
    unread?: boolean;
    href?: string;
    className?: string;
    data?: Readonly<Record<string, string>>;
};

export function bell(opts: BellOptions): Html {
    const name = `${opts.label ?? "Notifications"}${opts.unread ? ", new" : ""}`;
    const classes = cls(
        "fd-bell",
        opts.unread && "fd-bell--unread",
        opts.className,
    );
    const dot = opts.unread
        ? '<span class="fd-bell__dot" aria-hidden="true"></span>'
        : "";
    const inner = `${icon("bell")}${dot}`;
    const data = dataAttrs(opts.data);
    return raw(
        opts.href != null
            ? `<a class="${classes}" href="${safeHref(opts.href)}" aria-label="${esc(name)}"${data}>${inner}</a>`
            : `<button type="button" class="${classes}" aria-label="${esc(name)}"${data}>${inner}</button>`,
    );
}
