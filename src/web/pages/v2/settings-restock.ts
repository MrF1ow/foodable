/**
 * Settings › Household › Restock (FigCraft 411959): one list of rows, Weekly
 * restock (a switch), Day (a pull-down on the row) and Time (a time field on
 * the row that saves itself), then when it last ran. An owner or admin changes
 * them, each change posting on its own and coming back here with no toast;
 * everyone else reads the values.
 */
import type { AppChromeBase } from "../../attention.js";
import type { RestockPreferences } from "../../../household.js";
import { WEEKDAY_NAMES } from "../../../domain/weekdays.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menuRow } from "../../components/v2/menu.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
} from "./settings-shared.js";

export const RESTOCK_PATH = "/settings/household/restock";

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

/** The value of the Household page's Restock day row: `Sunday`, or Off. */
export function restockDayLabel(restock: RestockPreferences): string {
    return restock.enabled ? WEEKDAY_NAMES[restock.weekday] : "Off";
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

const WEEKDAY_KEYS = WEEKDAY_NAMES.map((_name, index) => index);

/** Day: the pull-down on the row; each day posts its number. */
function dayRow(restock: RestockPreferences): Html {
    return menuRow(
        {
            label: "Restock day",
            row: { title: "Day", value: WEEKDAY_NAMES[restock.weekday] },
            items: WEEKDAY_KEYS.map((index) => ({
                kind: "checked" as const,
                label: WEEKDAY_NAMES[index]!,
                checked: index === restock.weekday,
                action: RESTOCK_PATH,
                fields: { restock_weekday: String(index) },
            })),
        },
        "fd-restock__day",
    );
}

/** Time: a time field at the end of the row; leaving it with a new time saves. */
function timeRow(restock: RestockPreferences): Html {
    const control = raw(
        `<form class="fd-inline-form fd-restock__time" method="post" action="${RESTOCK_PATH}" data-fd-autosave><input class="fd-restock__time-input" type="time" name="restock_time" value="${esc(restock.time)}" required aria-label="Restock time" data-fd-autosave-input></form>`,
    );
    return itemRow({
        title: "Time",
        trailing: { kind: "control", html: control },
    });
}

export function renderSettingsRestockV2Body(
    view: SettingsRestockV2View,
): string {
    const { restock } = view;
    const title = "Weekly restock";
    const rows: Html[] = view.canManage
        ? [
              itemRow({
                  title,
                  trailing: {
                      kind: "toggle",
                      on: restock.enabled,
                      label: title,
                      form: {
                          action: RESTOCK_PATH,
                          fields: {
                              restock_enabled: restock.enabled ? "off" : "on",
                          },
                      },
                  },
              }),
              dayRow(restock),
              timeRow(restock),
          ]
        : [
              itemRow({ title, value: restock.enabled ? "On" : "Off" }),
              itemRow({ title: "Day", value: WEEKDAY_NAMES[restock.weekday] }),
              itemRow({
                  title: "Time",
                  value: restockTimeLabel(restock.time),
              }),
          ];
    return String(
        join([
            settingsErrorBanner(view.error),
            listGroup({ rows, label: "Restock" }),
            raw(
                `<p class="fd-restock__last-run" data-fd-restock-last-run>${esc(restockLastRunLabel(restock))}</p>`,
            ),
        ]),
    );
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
        className: "fd-restock",
        body: renderSettingsRestockV2Body(view),
    });
}

export const SETTINGS_RESTOCK_V2_MARKER = "data-fd-restock-last-run";
