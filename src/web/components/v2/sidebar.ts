/**
 * The design's Sidebar (FigCraft 590906): the household, the main links,
 * Settings at the foot and the account row, in a 248 px column.
 *
 * It is the live `.fd-sidebar` block (`shell.css`) with the design's own parts
 * inside it: `fd-sidebar--design` carries the design's padding, and the parts
 * are `fd-sidebar__*` and `fd-side-link`, never the live `.fd-household`,
 * `.fd-sidelink` or `.fd-account` rows, so the live shell renders as before.
 * `inline` lets the column sit in the page flow, as the gallery needs it; the
 * live one is sticky and as tall as the window.
 *
 * Styles: `public/app/v2/layout.css` (the parts) and the marked part of
 * `public/app/v2/shell.css` (the two modifiers).
 */
import { avatarInitials } from "./avatar-initials.js";
import { cls, esc, raw, safeHref, type Html } from "./html.js";
import { icon } from "./icon.js";
import { sideLink, type SideLinkOptions } from "./side-link.js";

type LinkOptions = Omit<SideLinkOptions, "kind" | "icon">;

export type SidebarLink = LinkOptions &
    Required<Pick<SideLinkOptions, "icon">> & {
        /** Sections shown under this link (Kitchen › Fridge). */
        subs?: readonly LinkOptions[];
    };

export type SidebarOptions = {
    household: {
        name: string;
        /** The line under the name ("3 members"). */
        meta?: string;
        href: string;
        /** Avatar initials; default the name's first letter. */
        initials?: string;
    };
    links: readonly SidebarLink[];
    /** Settings, pushed to the foot above the account row. */
    settings: LinkOptions;
    account: { name: string; role: string; href: string };
    /** Sit in the page flow instead of sticking to the window. */
    inline?: boolean;
    /** Accessible name of the navigation; default "Main navigation". */
    navLabel?: string;
};

function identity(
    avatar: Html,
    title: string,
    meta: string | undefined,
): string {
    return `${avatar}<span class="fd-sidebar__text"><span class="fd-sidebar__title">${esc(title)}</span>${meta != null ? `<span class="fd-sidebar__meta">${esc(meta)}</span>` : ""}</span>`;
}

export function sidebar(opts: SidebarOptions): Html {
    const { household, account } = opts;
    const links = opts.links
        .map(({ subs, ...link }) => {
            const main = sideLink({ ...link, kind: "main" });
            const sub = (subs ?? [])
                .map((s) => sideLink({ ...s, kind: "sub" }))
                .join("");
            return `${main}${sub}`;
        })
        .join("");
    const settings = sideLink({
        ...opts.settings,
        kind: "main",
        icon: "sun",
        className: cls("fd-sidebar__settings", opts.settings.className),
    });
    const householdAvatar = avatarInitials({
        initials: household.initials ?? [...household.name.trim()][0] ?? "?",
    });
    const accountAvatar = avatarInitials({ name: account.name });
    return raw(
        `<div class="${cls("fd-sidebar", "fd-sidebar--design", opts.inline && "fd-sidebar--inline")}">` +
            `<a class="fd-sidebar__household" href="${safeHref(household.href)}">${identity(householdAvatar, household.name, household.meta)}</a>` +
            `<nav class="fd-sidebar__nav" aria-label="${esc(opts.navLabel ?? "Main navigation")}">${links}${settings}</nav>` +
            `<a class="fd-sidebar__account" href="${safeHref(account.href)}">${identity(accountAvatar, account.name, account.role)}${icon("chevron-right", 18)}</a>` +
            `</div>`,
    );
}
