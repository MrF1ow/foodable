/**
 * The design's `List group`: the rows of one list. Flat (the default) sits on
 * the page with hairlines between rows; Card is one standout list on a panel
 * with rounded corners. The rows are `itemRow()` output (`<li>` elements).
 */
import { cls, dataAttrs, esc, join, raw, type Html } from "./html.js";

export type ListGroupOptions = {
    style?: "flat" | "card";
    rows: readonly Html[];
    /** Accessible name of the list. */
    label?: string;
    id?: string;
    className?: string;
    /** `data-*` on the list (the hook of a script that reads its rows). */
    data?: Readonly<Record<string, string>>;
};

export function listGroup(opts: ListGroupOptions): Html {
    const aria = opts.label != null ? ` aria-label="${esc(opts.label)}"` : "";
    const id = opts.id != null ? ` id="${esc(opts.id)}"` : "";
    return raw(
        `<ul class="${cls(
            "fd-list-group",
            opts.style === "card" && "fd-list-group--card",
            opts.className,
        )}"${id}${aria}${dataAttrs(opts.data)}>${join(opts.rows)}</ul>`,
    );
}
