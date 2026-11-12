/**
 * Making a share link from the app: the Share button and sheet on a recipe and
 * on the grocery list, and the screen that shows the new link's address once.
 *
 * FigCraft has no Share control. The recipe page's header row (desktop 48815
 * "Page header": Edit, Add to plan, Cook) and the phone's action row (22840:
 * Add to plan, Cook) keep the primary last, so Share goes first as one more
 * secondary button: Share, Add to plan, Cook. Groceries (phone
 * 21909 / 26821, desktop 47548 / 56431) takes it in the title row beside
 * "Add to list". The sheet is the app's own confirm sheet: an expiry choice
 * and Create link.
 *
 * The form opts out of Turbo. It answers with a 200 page that holds the
 * address, and Turbo drops a form response that is not a redirect; a redirect
 * would have to carry the address in a URL or a cookie, and it must not.
 */
import { esc, raw, type Html } from "../../components/v2/html.js";
import { sheet, sheetTrigger } from "../../components/v2/sheet.js";
import type { AppChromeBase } from "../../attention.js";
import { renderAppShell } from "../../shell.js";

export type ShareExpiryChoice = {
    /** What the form posts. */
    value: string;
    label: string;
    /** Whole days until the link stops working; null for never. */
    days: number | null;
};

/** Never first, and the default: a link someone was sent should keep working. */
export const SHARE_EXPIRY_CHOICES: readonly ShareExpiryChoice[] = [
    { value: "never", label: "Never", days: null },
    { value: "7", label: "7 days", days: 7 },
    { value: "30", label: "30 days", days: 30 },
    { value: "90", label: "90 days", days: 90 },
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

const SHARE_ICON = raw(
    `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 15V4"/><path d="M8 7.5 12 4l4 3.5"/><path d="M6 11H5.5A1.5 1.5 0 0 0 4 12.5v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H18"/></svg>`,
);

/** The Share button that opens the sheet. `className` styles it where it sits. */
export function renderShareTrigger(target: string, className: string): Html {
    return raw(
        sheetTrigger({
            target,
            label: "Share",
            className,
            icon: `${String(SHARE_ICON)}<span>Share</span>`,
        }),
    );
}

export type ShareSheetView = {
    id: string;
    /** Where the form posts. */
    action: string;
    title: string;
    /** The recipe's name, or what the list is. */
    subtitle: string;
    /** "recipe" or "grocery list": the sentence says who can read what. */
    what: string;
    /** A refused post re-renders the page with the sheet open. */
    open?: boolean;
    error?: string;
};

/** The sheet: how long the link works, and Create link. */
export function renderShareSheet(view: ShareSheetView): string {
    const formId = `${view.id}-form`;
    const err = view.error
        ? `<p class="fd-plan-error" role="alert">${esc(view.error)}</p>`
        : "";
    const options = SHARE_EXPIRY_CHOICES.map(
        (choice) =>
            `<option value="${esc(choice.value)}"${choice.days === null ? " selected" : ""}>${esc(choice.label)}</option>`,
    ).join("");
    const body = `<form id="${esc(formId)}" class="fd-plan-form" method="post" action="${esc(view.action)}" data-turbo="false">
${err}<p class="fd-share-note">Anyone who has the link can read this ${esc(view.what)}, without signing in. The link is shown once, when you create it.</p>
<label class="fd-plan-field"><span class="fd-plan-field__label">Link expires</span><span class="fd-plan-select"><select name="expires">${options}</select></span></label>
</form>`;
    return sheet({
        id: view.id,
        kind: "confirm",
        title: view.title,
        subtitle: view.subtitle,
        body,
        actions: `<button type="submit" class="fd-btn fd-btn--primary" form="${esc(formId)}">Create link</button>`,
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

/**
 * The one screen that shows a link's address. The address is in a single
 * read-only field and nowhere else in the markup (the Copy button and the
 * script read the field), and the page is sent no-store.
 */
export function renderShareCreatedBody(view: ShareCreatedView): string {
    const subject = view.name
        ? `<strong>${esc(view.name)}</strong>`
        : `the ${esc(view.what)}`;
    return `<div class="fd-share-made">
<h1 class="fd-share-made__title">Link ready</h1>
<p class="fd-share-made__lead">Anyone who has this link can read ${subject}, without signing in. It is shown only now: copy it before you leave.</p>
<div class="fd-share-made__box" data-fd-share-made>
<label class="fd-share-made__field"><span class="fd-share-made__label">Share link</span>
<input class="fd-share-made__input" type="text" readonly spellcheck="false" autocomplete="off" value="${esc(view.url)}" data-fd-share-url />
</label>
<button type="button" class="fd-btn fd-btn--primary fd-share-made__copy" data-fd-share-copy>Copy link</button>
</div>
<p class="fd-share-made__status" role="status" aria-live="polite" data-fd-share-status></p>
<p class="fd-share-made__meta">${esc(shareExpiryLabel(view.expiresAt))}. Revoke it any time in Settings › Household.</p>
<p class="fd-share-made__done"><a class="fd-btn" href="${esc(view.backHref)}" data-turbo="false">Done</a></p>
</div>`;
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
