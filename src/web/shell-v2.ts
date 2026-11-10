// The new household shell (flag `ui-v2`), drawn from the FigCraft design:
// Components › Nav bar, Screens › Today (Header, Account chip) and
// Desktop › Today (Sidebar, Top bar). Phones get a floating four-tab nav with
// the green search button in the middle and the account chip top right;
// from 1024 px the sidebar and the top bar replace both. The switch is one CSS
// media query in public/app/v2/shell.css, so the server renders both layouts
// and the stylesheet hides the one that does not apply.
//
// Pages that are not redesigned yet render their current body inside it: the
// old /app.css loads first and /app-v2.css after it. Every class here starts
// with `fd-`.

import { escapeHtml } from "../html.js";
import {
    appScriptHref,
    appStylesheetHref,
    appV2ScriptHref,
    appV2StylesheetHref,
} from "../widgets.js";
import type { HouseholdMember } from "../household.js";
import { fdIcon, type FdIconName } from "./components/fd-icons.js";
import { APP_PATHS } from "./route-map.js";
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

/** The nutrition page's log-meal dialog (`NUTRITION_LOG_MEAL_MODAL_ID`) and its
 *  Trends card (`data-nutrition-card="trends"`). Search, Scan and Log food link
 *  to the dialog by fragment; the Trends tab links to `FD_TRENDS_PATH` (`/trends`).
 *  v2/shell.js acts on the log-meal fragment only. A test pins both against
 *  their sources. */
export const FD_LOG_MEAL_HASH = "nutrition-log-meal";
export const FD_TRENDS_HASH = "trends";

export const FD_LOG_HREF = `${APP_PATHS.nutrition}#${FD_LOG_MEAL_HASH}`;
export const FD_TRENDS_PATH = "/trends";
export const FD_TRENDS_HREF = FD_TRENDS_PATH;

type FdTab = {
    id: Exclude<V2NavId, "settings" | "none">;
    label: string;
    href: string;
    icon: FdIconName;
    /** Old tab ids whose attention dot shows on this tab. */
    attention: readonly AppTabId[];
};

export const FD_TABS: readonly FdTab[] = [
    {
        id: "today",
        label: "Today",
        href: APP_PATHS.nutrition,
        icon: "cal",
        attention: ["nutrition"],
    },
    {
        id: "kitchen",
        label: "Kitchen",
        href: APP_PATHS.kitchenFridge,
        icon: "fridge",
        attention: ["fridge", "grocery"],
    },
    {
        id: "recipes",
        label: "Recipes",
        href: APP_PATHS.recipes,
        icon: "book",
        attention: ["recipes"],
    },
    {
        id: "trends",
        label: "Trends",
        href: FD_TRENDS_HREF,
        icon: "trend",
        attention: [],
    },
];

/** The Kitchen text tabs (design: Kitchen tabs). The groceries count in the
 *  design ("Groceries · 8") is not shown: the open-line count is not in the
 *  chrome and this shell adds no query for it. */
export const FD_KITCHEN_TABS: readonly {
    id: V2KitchenTab;
    label: string;
    href: string;
}[] = [
    { id: "fridge", label: "Fridge", href: APP_PATHS.kitchenFridge },
    { id: "groceries", label: "Groceries", href: APP_PATHS.kitchenGroceries },
    { id: "usuals", label: "Usuals", href: APP_PATHS.kitchenUsuals },
];

/** Desktop names the fridge page "Overview" (Desktop › Kitchen › Sidebar ›
 *  Sub/Overview); the phone's text tab says "Fridge". */
const SIDEBAR_KITCHEN_LABELS: Record<V2KitchenTab, string> = {
    fridge: "Overview",
    groceries: "Groceries",
    usuals: "Usuals",
};

/** Desktop Kitchen sections: sub-items under the sidebar's Kitchen link while
 *  Kitchen is active (design: Sidebar › Sub/Overview, Sub/Groceries,
 *  Sub/Usuals). They replace the text tabs from 1024 px. */
function sidebarKitchenSubs(chrome: AppChrome): string {
    const current = kitchenTabFor(chrome);
    return FD_KITCHEN_TABS.map((t) => {
        const on = t.id === current ? ' aria-current="page"' : "";
        return `<a class="fd-sidesub" href="${escapeHtml(t.href)}"${on}>${SIDEBAR_KITCHEN_LABELS[t.id]}</a>`;
    }).join("");
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
        return `<a class="fd-kitchen-tab" href="${escapeHtml(t.href)}"${on}>${t.label}</a>`;
    }).join("");
    return `<nav class="fd-kitchen-tabs" aria-label="Kitchen sections">${links}</nav>`;
}

/** "Ethan Flow" → "EF", "Ethan" → "E". First letters of the first and last
 *  word, upper-cased. */
export function initialsOf(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    const first = [...words[0]!][0] ?? "";
    const last =
        words.length > 1 ? ([...words[words.length - 1]!][0] ?? "") : "";
    return (first + last).toLocaleUpperCase("en");
}

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
    return role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Member";
}

function memberCountLabel(count: number): string {
    return count === 1 ? "1 member" : `${count} members`;
}

function attentionOn(chrome: AppChrome, tab: FdTab): boolean {
    return tab.attention.some((id) => chrome.attention.tabs[id] === true);
}

function settingsAttention(chrome: AppChrome): boolean {
    return chrome.attention.tabs.household === true;
}

function dotClass(base: string, attention: boolean): string {
    return attention ? `${base} ${base}-attention` : base;
}

function ariaLabel(label: string, attention: boolean): string {
    return escapeHtml(attention ? `${label}, has notices` : label);
}

function phoneTabs(chrome: AppChrome, active: V2NavId): string {
    const tab = (t: FdTab) => {
        const attention = attentionOn(chrome, t);
        const current = t.id === active ? ' aria-current="page"' : "";
        return `<a class="fd-tab" href="${escapeHtml(t.href)}"${current} aria-label="${ariaLabel(t.label, attention)}">${fdIcon(t.icon)}<span class="${dotClass("fd-tab-dot", attention)}" aria-hidden="true"></span></a>`;
    };
    const [today, kitchen, recipes, trends] = FD_TABS;
    const log = `<a class="fd-log" href="${FD_LOG_HREF}" data-fd-open-sheet="${FD_LOG_SEARCH_SHEET_ID}" aria-label="Search and log food" title="Search and log food">${fdIcon("search", 2)}</a>`;
    return `<nav class="fd-tabs" aria-label="Main tabs">${tab(today!)}${tab(kitchen!)}${log}${tab(recipes!)}${tab(trends!)}</nav>`;
}

function sidebar(chrome: AppChrome, active: V2NavId): string {
    const identity = chrome.identity;
    const householdName = identity?.householdName ?? "Household";
    const household = `<a class="fd-household" href="${APP_PATHS.settingsHousehold}" aria-label="${escapeHtml(identity ? `${householdName}, ${memberCountLabel(identity.memberCount)}` : householdName)}"><span class="fd-avatar" aria-hidden="true">${escapeHtml(householdInitial(householdName))}</span><span class="fd-household-text"><span class="fd-household-name">${escapeHtml(householdName)}</span>${
        identity
            ? `<span class="fd-household-meta">${memberCountLabel(identity.memberCount)}</span>`
            : ""
    }</span></a>`;

    const link = (t: FdTab) => {
        const attention = attentionOn(chrome, t);
        // With Kitchen's sections listed, the section link below is the page
        // and Kitchen is the current group ("true", not "page").
        const current =
            t.id !== active
                ? ""
                : t.id === "kitchen"
                  ? ' aria-current="true"'
                  : ' aria-current="page"';
        return `<a class="fd-sidelink" href="${escapeHtml(t.href)}"${current}${attention ? ` aria-label="${ariaLabel(t.label, true)}"` : ""}>${fdIcon(t.icon)}<span class="fd-sidelink-label">${escapeHtml(t.label)}</span><span class="${dotClass("fd-side-dot", attention)}" aria-hidden="true"></span></a>`;
    };
    const settingsAttn = settingsAttention(chrome);
    const settings = `<a class="fd-sidelink fd-sidelink-settings" href="${APP_PATHS.settings}" data-turbo="false"${active === "settings" ? ' aria-current="page"' : ""}${settingsAttn ? ` aria-label="${ariaLabel(SETTINGS_LABEL, true)}"` : ""}>${fdIcon("sun")}<span class="fd-sidelink-label">${SETTINGS_LABEL}</span><span class="${dotClass("fd-side-dot", settingsAttn)}" aria-hidden="true"></span></a>`;
    const links = FD_TABS.map((t) =>
        t.id === "kitchen" && active === "kitchen"
            ? `${link(t)}${sidebarKitchenSubs(chrome)}`
            : link(t),
    ).join("");
    const nav = `<nav class="fd-sidenav" aria-label="Main navigation">${links}${settings}</nav>`;

    const account = identity
        ? `<a class="fd-account" href="${APP_PATHS.settings}" data-turbo="false" aria-label="${escapeHtml(`Account: ${identity.viewerName}, ${roleLabel(identity.viewerRole)}`)}"><span class="fd-avatar" aria-hidden="true">${escapeHtml(initialsOf(identity.viewerName))}</span><span class="fd-account-text"><span class="fd-account-name">${escapeHtml(identity.viewerName)}</span><span class="fd-account-role">${roleLabel(identity.viewerRole)}</span></span>${fdIcon("chevR")}</a>`
        : "";
    return `<div class="fd-sidebar">${household}${nav}${account}</div>`;
}

/** The account chip, top right (design: Header › Account chip). It sits over
 *  the page's title row, absolutely positioned inside <main>; shell.css keeps
 *  the title and its actions clear of it. Hidden from 1024 px, where the
 *  sidebar's Account row replaces it. */
function accountChip(chrome: AppChrome): string {
    const name = chrome.identity?.viewerName ?? "";
    const label = name ? `Settings, signed in as ${name}` : "Settings";
    return `<a class="fd-account-chip" href="${APP_PATHS.settings}" data-turbo="false" aria-label="${escapeHtml(label)}" title="Settings">${escapeHtml(name ? initialsOf(name) : "Me")}</a>`;
}

/** The page's own header is what `pageHeader` (components/ui.ts) writes first:
 *  a bare <h1>, or a <header class="dash-head">. */
const LEADING_PAGE_HEADER =
    /^\s*(?:<h1(?:\s[^>]*)?>[\s\S]*?<\/h1>|<header class="dash-head">[\s\S]*?<\/header>)/;

/** The Kitchen text tabs go directly under the page header, as in the design.
 *  A body that does not start with one gets them first. */
function withKitchenTabs(body: string, chrome: AppChrome): string {
    const tabs = kitchenTabs(chrome);
    const head = LEADING_PAGE_HEADER.exec(body)?.[0];
    return head ? `${head}${tabs}${body.slice(head.length)}` : `${tabs}${body}`;
}

function topBar(): string {
    return `<header class="fd-topbar"><a class="fd-search" href="${FD_LOG_HREF}" data-fd-open-sheet="${FD_LOG_SEARCH_SHEET_ID}" aria-keyshortcuts="Control+K Meta+K">${fdIcon("search")}<span class="fd-search-text">Search foods, recipes, barcodes</span><kbd class="fd-kbd" aria-hidden="true">⌘K</kbd></a><span class="fd-topbar-fill"></span><a class="fd-scan" href="${FD_LOG_HREF}" aria-label="Scan a barcode" title="Scan a barcode">${fdIcon("scan")}</a><a class="fd-logfood" href="${FD_LOG_HREF}" data-fd-open-sheet="${FD_LOG_SEARCH_SHEET_ID}">${fdIcon("plus")}<span>Log food</span></a></header>`;
}

/** Head for the new shell: the shared meta, then the old stylesheet and script
 *  (the page bodies still lean on them, and Turbo and the modal code live in
 *  /app.js) followed by the v2 ones. All four are Turbo-tracked, so a member
 *  whose shell changes gets one full reload, never a morph from old markup
 *  into new. */
export function appHeadV2(title: string, theme: ThemePref): string {
    // "page": the phone page behind the floating nav and the desktop page are
    // both --surface-bg, so the browser chrome takes the page colour.
    return `${appHeadMeta(title, theme, "page")}
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
${sidebar(chrome, active)}
<div class="fd-column">
${topBar()}
<main class="app-main native fd-main">${accountChip(chrome)}${active === "kitchen" ? withKitchenTabs(chrome.body, chrome) : chrome.body}</main>
</div>
${phoneTabs(chrome, active)}
</div>
${chrome.flags.uiV2 ? renderLogSheets({ timezone: chrome.v2Timezone ?? "UTC", ...chrome.v2LogSheet }) : ""}
<div id="toast-region" class="toast-region" role="status" aria-live="polite" data-turbo-permanent></div>
</body>
</html>`;
}
