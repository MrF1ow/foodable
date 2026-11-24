import type { AppChromeBase } from "../../attention.js";
import type { HideableNutrient } from "../../../db/profiles.js";
import { join, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { renderHouseholdLayout } from "./settings-household-layout.js";
import { settingsErrorBanner } from "./settings-shared.js";

/**
 * Settings › Nutrients shown (FigCraft 418301, Light and desktop twins): one
 * switch a nutrient. Each switch is its own form and posts the opposite of what
 * it shows, coming back here with no toast.
 */
export const NUTRIENTS_PATH = "/settings/nutrients";

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
    { nutrient: "fiber", sub: "At least" },
    { nutrient: "sugar", sub: "At most" },
    { nutrient: "caffeine", sub: "At most" },
    { nutrient: "alcohol", sub: "At most" },
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
    return itemRow({
        title: label,
        subtitle: sub,
        trailing: {
            kind: "toggle",
            on: shown,
            label,
            form: {
                action: NUTRIENTS_PATH,
                fields: { nutrient, shown: shown ? "0" : "1" },
            },
        },
    });
}

export function renderSettingsNutrientsV2Body(
    view: SettingsNutrientsV2View,
): string {
    const rows = ROWS.map((r) => nutrientRow(view, r.nutrient, r.sub));
    return String(
        join([
            settingsErrorBanner(view.error),
            sectionHeader({
                label: "Limits and minimums",
                rule: false,
            }),
            listGroup({
                rows,
                label: "Nutrients shown",
                data: { "fd-nutrients": "" },
            }),
        ]),
    );
}

export function renderSettingsNutrientsV2Page(
    view: SettingsNutrientsV2View,
): string {
    return renderHouseholdLayout({
        chrome: view.chrome,
        page: "nutrients",
        title: "Nutrients shown",
        body: renderSettingsNutrientsV2Body(view),
    });
}

export const SETTINGS_NUTRIENTS_V2_MARKER = "data-fd-nutrients";
