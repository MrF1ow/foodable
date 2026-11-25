/**
 * The design's Tab and Tabs (FigCraft 172205, 172206): text tabs on a hairline,
 * the current one in the primary colour with a green underline, and a trailing
 * slot for a Filter button and an Add button.
 *
 * Classes are `fd-tab-row*`: `.fd-tabs` and `.fd-tab` belong to the phone Nav
 * bar (`nav-bar.ts`) and keep that. A tab is a link; the current one carries
 * `aria-current="page"`. Styles: `public/app/v2/tab-row.css`.
 */
import { cls, dataAttrs, esc, raw, safeHref, type Html } from "./html.js";

export type TabOptions = {
    label: string;
    href: string;
    active?: boolean;
    /** Shown after the label: "Groceries · 8". */
    count?: number | string;
    className?: string;
    /** `data-*` on the tab (what a script that switches in place reads). */
    data?: Readonly<Record<string, string>>;
};

export function tab(opts: TabOptions): Html {
    const text =
        opts.count != null && opts.count !== ""
            ? `${esc(opts.label)} · ${esc(opts.count)}`
            : esc(opts.label);
    return raw(
        `<a class="${cls("fd-tab-row__tab", opts.active && "fd-tab-row__tab--active", opts.className)}" href="${safeHref(opts.href)}"${opts.active ? ' aria-current="page"' : ""}${dataAttrs(opts.data)}>${text}</a>`,
    );
}

export type TabsOptions = {
    /** Accessible name of the navigation ("Kitchen"). */
    label: string;
    tabs: readonly TabOptions[];
    /** The trailing slot: a Filter button, an Add button. */
    trailing?: Html;
    className?: string;
    data?: Readonly<Record<string, string>>;
};

export function tabs(opts: TabsOptions): Html {
    const trailing = opts.trailing
        ? `<div class="fd-tab-row__trailing">${opts.trailing}</div>`
        : "";
    return raw(
        `<div class="${cls("fd-tab-row", opts.className)}"${dataAttrs(opts.data)}><nav class="fd-tab-row__tabs" aria-label="${esc(opts.label)}">${opts.tabs.map(tab).join("")}</nav>${trailing}</div>`,
    );
}
