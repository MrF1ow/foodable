import type {
    AppChrome,
    AppTabId,
    ThemePref,
    renderBarePage,
    renderSettingsPage,
} from "../web/shell.js";
import {
    DEFAULT_RESTOCK,
    EMPTY_HOUSEHOLD_PREFERENCES,
    type HouseholdMember,
} from "../household.js";
import type { renderSettingsPage as renderSettingsAccountPage } from "../web/pages/settings.js";
import type { renderSettingsHelpPage } from "../web/pages/settings-help.js";
import type { renderHouseholdSettingsPrefsPage } from "../web/pages/settings-household.js";
import { FIXTURE_APP_CHROME_FLAGS } from "./chrome-flags.js";

/** The old shell's renderers, as a case builder takes them, so one list of
 *  cases renders against the current code and against a copy of `main`'s. */
export type LegacyShellRenderers = {
    renderAppShell: (chrome: AppChrome) => string;
    renderBarePage: typeof renderBarePage;
    renderSettingsPage: typeof renderSettingsPage;
    /** The Settings section pages (src/web/pages/settings*.ts), whose
     *  sub-nav gains a Members link under `ui-v2`. */
    renderSettingsAccountPage: typeof renderSettingsAccountPage;
    renderSettingsHelpPage: typeof renderSettingsHelpPage;
    renderHouseholdSettingsPrefsPage: typeof renderHouseholdSettingsPrefsPage;
};

const OWNER: HouseholdMember = {
    householdId: "h1",
    userId: "u1",
    role: "owner",
    displayName: "Ethan",
} as HouseholdMember;

const ACTIVES: (AppTabId | "none")[] = [
    "nutrition",
    "fridge",
    "grocery",
    "recipes",
    "household",
    "none",
];

/** Rendered with `ui-v2` off. src/web/fixtures/shell-legacy.golden.json holds
 *  what `main` rendered for each case before the new shell existed. */
export function legacyShellCases(
    r: LegacyShellRenderers,
): Record<string, string> {
    const out: Record<string, string> = {};
    const themes: ThemePref[] = ["system", "light", "dark"];
    for (const active of ACTIVES) {
        for (const theme of themes) {
            out[`app-shell ${active} ${theme}`] = r.renderAppShell({
                title: `Page <${active}> & "more"`,
                active,
                theme,
                body: `<h1>${active}</h1><p>Body &amp; text</p>`,
                attention: { count: 0, tabs: {} },
                flags: FIXTURE_APP_CHROME_FLAGS,
            });
        }
    }
    out["app-shell attention dots"] = r.renderAppShell({
        title: "Dots",
        active: "fridge",
        theme: "system",
        body: "<h1>Dots</h1>",
        attention: {
            count: 3,
            tabs: { fridge: true, grocery: true, household: true },
        },
        flags: FIXTURE_APP_CHROME_FLAGS,
    });
    out["bare page"] = r.renderBarePage("Create household", "<h1>Hi</h1>");
    out["bare page dark"] = r.renderBarePage(
        "Forbidden",
        "<h1>No</h1>",
        "dark",
    );
    out["settings page"] = r.renderSettingsPage({
        title: "Settings",
        theme: "light",
        backHref: "/kitchen/fridge",
        body: "<h1>Settings</h1>",
    });
    // The Settings section pages with the flag off: the sub-nav keeps its
    // three entries. (`flags` is what the routes pass; main ignores it.)
    const flags = FIXTURE_APP_CHROME_FLAGS;
    for (const theme of ["light", "dark"] as const) {
        out[`settings account ${theme}`] = r.renderSettingsAccountPage({
            chrome: { theme },
            flags,
            backHref: "/kitchen/fridge",
            displayName: "Ethan <E>",
            timezone: "America/Los_Angeles",
            weightUnit: "kg",
            widgetsEnabled: true,
            alcoholTrackingEnabled: false,
            drinkUnit: "",
        });
        out[`settings help ${theme}`] = r.renderSettingsHelpPage({
            chrome: { theme },
            flags,
            backHref: "/",
        });
    }
    out["settings account error"] = r.renderSettingsAccountPage({
        chrome: { theme: "system" },
        flags,
        backHref: "/recipes",
        displayName: "",
        timezone: "",
        weightUnit: "",
        widgetsEnabled: false,
        alcoholTrackingEnabled: true,
        drinkUnit: "us",
        error: "Display name is too long",
    });
    out["settings household owner"] = r.renderHouseholdSettingsPrefsPage({
        chrome: { theme: "dark" },
        flags,
        backHref: "/kitchen/fridge",
        member: OWNER,
        preferences: {
            ...EMPTY_HOUSEHOLD_PREFERENCES,
            restock: { ...DEFAULT_RESTOCK, enabled: true },
        },
        ownerTimezoneLabel: "America/Los_Angeles",
    });
    out["settings household member"] = r.renderHouseholdSettingsPrefsPage({
        chrome: { theme: "light" },
        flags,
        backHref: "/",
        member: { ...OWNER, userId: "u2", role: "member" },
        preferences: EMPTY_HOUSEHOLD_PREFERENCES,
        ownerTimezoneLabel: "America/Los_Angeles",
    });
    return out;
}

/** Hashes (`?v=<12 hex>`) depend on which assets another test warmed first. */
export function stripAssetHashes(html: string): string {
    return html.replace(/\?v=[0-9a-f]{12}/g, "");
}
