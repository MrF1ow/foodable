/**
 * The design's Side link (FigCraft 590905): one row of the desktop sidebar.
 *
 * - `main`: an 18 px icon and a 14 px label, 40 px high (Today, Kitchen,
 *   Recipes, Trends, Settings).
 * - `sub`: an indent and a 13 px label, 32 px high, for a section under its
 *   Main link (Kitchen › Fridge).
 *
 * Current is a brighter label and icon in Medium weight, with no background
 * (rule 24): the page you are on is told by type, not by a filled pill.
 * `current: true` marks the page (`aria-current="page"`); `"group"` marks a
 * Main link whose section below is the page (`aria-current="true"`).
 *
 * Styles: `public/app/v2/layout.css`. The live shell's `.fd-sidelink` rows
 * are not touched.
 */
import { cls, dataAttrs, esc, raw, safeHref, type Html } from "./html.js";
import { icon, type IconName } from "./icon.js";

export type SideLinkOptions = {
    kind: "main" | "sub";
    label: string;
    href: string;
    /** Required for `main`; a `sub` link has none. */
    icon?: IconName;
    current?: boolean | "group";
    className?: string;
    data?: Readonly<Record<string, string>>;
};

export function sideLink(opts: SideLinkOptions): Html {
    if (opts.kind === "main" && opts.icon == null) {
        throw new Error("sideLink: a main link needs an icon");
    }
    const lead =
        opts.kind === "main"
            ? icon(opts.icon as IconName, 18)
            : `<span class="fd-side-link__indent" aria-hidden="true"></span>`;
    const current = opts.current
        ? ` aria-current="${opts.current === "group" ? "true" : "page"}"`
        : "";
    return raw(
        `<a class="${cls("fd-side-link", `fd-side-link--${opts.kind}`, opts.current && "fd-side-link--current", opts.className)}" href="${safeHref(opts.href)}"${current}${dataAttrs(opts.data)}>${lead}<span class="fd-side-link__label">${esc(opts.label)}</span></a>`,
    );
}
