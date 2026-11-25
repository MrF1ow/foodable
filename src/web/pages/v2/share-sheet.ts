/**
 * Making a share link from the app: the sheet that asks how long the link
 * works (opened from the Detail bar's ⋯ on a recipe, or the Groceries ⋯), and
 * the screen that shows the new link's address once, as a "Link ready" sheet
 * (FigCraft 406788, 407028 and 407265).
 *
 * The form opts out of Turbo. It answers with a 200 page that holds the
 * address, and Turbo drops a form response that is not a redirect; a redirect
 * would have to carry the address in a URL or a cookie, and it must not.
 */
import { button } from "../../components/v2/button.js";
import { choiceGroup } from "../../components/v2/chips.js";
import { detailBar } from "../../components/v2/detail-bar.js";
import { field } from "../../components/v2/field.js";
import { esc, raw } from "../../components/v2/html.js";
import { pageHeader } from "../../components/v2/page-header.js";
import { pageLayout } from "../../components/v2/page-layout.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import type { AppChromeBase } from "../../attention.js";
import { renderAppShell } from "../../shell.js";

export type ShareExpiryChoice = {
    /** What the form posts. */
    value: string;
    label: string;
    /** Whole days until the link stops working; null for never. */
    days: number | null;
};

/** Never is the default: a link someone was sent should keep working. */
export const SHARE_EXPIRY_CHOICES: readonly ShareExpiryChoice[] = [
    { value: "7", label: "1 week", days: 7 },
    { value: "30", label: "1 month", days: 30 },
    { value: "90", label: "3 months", days: 90 },
    { value: "never", label: "Never expires", days: null },
];

/** The days a posted choice stands for, or null when the form never offered it. */
export function parseShareExpiry(
    value: string,
): { ok: true; days: number | null } | { ok: false } {
    const choice = SHARE_EXPIRY_CHOICES.find((c) => c.value === value.trim());
    return choice ? { ok: true, days: choice.days } : { ok: false };
}

export const RECIPE_SHARE_SHEET_ID = "fd-recipe-share-sheet";
export const GROCERY_SHARE_SHEET_ID = "fd-grocery-share-sheet";

export type ShareSheetView = {
    id: string;
    /** Where the form posts. */
    action: string;
    title: string;
    /** A line under the title; the recipe's sheet has none. */
    subtitle?: string;
    /** "recipe" or "grocery list". */
    what: string;
    /** A refused post re-renders the page with the sheet open. */
    open?: boolean;
    error?: string;
};

/** The sheet: how long the link works, and Make link. */
export function renderShareSheet(view: ShareSheetView): string {
    const formId = `${view.id}-form`;
    const err = view.error
        ? `<p class="fd-recipe-error" role="alert">${esc(view.error)}</p>`
        : "";
    const expiry = sheetSection({
        kind: "choice",
        label: "Link works for",
        content: choiceGroup({
            name: "expires",
            legend: "Link works for",
            options: SHARE_EXPIRY_CHOICES.map((choice) => ({
                value: choice.value,
                label: choice.label,
                selected: choice.days === null,
            })),
        }),
    });
    const body = `<form id="${esc(formId)}" class="fd-share-form" method="post" action="${esc(view.action)}" data-turbo="false">
${err}${String(expiry)}
</form>`;
    return sheet({
        id: view.id,
        placement: "dialog",
        header: {
            kind: "title",
            title: view.title,
            ...(view.subtitle ? { subtitle: view.subtitle } : {}),
        },
        body: raw(body),
        actions: {
            kind: "single",
            primary: { label: "Make link", type: "submit", form: formId },
        },
        openOnLoad: view.open,
        focus: "panel",
    });
}

const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
] as const;

/** "14 Dec 2026" for an ISO instant, in UTC; the raw string if it does not parse. */
export function shareDateLabel(iso: string): string {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return iso;
    return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/** "Never expires" or "Expires 14 Dec 2026". */
export function shareExpiryLabel(expiresAt: string | null): string {
    return expiresAt === null
        ? "Never expires"
        : `Expires ${shareDateLabel(expiresAt)}`;
}

export type ShareCreatedView = {
    chrome: AppChromeBase;
    /** The address to give out. Shown here and nowhere else. */
    url: string;
    /** "recipe" or "grocery list". */
    what: string;
    /** The recipe's name; the list has none. */
    name: string | null;
    expiresAt: string | null;
    /** Where Done goes: the recipe, or the list. */
    backHref: string;
    active: "recipes" | "grocery";
};

const MADE_SHEET_ID = "fd-share-made-sheet";

/**
 * The one screen that shows a link's address: the page the link belongs to,
 * as a Detail bar and its title, with the "Link ready" sheet open over it.
 * The address is in a single read-only field and nowhere else in the markup
 * (the Copy button and the script read the field), and the page is sent
 * no-store. Done goes back to the page; so does closing the sheet.
 */
export function renderShareCreatedBody(view: ShareCreatedView): string {
    const subtitle = view.name ?? "Grocery list";
    const urlField = field({
        id: "fd-share-made-url",
        label: "Share link",
        labelHidden: true,
        name: "share_url",
        type: "text",
        value: view.url,
        readonly: true,
        spellcheck: false,
        autocomplete: "off",
        inputData: { "fd-share-url": "" },
        className: "fd-share-made__field",
    });
    const copy = button({
        round: true,
        icon: "copy",
        label: "Copy link",
        attrs: { "data-fd-share-copy": "" },
    });
    const body = sheetSection({
        kind: "custom",
        label: "Share link",
        content: raw(
            `<div class="fd-share-made__box" data-fd-share-made data-fd-share-back="${esc(view.backHref)}">${urlField}${copy}</div>
<p class="fd-share-made__meta">${esc(shareExpiryLabel(view.expiresAt))} · shown only once</p>
<p class="fd-share-made__meta">Anyone with the link can read this ${esc(view.what)}. Revoke it in Settings › Household.</p>
<p class="fd-share-made__status fd-sr" role="status" aria-live="polite" data-fd-share-status></p>`,
        ),
    });
    const made = sheet({
        id: MADE_SHEET_ID,
        placement: "dialog",
        header: { kind: "title", title: "Link ready", subtitle },
        body: body,
        actions: {
            kind: "single",
            // Closing the sheet goes back to the page (share-link.js), so Done
            // is a close, not a form: a GET form would add a stray "?".
            primary: {
                label: "Done",
                attrs: { command: "close", commandfor: MADE_SHEET_ID },
            },
        },
        openOnLoad: true,
        focus: "panel",
    });
    const page = pageLayout({
        layout: "single",
        header: detailBar({
            back: { href: view.backHref, attrs: { "data-turbo": "false" } },
            balance: true,
        }),
        content: pageHeader({ title: subtitle }),
    });
    return `<div class="fd-share-made">${String(page)}${made}</div>`;
}

export function renderShareCreatedPage(view: ShareCreatedView): string {
    return renderAppShell({
        ...view.chrome,
        title: "Share link",
        active: view.active,
        ...(view.active === "grocery"
            ? { v2Kitchen: "groceries" as const }
            : {}),
        body: renderShareCreatedBody(view),
    });
}
