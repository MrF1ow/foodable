/**
 * Rotating the household token (FigCraft 424336, 425210): a confirm sheet on
 * the Household page, then the one page that shows the new token.
 *
 * The rotate route answers 200 with the token in the page, which Turbo Drive
 * would refuse, so the sheet's form is a full page load (`data-turbo="false"`).
 * The token is in that page once and nowhere else: not a redirect, not a toast.
 * Turbo would keep a snapshot of the page for the Back button, so the page
 * marks itself uncacheable (the shell's head is shared, so it adds the meta
 * itself) and blanks the token as it is snapshotted anyway.
 */
import type { AppChromeBase } from "../../attention.js";
import { button } from "../../components/v2/button.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { icon } from "../../components/v2/icon.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { APP_PATHS } from "../../route-map.js";
import { renderHouseholdLayout } from "./settings-household-layout.js";

export const HOUSEHOLD_ROTATE_TOKEN_SHEET_ID = "fd-household-rotate-token";
export const ROTATE_TOKEN_PATH = "/settings/household/rotate-token";

const TOKEN_ID = "household-token";

/** Keeps the token out of Turbo's snapshot cache: leaving the page by a Turbo
 *  visit and pressing Back must fetch the page again, not restore the token. */
export const TOKEN_NO_CACHE_SCRIPT = `<script>(function(){var m=document.createElement("meta");m.name="turbo-cache-control";m.content="no-cache";document.head.appendChild(m);document.addEventListener("turbo:before-cache",function(){var t=document.getElementById("${TOKEN_ID}");if(t)t.textContent=""},{once:true})})()</script>`;

/** The confirm the Household ⋯ menu opens: owner only (the menu item and the route). */
export function rotateTokenSheet(opts: { open?: boolean } = {}): string {
    const formId = `${HOUSEHOLD_ROTATE_TOKEN_SHEET_ID}-form`;
    return sheet({
        id: HOUSEHOLD_ROTATE_TOKEN_SHEET_ID,
        placement: "dialog",
        header: { kind: "title", title: "Rotate household token?" },
        body: sheetSection({
            kind: "custom",
            content: raw(
                `<form id="${formId}" method="post" action="${ROTATE_TOKEN_PATH}" data-turbo="false"><p class="fd-sheet__text">Agents using the old token stop working.</p></form>`,
            ),
        }),
        actions: {
            kind: "destructive",
            danger: { label: "Rotate token", type: "submit", form: formId },
        },
        openOnLoad: opts.open,
    });
}

export type HouseholdTokenPageView = {
    chrome: AppChromeBase;
    /** The new token: shown on this response only. */
    token: string;
};

/** The new token in a box with a copy button, "Shown only now", and Done. */
export function renderHouseholdTokenPage(view: HouseholdTokenPageView): string {
    const body: Html = join([
        raw(
            `<div class="fd-settings-invite-code" data-fd-copy-address><div class="fd-settings-invite-code__box"><code id="${TOKEN_ID}" data-fd-copy-source>${esc(view.token)}</code><button type="button" class="fd-settings-invite-code__copy" data-fd-copy-trigger aria-label="Copy token">${icon("copy", 20)}</button></div><p class="fd-settings-invite-code__note">Shown only now</p></div><p class="fd-visually-hidden" role="status" aria-live="polite" data-fd-copy-status></p>${TOKEN_NO_CACHE_SCRIPT}`,
        ),
        button({
            label: "Done",
            variant: "primary",
            href: APP_PATHS.settingsHousehold,
        }),
    ]);
    return renderHouseholdLayout({
        chrome: view.chrome,
        title: "Household token",
        body,
    });
}
