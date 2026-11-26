// The household shell, built from the design's components: the Nav bar
// (components/v2/nav-bar.ts) on phones, with the bell and the account chip top
// right; from 1024 px the Sidebar and the Top bar (components/v2/sidebar.ts,
// top-bar.ts, with the Side link and the Bell) replace both. The switch is one
// CSS media query in public/app/v2/shell.css, so the server renders both
// layouts and the stylesheet hides the one that does not apply.
//
// Pages that are not switched yet render their current body inside it: the
// old /app.css loads first and /app-v2.css after it. Every class here starts
// with `fd-`.

import { escapeHtml } from "../html.js";
import {
    appScriptHref,
    appStylesheetHref,
    appV2ScriptHref,
    appV2StylesheetHref,
    scannerWasmHref,
    scannerZxingScriptHref,
} from "../widgets.js";
import type { HouseholdMember } from "../household.js";
import { APP_PATHS } from "./route-map.js";
import { initialsOf } from "./initials.js";
import { memberAvatar } from "./components/v2/avatar.js";
import { bell, type BellOptions } from "./components/v2/bell.js";
import {
    NAV_BAR_TABS,
    navBar,
    type NavBarActive,
} from "./components/v2/nav-bar.js";
import { sidebar, type SidebarLink } from "./components/v2/sidebar.js";
import { topBar } from "./components/v2/top-bar.js";
import type { IconName } from "./components/v2/icon.js";
import { NOTIFICATIONS_PAGE } from "../copy/notifications.js";
import {
    appHeadMeta,
    htmlOpen,
    type AppChrome,
    type AppTabId,
    type ThemePref,
    type V2KitchenTab,
    type V2NavId,
} from "./shell.js";
import {
    FD_LOG_SEARCH_SHEET_ID,
    renderLogSheets,
} from "./pages/v2/log-sheet.js";

/** The log-meal fragment (`#nutrition-log-meal`) and the Trends card key
 *  (`trends`). Search and Log food link to the log-meal fragment; the Trends
 *  tab links to `FD_TRENDS_PATH` (`/trends`).
 *  v2/shell.js acts on the log-meal fragment only. A test pins both. */
export const FD_LOG_MEAL_HASH = "nutrition-log-meal";
export const FD_TRENDS_HASH = "trends";

export const FD_LOG_HREF = `${APP_PATHS.nutrition}#${FD_LOG_MEAL_HASH}`;
export const FD_TRENDS_PATH = "/trends";
export const FD_TRENDS_HREF = FD_TRENDS_PATH;

/** The sidebar's main links, in the design's order. */
const SIDEBAR_LINKS: readonly {
    id: Exclude<NavBarActive, "none">;
    icon: IconName;
}[] = [
    { id: "today", icon: "calendar" },
    { id: "kitchen", icon: "fridge" },
    { id: "recipes", icon: "book" },
    { id: "trends", icon: "trend" },
];

/** The Kitchen text tabs (design: Kitchen tabs). Open grocery line count comes
 *  from `chrome.v2KitchenGroceriesCount` (a cheap listLines count on Kitchen
 *  tab pages). */
export const FD_KITCHEN_TABS: readonly {
    id: V2KitchenTab;
    label: string;
    href: string;
}[] = [
    { id: "fridge", label: "Fridge", href: APP_PATHS.kitchenFridge },
    { id: "groceries", label: "Groceries", href: APP_PATHS.kitchenGroceries },
    { id: "usuals", label: "Usuals", href: APP_PATHS.kitchenUsuals },
];

/** The sidebar's section links read as the phone's text tabs do. */
const SIDEBAR_KITCHEN_LABELS: Record<V2KitchenTab, string> = {
    fridge: "Fridge",
    groceries: "Groceries",
    usuals: "Usuals",
};

/** Desktop Kitchen sections: sub-links under the sidebar's Kitchen link while
 *  Kitchen is active (design: Sidebar › Sub). They replace the text tabs from 1024 px. */
function sidebarKitchenSubs(chrome: AppChrome) {
    const current = kitchenTabFor(chrome);
    return FD_KITCHEN_TABS.map((t) => ({
        label:
            t.id === "groceries" && chrome.v2KitchenGroceriesCount != null
                ? `${SIDEBAR_KITCHEN_LABELS[t.id]} · ${chrome.v2KitchenGroceriesCount}`
                : SIDEBAR_KITCHEN_LABELS[t.id],
        href: t.href,
        current: t.id === current,
    }));
}

const SETTINGS_LABEL = "Settings";

/** The tab to mark current. `v2Active` wins; otherwise it follows the old
 *  `active` id. Household and settings pages are the sidebar's Settings item
 *  and no phone tab. */
export function v2ActiveFor(
    chrome: Pick<AppChrome, "active" | "v2Active">,
): V2NavId {
    if (chrome.v2Active) return chrome.v2Active;
    switch (chrome.active) {
        case "nutrition":
            return "today";
        case "fridge":
        case "grocery":
            return "kitchen";
        case "recipes":
            return "recipes";
        case "household":
            return "settings";
        default:
            return "none";
    }
}

/** The current Kitchen text tab. `v2Kitchen` wins; otherwise the grocery
 *  page is Groceries and everything else under Kitchen is the fridge. */
export function kitchenTabFor(
    chrome: Pick<AppChrome, "active" | "v2Kitchen">,
): V2KitchenTab {
    if (chrome.v2Kitchen) return chrome.v2Kitchen;
    return chrome.active === "grocery" ? "groceries" : "fridge";
}

function kitchenTabs(chrome: AppChrome): string {
    const current = kitchenTabFor(chrome);
    const links = FD_KITCHEN_TABS.map((t) => {
        const on = t.id === current ? ' aria-current="page"' : "";
        const label =
            t.id === "groceries" && chrome.v2KitchenGroceriesCount != null
                ? `${t.label} · ${chrome.v2KitchenGroceriesCount}`
                : t.label;
        return `<a class="fd-kitchen-tab" href="${escapeHtml(t.href)}"${on}>${escapeHtml(label)}</a>`;
    }).join("");
    return `<nav class="fd-kitchen-tabs" aria-label="Kitchen sections">${links}</nav>`;
}

export { initialsOf };

/** The household avatar's letter: the design shows "F" for "The Flow
 *  household", so a leading "The" is skipped. */
export function householdInitial(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    const word =
        words.length > 1 && /^the$/i.test(words[0]!)
            ? words[1]!
            : (words[0] ?? "");
    return ([...word][0] ?? "?").toLocaleUpperCase("en");
}

function roleLabel(role: HouseholdMember["role"]): string {
    // oxlint-disable-next-line foodable/no-raw-role-check -- a display label, not a permission decision
    return role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Member";
}

function memberCountLabel(count: number): string {
    return count === 1 ? "1 member" : `${count} members`;
}

/** Nav bar's current tab: Settings and the pages outside the four have none. */
function navBarActive(active: V2NavId): NavBarActive {
    return active === "settings" ? "none" : active;
}

function desktopSidebar(chrome: AppChrome, active: V2NavId): string {
    const identity = chrome.identity;
    const householdName = identity?.householdName ?? "Household";
    const links: SidebarLink[] = NAV_BAR_TABS.map((t) => {
        const icon = SIDEBAR_LINKS.find((l) => l.id === t.id)!.icon;
        // With Kitchen's sections listed, the section link below is the page
        // and Kitchen is the current group.
        const kitchenOpen = t.id === "kitchen" && active === "kitchen";
        return {
            label: t.label,
            href: t.href,
            icon,
            current: kitchenOpen ? ("group" as const) : t.id === active,
            subs: kitchenOpen ? sidebarKitchenSubs(chrome) : undefined,
        };
    });
    const account = identity
        ? {
              name: identity.viewerName,
              role: roleLabel(identity.viewerRole),
              href: APP_PATHS.settings,
              avatar: memberAvatar({
                  name: identity.viewerName,
                  userId: identity.viewerUserId,
                  version: identity.viewerUserId
                      ? identity.avatarVersions?.get(identity.viewerUserId)
                      : null,
                  enabled: true,
                  className: "fd-avatar-initials",
              }),
          }
        : undefined;
    return String(
        sidebar({
            household: {
                name: householdName,
                meta: identity
                    ? memberCountLabel(identity.memberCount)
                    : undefined,
                href: APP_PATHS.settingsHousehold,
                initials: householdInitial(householdName),
            },
            links,
            settings: {
                label: SETTINGS_LABEL,
                href: APP_PATHS.settings,
                current: active === "settings",
            },
            account,
        }),
    );
}

/** The bell (design: Bell, with the green dot when something is new). It opens
 *  the inbox. The phone cluster and the desktop top bar both carry one.
 *  Turbo's hover prefetch is off for it: opening the inbox marks what it shows
 *  as read, so a GET from a mouse passing over the bell would clear the dot
 *  without the person opening anything. */
function notificationsBellOptions(chrome: AppChrome): BellOptions {
    return {
        href: APP_PATHS.notifications,
        label: NOTIFICATIONS_PAGE.bellLabel,
        unread: chrome.notificationsUnread === true,
        data: { "turbo-prefetch": "false" },
    };
}

function notificationsBell(chrome: AppChrome): string {
    return String(bell(notificationsBellOptions(chrome)));
}

/** The phone's top-right cluster (design: Header, the bell beside the account
 *  chip). It sits over the page's title row, absolutely positioned inside
 *  <main>; shell.css keeps the title and its actions clear of it. Hidden from
 *  1024 px, where the top bar's bell and the sidebar's Account row replace it.
 *  Settings pages and pages with their own Detail bar leave it out: Settings is
 *  where the chip points and carries the profile card and a back link, and a
 *  Detail bar is the page's whole top. */
function phoneCluster(chrome: AppChrome): string {
    return `<div class="fd-cluster">${notificationsBell(chrome)}${accountChip(chrome)}</div>`;
}

/** The account chip (design: Header › Account chip). */
function accountChip(chrome: AppChrome): string {
    const name = chrome.identity?.viewerName ?? "";
    const label = name ? `Settings, signed in as ${name}` : "Settings";
    const identity = chrome.identity;
    const version = identity?.viewerUserId
        ? identity.avatarVersions?.get(identity.viewerUserId)
        : undefined;
    // With a picture the chip becomes a small round avatar (picture over the
    // initials); without one it keeps its pill with the initials.
    if (identity?.viewerUserId && version) {
        const avatar = memberAvatar({
            name,
            userId: identity.viewerUserId,
            version,
            enabled: true,
            className: "fd-account-chip__avatar",
        });
        return `<a class="fd-account-chip fd-account-chip--photo" href="${APP_PATHS.settings}" aria-label="${escapeHtml(label)}" title="Settings">${String(avatar)}</a>`;
    }
    return `<a class="fd-account-chip" href="${APP_PATHS.settings}" aria-label="${escapeHtml(label)}" title="Settings">${escapeHtml(name ? initialsOf(name) : "Me")}</a>`;
}

/** The page's own header is what its first element writes: a bare <h1> or the
 *  design's Page header (`components/v2/page-header.ts`). */
const LEADING_PAGE_HEADER =
    /^\s*(?:<h1(?:\s[^>]*)?>[\s\S]*?<\/h1>|<header class="fd-page-header(?:\s[^"]*)?"[^>]*>[\s\S]*?<\/header>)/;

/** The Kitchen text tabs go directly under the page header, as in the design.
 *  A body that does not start with one gets them first. */
function withKitchenTabs(body: string, chrome: AppChrome): string {
    const tabs = kitchenTabs(chrome);
    const head = LEADING_PAGE_HEADER.exec(body)?.[0];
    return head ? `${head}${tabs}${body.slice(head.length)}` : `${tabs}${body}`;
}

/** The desktop Top bar: the search field opens the log search sheet (the
 *  shell script wires `data-fd-open-sheet`), then the bell and Log food. There
 *  is no scan button: scanning is a phone action. */
function desktopTopBar(chrome: AppChrome): string {
    return String(
        topBar({
            search: { data: { "fd-open-sheet": FD_LOG_SEARCH_SHEET_ID } },
            bell: notificationsBellOptions(chrome),
            logFood: {
                href: FD_LOG_HREF,
                attrs: { "data-fd-open-sheet": FD_LOG_SEARCH_SHEET_ID },
            },
        }),
    );
}

/** Head for the shell: the shared meta, then the base stylesheet and script
 *  (/app.css and /app.js carry the shared form and modal primitives, Turbo and
 *  the modal code) followed by the shell's own. All four are Turbo-tracked, so
 *  a deploy that changes any of them gets one full reload rather than a morph
 *  across versions. */
export function appHeadV2(title: string, theme: ThemePref): string {
    // The phone page behind the floating nav and the desktop page are both
    // --surface-bg, so the browser chrome takes the page colour.
    return `${appHeadMeta(title, theme)}
<link rel="stylesheet" href="${appStylesheetHref()}" data-turbo-track="reload" />
<link rel="stylesheet" href="${appV2StylesheetHref()}" data-turbo-track="reload" />
<script src="${appScriptHref()}" defer data-turbo-track="reload"></script>
<script src="${appV2ScriptHref()}" defer data-turbo-track="reload"></script>`;
}

export function renderAppShellV2(chrome: AppChrome): string {
    const active = v2ActiveFor(chrome);
    return `<!doctype html>
${htmlOpen(chrome.theme)}
<head>
${appHeadV2(chrome.title, chrome.theme)}
</head>
<body class="fd-body">
<div class="fd-shell">
${desktopSidebar(chrome, active)}
<div class="fd-column">
${desktopTopBar(chrome)}
<main class="app-main native fd-main">${active === "settings" || chrome.v2Detail ? "" : phoneCluster(chrome)}${active === "kitchen" ? withKitchenTabs(chrome.body, chrome) : chrome.body}</main>
</div>
${navBar({ active: navBarActive(active), logHref: FD_LOG_HREF })}
</div>
${renderLogSheets({ timezone: chrome.v2Timezone ?? "UTC", barcodeCamera: chrome.flags.barcodeCamera, scannerZxingHref: scannerZxingScriptHref(), scannerWasmHref: scannerWasmHref(), ...chrome.v2LogSheet })}
<div id="toast-region" class="toast-region" role="status" aria-live="polite" data-turbo-permanent></div>
</body>
</html>`;
}
