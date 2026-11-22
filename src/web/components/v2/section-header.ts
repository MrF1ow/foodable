/**
 * The design's `Section header`: an ALL CAPS label, an optional count, an
 * optional trailing action, and a hairline under it (Rule On, the default) or
 * none (Rule Off). The older `sectionHeader` in `rows.ts` (class
 * `fd-section-head`) is a different component that pages still use.
 */
import { cls, dataAttrs, esc, join, raw, safeHref, type Html } from "./html.js";

export type SectionHeaderAction = {
    /** Visible text, also the accessible name. */
    label: string;
    /** A link when given, a button otherwise. */
    href?: string;
    /** `data-*` hooks for whatever wires a button action. */
    data?: Readonly<Record<string, string>>;
};

export type SectionHeaderOptions = {
    /** Written as given; the stylesheet capitalises it. */
    label: string;
    count?: string | number;
    action?: SectionHeaderAction;
    /** Hairline under the header. Default on. */
    rule?: boolean;
    /** Heading level of the label. Default 2. */
    level?: 2 | 3 | 4;
    id?: string;
    className?: string;
};

function action(a: SectionHeaderAction): Html {
    if (a.href != null) {
        return raw(
            `<a class="fd-section-header__action" href="${safeHref(a.href)}"${dataAttrs(a.data)}>${esc(a.label)}</a>`,
        );
    }
    return raw(
        `<button type="button" class="fd-section-header__action"${dataAttrs(a.data)}>${esc(a.label)}</button>`,
    );
}

export function sectionHeader(opts: SectionHeaderOptions): Html {
    const level = opts.level ?? 2;
    const id = opts.id != null ? ` id="${esc(opts.id)}"` : "";
    return raw(
        `<div class="${cls(
            "fd-section-header",
            opts.rule !== false && "fd-section-header--rule",
            opts.className,
        )}"${id}>${join([
            `<h${level} class="fd-section-header__label">${esc(opts.label)}</h${level}>`,
            opts.count != null
                ? `<span class="fd-section-header__count">${esc(opts.count)}</span>`
                : "",
            opts.action ? action(opts.action) : "",
        ])}</div>`,
    );
}
