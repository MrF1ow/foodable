import type { AppChromeBase } from "../../attention.js";
import type { RestockPreferences } from "../../../household.js";
import { WEEKDAY_NAMES } from "../../../domain/weekdays.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
    settingsField,
    settingsPrimarySubmit,
} from "./settings-shared.js";
import {
    householdRow,
    householdRowCard,
    ROW_ICONS,
    switchForm,
} from "./settings-household-rows.js";

export const RESTOCK_PATH = "/settings/household/restock";
export const RESTOCK_INTRO =
    "On the restock day Foodable adds food that is about to expire and the usuals that are due to the grocery list.";

export type SettingsRestockV2View = {
    chrome: AppChromeBase;
    restock: RestockPreferences;
    /** Owners and admins edit; members only read. */
    canManage: boolean;
    error?: string;
};

/** `07:00` → `7:00 AM`. */
export function restockTimeLabel(time: string): string {
    const [h = "0", m = "00"] = time.split(":");
    const hour = Number(h);
    const suffix = hour >= 12 ? "PM" : "AM";
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    return `${twelve}:${m} ${suffix}`;
}

/** The value of the Household row: `Sunday, 9:00 AM`, or Off. */
export function restockSummary(restock: RestockPreferences): string {
    if (!restock.enabled) return "Off";
    return `${WEEKDAY_NAMES[restock.weekday]}, ${restockTimeLabel(restock.time)}`;
}

function dateLabel(localDate: string): string {
    const d = new Date(`${localDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return localDate;
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    }).format(d);
}

/** "Last ran Jun 7 · added 3 usuals"; the date alone when the count is unknown. */
export function restockLastRunLabel(restock: RestockPreferences): string {
    if (!restock.lastRunOn) return "Hasn't run yet";
    const when = `Last ran ${dateLabel(restock.lastRunOn)}`;
    const added = restock.lastRunAdded;
    if (added == null) return when;
    return `${when} · added ${added} ${added === 1 ? "usual" : "usuals"}`;
}

function scheduleForm(restock: RestockPreferences): string {
    const days = WEEKDAY_NAMES.map(
        (name, index) =>
            `<option value="${index}"${index === restock.weekday ? " selected" : ""}>${esc(name)}</option>`,
    ).join("");
    const day = settingsField({
        id: "restock_weekday",
        label: "Day",
        control: `<select class="fd-settings-input" id="restock_weekday" name="restock_weekday">${days}</select>`,
    });
    const time = settingsField({
        id: "restock_time",
        label: "Time",
        control: `<input class="fd-settings-input" id="restock_time" name="restock_time" type="time" value="${esc(restock.time)}" required />`,
    });
    return `<form method="post" action="${RESTOCK_PATH}" class="fd-restock-form">${String(day)}${String(time)}${settingsPrimarySubmit("Save")}</form>`;
}

export function renderSettingsRestockV2Body(
    view: SettingsRestockV2View,
): string {
    const { restock } = view;
    const label = "Weekly restock";
    const switchRow = view.canManage
        ? raw(
              `<li class="fd-row fd-row--stores-pref"><div class="fd-row__body fd-stores-pref"><span class="fd-stores-pref__icon" aria-hidden="true">${ROW_ICONS.refresh}</span><span class="fd-stores-pref__main"><span class="fd-row__title">${esc(label)}</span><span class="fd-row__sub">${esc(restock.enabled ? "On" : "Off")}</span></span>${switchForm({ action: RESTOCK_PATH, name: "restock_enabled", on: restock.enabled, label })}</div></li>`,
          )
        : householdRow({
              icon: ROW_ICONS.refresh,
              label,
              value: restock.enabled ? "On" : "Off",
          });
    const rows: Html[] = [switchRow];
    if (!view.canManage) {
        rows.push(
            householdRow({
                icon: ROW_ICONS.calendar,
                label: "Restock day",
                value: restockSummary({ ...restock, enabled: true }),
            }),
        );
    }
    const schedule = view.canManage ? scheduleForm(restock) : "";
    const note = view.canManage
        ? ""
        : `<p class="fd-stores-hint">Only the owner or an admin can change this.</p>`;
    return `<div class="fd-restock fd-stores" data-fd-restock>${String(settingsErrorBanner(view.error))}<p class="fd-stores-intro">${esc(RESTOCK_INTRO)}</p>${String(householdRowCard(rows, "Restock"))}${schedule}<p class="fd-stores-hint" data-fd-restock-last-run>${esc(restockLastRunLabel(restock))}</p>${note}</div>`;
}

export function renderSettingsRestockV2Page(
    view: SettingsRestockV2View,
): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "household",
        title: "Restock",
        backHref: "/settings/household",
        backLabel: "Household",
        body: renderSettingsRestockV2Body(view),
    });
}

export const SETTINGS_RESTOCK_V2_MARKER = "data-fd-restock";
