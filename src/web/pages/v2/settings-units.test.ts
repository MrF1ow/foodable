import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    drinkUnitLabel,
    renderSettingsUnitsV2Body,
    renderSettingsUnitsV2Page,
    UNITS_DRINKS_SHEET_ID,
    UNITS_WEIGHT_SHEET_ID,
    weightUnitLabel,
} from "./settings-units.js";

const chrome = {
    theme: "light" as const,
    attention: { count: 0, tabs: {} },
    flags: FIXTURE_APP_CHROME_FLAGS,
    identity: {
        viewerName: "Ethan Flow",
        viewerRole: "owner" as const,
        householdName: "Flow",
        memberCount: 2,
    },
};

const view = { chrome, weightUnit: "lb" as const, drinkUnit: "us" as const };

describe("Settings › Units", () => {
    test("lists Weight and Drinks with their values, and no Water row", () => {
        const html = renderSettingsUnitsV2Body(view);
        expect(html).toContain("How Foodable shows amounts to you.");
        expect(html).toContain("What is already logged does not change.");
        expect(html).toMatch(/fd-row__title">Weight</);
        expect(html).toMatch(/fd-stores-pref__value">lb</);
        expect(html).toMatch(/fd-row__title">Drinks</);
        expect(html).toMatch(/fd-stores-pref__value">US drinks</);
        expect(html).not.toContain("Water");
    });

    test("rows are label, value and chevron, with no leading icon", () => {
        const html = renderSettingsUnitsV2Body(view);
        expect(html).not.toContain("fd-stores-pref__icon");
        // Each row button opens on its label (the chevron is the only icon).
        expect(
            html.match(
                /command="show-modal"><span class="fd-stores-pref__main"/g,
            ),
        ).toHaveLength(2);
        expect(html.match(/fd-row__chevron/g)).toHaveLength(2);
    });

    test("each row opens a sheet whose form posts the unit to /settings/units", () => {
        const html = renderSettingsUnitsV2Body(view);
        expect(html).toContain(`commandfor="${UNITS_WEIGHT_SHEET_ID}"`);
        expect(html).toContain(`commandfor="${UNITS_DRINKS_SHEET_ID}"`);
        expect(html.match(/action="\/settings\/units"/g)).toHaveLength(2);
        expect(html).toContain('name="preferred_weight_unit"');
        expect(html).toContain('name="preferred_drink_unit"');
        // The stored choice is the selected option; "Not set" clears it.
        expect(html).toMatch(/<option value="lb" selected>lb</);
        expect(html).toMatch(/<option value="us" selected>US drinks</);
        expect(html).toContain('<option value="">Not set</option>');
        // No full-page reload: only Account and Display opt out of Turbo.
        expect(html).not.toContain("data-turbo");
    });

    test("a unit never chosen reads Not set", () => {
        expect(weightUnitLabel("")).toBe("Not set");
        expect(drinkUnitLabel("")).toBe("Not set");
        expect(drinkUnitLabel("uk")).toBe("UK units");
        const html = renderSettingsUnitsV2Body({
            ...view,
            weightUnit: "",
            drinkUnit: "",
        });
        expect(html).toContain('<option value="" selected>Not set</option>');
        expect(html.match(/fd-stores-pref__value">Not set</g)).toHaveLength(2);
    });

    test("an error reopens its sheet and shows inside it", () => {
        const html = renderSettingsUnitsV2Body({
            ...view,
            error: "Choose kg or lb.",
            openSheet: UNITS_WEIGHT_SHEET_ID,
        });
        expect(html).toContain("data-sheet-open-on-load");
        expect(html.match(/Choose kg or lb\./g)).toHaveLength(1);
        const sheet = html.slice(html.indexOf(`id="${UNITS_WEIGHT_SHEET_ID}"`));
        expect(sheet.indexOf("Choose kg or lb.")).toBeGreaterThan(-1);
    });

    test("the page is the Units section", () => {
        const html = renderSettingsUnitsV2Page(view);
        expect(html).toContain('data-fd-settings-page="units"');
        expect(html).toContain("<title>Units</title>");
    });
});
