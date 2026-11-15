import { esc, raw, type Html } from "../../components/v2/html.js";
import {
    iconCart,
    iconChevronRight,
    iconRefresh,
} from "../../components/v2/icons.js";
import { sheet } from "../../components/v2/sheet.js";
import { rowList } from "../../components/v2/rows.js";
import { settingsField } from "./settings-shared.js";

/**
 * The rows of the Household group and of its sub-pages: an icon, a label, the
 * current value and a chevron. A row either links to a page, opens an edit
 * sheet, or (for a viewer who cannot change it) just shows its value. These
 * reuse the stores page's `fd-stores-pref` row so the two pages look alike.
 */

function lineIcon(inner: string): Html {
    return raw(
        `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`,
    );
}

export const ROW_ICONS = {
    edit: lineIcon(
        '<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="M13.5 6.5l4 4"/>',
    ),
    pin: lineIcon(
        '<path d="M12 21s6-5.2 6-10a6 6 0 0 0-12 0c0 4.8 6 10 6 10Z"/><circle cx="12" cy="11" r="2.2"/>',
    ),
    clock: lineIcon('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'),
    calendar: lineIcon(
        '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    ),
    link: lineIcon(
        '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    ),
    hourglass: lineIcon(
        '<path d="M7 4h10M7 20h10M8 4c0 4 4 5 4 8s-4 4-4 8M16 4c0 4-4 5-4 8s4 4 4 8"/>',
    ),
    bell: lineIcon(
        '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15Z"/><path d="M10 21h4"/>',
    ),
    cart: iconCart(),
    refresh: iconRefresh(),
} as const;

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
    /** A trigger row for an old-style dialog (the rotate-token confirm). */
    modalId?: string;
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
    const target = opts.sheetId ?? opts.modalId;
    if (target) {
        return raw(
            `<li class="fd-row fd-row--stores-pref"><button type="button" class="fd-row__body fd-stores-pref" commandfor="${esc(target)}" command="show-modal">${rowInner(opts, true)}</button></li>`,
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

export function textInputField(opts: {
    id: string;
    label: string;
    name: string;
    value: string;
    maxlength?: number;
    required?: boolean;
    placeholder?: string;
    inputmode?: string;
}): string {
    return String(
        settingsField({
            id: opts.id,
            label: opts.label,
            control: `<input class="fd-settings-input" id="${esc(opts.id)}" name="${esc(opts.name)}" value="${esc(opts.value)}"${opts.maxlength ? ` maxlength="${opts.maxlength}"` : ""}${opts.required ? " required" : ""}${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ""}${opts.inputmode ? ` inputmode="${esc(opts.inputmode)}"` : ""} autocomplete="off" />`,
        }),
    );
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

export function timeZoneSelect(opts: {
    id: string;
    name: string;
    stored: string | null;
    /** Label of the empty choice; absent means a zone must be picked. */
    emptyLabel?: string;
}): string {
    const options = timeZoneOptions(opts.stored)
        .map(
            (zone) =>
                `<option value="${esc(zone)}"${zone === opts.stored ? " selected" : ""}>${esc(zone)}</option>`,
        )
        .join("");
    const empty =
        opts.emptyLabel !== undefined
            ? `<option value=""${opts.stored ? "" : " selected"}>${esc(opts.emptyLabel)}</option>`
            : "";
    return `<select class="fd-settings-input" id="${esc(opts.id)}" name="${esc(opts.name)}">${empty}${options}</select>`;
}

/** A switch that posts `name=on|off` (the opposite of the current state). */
export function switchForm(opts: {
    action: string;
    name: string;
    on: boolean;
    label: string;
    extraHidden?: Readonly<Record<string, string>>;
}): string {
    const hidden = Object.entries(opts.extraHidden ?? {})
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${esc(name)}" value="${esc(value)}" />`,
        )
        .join("");
    return `<form method="post" action="${esc(opts.action)}" class="fd-inline-form">${hidden}<input type="hidden" name="${esc(opts.name)}" value="${opts.on ? "off" : "on"}" /><button type="submit" class="fd-switch" role="switch" aria-checked="${opts.on ? "true" : "false"}" aria-label="${esc(opts.label)}"><span class="fd-switch__knob" aria-hidden="true"></span></button></form>`;
}
