import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    isSwitchableNutrient,
    nutrientShown,
    renderSettingsNutrientsV2Body,
    renderSettingsNutrientsV2Page,
} from "./settings-nutrients.js";

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

function switchOf(html: string, label: string) {
    const form = html.match(
        new RegExp(
            `<form[^>]*>(?:(?!</form>).)*aria-label="${label}"(?:(?!</form>).)*</form>`,
            "s",
        ),
    )?.[0];
    if (!form) throw new Error(`no switch for ${label}`);
    return {
        form,
        checked: /aria-checked="true"/.test(form),
        posts: form.match(/name="shown" value="(\d)"/)?.[1],
        nutrient: form.match(/name="nutrient" value="(\w+)"/)?.[1],
    };
}

describe("Settings › Nutrients shown", () => {
    test("four switches in the design's order, with no intro", () => {
        const html = renderSettingsNutrientsV2Body({
            chrome,
            hidden: [],
            alcoholTrackingEnabled: false,
        });
        expect(html).not.toContain(
            "What Today and the chat cards show besides calories and macros.",
        );
        expect(html).toContain("Limits and minimums");
        const order = ["Fiber", "Sugar", "Caffeine", "Alcohol"].map((l) =>
            html.indexOf(`fd-item-row__title" title="${l}"`),
        );
        expect(order.every((i) => i > -1)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(html).toContain(">At least<");
        expect(html.match(/>At most</g)).toHaveLength(3);
        expect(html).not.toContain("from your goals");
        expect(html).not.toContain("logged drinks stay");
        // Item rows in a List group, not the old pref rows.
        expect(html).toContain("fd-list-group");
        expect(html).not.toContain("fd-stores-pref");
    });

    test("a switch shows the member's state and posts the opposite", () => {
        const html = renderSettingsNutrientsV2Body({
            chrome,
            hidden: ["sugar"],
            alcoholTrackingEnabled: false,
        });
        expect(switchOf(html, "Fiber")).toMatchObject({
            checked: true,
            posts: "0",
            nutrient: "fiber",
        });
        expect(switchOf(html, "Sugar")).toMatchObject({
            checked: false,
            posts: "1",
            nutrient: "sugar",
        });
        expect(switchOf(html, "Caffeine").checked).toBe(true);
        expect(switchOf(html, "Alcohol")).toMatchObject({
            checked: false,
            posts: "1",
            nutrient: "alcohol",
        });
        const on = renderSettingsNutrientsV2Body({
            chrome,
            hidden: [],
            alcoholTrackingEnabled: true,
        });
        expect(switchOf(on, "Alcohol").checked).toBe(true);
    });

    test("every switch is its own form to /settings/nutrients, with Turbo left on", () => {
        const html = renderSettingsNutrientsV2Body({
            chrome,
            hidden: [],
            alcoholTrackingEnabled: false,
        });
        expect(html.match(/action="\/settings\/nutrients"/g)).toHaveLength(4);
        expect(html).not.toContain("data-turbo");
    });

    test("nutrientShown reads alcohol from its opt-in and the rest from the list", () => {
        const base = { hidden: ["caffeine" as const] };
        expect(
            nutrientShown({ ...base, alcoholTrackingEnabled: true }, "alcohol"),
        ).toBe(true);
        expect(
            nutrientShown(
                { ...base, alcoholTrackingEnabled: false },
                "caffeine",
            ),
        ).toBe(false);
        expect(
            nutrientShown({ ...base, alcoholTrackingEnabled: false }, "fiber"),
        ).toBe(true);
    });

    test("isSwitchableNutrient names the four and nothing else", () => {
        for (const n of ["fiber", "sugar", "caffeine", "alcohol"]) {
            expect(isSwitchableNutrient(n)).toBe(true);
        }
        for (const n of ["protein", "Sugar", "", undefined, 3]) {
            expect(isSwitchableNutrient(n)).toBe(false);
        }
    });

    test("the page is the Nutrients section", () => {
        const html = renderSettingsNutrientsV2Page({
            chrome,
            hidden: [],
            alcoholTrackingEnabled: false,
        });
        expect(html).toContain('data-fd-settings-page="nutrients"');
        expect(html).toContain("<title>Nutrients shown</title>");
    });
});
