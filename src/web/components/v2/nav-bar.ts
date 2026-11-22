/**
 * The design's Nav bar (FigCraft 294): the phone's frosted pill with Today,
 * Kitchen, the green Search button in the middle, Recipes and Trends. Each tab
 * is a 24 px icon over a 4 px dot; the current one's dot is green and its icon
 * brighter. `none` marks no tab (a page outside the four). No notice dots.
 *
 * This builder emits the live shell's markup (`.fd-tabs`, `.fd-tab`,
 * `.fd-tab-dot`, `.fd-log`, styled in `shell.css`), so the shell can move onto
 * it without a pixel changing. `inline` adds `fd-tabs--inline`
 * (`public/app/v2/tab-row.css`) to let the bar sit in the page flow, as the
 * gallery needs it; the live bar is fixed to the screen.
 *
 * Not to be confused with `tabs.ts`, the text Tabs, whose classes are
 * `fd-tab-row*`.
 */
import { esc, raw, safeHref, type Html } from "./html.js";
import { fdIcon, type FdIconName } from "../fd-icons.js";
import { APP_PATHS } from "../../route-map.js";

export type NavBarActive = "today" | "kitchen" | "recipes" | "trends" | "none";

export const NAV_BAR_TABS: readonly {
    id: Exclude<NavBarActive, "none">;
    label: string;
    href: string;
    icon: FdIconName;
}[] = [
    { id: "today", label: "Today", href: APP_PATHS.nutrition, icon: "cal" },
    {
        id: "kitchen",
        label: "Kitchen",
        href: APP_PATHS.kitchenFridge,
        icon: "fridge",
    },
    {
        id: "recipes",
        label: "Recipes",
        href: APP_PATHS.recipes,
        icon: "book",
    },
    { id: "trends", label: "Trends", href: "/trends", icon: "trend" },
];

/** The sheet the centre button opens (the live log sheet's search sheet). */
export const NAV_LOG_SHEET_ID = "fd-log-search";

const DEFAULT_LOG_HREF = `${APP_PATHS.nutrition}#nutrition-log-meal`;

export type NavBarOptions = {
    active: NavBarActive;
    /** Where the centre button goes without a script; default the log fragment. */
    logHref?: string;
    /** Sit in the page flow instead of fixed to the screen's foot. */
    inline?: boolean;
};

export function navBar(opts: NavBarOptions): Html {
    const tab = (t: (typeof NAV_BAR_TABS)[number]) =>
        `<a class="fd-tab" href="${esc(t.href)}"${t.id === opts.active ? ' aria-current="page"' : ""} aria-label="${esc(t.label)}">${fdIcon(t.icon)}<span class="fd-tab-dot" aria-hidden="true"></span></a>`;
    const [today, kitchen, recipes, trends] = NAV_BAR_TABS;
    const log = `<a class="fd-log" href="${safeHref(opts.logHref ?? DEFAULT_LOG_HREF)}" data-fd-open-sheet="${NAV_LOG_SHEET_ID}" aria-label="Search" title="Search">${fdIcon("search", 2)}</a>`;
    return raw(
        `<nav class="fd-tabs fd-nav-bar${opts.inline ? " fd-tabs--inline" : ""}" aria-label="Main tabs">${tab(today!)}${tab(kitchen!)}${log}${tab(recipes!)}${tab(trends!)}</nav>`,
    );
}
