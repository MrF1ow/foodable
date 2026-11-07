import { validateTz } from "../../domain/tz.js";
import { escapeHtml } from "../shell.js";

function supportedTimezones(): string[] {
    return Intl.supportedValuesOf("timeZone").slice().sort();
}

/**
 * Builds a timezone &lt;select&gt; with a "same as owner" blank option and IANA
 * zones. Keeps a valid selected value even when it is absent from the list.
 */
export function timezoneSelectHtml(input: {
    id: string;
    name: string;
    selected: string | null;
    ownerTimezoneLabel: string;
    sameAsOwnerLabel?: string;
    /** When true, show an invalid selected value instead of dropping it. */
    keepInvalid?: boolean;
}): string {
    const zones = supportedTimezones();
    const selected = input.selected ?? "";
    const sameLabel =
        input.sameAsOwnerLabel ??
        `Same as the owner (${input.ownerTimezoneLabel})`;
    const blankSelected = selected === "" ? " selected" : "";
    const options: string[] = [
        `<option value=""${blankSelected}>${escapeHtml(sameLabel)}</option>`,
    ];
    const selectedValid = selected !== "" && validateTz(selected);
    if (
        selected &&
        (input.keepInvalid || selectedValid) &&
        !zones.includes(selected)
    ) {
        const sel = " selected";
        options.push(
            `<option value="${escapeHtml(selected)}"${sel}>${escapeHtml(selected)}</option>`,
        );
    }
    for (const zone of zones) {
        const sel = zone === selected ? " selected" : "";
        options.push(
            `<option value="${escapeHtml(zone)}"${sel}>${escapeHtml(zone)}</option>`,
        );
    }
    return `<select id="${escapeHtml(input.id)}" name="${escapeHtml(input.name)}">${options.join("")}</select>`;
}
