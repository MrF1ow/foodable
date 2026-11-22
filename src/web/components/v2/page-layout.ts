/**
 * The design's Page layout (FigCraft 677783): how a desktop page's content is
 * set in the column beside the sidebar. The content is always centred (rule 25)
 * and has a Header slot above it.
 *
 * - `single`: one column, 720 wide.
 * - `narrow`: one column, 480 wide.
 * - `two-columns`: a left and a right column, filling the width.
 * - `settings`: a 240 menu beside a 640 content column.
 *
 * Below 1024 px the boxes simply fill the screen; the columns wrap under each
 * other. The slots take typed `Html`, so a caller's strings are already
 * escaped by the component that made them.
 *
 * Styles: `public/app/v2/layout.css`; the fixed widths are its `--fd-*` locals.
 */
import { cls, raw, type Html } from "./html.js";

type Base = {
    /** The page header (title, actions); left out when the page has none. */
    header?: Html;
    className?: string;
};

export type PageLayoutOptions = Base &
    (
        | { layout: "single" | "narrow"; content: Html }
        | { layout: "two-columns"; left: Html; right: Html }
        | { layout: "settings"; menu: Html; content: Html }
    );

export function pageLayout(opts: PageLayoutOptions): Html {
    const header = opts.header
        ? `<div class="fd-page-layout__header">${opts.header}</div>`
        : "";
    const slot = (name: string, html: Html) =>
        `<div class="fd-page-layout__${name}">${html}</div>`;
    let body: string;
    if (opts.layout === "two-columns") {
        body = `<div class="fd-page-layout__columns">${slot("column", opts.left)}${slot("column", opts.right)}</div>`;
    } else if (opts.layout === "settings") {
        body = `<div class="fd-page-layout__columns">${slot("menu", opts.menu)}${slot("content", opts.content)}</div>`;
    } else {
        body = slot("content", opts.content);
    }
    return raw(
        `<div class="${cls("fd-page-layout", `fd-page-layout--${opts.layout}`, opts.className)}"><div class="fd-page-layout__box">${header}${body}</div></div>`,
    );
}
