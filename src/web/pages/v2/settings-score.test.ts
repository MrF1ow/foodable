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
    weightsForShare,
    type SettingsScoreV2View,
} from "./settings-score.js";

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

/** The page's own forms (the shell has a few of its own). */
const forms = (html: string) =>
    [...html.matchAll(/<form\b[^>]*>/g)].map((m) => m[0]);
const WEIGHT_ROWS = ["Nutrition", "Processing", "Additives", "Environment"];

describe("the member page", () => {
    test("shows the household switch, the preset chips, four weight rows with their shares and the checks", () => {
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
        expect(html).toContain("Use household default");
        expect(html).toContain('value="balanced" checked');
        // Each weight is a pull-down on its row: the share it has now.
        for (const [title, share] of [
            ["Nutrition", "40%"],
            ["Processing", "25%"],
            ["Additives", "20%"],
            ["Environment", "15%"],
        ]) {
            const row = html.match(
                new RegExp(
                    `<button[^>]*fd-menu__row[^>]*>(?:(?!</button>)[\\s\\S])*?>${title}<[\\s\\S]*?</button>`,
                ),
            );
            expect(row, title).not.toBeNull();
            expect(row![0]).toContain(`>${share}<`);
        }
        expect(html).not.toContain('type="range"');
        expect(html).toContain("Weights</h2>");
        expect(html).toMatch(/fd-section-header__count">100%</);
        // The two switches of the checks, plus the household one.
        expect(html.match(/role="switch"/g)).toHaveLength(3);
        expect(html).toContain(">Milk<");
        expect(html).toContain('href="/settings/household/members/u1"');
        // The lead-in and "from your person rules" help are cut.
        expect(html).not.toContain("How much each part counts");
        expect(html).not.toContain("from your person rules");
    });

    test("a weight's pull-down lists shares and saves the weights that show the one picked", () => {
        const html = renderSettingsScoreV2Page(view());
        const menu = html.match(
            /aria-label="Nutrition weight"[\s\S]*?<\/div><\/div>/,
        )![0];
        // Every ten from 0% to 100%; the share the row shows now (40%) is ticked.
        expect(menu.match(/menuitemcheckbox/g)).toHaveLength(11);
        expect(menu).toMatch(
            /aria-checked="true"[^>]*>(?:(?!<button)[\s\S])*?>40%</,
        );
        // The ticked share is the current choice: picking it again posts
        // nothing, so it cannot turn the household default off by itself.
        expect(menu).toContain('aria-checked="true" data-fd-menu-close>');
        expect(menu.match(/<form /g)).toHaveLength(10);
        // Choosing 60% posts Custom with Nutrition 60 and the others rescaled
        // in proportion (25:20:15 into 40), summing to 100, so the row shows 60%.
        const form = menu.match(
            /<form[^>]*>(?:(?!<\/form>)[\s\S])*?weight_nutrition" value="60"(?:(?!<\/form>)[\s\S])*?<\/form>/,
        )![0];
        expect(form).toContain('action="/settings/product-score"');
        expect(form).toContain('name="intent" value="choice"');
        expect(form).toContain('name="preset" value="custom"');
        expect(form).toContain('name="weight_processing" value="17"');
        expect(form).toContain('name="weight_additives" value="13"');
        expect(form).toContain('name="weight_environment" value="10"');
        // A share between the tens is offered too, in order.
        const odd = renderSettingsScoreV2Page(
            view({
                preset: "custom",
                weights: {
                    nutrition: 45,
                    processing: 25,
                    additives: 20,
                    environment: 10,
                },
            }),
        );
        const oddMenu = odd.match(
            /aria-label="Nutrition weight"[\s\S]*?<\/div><\/div>/,
        )![0];
        expect(oddMenu.match(/menuitemcheckbox/g)).toHaveLength(12);
    });

    test("weightsForShare gives the part the share asked for and keeps the others in proportion", () => {
        const base = {
            nutrition: 40,
            processing: 30,
            additives: 20,
            environment: 10,
        };
        for (const share of [0, 10, 25, 50, 90, 100]) {
            const next = weightsForShare(base, "nutrition", share)!;
            expect(weightShares(next).nutrition).toBe(share);
            expect(Object.values(next).reduce((sum, n) => sum + n, 0)).toBe(
                100,
            );
        }
        // The others' order and rough proportions stay: 30:20:10 into 50.
        expect(weightsForShare(base, "nutrition", 50)).toEqual({
            nutrition: 50,
            processing: 25,
            additives: 17,
            environment: 8,
        });
        // With every other weight at zero the part is the whole: only 100% is reachable.
        const alone = {
            nutrition: 40,
            processing: 0,
            additives: 0,
            environment: 0,
        };
        expect(weightsForShare(alone, "nutrition", 60)).toBeNull();
        expect(weightsForShare(alone, "nutrition", 100)).toEqual({
            ...alone,
            nutrition: 100,
        });
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
        expect(html).toContain('name="weight_nutrition" value="0"');
        expect(html).toMatch(/fd-section-header__count">0%</);
        for (const title of WEIGHT_ROWS) expect(html).toContain(`>${title}<`);
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

    test("the household switch: on while following, off makes the household's weights the person's own", () => {
        const following = renderSettingsScoreV2Page(
            view({
                followsHousehold: true,
                householdPresetLabel: "Planet",
                preset: "planet",
                weights: SCORE_PRESETS.planet,
            }),
        );
        const sw = following.match(
            /<form[^>]*>(?:(?!<\/form>)[\s\S])*?aria-label="Use household default"[\s\S]*?<\/form>/,
        )![0];
        expect(sw).toContain('aria-checked="true"');
        expect(sw).toContain('name="intent" value="choice"');
        expect(sw).toContain('name="preset" value="planet"');
        expect(sw).toContain(
            `name="weight_nutrition" value="${SCORE_PRESETS.planet.nutrition}"`,
        );
        expect(following).toContain(">Planet<");
        const own = renderSettingsScoreV2Page(
            view({ householdPresetLabel: "Planet" }),
        );
        const off = own.match(
            /<form[^>]*>(?:(?!<\/form>)[\s\S])*?aria-label="Use household default"[\s\S]*?<\/form>/,
        )![0];
        expect(off).toContain('aria-checked="false"');
        expect(off).toContain('name="intent" value="household"');
    });

    test("the household row links only for owners and admins", () => {
        const member = renderSettingsScoreV2Page(view());
        expect(member).not.toContain("/settings/product-score/household");
        const admin = renderSettingsScoreV2Page(
            view({ canEditHousehold: true }),
        );
        expect(admin).toContain('href="/settings/product-score/household"');
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

describe("autosave", () => {
    test("the preset chips are the one autosave form; nothing opts out of Turbo", () => {
        const html = renderSettingsScoreV2Page(
            view({ canEditHousehold: true }),
        );
        expect(html).not.toContain("Save weights");
        expect(html).not.toContain("Save household default");
        for (const form of forms(html)) {
            expect(form).not.toContain('data-turbo="false"');
        }
        const marked = forms(html).filter((f) =>
            f.includes('data-fd-autosave="form"'),
        );
        expect(marked).toHaveLength(1);
        expect(marked[0]).toContain("fd-score-form");
        expect(html).toContain(
            'class="fd-visually-hidden">Save</button></form>',
        );
        // The chips carry the weights as hidden fields, ignored by a preset.
        expect(html).toContain('name="weight_nutrition" value="40"');
    });

    test("the household default page saves itself too, and a refused draft is marked", () => {
        const base = {
            chrome,
            preset: "planet" as const,
            weights: SCORE_PRESETS.planet,
            isSet: true,
        };
        const html = renderSettingsScoreHouseholdV2Page(base);
        expect(html).not.toContain("Save household default");
        for (const form of forms(html)) {
            expect(form).not.toContain('data-turbo="false"');
        }
        const choice = forms(html).find((f) => f.includes("fd-score-form"));
        expect(choice).toContain('data-fd-autosave="form"');
        expect(choice).not.toContain("data-fd-invalid");
        const refused = renderSettingsScoreHouseholdV2Page({
            ...base,
            error: "No.",
            draft: {
                preset: "custom",
                weights: {
                    nutrition: "0",
                    processing: "0",
                    additives: "0",
                    environment: "0",
                },
            },
        });
        expect(
            forms(refused).find((f) => f.includes("fd-score-form")),
        ).toContain("data-fd-invalid");
    });
});

describe("the household default page", () => {
    test("offers Clear in the ⋯, confirmed in place, only when a default is set", () => {
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
        expect(set).toContain("data-fd-menu-confirm");
        expect(set).toContain('action="/settings/product-score/household"');
        expect(set).toContain(
            'aria-label="Back" href="/settings/product-score"',
        );
        const unset = renderSettingsScoreHouseholdV2Page({
            ...base,
            isSet: false,
        });
        expect(unset).not.toContain('value="clear"');
        expect(unset).toContain("fd-detail-bar__balance");
    });

    test("has the chips and the weights, and no household switch", () => {
        const html = renderSettingsScoreHouseholdV2Page({
            chrome,
            preset: "planet",
            weights: SCORE_PRESETS.planet,
            isSet: false,
        });
        expect(html).toContain("Household default</h1>");
        expect(html).toContain("Weights</h2>");
        expect(html).not.toContain("Use household default");
        expect(html).not.toContain("Checks for you");
    });
});
