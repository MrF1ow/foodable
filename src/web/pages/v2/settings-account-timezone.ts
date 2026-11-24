/**
 * Settings › Account › Time zone (FigCraft Screens › Settings › time zone and
 * Desktop › Settings › time zone): a page with a search field over a list of
 * zones, one round choice each with its UTC offset. Choosing one saves it and
 * goes back to Account (303, no toast).
 *
 * With nothing typed the list is the zone the person has, then the common
 * ones; typing in the search field and pressing Enter shows what matches (a
 * GET with `q`, so it works with no script). The list is one form in a named
 * radio group. A tap or click on a row saves it at once (`data-fd-pick`,
 * client/shell.js); the arrow keys only move through the group, so a keyboard
 * or screen-reader user is never sent away by looking, and Enter saves the
 * checked row. With no script a Save button does.
 */
import type { AppChromeBase } from "../../attention.js";
import { emptyState } from "../../components/v2/empty-state.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { searchField } from "../../components/v2/search-field.js";
import { APP_PATHS } from "../../route-map.js";
import { renderHouseholdLayout } from "./settings-household-layout.js";
import { timeZoneOptions } from "./settings-household-rows.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
} from "./settings-shared.js";

/** The zones shown before anything is typed, after the person's own. */
export const COMMON_TIME_ZONES: readonly string[] = [
    "America/Los_Angeles",
    "America/Denver",
    "America/Chicago",
    "America/New_York",
    "Europe/London",
    "Europe/Kyiv",
    "Asia/Tokyo",
];

/** The most a search lists, so a one-letter query stays a short page. */
export const TIME_ZONE_SEARCH_LIMIT = 50;

/** "UTC−8", "UTC+0", "UTC+5:30": the zone's offset at `now`, as the design
 *  writes it (a true minus sign). */
export function utcOffsetLabel(zone: string, now: Date): string {
    let part: string | undefined;
    try {
        part = new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            timeZoneName: "shortOffset",
        })
            .formatToParts(now)
            .find((p) => p.type === "timeZoneName")?.value;
    } catch {
        return "";
    }
    const m = /^GMT(?:([+−-])(\d{1,2})(?::(\d{2}))?)?$/.exec(part ?? "");
    if (!m || !m[1]) return "UTC+0";
    return `UTC${m[1] === "+" ? "+" : "−"}${Number(m[2])}${m[3] ? `:${m[3]}` : ""}`;
}

function words(text: string): string[] {
    return text
        .toLowerCase()
        .replaceAll("_", " ")
        .replaceAll("/", " ")
        .split(/\s+/)
        .filter(Boolean);
}

/** The zones to list: the stored one then the common ones for an empty
 *  query, else every zone whose name holds all the typed words. */
export function timeZonesFor(stored: string, query: string): string[] {
    const typed = words(query);
    if (typed.length === 0) {
        const list = stored ? [stored] : [];
        for (const zone of COMMON_TIME_ZONES) {
            if (!list.includes(zone)) list.push(zone);
        }
        return list;
    }
    return timeZoneOptions(stored || null)
        .filter((zone) => {
            const name = words(zone).join(" ");
            return typed.every((w) => name.includes(w));
        })
        .slice(0, TIME_ZONE_SEARCH_LIMIT);
}

/** Settings › Household › Time zone: the household's zone, the same page. */
export const HOUSEHOLD_TIMEZONE_PATH = "/settings/household/timezone";

export type SettingsTimezoneV2View = {
    chrome: AppChromeBase;
    /**
     * The household's zone rather than the person's: a manager's page, saved
     * to the household (303 back to Household, no toast), with a first choice
     * that follows the owner's zone, which stores none.
     */
    household?: boolean;
    /** Where Settings sends the person back to (carried through the post). */
    backHref: string;
    /** The stored IANA zone, "" when none is set yet. */
    timezone: string;
    /** What the search field holds. */
    query?: string;
    /** A refused save, said in place. */
    error?: string;
    /** For the offsets; default now. */
    now?: Date;
};

function searchForm(query: string, household: boolean): Html {
    const action = household
        ? HOUSEHOLD_TIMEZONE_PATH
        : APP_PATHS.settingsTimezone;
    return raw(
        `<form class="fd-settings-tz-search" method="get" action="${esc(action)}" role="search" data-turbo-action="replace">${searchField(
            {
                label: "Search time zones",
                placeholder: "Search time zones",
                name: "q",
                value: query,
                clear: false,
            },
        )}</form>`,
    );
}

export function renderSettingsTimezoneV2Body(
    view: SettingsTimezoneV2View,
): string {
    const now = view.now ?? new Date();
    const query = (view.query ?? "").trim();
    const zones = timeZonesFor(view.timezone, query);
    const household = view.household === true;
    const rows = zones.map((zone) =>
        itemRow({
            title: zone,
            value: utcOffsetLabel(zone, now),
            lead: {
                kind: "radio",
                label: `${zone}, ${utcOffsetLabel(zone, now)}`,
                name: "timezone",
                value: zone,
                checked: zone === view.timezone,
            },
        }),
    );
    // The household's own choice to store no zone: it follows the owner's.
    if (household && query === "") {
        rows.unshift(
            itemRow({
                title: "Use the owner's time zone",
                lead: {
                    kind: "radio",
                    label: "Use the owner's time zone",
                    name: "timezone",
                    value: "",
                    checked: view.timezone === "",
                },
            }),
        );
    }
    const list =
        rows.length > 0
            ? String(listGroup({ rows, label: "Time zones" }))
            : String(emptyState({ title: "No time zone matches" }));
    // Only the zone is posted: the settings handler writes just what the form
    // carries, so units, alcohol and the widget switch keep their values.
    const choices = `<fieldset class="fd-settings-tz-group"><legend class="fd-visually-hidden">Time zone</legend>${list}</fieldset>`;
    const carried = household
        ? ""
        : `<input type="hidden" name="group" value="nutrition" /><input type="hidden" name="return" value="${esc(APP_PATHS.settingsAccount)}" /><input type="hidden" name="from" value="${esc(view.backHref)}" />`;
    const form = `<form class="fd-settings-tz-form" method="post" action="${household ? HOUSEHOLD_TIMEZONE_PATH : "/settings"}" data-fd-pick>${carried}${choices}<noscript><button type="submit" class="fd-btn">Save</button></noscript></form>`;
    return `${String(settingsErrorBanner(view.error))}${form}`;
}

export function renderSettingsTimezoneV2Page(
    view: SettingsTimezoneV2View,
): string {
    const query = (view.query ?? "").trim();
    if (view.household) {
        return renderHouseholdLayout({
            chrome: view.chrome,
            title: "Time zone",
            headerExtra: searchForm(query, true),
            className: "fd-settings--timezone",
            body: renderSettingsTimezoneV2Body(view),
        });
    }
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "timezone",
        title: "Time zone",
        backHref: APP_PATHS.settingsAccount,
        headerExtra: searchForm(query, false),
        className: "fd-settings--timezone fd-settings--flat",
        body: renderSettingsTimezoneV2Body(view),
    });
}
