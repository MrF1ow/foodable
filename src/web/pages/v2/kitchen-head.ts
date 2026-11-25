import { esc, raw } from "../../components/v2/html.js";
import { iconPlus } from "../../components/v2/icons.js";
import { pageHeader } from "../../components/v2/page-header.js";
import { sheetTrigger } from "../../components/v2/sheet.js";

/**
 * The Kitchen page header, one markup for Fridge, Groceries and Usuals so the
 * title never moves between tabs: the design's Page header with the title, a
 * subtitle and, from 1024px, the tab's actions in its Actions slot. The shell
 * puts the text tabs right under it on the phone and the sidebar lists the
 * sections on desktop, so the header carries no tabs of its own.
 */

export type KitchenTab = "fridge" | "groceries" | "usuals";

export function renderKitchenHead(opts: {
    active: KitchenTab;
    /** The line under the title (plain text, escaped here). */
    phoneSubtitle: string;
    /**
     * Groceries and Usuals still pass it; the header shows one subtitle at
     * every width, so only `phoneSubtitle` is drawn.
     */
    desktopSubtitle?: string;
    /** The tab's actions, drawn in the header from 1024px (trusted markup). */
    desktopTools?: string;
}): string {
    return String(
        pageHeader({
            title: "Kitchen",
            subtitle: opts.phoneSubtitle,
            actions: opts.desktopTools ? raw(opts.desktopTools) : undefined,
            className: "fd-kitchen-head",
            data: { "fd-kitchen-tab": opts.active },
        }),
    );
}

/**
 * The add button every Kitchen tab has, in two places that are never both
 * visible. On the phone it is the round "+" level with the tabs (`phone`, put
 * in `kitchenTopTools`); from 1024px the tabs are gone and the labelled button
 * rides in the header's Actions slot (`desktop`, passed as `desktopTools`). One
 * markup per place, so the tabs cannot drift.
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
