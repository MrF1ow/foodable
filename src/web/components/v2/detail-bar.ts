/**
 * The design's Detail bar (FigCraft 171983): the top bar of a page you went
 * into. A round Back button, the title centred, and a trailing round button.
 * With no trailing button, `balance` keeps an empty cell where it would be, so
 * the title stays centred (design rule 18); the bar centres the title in
 * either case because its columns are equal.
 *
 * Styles: `public/app/v2/header.css`.
 */
import { button } from "./button.js";
import { cls, dataAttrs, esc, raw, type Html } from "./html.js";
import type { IconName } from "./icon.js";

export type DetailBarOptions = {
    title?: string;
    back: {
        /** Accessible name; default "Back". */
        label?: string;
        href?: string;
    };
    trailing?: {
        label: string;
        /** Default `more` (the three dots). */
        icon?: IconName;
        href?: string;
    };
    /** Keep an empty cell where the trailing button would be. */
    balance?: boolean;
    className?: string;
    data?: Readonly<Record<string, string>>;
};

export function detailBar(opts: DetailBarOptions): Html {
    const back = button({
        round: true,
        icon: "chevron-left",
        label: opts.back.label ?? "Back",
        href: opts.back.href,
    });
    const trailing = opts.trailing
        ? button({
              round: true,
              icon: opts.trailing.icon ?? "more",
              label: opts.trailing.label,
              href: opts.trailing.href,
          })
        : opts.balance
          ? '<span class="fd-detail-bar__balance" aria-hidden="true"></span>'
          : "";
    const title =
        opts.title != null
            ? `<h1 class="fd-detail-bar__title">${esc(opts.title)}</h1>`
            : `<span class="fd-detail-bar__title"></span>`;
    return raw(
        `<header class="${cls("fd-detail-bar", opts.className)}"${dataAttrs(opts.data)}><div class="fd-detail-bar__start">${back}</div>${title}<div class="fd-detail-bar__end">${trailing}</div></header>`,
    );
}
