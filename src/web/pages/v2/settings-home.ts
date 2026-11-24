/**
 * Settings home (FigCraft Screens › Settings and Desktop › Settings): the
 * profile card, then the rows that open each page. The phone stacks them under
 * a Detail bar; from 1024 px the Page layout puts the profile and the first
 * four rows in the left column and Preferences and Connect in the right.
 *
 * Two rows act in place: Display is a Segmented control that saves itself
 * (`data-fd-autosave="form"`, a Turbo form), and Export data posts and answers
 * with the download link, which is a full page load. Neither shows a toast.
 */
import type { AppChromeBase } from "../../attention.js";
import { memberAvatar } from "../../components/v2/avatar.js";
import { profileCard } from "../../components/v2/profile-card.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import type { IconName } from "../../components/v2/icon.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { segmented } from "../../components/v2/segmented.js";
import { APP_PATHS } from "../../route-map.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
} from "./settings-shared.js";

export type SettingsHomeV2View = {
    chrome: AppChromeBase;
    displayName: string;
    email: string;
    /** Raw `profiles.theme` (null = Auto) for the Display control. */
    storedTheme?: "light" | "dark" | null;
    /** A refused Display or Export post, said in place. */
    error?: string;
};

const THEME_OPTIONS = [
    { value: "system", label: "Auto" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
] as const;

export function themeChoiceValue(
    stored: string | null | undefined,
): (typeof THEME_OPTIONS)[number]["value"] {
    return stored === "light" || stored === "dark" ? stored : "system";
}

export function isValidDisplayTheme(
    raw: string,
): raw is (typeof THEME_OPTIONS)[number]["value"] {
    return raw === "system" || raw === "light" || raw === "dark";
}

function roleLabel(role: string | undefined): string | undefined {
    if (!role) return undefined;
    return role.charAt(0).toUpperCase() + role.slice(1);
}

function linkRow(
    title: string,
    href: string,
    icon: IconName,
    value?: string,
): Html {
    return itemRow({
        title,
        href,
        value,
        lead: { kind: "icon", name: icon },
        trailing: { kind: "chevron" },
    });
}

/** Display: the theme choice, saved when it changes. The post always answers
 *  with a 303 back to Settings, so it carries nothing to say where. */
function displayRow(stored: "light" | "dark" | null | undefined): Html {
    const selected = themeChoiceValue(stored);
    const control = raw(
        `<form class="fd-inline-form fd-settings-display" method="post" action="/settings/display" data-fd-autosave="form">${segmented(
            {
                label: "Appearance",
                name: "theme",
                size: "small",
                segments: THEME_OPTIONS.map((o) => ({
                    ...o,
                    selected: o.value === selected,
                })),
            },
        )}<noscript><button type="submit" class="fd-btn">Save</button></noscript></form>`,
    );
    return itemRow({
        title: "Display",
        lead: { kind: "icon", name: "sun" },
        trailing: { kind: "control", html: control },
    });
}

/** Export data: one POST, then a 303 to the download link. The response is a
 *  file's link, not a page Turbo can render, so the form is a full load. */
function exportRow(): Html {
    return itemRow({
        title: "Export data",
        value: "ZIP",
        lead: { kind: "icon", name: "download" },
        submit: {
            action: "/settings/export",
            formData: { turbo: "false" },
        },
    });
}

function section(label: string, rows: readonly Html[]): string {
    return `${String(sectionHeader({ label, rule: false }))}${String(listGroup({ rows, label }))}`;
}

export function renderSettingsHomeV2Page(view: SettingsHomeV2View): string {
    const id = view.chrome.identity;
    const members = id?.memberCount;
    const fields: { key: string; value: string | number | null }[] = [];
    if (id?.householdName)
        fields.push({ key: "Household", value: id.householdName });
    if (members != null && members > 0)
        fields.push({ key: "Members", value: members });
    const role = roleLabel(id?.viewerRole);
    if (role) fields.push({ key: "Role", value: role });
    const left = `${String(
        profileCard({
            name: view.displayName,
            email: view.email || undefined,
            // The picture, over the initials, when the member has set one.
            avatar: id?.viewerUserId
                ? memberAvatar({
                      name: view.displayName,
                      userId: id.viewerUserId,
                      version: id.avatarVersions?.get(id.viewerUserId) ?? null,
                      enabled: true,
                      className: "fd-avatar-initials",
                  })
                : undefined,
            fields,
        }),
    )}${String(settingsErrorBanner(view.error))}${String(
        listGroup({
            label: "Settings",
            rows: [
                linkRow("Account", APP_PATHS.settingsAccount, "user"),
                linkRow(
                    "Household & members",
                    APP_PATHS.settingsHousehold,
                    "users",
                    members != null && members > 0
                        ? String(members)
                        : undefined,
                ),
                linkRow("Goals", APP_PATHS.settingsGoals, "target"),
                linkRow(
                    "Saved foods & recipes",
                    APP_PATHS.settingsSaved,
                    "bookmark",
                ),
            ],
        }),
    )}`;
    const right = `${section("Preferences", [
        displayRow(view.storedTheme),
        linkRow("Units", APP_PATHS.settingsUnits, "ruler"),
        linkRow("Nutrients shown", APP_PATHS.settingsNutrients, "drop"),
        linkRow("Product score", APP_PATHS.settingsScore, "gauge"),
        linkRow("Notifications", APP_PATHS.settingsNotifications, "bell"),
    ])}${section("Connect", [
        linkRow("AI connections", APP_PATHS.settingsAi, "code"),
        linkRow("Help", APP_PATHS.settingsHelp, "help"),
        exportRow(),
    ])}`;
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "home",
        title: "Settings",
        className: "fd-settings--home fd-settings--flat",
        home: { left, right },
    });
}
