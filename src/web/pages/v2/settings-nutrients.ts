import type { AppChromeBase } from "../../attention.js";
import type { HideableNutrient } from "../../../db/profiles.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { sectionHeader } from "../../components/v2/rows.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
} from "./settings-shared.js";
import { householdRowCard } from "./settings-household-rows.js";

export const NUTRIENTS_PATH = "/settings/nutrients";
export const NUTRIENTS_INTRO =
    "What Today and the chat cards show besides calories and macros.";

/** What a switch can name: the three hideable nutrients and alcohol. */
export const SWITCHABLE_NUTRIENTS = [
    "fiber",
    "sugar",
    "caffeine",
    "alcohol",
] as const;
export type SwitchableNutrient = (typeof SWITCHABLE_NUTRIENTS)[number];

export function isSwitchableNutrient(
    value: unknown,
): value is SwitchableNutrient {
    return (
        typeof value === "string" &&
        (SWITCHABLE_NUTRIENTS as readonly string[]).includes(value)
    );
}

const ROWS: readonly { nutrient: SwitchableNutrient; sub: string }[] = [
    { nutrient: "fiber", sub: "At least, from your goals" },
    { nutrient: "sugar", sub: "At most, from your goals" },
    { nutrient: "caffeine", sub: "At most, from your goals" },
    { nutrient: "alcohol", sub: "Off hides it; logged drinks stay" },
];

const LABELS: Record<SwitchableNutrient, string> = {
    fiber: "Fiber",
    sugar: "Sugar",
    caffeine: "Caffeine",
    alcohol: "Alcohol",
};

export type SettingsNutrientsV2View = {
    chrome: AppChromeBase;
    /** Switched off by this member (never includes alcohol). */
    hidden: readonly HideableNutrient[];
    alcoholTrackingEnabled: boolean;
    error?: string;
};

/** Whether a nutrient's switch reads On for this member. */
export function nutrientShown(
    view: Pick<SettingsNutrientsV2View, "hidden" | "alcoholTrackingEnabled">,
    nutrient: SwitchableNutrient,
): boolean {
    return nutrient === "alcohol"
        ? view.alcoholTrackingEnabled
        : !view.hidden.includes(nutrient);
}

function nutrientRow(
    view: SettingsNutrientsV2View,
    nutrient: SwitchableNutrient,
    sub: string,
): Html {
    const label = LABELS[nutrient];
    const shown = nutrientShown(view, nutrient);
    // Each switch is its own form and posts the opposite of what it shows.
    return raw(
        `<li class="fd-row fd-row--stores-pref"><div class="fd-row__body fd-stores-pref"><span class="fd-stores-pref__main"><span class="fd-row__title">${esc(label)}</span><span class="fd-row__sub">${esc(sub)}</span></span><form method="post" action="${NUTRIENTS_PATH}" class="fd-inline-form"><input type="hidden" name="nutrient" value="${nutrient}" /><input type="hidden" name="shown" value="${shown ? "0" : "1"}" /><button type="submit" class="fd-switch" role="switch" aria-checked="${shown ? "true" : "false"}" aria-label="${esc(label)}"><span class="fd-switch__knob" aria-hidden="true"></span></button></form></div></li>`,
    );
}

export function renderSettingsNutrientsV2Body(
    view: SettingsNutrientsV2View,
): string {
    const rows = ROWS.map((r) => nutrientRow(view, r.nutrient, r.sub));
    return `<div class="fd-nutrients fd-stores" data-fd-nutrients><p class="fd-stores-intro">${esc(NUTRIENTS_INTRO)}</p>${String(settingsErrorBanner(view.error))}${String(sectionHeader({ title: "Limits and minimums", level: 2 }))}${String(householdRowCard(rows, "Nutrients shown"))}</div>`;
}

export function renderSettingsNutrientsV2Page(
    view: SettingsNutrientsV2View,
): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "nutrients",
        title: "Nutrients shown",
        body: renderSettingsNutrientsV2Body(view),
    });
}

export const SETTINGS_NUTRIENTS_V2_MARKER = "data-fd-nutrients";
