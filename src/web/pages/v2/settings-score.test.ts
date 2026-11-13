import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { SCORE_PRESETS } from "../../../domain/product-score.js";
import {
    DOLLAR_PAYLOADS,
    injectedAttributes,
} from "../../components/v2/test-helpers.js";
import {
    parseScoreForm,
    parseScoreIntent,
    renderSettingsScoreHouseholdV2Page,
    renderSettingsScoreV2Page,
    weightShares,
    type SettingsScoreV2View,
} from "./settings-score.js";

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

function view(over: Partial<SettingsScoreV2View> = {}): SettingsScoreV2View {
    return {
        chrome,
        preset: "balanced",
        weights: SCORE_PRESETS.balanced,
        followsHousehold: false,
        householdPresetLabel: "Balanced",
        canEditHousehold: false,
        warnTraces: true,
        compareGoals: true,
        allergensText: "Milk",
        allergensHref: "/settings/household/members/u1",
        ...over,
    };
}

const CUSTOM = {
    preset: "custom",
    weight_nutrition: "10",
    weight_processing: "70",
    weight_additives: "20",
    weight_environment: "0",
};

describe("parseScoreForm", () => {
    test("a preset ignores whatever the sliders hold", () => {
        const parsed = parseScoreForm({
            preset: "planet",
            weight_nutrition: "nonsense",
        });
        expect(parsed).toEqual({
            ok: true,
            choice: { preset: "planet", weights: null },
        });
    });

    test("custom takes four whole numbers", () => {
        expect(parseScoreForm(CUSTOM)).toEqual({
            ok: true,
            choice: {
                preset: "custom",
                weights: {
                    nutrition: 10,
                    processing: 70,
                    additives: 20,
                    environment: 0,
                },
            },
        });
    });

    test.each([
        [
            "zero-sum",
            {
                ...CUSTOM,
                weight_nutrition: "0",
                weight_processing: "0",
                weight_additives: "0",
            },
            "at least one part",
        ],
        ["above 100", { ...CUSTOM, weight_nutrition: "101" }, "0 to 100"],
        ["negative", { ...CUSTOM, weight_nutrition: "-1" }, "0 to 100"],
        ["fractional", { ...CUSTOM, weight_nutrition: "1.5" }, "0 to 100"],
        ["blank", { ...CUSTOM, weight_nutrition: "" }, "0 to 100"],
        ["exponent", { ...CUSTOM, weight_nutrition: "1e1" }, "0 to 100"],
        ["hex", { ...CUSTOM, weight_nutrition: "0x10" }, "0 to 100"],
        ["missing", { preset: "custom" }, "0 to 100"],
    ])(
        "custom with %s weights is refused and keeps the draft",
        (_n, body, text) => {
            const parsed = parseScoreForm(body);
            expect(parsed.ok).toBe(false);
            if (parsed.ok) return;
            expect(parsed.error).toContain(text);
            expect(parsed.draft.preset).toBe("custom");
        },
    );

    test("an unknown or missing preset is refused", () => {
        expect(parseScoreForm({ preset: "nope" }).ok).toBe(false);
        expect(parseScoreForm({}).ok).toBe(false);
    });
});

test("parseScoreIntent only knows the four saves", () => {
    for (const intent of [
        "choice",
        "household",
        "warn_traces",
        "compare_goals",
    ]) {
        expect(parseScoreIntent(intent)).toBe(intent as never);
    }
    expect(parseScoreIntent("clear")).toBeNull();
    expect(parseScoreIntent("")).toBeNull();
});

test("weightShares are each part's share of the total", () => {
    expect(weightShares(SCORE_PRESETS.balanced)).toEqual(
        SCORE_PRESETS.balanced,
    );
    expect(
        weightShares({
            nutrition: 10,
            processing: 10,
            additives: 0,
            environment: 0,
        }),
    ).toEqual({ nutrition: 50, processing: 50, additives: 0, environment: 0 });
    expect(
        weightShares({
            nutrition: 0,
            processing: 0,
            additives: 0,
            environment: 0,
        }),
    ).toEqual({ nutrition: 0, processing: 0, additives: 0, environment: 0 });
});

describe("the member page", () => {
    test("shows the preset chips, four sliders and both switches", () => {
        const html = renderSettingsScoreV2Page(view());
        for (const label of [
            "Balanced",
            "Health first",
            "Less processed",
            "Planet",
            "Custom",
            "Nutrition",
            "Processing",
            "Additives",
            "Environment",
            "Nutri-Score",
            "NOVA",
            "Risk tiers",
            "Green-Score",
        ]) {
            expect(html).toContain(`>${label}<`);
        }
        expect(html.match(/type="range"/g)).toHaveLength(4);
        expect(html.match(/role="switch"/g)).toHaveLength(2);
        expect(html).toContain('value="balanced" checked');
        expect(html).toContain("Milk · from your person rules");
        expect(html).toContain('href="/settings/household/members/u1"');
    });

    test("a refused save shows the error and the typed weights, not the saved ones", () => {
        const html = renderSettingsScoreV2Page(
            view({
                error: "Give at least one part a weight above 0.",
                draft: {
                    preset: "custom",
                    weights: {
                        nutrition: "0",
                        processing: "0",
                        additives: "0",
                        environment: "0",
                    },
                },
            }),
        );
        expect(html).toContain('role="alert"');
        expect(html).toContain("Give at least one part a weight above 0.");
        expect(html).toContain('value="custom" checked');
        expect(html).toContain('value="0" style="--fd-fill:0%"');
    });

    test("the switches post the opposite of their state", () => {
        const html = renderSettingsScoreV2Page(
            view({ warnTraces: false, compareGoals: true }),
        );
        expect(html).toMatch(
            /name="intent" value="warn_traces"><input type="hidden" name="value" value="1"/,
        );
        expect(html).toMatch(
            /name="intent" value="compare_goals"><input type="hidden" name="value" value="0"/,
        );
    });

    test("a member following the household sees the note, one with a choice sees the way back", () => {
        const following = renderSettingsScoreV2Page(
            view({ followsHousehold: true, householdPresetLabel: "Planet" }),
        );
        expect(following).toContain(
            "You are using the household default (Planet)",
        );
        expect(following).not.toContain('name="intent" value="household"');
        const own = renderSettingsScoreV2Page(
            view({ householdPresetLabel: "Planet" }),
        );
        expect(own).toContain('name="intent" value="household"');
        expect(own).toContain("Use household default (Planet)");
    });

    test("the household row links only for owners and admins", () => {
        const member = renderSettingsScoreV2Page(view());
        expect(member).toContain("fd-scoreset__household--static");
        expect(member).not.toContain("/settings/product-score/household");
        const admin = renderSettingsScoreV2Page(
            view({ canEditHousehold: true }),
        );
        expect(admin).toContain('href="/settings/product-score/household"');
        expect(admin).not.toContain("fd-scoreset__household--static");
    });

    test("allergen text from a member's rules is escaped", async () => {
        for (const payload of DOLLAR_PAYLOADS) {
            const html = renderSettingsScoreV2Page(
                view({ allergensText: payload }),
            );
            expect(await injectedAttributes(html)).toEqual([]);
        }
        const html = renderSettingsScoreV2Page(
            view({ allergensText: '<img src=x onerror="alert(1)">' }),
        );
        expect(html).not.toContain("<img src=x");
    });
});

describe("the household default page", () => {
    test("offers Clear only when a default is set", () => {
        const base = {
            chrome,
            preset: "planet" as const,
            weights: SCORE_PRESETS.planet,
        };
        const set = renderSettingsScoreHouseholdV2Page({
            ...base,
            isSet: true,
        });
        expect(set).toContain('value="clear"');
        expect(set).toContain('action="/settings/product-score/household"');
        const unset = renderSettingsScoreHouseholdV2Page({
            ...base,
            isSet: false,
        });
        expect(unset).not.toContain('value="clear"');
    });
});
