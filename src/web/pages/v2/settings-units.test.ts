import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    drinkUnitLabel,
    renderSettingsUnitsV2Body,
    renderSettingsUnitsV2Page,
    weightUnitLabel,
} from "./settings-units.js";

const chrome = {
    theme: "light" as const,
    flags: FIXTURE_APP_CHROME_FLAGS,
    identity: {
        viewerName: "Ethan Flow",
        viewerRole: "owner" as const,
        householdName: "Flow",
        memberCount: 2,
    },
};

const view = { chrome, weightUnit: "lb" as const, drinkUnit: "us" as const };

/** The pull-down of one row: its trigger's value and the choices it posts. */
function pullDown(html: string, title: string) {
    const menu = html.match(
        new RegExp(
            `<div class="fd-menu fd-menu--anchored fd-menu--row"[^>]*>(?:(?!<li ).)*?title="${title}"(?:(?!<li ).)*`,
            "s",
        ),
    )?.[0];
    if (!menu) throw new Error(`no pull-down for ${title}`);
    return {
        value: menu.match(/class="fd-item-row__value">([^<]*)</)?.[1],
        // The chosen value is a button that only closes the menu (nothing to
        // post); every other is a form of one hidden field and its button.
        choices: [
            ...menu.matchAll(
                /(?:<form class="fd-menu__form" method="post" action="([^"]+)"><input type="hidden" name="([^"]+)" value="([^"]*)">)?<button[^>]*aria-checked="(true|false)"[^>]*>.*?fd-menu__label">([^<]*)</gs,
            ),
        ].map((m) =>
            m[1] === undefined
                ? { current: true, checked: m[4] === "true", label: m[5] }
                : {
                      action: m[1],
                      name: m[2],
                      value: m[3],
                      checked: m[4] === "true",
                      label: m[5],
                  },
        ),
    };
}

describe("Settings › Units", () => {
    test("two rows, Weight and Drinks, with their values and no intro or Water row", () => {
        const html = renderSettingsUnitsV2Body(view);
        expect(html).not.toContain("How Foodable shows amounts to you.");
        expect(html).not.toContain("What is already logged does not change.");
        expect(html).not.toContain("Water");
        expect(pullDown(html, "Weight").value).toBe("lb");
        expect(pullDown(html, "Drinks").value).toBe("US drinks");
        expect(html.match(/fd-menu--row/g)).toHaveLength(2);
        // Pull-downs, not sheets: no dialog, no old row or select.
        expect(html).not.toContain("<dialog");
        expect(html).not.toContain("fd-settings-select");
        expect(html).not.toContain("fd-stores-pref");
    });

    test("each pull-down posts its unit to /settings/units and ticks the stored choice", () => {
        const html = renderSettingsUnitsV2Body(view);
        expect(pullDown(html, "Weight").choices).toEqual([
            {
                action: "/settings/units",
                name: "preferred_weight_unit",
                value: "",
                checked: false,
                label: "Not set",
            },
            {
                action: "/settings/units",
                name: "preferred_weight_unit",
                value: "kg",
                checked: false,
                label: "kg",
            },
            // Picking the unit already chosen posts nothing.
            { current: true, checked: true, label: "lb" },
        ]);
        expect(pullDown(html, "Drinks").choices).toEqual([
            {
                action: "/settings/units",
                name: "preferred_drink_unit",
                value: "",
                checked: false,
                label: "Not set",
            },
            { current: true, checked: true, label: "US drinks" },
            {
                action: "/settings/units",
                name: "preferred_drink_unit",
                value: "uk",
                checked: false,
                label: "UK units",
            },
        ]);
        // A save is a Turbo visit: nothing opts out.
        expect(html).not.toContain("data-turbo");
    });

    test("a unit never chosen reads Not set and ticks it", () => {
        expect(weightUnitLabel("")).toBe("Not set");
        expect(drinkUnitLabel("")).toBe("Not set");
        expect(drinkUnitLabel("uk")).toBe("UK units");
        const html = renderSettingsUnitsV2Body({
            ...view,
            weightUnit: "",
            drinkUnit: "",
        });
        expect(pullDown(html, "Weight").value).toBe("Not set");
        expect(pullDown(html, "Drinks").value).toBe("Not set");
        expect(
            pullDown(html, "Weight").choices.find((c) => c.checked)?.label,
        ).toBe("Not set");
    });

    test("a refused value says so above the rows", () => {
        const html = renderSettingsUnitsV2Body({
            ...view,
            error: "Choose kg or lb.",
        });
        expect(html.match(/Choose kg or lb\./g)).toHaveLength(1);
        expect(html.indexOf("Choose kg or lb.")).toBeLessThan(
            html.indexOf("fd-menu--row"),
        );
    });

    test("the page is the Units section", () => {
        const html = renderSettingsUnitsV2Page(view);
        expect(html).toContain('data-fd-settings-page="units"');
        expect(html).toContain("<title>Units</title>");
    });
});
