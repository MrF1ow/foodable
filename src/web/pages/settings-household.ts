import {
    escapeHtml,
    renderSettingsPage as renderSettingsShell,
    type ViewerChrome,
} from "../shell.js";
import {
    canManageHousehold,
    DEFAULT_RESTOCK,
    householdTimezone,
    isRestockTime,
    isRestockWeekday,
    type HouseholdMember,
    type HouseholdPreferences,
} from "../../household.js";
import {
    errorBanner,
    field,
    pageHeader,
    panel,
    row,
} from "../components/ui.js";
import { renderSettingsNav } from "../components/settings-nav.js";
import { timezoneSelectHtml } from "../components/timezone-select.js";

const WEEKDAYS = [
    { value: 0, label: "Sunday" },
    { value: 1, label: "Monday" },
    { value: 2, label: "Tuesday" },
    { value: 3, label: "Wednesday" },
    { value: 4, label: "Thursday" },
    { value: 5, label: "Friday" },
    { value: 6, label: "Saturday" },
] as const;

const RESTOCK_HELP =
    "On the day and time above, food that expires within 7 days and usuals whose schedule is due go on the grocery list. Any other day, usuals set to “Add when it runs low” are added once they run low. This one switch controls all of it.";

export type HouseholdSettingsPageView = {
    chrome: ViewerChrome;
    backHref: string;
    member: HouseholdMember;
    preferences: HouseholdPreferences;
    ownerTimezoneLabel: string;
    /** Submitted values on validation error; otherwise stored preferences. */
    draft?: {
        timezone: string | null;
        restockEnabled: boolean;
        restockWeekday: string;
        restockTime: string;
    };
    error?: string;
};

function hiddenFrom(backHref: string): string {
    return `<input type="hidden" name="from" value="${escapeHtml(backHref)}" />`;
}

function weekdayLabel(weekday: number): string {
    return WEEKDAYS.find((d) => d.value === weekday)?.label ?? "Saturday";
}

function timezoneDisplay(
    prefs: Pick<HouseholdPreferences, "timezone">,
    ownerTimezoneLabel: string,
): string {
    if (prefs.timezone != null && prefs.timezone !== "") {
        return prefs.timezone;
    }
    return `Same as the owner (${ownerTimezoneLabel})`;
}

function weekdaySelect(
    id: string,
    name: string,
    selectedRaw: string,
    keepInvalid: boolean,
): string {
    const trimmed = selectedRaw.trim();
    const selectedNum =
        trimmed !== "" && /^\d+$/.test(trimmed) ? Number(trimmed) : null;
    const opts = WEEKDAYS.map((d) => {
        const sel =
            selectedNum != null && d.value === selectedNum ? " selected" : "";
        return `<option value="${d.value}"${sel}>${d.label}</option>`;
    });
    if (
        keepInvalid &&
        (trimmed === "" ||
            selectedNum == null ||
            !isRestockWeekday(selectedNum))
    ) {
        const label = trimmed === "" ? "Choose a day" : escapeHtml(trimmed);
        const value = escapeHtml(trimmed);
        opts.unshift(`<option value="${value}" selected>${label}</option>`);
    }
    return `<select id="${escapeHtml(id)}" name="${escapeHtml(name)}">${opts.join("")}</select>`;
}

/** A browser blanks a `type="time"` value it can't parse, so a rejected
 * time is re-rendered as text: the error stays visible and re-posts as is. */
function restockTimeInput(value: string, keepInvalid: boolean): string {
    const type = keepInvalid && !isRestockTime(value) ? "text" : "time";
    return `<input type="${type}" id="restock_time" name="restock_time" value="${escapeHtml(value)}" step="60" />`;
}

function readOnlyBody(
    view: HouseholdSettingsPageView,
    prefs: HouseholdPreferences,
): string {
    const tz = timezoneDisplay(prefs, view.ownerTimezoneLabel);
    const restockOn = prefs.restock.enabled ? "On" : "Off";
    const schedule = prefs.restock.enabled
        ? `Check on ${weekdayLabel(prefs.restock.weekday)} at ${prefs.restock.time}`
        : "";
    return `
        ${pageHeader({ title: "Household" })}
        ${renderSettingsNav("household", view.backHref)}
        ${panel({
            title: "Timezone",
            body: row({ title: "Timezone", meta: tz }),
        })}
        ${panel({
            title: "Restock",
            body: `${row({ title: "Restock the grocery list", meta: restockOn })}
            ${schedule ? row({ title: "Schedule", meta: schedule }) : ""}
            <p class="muted">${escapeHtml(RESTOCK_HELP)}</p>
            <p class="muted">Only the household owner or an admin can change these settings.</p>`,
        })}
    `;
}

function editableBody(
    view: HouseholdSettingsPageView,
    form: {
        timezone: string | null;
        restockEnabled: boolean;
        restockWeekday: string;
        restockTime: string;
    },
    keepInvalid: boolean,
): string {
    const tzValue = form.timezone ?? "";
    const restockChecked = form.restockEnabled ? " checked" : "";
    return `
        ${pageHeader({ title: "Household" })}
        ${errorBanner(view.error)}
        ${renderSettingsNav("household", view.backHref)}
        <form method="POST" action="/settings/household-settings">
            ${hiddenFrom(view.backHref)}
            ${panel({
                title: "Timezone",
                body: field({
                    id: "household_timezone",
                    label: "Timezone",
                    control: timezoneSelectHtml({
                        id: "household_timezone",
                        name: "timezone",
                        selected: tzValue || null,
                        ownerTimezoneLabel: view.ownerTimezoneLabel,
                        keepInvalid,
                    }),
                }),
            })}
            ${panel({
                title: "Restock",
                body: `<label><input type="checkbox" role="switch" name="restock_enabled" value="true"${restockChecked} /> Restock the grocery list</label>
            ${field({
                id: "restock_weekday",
                label: "Check on",
                control: weekdaySelect(
                    "restock_weekday",
                    "restock_weekday",
                    form.restockWeekday,
                    keepInvalid,
                ),
            })}
            ${field({
                id: "restock_time",
                label: "at",
                control: restockTimeInput(form.restockTime, keepInvalid),
            })}
            <p class="muted">${escapeHtml(RESTOCK_HELP)}</p>
            <button type="submit" class="btn-primary">Save</button>`,
            })}
        </form>
    `;
}

export function renderHouseholdSettingsPrefsPage(
    view: HouseholdSettingsPageView,
): string {
    const keepInvalid = view.draft != null;
    const form = view.draft
        ? {
              timezone: view.draft.timezone,
              restockEnabled: view.draft.restockEnabled,
              restockWeekday: view.draft.restockWeekday,
              restockTime: view.draft.restockTime,
          }
        : {
              timezone: view.preferences.timezone,
              restockEnabled: view.preferences.restock.enabled,
              restockWeekday: String(view.preferences.restock.weekday),
              restockTime: view.preferences.restock.time,
          };

    const prefs: HouseholdPreferences = view.draft
        ? {
              ...view.preferences,
              timezone: form.timezone,
              restock: {
                  ...view.preferences.restock,
                  enabled: form.restockEnabled,
                  weekday: isRestockWeekday(Number(form.restockWeekday.trim()))
                      ? (Number(form.restockWeekday.trim()) as
                            0 | 1 | 2 | 3 | 4 | 5 | 6)
                      : DEFAULT_RESTOCK.weekday,
                  time: form.restockTime,
              },
          }
        : view.preferences;

    const body = canManageHousehold(view.member)
        ? editableBody(view, form, keepInvalid)
        : readOnlyBody(view, prefs);

    return renderSettingsShell({
        title: "Household",
        theme: view.chrome.theme,
        backHref: view.backHref,
        body,
    });
}

export function ownerTimezoneLabelForSelect(
    ownerProfile: { timezone: string | null } | null | undefined,
): string {
    return householdTimezone({ timezone: null }, ownerProfile);
}
