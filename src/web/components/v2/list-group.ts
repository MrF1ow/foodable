/**
 * The design's `List group`: the rows of one list. Flat (the default) sits on
 * the page with hairlines between rows; Card is one standout list on a panel
 * with rounded corners. The rows are `itemRow()` output (`<li>` elements).
 */
import { cls, esc, join, raw, type Html } from "./html.js";

export type ListGroupOptions = {
    style?: "flat" | "card";
    rows: readonly Html[];
    /** Accessible name of the list. */
    label?: string;
    id?: string;
    className?: string;
};

export function listGroup(opts: ListGroupOptions): Html {
    const aria = opts.label != null ? ` aria-label="${esc(opts.label)}"` : "";
    const id = opts.id != null ? ` id="${esc(opts.id)}"` : "";
    return raw(
        `<ul class="${cls(
            "fd-list-group",
            opts.style === "card" && "fd-list-group--card",
            opts.className,
        )}"${id}${aria}>${join(opts.rows)}</ul>`,
    );
}
