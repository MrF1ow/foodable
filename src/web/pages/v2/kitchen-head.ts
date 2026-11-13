import { esc } from "../../components/v2/html.js";
import { APP_PATHS } from "../../route-map.js";

/**
 * The Kitchen page header, one markup for Fridge, Groceries and Usuals so the
 * title never moves between tabs: on the phone a bare `<h1>` (the shell puts
 * the text tabs right under it) with the subtitle beneath; from 1024px a head
 * row with the title and subtitle on the left and the section switch, plus
 * whatever the tab adds, on the right.
 */

export type KitchenTab = "fridge" | "groceries" | "usuals";

const DESKTOP_KITCHEN_TABS = [
    { id: "fridge" as const, label: "Overview", href: APP_PATHS.kitchenFridge },
    {
        id: "groceries" as const,
        label: "Groceries",
        href: APP_PATHS.kitchenGroceries,
    },
    { id: "usuals" as const, label: "Usuals", href: APP_PATHS.kitchenUsuals },
];

export function renderKitchenDesktopSeg(active: KitchenTab): string {
    const links = DESKTOP_KITCHEN_TABS.map((tab) => {
        const on =
            tab.id === active
                ? ' class="fd-seg-btn fd-seg-btn--on" aria-current="page"'
                : ' class="fd-seg-btn"';
        return `<a${on} href="${esc(tab.href)}">${esc(tab.label)}</a>`;
    }).join("");
    return `<nav class="fd-seg fd-kitchen-overview-seg" aria-label="Kitchen sections">${links}</nav>`;
}

export function renderKitchenHead(opts: {
    active: KitchenTab;
    /** The line under the title on the phone (plain text, escaped here). */
    phoneSubtitle: string;
    /** The line under the title from 1024px. */
    desktopSubtitle: string;
    /** Extra desktop controls after the section switch (trusted markup). */
    desktopTools?: string;
}): string {
    const phone = esc(opts.phoneSubtitle);
    const desktop = esc(opts.desktopSubtitle);
    return `<h1 class="fd-kitchen-fridge-title fd-kitchen-fridge-title--phone">Kitchen<span class="fd-kitchen-fridge-count">${phone}</span></h1>
<header class="fd-kitchen-overview-head">
<div class="fd-kitchen-overview-head__title">
<h1 class="fd-kitchen-fridge-title">Kitchen<span class="fd-kitchen-fridge-count fd-kitchen-fridge-count--phone">${phone}</span><span class="fd-kitchen-fridge-count fd-kitchen-fridge-count--desktop">${desktop}</span></h1>
</div>
<div class="fd-kitchen-overview-head__tools">
${renderKitchenDesktopSeg(opts.active)}${opts.desktopTools ? `\n${opts.desktopTools}` : ""}
</div>
</header>`;
}
