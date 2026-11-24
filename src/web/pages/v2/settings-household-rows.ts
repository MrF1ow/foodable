import { esc, raw, type Html } from "../../components/v2/html.js";
import { iconChevronRight } from "../../components/v2/icons.js";
import { sheet } from "../../components/v2/sheet.js";
import { rowList } from "../../components/v2/rows.js";

/**
 * The rows of the Household group and of its sub-pages: an icon, a label, the
 * current value and a chevron. A row either links to a page, opens an edit
 * sheet, or (for a viewer who cannot change it) just shows its value. These
 * reuse the stores page's `fd-stores-pref` row so the two pages look alike.
 */

export type HouseholdRowOpts = {
    /** Left of the label; a row with none is label, value, chevron. */
    icon?: Html;
    label: string;
    /** Plain text shown at the right. */
    value?: string;
    /** A link row. */
    href?: string;
    /** An edit-sheet row: opens the sheet with this id. */
    sheetId?: string;
};

function rowInner(opts: HouseholdRowOpts, chevron: boolean): string {
    const value = opts.value
        ? `<span class="fd-stores-pref__value">${esc(opts.value)}</span>`
        : "";
    const chev = chevron
        ? `<span class="fd-row__chevron" aria-hidden="true">${iconChevronRight()}</span>`
        : "";
    const icon = opts.icon
        ? `<span class="fd-stores-pref__icon" aria-hidden="true">${opts.icon}</span>`
        : "";
    return `${icon}<span class="fd-stores-pref__main"><span class="fd-row__title">${esc(opts.label)}</span></span>${value}${chev}`;
}

export function householdRow(opts: HouseholdRowOpts): Html {
    if (opts.href) {
        return raw(
            `<li class="fd-row fd-row--stores-pref"><a class="fd-row__body fd-stores-pref" href="${esc(opts.href)}">${rowInner(opts, true)}</a></li>`,
        );
    }
    if (opts.sheetId) {
        return raw(
            `<li class="fd-row fd-row--stores-pref"><button type="button" class="fd-row__body fd-stores-pref" commandfor="${esc(opts.sheetId)}" command="show-modal">${rowInner(opts, true)}</button></li>`,
        );
    }
    return raw(
        `<li class="fd-row fd-row--stores-pref"><div class="fd-row__body fd-stores-pref">${rowInner(opts, false)}</div></li>`,
    );
}

/** The card of rows. */
export function householdRowCard(rows: readonly Html[], label: string): Html {
    return rowList(rows, { label, className: "fd-list--card" });
}

/** An edit sheet holding one form; the Save button sits in the action row. */
export function householdEditSheet(opts: {
    id: string;
    title: string;
    subtitle?: string;
    action: string;
    /** The fields, already escaped (built with `settingsField`). */
    fields: string;
    /** A 4xx re-render reopens the sheet and shows this error inside it. */
    error?: string;
    open?: boolean;
    saveLabel?: string;
}): string {
    const formId = `${opts.id}-form`;
    const error = opts.error
        ? `<p class="fd-settings-error" role="alert">${esc(opts.error)}</p>`
        : "";
    return sheet({
        id: opts.id,
        kind: "edit",
        title: opts.title,
        subtitle: opts.subtitle,
        body: `<form id="${formId}" method="post" action="${esc(opts.action)}" class="fd-stores-form">${error}${opts.fields}</form>`,
        actions: `<button type="button" class="fd-btn" command="close" commandfor="${esc(opts.id)}">Cancel</button><button type="submit" class="fd-btn fd-btn--primary" form="${formId}">${esc(opts.saveLabel ?? "Save")}</button>`,
        openOnLoad: opts.open,
    });
}

/**
 * The IANA names a time zone picker lists: what the runtime supports, plus the
 * stored value when it is missing (aliases such as `US/Pacific` are valid and
 * stored but not in the supported list), so a re-save keeps it.
 */
export function timeZoneOptions(stored: string | null): string[] {
    const zones = Intl.supportedValuesOf("timeZone");
    const list = zones.includes("UTC") ? [...zones] : ["UTC", ...zones];
    if (stored && !list.includes(stored)) list.push(stored);
    return list.sort((a, b) => a.localeCompare(b));
}
