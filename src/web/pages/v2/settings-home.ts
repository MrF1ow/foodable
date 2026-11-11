import type { AppChromeBase } from "../../attention.js";
import {
    renderSettingsV2Page,
    settingsDesktopHomePane,
} from "./settings-shared.js";

export type SettingsHomeV2View = {
    chrome: AppChromeBase;
    displayName: string;
    email: string;
    /** Raw `profiles.theme` (null = Auto) for the menu theme control. */
    storedTheme?: "light" | "dark" | null;
};

function roleLabel(role: string | undefined): string | undefined {
    if (!role) return undefined;
    return role.charAt(0).toUpperCase() + role.slice(1);
}

export function renderSettingsHomeV2Page(view: SettingsHomeV2View): string {
    const id = view.chrome.identity;
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "home",
        title: "Settings",
        profile: {
            displayName: view.displayName,
            email: view.email,
            roleLabel: roleLabel(id?.viewerRole),
            householdName: id?.householdName,
            memberCount: id?.memberCount,
        },
        storedTheme: view.storedTheme ?? null,
        body: settingsDesktopHomePane({
            householdName: id?.householdName,
            memberCount: id?.memberCount,
        }),
    });
}
