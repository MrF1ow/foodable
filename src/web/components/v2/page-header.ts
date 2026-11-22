/**
 * The design's Page header (FigCraft 171972): a page title (28/34) with an
 * optional subtitle, then at the far end an Actions slot, the Bell and the
 * account Avatar. Each part is opt-in; the design shows the bell and avatar by
 * default, the code asks for them.
 *
 * The avatar here is the initials circle of the header; the picture avatar
 * (`avatar.ts`) is a different, live component. Styles: `public/app/v2/header.css`.
 */
import { bell, type BellOptions } from "./bell.js";
import { cls, dataAttrs, esc, raw, safeHref, type Html } from "./html.js";

export type PageHeaderOptions = {
    title: string;
    subtitle?: string;
    /** The Actions slot: ready-made controls shown before the bell. */
    actions?: Html;
    bell?: BellOptions;
    avatar?: {
        initials: string;
        /** Accessible name; default "Account". */
        label?: string;
        href?: string;
    };
    className?: string;
    data?: Readonly<Record<string, string>>;
};

export function pageHeader(opts: PageHeaderOptions): Html {
    const subtitle = opts.subtitle
        ? `<p class="fd-page-header__subtitle">${esc(opts.subtitle)}</p>`
        : "";
    const actions = opts.actions
        ? `<div class="fd-page-header__actions">${opts.actions}</div>`
        : "";
    const avatar = opts.avatar
        ? opts.avatar.href != null
            ? `<a class="fd-page-header__avatar" href="${safeHref(opts.avatar.href)}" aria-label="${esc(opts.avatar.label ?? "Account")}">${esc(opts.avatar.initials)}</a>`
            : `<span class="fd-page-header__avatar" role="img" aria-label="${esc(opts.avatar.label ?? "Account")}">${esc(opts.avatar.initials)}</span>`
        : "";
    const end = `${actions}${opts.bell ? bell(opts.bell) : ""}${avatar}`;
    return raw(
        `<header class="${cls("fd-page-header", opts.className)}"${dataAttrs(opts.data)}><div class="fd-page-header__titles"><h1 class="fd-page-header__title">${esc(opts.title)}</h1>${subtitle}</div>${end ? `<div class="fd-page-header__end">${end}</div>` : ""}</header>`,
    );
}
