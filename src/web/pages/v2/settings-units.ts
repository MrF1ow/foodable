import type { AppChromeBase } from "../../attention.js";
import { DRINK_UNITS, type DrinkUnit } from "../../../alcohol.js";
import { WEIGHT_UNITS, type WeightUnit } from "../../../domain/units.js";
import { esc, type Html } from "../../components/v2/html.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
    settingsField,
} from "./settings-shared.js";
import {
    householdEditSheet,
    householdRow,
    householdRowCard,
} from "./settings-household-rows.js";

export const UNITS_PATH = "/settings/units";
export const UNITS_INTRO =
    "How Foodable shows amounts to you. What is already logged does not change.";

export const UNITS_WEIGHT_SHEET_ID = "fd-units-weight";
export const UNITS_DRINKS_SHEET_ID = "fd-units-drinks";

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
    /** A 4xx re-render reopens this sheet with the error inside it. */
    openSheet?: typeof UNITS_WEIGHT_SHEET_ID | typeof UNITS_DRINKS_SHEET_ID;
};

/** What the Weight row shows. */
export function weightUnitLabel(unit: WeightUnit | ""): string {
    return unit === "" ? "Not set" : unit;
}

/** What the Drinks row shows. */
export function drinkUnitLabel(unit: DrinkUnit | ""): string {
    return unit === "" ? "Not set" : DRINK_LABELS[unit];
}

function unitSelect(opts: {
    id: string;
    name: string;
    selected: string;
    values: readonly string[];
    labels: (value: string) => string;
}): string {
    const blank = `<option value=""${opts.selected === "" ? " selected" : ""}>Not set</option>`;
    const options = opts.values
        .map(
            (value) =>
                `<option value="${esc(value)}"${value === opts.selected ? " selected" : ""}>${esc(opts.labels(value))}</option>`,
        )
        .join("");
    return `<select class="fd-settings-select" id="${esc(opts.id)}" name="${esc(opts.name)}">${blank}${options}</select>`;
}

function sheets(view: SettingsUnitsV2View): string {
    const weight = householdEditSheet({
        id: UNITS_WEIGHT_SHEET_ID,
        title: "Weight",
        action: UNITS_PATH,
        fields: String(
            settingsField({
                id: "preferred_weight_unit",
                label: "Weight unit",
                control: unitSelect({
                    id: "preferred_weight_unit",
                    name: "preferred_weight_unit",
                    selected: view.weightUnit,
                    values: WEIGHT_UNITS,
                    labels: (v) => v,
                }),
            }),
        ),
        error:
            view.openSheet === UNITS_WEIGHT_SHEET_ID ? view.error : undefined,
        open: view.openSheet === UNITS_WEIGHT_SHEET_ID,
    });
    const drinks = householdEditSheet({
        id: UNITS_DRINKS_SHEET_ID,
        title: "Drinks",
        action: UNITS_PATH,
        fields: String(
            settingsField({
                id: "preferred_drink_unit",
                label: "Drink unit",
                control: unitSelect({
                    id: "preferred_drink_unit",
                    name: "preferred_drink_unit",
                    selected: view.drinkUnit,
                    values: DRINK_UNITS,
                    labels: (v) => DRINK_LABELS[v as DrinkUnit],
                }),
            }),
        ),
        error:
            view.openSheet === UNITS_DRINKS_SHEET_ID ? view.error : undefined,
        open: view.openSheet === UNITS_DRINKS_SHEET_ID,
    });
    return `${weight}${drinks}`;
}

export function renderSettingsUnitsV2Body(view: SettingsUnitsV2View): string {
    const rows: Html[] = [
        householdRow({
            label: "Weight",
            value: weightUnitLabel(view.weightUnit),
            sheetId: UNITS_WEIGHT_SHEET_ID,
        }),
        householdRow({
            label: "Drinks",
            value: drinkUnitLabel(view.drinkUnit),
            sheetId: UNITS_DRINKS_SHEET_ID,
        }),
    ];
    // An error with no sheet to show it in sits under the intro.
    const banner = view.openSheet
        ? ""
        : String(settingsErrorBanner(view.error));
    return `<div class="fd-units fd-stores" data-fd-units><p class="fd-stores-intro">${esc(UNITS_INTRO)}</p>${banner}${String(householdRowCard(rows, "Units"))}${sheets(view)}</div>`;
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
