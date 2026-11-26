/**
 * Settings › Units (FigCraft 418048, Light and desktop twins): two rows, Weight
 * and Drinks, each a pull-down on the row. Choosing a value posts it and comes
 * back here with no toast; "Not set" clears the choice. Anyone signed in changes
 * their own units. What is already logged does not change.
 */
import type { AppChromeBase } from "../../attention.js";
import { DRINK_UNITS, type DrinkUnit } from "../../../alcohol.js";
import { WEIGHT_UNITS, type WeightUnit } from "../../../domain/units.js";
import { join, raw, type Html } from "../../components/v2/html.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menuRow } from "../../components/v2/menu.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
} from "./settings-shared.js";

export const UNITS_PATH = "/settings/units";

const DRINK_LABELS: Record<DrinkUnit, string> = {
    us: "US drinks",
    uk: "UK units",
};

export type SettingsUnitsV2View = {
    chrome: AppChromeBase;
    /** `""` means never chosen. */
    weightUnit: WeightUnit | "";
    drinkUnit: DrinkUnit | "";
    error?: string;
};

/** What the Weight row shows. */
export function weightUnitLabel(unit: WeightUnit | ""): string {
    return unit === "" ? "Not set" : unit;
}

/** What the Drinks row shows. */
export function drinkUnitLabel(unit: DrinkUnit | ""): string {
    return unit === "" ? "Not set" : DRINK_LABELS[unit];
}

/** One row with a pull-down: each choice posts its field and value. */
function unitRow(opts: {
    title: string;
    field: "preferred_weight_unit" | "preferred_drink_unit";
    selected: string;
    value: string;
    choices: readonly { value: string; label: string }[];
}): Html {
    const choose = (value: string, label: string) => ({
        kind: "checked" as const,
        label,
        checked: value === opts.selected,
        // The value already chosen only closes the menu: picking it posts nothing.
        current: value === opts.selected,
        action: UNITS_PATH,
        fields: { [opts.field]: value },
    });
    return menuRow({
        label: opts.title,
        row: { title: opts.title, value: opts.value },
        items: [
            choose("", "Not set"),
            ...opts.choices.map((c) => choose(c.value, c.label)),
        ],
    });
}

export function renderSettingsUnitsV2Body(view: SettingsUnitsV2View): string {
    const rows: Html[] = [
        unitRow({
            title: "Weight",
            field: "preferred_weight_unit",
            selected: view.weightUnit,
            value: weightUnitLabel(view.weightUnit),
            choices: WEIGHT_UNITS.map((unit) => ({
                value: unit,
                label: unit,
            })),
        }),
        unitRow({
            title: "Drinks",
            field: "preferred_drink_unit",
            selected: view.drinkUnit,
            value: drinkUnitLabel(view.drinkUnit),
            choices: DRINK_UNITS.map((unit) => ({
                value: unit,
                label: DRINK_LABELS[unit],
            })),
        }),
    ];
    return String(
        join([
            settingsErrorBanner(view.error),
            listGroup({ rows, label: "Units", data: { "fd-units": "" } }),
        ]),
    );
}

export function renderSettingsUnitsV2Page(view: SettingsUnitsV2View): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "units",
        title: "Units",
        body: renderSettingsUnitsV2Body(view),
    });
}

export const SETTINGS_UNITS_V2_MARKER = "data-fd-units";
