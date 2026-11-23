import { describe, expect, test } from "bun:test";
import { NOTIFICATION_KINDS } from "../../../domain/notification-kinds.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { AppChromeBase } from "../../attention.js";
import {
    renderSettingsNotificationsV2Body,
    renderSettingsNotificationsV2Page,
    type SettingsNotificationsV2View,
} from "./settings-notifications.js";

const CHROME: AppChromeBase = {
    theme: "light",
    flags: FIXTURE_APP_CHROME_FLAGS,
    identity: {
        viewerName: "Ethan Flow",
        viewerRole: "owner",
        householdName: "The Flow household",
        memberCount: 3,
    },
};

function view(
    over: Partial<SettingsNotificationsV2View> = {},
): SettingsNotificationsV2View {
    return { chrome: CHROME, prefs: [], ...over };
}

/** The `<li>` of one kind's row. */
function rowOf(html: string, kind: string): string {
    const from = html.indexOf(`id="notification-kind-${kind}"`);
    expect(from).toBeGreaterThan(-1);
    return html.slice(from, html.indexOf("</li>", from));
}

const titles = (html: string) =>
    [...html.matchAll(/class="fd-item-row__title"[^>]*>([^<]*)</g)].map(
        (m) => m[1],
    );

describe("Settings › Notifications", () => {
    test("two sections, the base kinds and then the extras, in the design's words and order", () => {
        const html = renderSettingsNotificationsV2Body(view());
        const heads = [
            ...html.matchAll(/class="fd-section-header__label">([^<]*)<\/h2>/g),
        ].map((m) => m[1]);
        expect(heads).toEqual([
            "Base · on unless you turn them off",
            "Extras · off unless you turn them on",
        ]);
        expect(titles(html)).toEqual([
            "Food expiring",
            "Running low",
            "Weigh-in due",
            "Recipe changes by others",
            "Week plan changes",
            "New usual products",
        ]);
    });

    test("Allergens has no row, no switch and no section: it cannot be turned off", () => {
        expect(NOTIFICATION_KINDS.allergens.canDisable).toBe(false);
        const html = renderSettingsNotificationsV2Page(view());
        expect(html).not.toContain("notification-kind-allergens");
        expect(html).not.toContain('value="allergens"');
        expect(html).not.toContain("ALWAYS ON");
        expect(html).not.toMatch(/fd-item-row__title"[^>]*>Allergens</);
    });

    test("a kind with no saved choice is at its default: the base on, the extras off", () => {
        const html = renderSettingsNotificationsV2Body(view());
        for (const kind of ["food_expiring", "running_low", "weigh_in_due"]) {
            expect(rowOf(html, kind)).toContain('aria-checked="true"');
        }
        for (const kind of [
            "recipe_changes",
            "week_plan_changes",
            "new_usuals",
        ]) {
            expect(rowOf(html, kind)).toContain('aria-checked="false"');
        }
    });

    test("a saved choice wins over the default, either way", () => {
        const html = renderSettingsNotificationsV2Body(
            view({
                prefs: [
                    { kind: "running_low", enabled: false },
                    { kind: "new_usuals", enabled: true },
                ],
            }),
        );
        expect(rowOf(html, "running_low")).toContain('aria-checked="false"');
        expect(rowOf(html, "new_usuals")).toContain('aria-checked="true"');
        expect(rowOf(html, "food_expiring")).toContain('aria-checked="true"');
    });

    test("each row says who gets it: Household, or Just you for the weigh-in", () => {
        const html = renderSettingsNotificationsV2Body(view());
        const sub = (kind: string) =>
            rowOf(html, kind).match(
                /class="fd-item-row__subtitle">([^<]*)</,
            )?.[1];
        expect(sub("food_expiring")).toBe("Household");
        expect(sub("running_low")).toBe("Household");
        expect(sub("weigh_in_due")).toBe("Just you");
        expect(sub("recipe_changes")).toBe("Household");
        expect(sub("week_plan_changes")).toBe("Household");
        expect(sub("new_usuals")).toBe("Household");
    });

    test("every switch is its own autosaving form that posts the value it moves to and returns here", () => {
        const html = renderSettingsNotificationsV2Body(
            view({ prefs: [{ kind: "running_low", enabled: false }] }),
        );
        const forms = html.match(/<form [^>]*>/g) ?? [];
        expect(forms).toHaveLength(6);
        for (const form of forms) {
            expect(form).toContain('data-fd-autosave="form"');
            expect(form).toContain('method="post"');
            expect(form).toContain('action="/settings/notifications"');
        }
        const on = rowOf(html, "food_expiring");
        expect(on).toContain(
            '<input type="hidden" name="kind" value="food_expiring">',
        );
        expect(on).toContain(
            '<input type="hidden" name="enabled" value="false">',
        );
        expect(on).toContain(
            '<input type="hidden" name="return" value="/settings/notifications">',
        );
        const off = rowOf(html, "running_low");
        expect(off).toContain(
            '<input type="hidden" name="enabled" value="true">',
        );
        // The button carries no name or value of its own: a save sent by the
        // script has no submitter, and the hidden field says it.
        expect(on).toMatch(/<button type="submit"[^>]*role="switch"/);
        expect(on).not.toMatch(/<button[^>]*\sname=/);
    });

    test("each switch is named after its kind", () => {
        const html = renderSettingsNotificationsV2Body(view());
        expect(rowOf(html, "recipe_changes")).toContain(
            'aria-label="Recipe changes by others"',
        );
    });

    test("a refused save is said in place, above the rows", () => {
        const html = renderSettingsNotificationsV2Body(
            view({ error: "Allergen notifications can't be turned off." }),
        );
        expect(html).toContain('role="alert"');
        expect(html.indexOf('role="alert"')).toBeLessThan(
            html.indexOf("notification-kind-food_expiring"),
        );
    });

    test("it renders inside the Settings shell with Notifications current and no toast", () => {
        const html = renderSettingsNotificationsV2Page(view());
        expect(html).toContain('data-fd-settings-page="notifications"');
        expect(html).toMatch(
            /href="\/settings\/notifications" aria-current="page"/,
        );
        expect(html).toContain("fd-settings-back");
        expect(html).not.toContain("data-fd-toast");
    });
});

describe("spacing", () => {
    test("12 px from a section's header to its rows, and the second section 12 px lower", async () => {
        const css = await Bun.file("public/app/v2/settings.css").text();
        expect(css).toMatch(
            /\.fd-notification-settings__section \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*gap: var\(--space-md\);/,
        );
        expect(css).toMatch(
            /\.fd-notification-settings__section \+ \.fd-notification-settings__section \{\s*margin-top: var\(--space-md\);/,
        );
        // The rows' sections carry that class.
        expect(
            renderSettingsNotificationsV2Body(view()).match(
                /class="fd-notification-settings__section"/g,
            ),
        ).toHaveLength(2);
    });
});
