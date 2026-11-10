import type { AppChromeBase } from "../../attention.js";
import { renderSettingsV2Page } from "./settings-shared.js";

export type SettingsHomeV2View = {
    chrome: AppChromeBase;
    displayName: string;
    email: string;
};

export function renderSettingsHomeV2Page(view: SettingsHomeV2View): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "home",
        title: "Settings",
        profile: {
            displayName: view.displayName,
            email: view.email,
        },
        homeHouseholdCard: true,
        body: "",
    });
}
