/**
 * The design's Sidebar (FigCraft 590906): the household, the main links,
 * Settings at the foot and the account row, in a 248 px column.
 *
 * The shell's desktop column: `.fd-sidebar` (`shell.css`, hidden below 1024 px,
 * sticky and window-tall from there) with `fd-sidebar--design` for the
 * design's padding; the parts are `fd-sidebar__*` and `fd-side-link`.
 * `inline` lets the column sit in the page flow, as the gallery needs it.
 *
 * Styles: `public/app/v2/layout.css` (the parts) and `public/app/v2/shell.css`
 * (the column and its two modifiers).
 */
import { avatarInitials } from "./avatar-initials.js";
import { cls, dataAttrs, esc, raw, safeHref, type Html } from "./html.js";
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
    /** The viewer's row at the foot; omit when no one is signed in. */
    account?: {
        name: string;
        role: string;
        href: string;
        /** The person's circle when it is more than their initials (a
         *  picture over them; give it the `fd-avatar-initials` class for the
         *  design's size); default the initials circle. */
        avatar?: Html;
        data?: Readonly<Record<string, string>>;
    };
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

function accountRow(account: SidebarOptions["account"]): string {
    if (!account) return "";
    const avatar = account.avatar ?? avatarInitials({ name: account.name });
    return `<a class="fd-sidebar__account" href="${safeHref(account.href)}" aria-label="${esc(`Account: ${account.name}, ${account.role}`)}"${dataAttrs(account.data)}>${identity(avatar, account.name, account.role)}${icon("chevron-right", 18)}</a>`;
}

export function sidebar(opts: SidebarOptions): Html {
    const { household } = opts;
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
    return raw(
        `<div class="${cls("fd-sidebar", "fd-sidebar--design", opts.inline && "fd-sidebar--inline")}">` +
            `<a class="fd-sidebar__household" href="${safeHref(household.href)}">${identity(householdAvatar, household.name, household.meta)}</a>` +
            `<nav class="fd-sidebar__nav" aria-label="${esc(opts.navLabel ?? "Main navigation")}">${links}${settings}</nav>` +
            accountRow(opts.account) +
            `</div>`,
    );
}
