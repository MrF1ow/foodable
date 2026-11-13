import { esc } from "../../components/v2/html.js";
import { iconPlus } from "../../components/v2/icons.js";
import { sheetTrigger } from "../../components/v2/sheet.js";
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

/**
 * The add button every Kitchen tab has, in two places that are never both
 * visible. On the phone it is the round "+" level with the tabs (`phone`, put
 * in `kitchenTopTools`); from 1024px the tabs are gone and the labelled button
 * rides in the header after the section switch (`desktop`, passed as
 * `desktopTools`). One markup per place, so the three tabs cannot drift.
 */
export function kitchenAddButton(opts: { target: string; label: string }): {
    phone: string;
    desktop: string;
} {
    return {
        phone: sheetTrigger({
            target: opts.target,
            label: opts.label,
            className: "fd-icon-btn fd-kitchen-fridge-add",
            icon: String(iconPlus()),
        }),
        desktop: sheetTrigger({
            target: opts.target,
            label: opts.label,
            className: "fd-btn fd-btn--primary fd-kitchen-overview-add",
            icon: `${String(iconPlus())}<span>${esc(opts.label)}</span>`,
        }),
    };
}

/**
 * The phone's tool row at the right of the tabs, first in the page so it takes
 * no room in the flow. Buttons are listed left to right; the add button goes
 * last, so it sits in the same corner on every tab.
 */
export function kitchenTopTools(...buttons: string[]): string {
    return `<div class="fd-kitchen-fridge-top">${buttons.join("")}</div>`;
}
