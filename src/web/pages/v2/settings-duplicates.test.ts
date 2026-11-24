import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { newFood, type PossibleDuplicatePair } from "../../../domain/foods.js";
import {
    injectedAttributes,
    XSS,
    XSS_ESCAPED,
} from "../../components/v2/test-helpers.js";
import {
    DUPLICATES_PATH,
    duplicateComparePath,
    duplicatesBackFrom,
    findDuplicatePair,
    renderSettingsDuplicateCompareV2Page,
    renderSettingsDuplicatesV2Page,
} from "./settings-duplicates.js";

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

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function pairOf(
    over: {
        subject?: Partial<ReturnType<typeof newFood>>;
        related?: Partial<ReturnType<typeof newFood>>;
    } = {},
): PossibleDuplicatePair {
    return {
        subject: {
            ...newFood({ householdId: "hh", kind: "food", name: "Milk" }),
            id: A,
            calories: 60,
            ...over.subject,
        },
        related: {
            ...newFood({ householdId: "hh", kind: "food", name: "Whole milk" }),
            id: B,
            calories: 64,
            ...over.related,
        },
        rule: "contains_words",
    };
}

const counts = new Map([
    [A, 6],
    [B, 1],
]);

describe("duplicatesBackFrom", () => {
    test("accepts the list and a compare path of two uuids", () => {
        expect(duplicatesBackFrom(DUPLICATES_PATH)).toBe(DUPLICATES_PATH);
        const compare = duplicateComparePath(A, B);
        expect(duplicatesBackFrom(compare)).toBe(compare);
    });

    test("everything else is the list", () => {
        for (const bad of [
            undefined,
            null,
            "",
            "https://evil.example",
            "//evil.example",
            "/settings/account",
            "/settings/saved",
            `${DUPLICATES_PATH}/`,
            `${DUPLICATES_PATH}/${A}`,
            `${DUPLICATES_PATH}/${A}/${B}/x`,
            `${DUPLICATES_PATH}/${A}/${B}?x=1`,
            `${DUPLICATES_PATH}/${A}/${B}#x`,
            `${DUPLICATES_PATH}/a/b`,
            // Uppercase ids pass no allowlist: the pair lookup compares exactly.
            duplicateComparePath(
                "ABCDEF01-2345-4678-8ABC-DEF012345678",
                "FEDCBA01-2345-4678-8ABC-DEF012345678",
            ),
            `${DUPLICATES_PATH}/../../account`,
        ]) {
            expect(duplicatesBackFrom(bad), String(bad)).toBe(DUPLICATES_PATH);
        }
    });
});

test("findDuplicatePair matches either order and nothing else", () => {
    const pair = pairOf();
    expect(findDuplicatePair([pair], A, B)).toBe(pair);
    expect(findDuplicatePair([pair], B, A)).toBe(pair);
    expect(findDuplicatePair([pair], A, "other")).toBeUndefined();
});

describe("the list", () => {
    test("shows each pair as an Item row with its uses and a ⋯ of two actions", () => {
        const html = renderSettingsDuplicatesV2Page({
            chrome,
            pairs: [pairOf()],
            refCounts: counts,
        });
        expect(html).toContain(`id="dup-${A}-${B}"`);
        expect(html).toContain("Milk · Whole milk");
        expect(html).toContain("6 uses and 1 use");
        expect(html).toContain('aria-label="Actions for Milk · Whole milk"');
        expect(html).toContain("Compare and merge");
        expect(html).toContain("Keep apart");
        expect(html).toContain(`href="${DUPLICATES_PATH}/${A}/${B}"`);
        // The design's menu has these two items only, and no lead-in text.
        expect(html).not.toContain("Merge into");
        expect(html).not.toContain("Not the same");
        expect(html).not.toContain("Use ⋯ to merge");
        expect(html).toContain("fd-item-row");
        expect(html).toContain('data-fd-menu data-anchor="more"');
    });

    test("the page is the Settings layout with Saved foods & recipes current and behind it", () => {
        const html = renderSettingsDuplicatesV2Page({
            chrome,
            pairs: [pairOf()],
            refCounts: counts,
        });
        expect(html).toContain('data-fd-settings-page="saved"');
        expect(html).toContain(
            'aria-label="Saved foods &amp; recipes" href="/settings/saved"',
        );
        expect(html).toContain('href="/settings/saved" aria-current="page"');
    });

    test("Keep apart posts both foods with the list as back", () => {
        const html = renderSettingsDuplicatesV2Page({
            chrome,
            pairs: [pairOf()],
            refCounts: counts,
        });
        expect(html).toContain(
            `action="/settings/household/possible-duplicates/keep-separate"`,
        );
        expect(html).toContain(
            `<input type="hidden" name="subject_id" value="${A}"><input type="hidden" name="related_id" value="${B}"><input type="hidden" name="back" value="${DUPLICATES_PATH}">`,
        );
    });

    test("an empty list says so; an error is shown", () => {
        const html = renderSettingsDuplicatesV2Page({
            chrome,
            pairs: [],
            refCounts: new Map(),
            error: "Could not merge foods.",
        });
        expect(html).toContain("No possible duplicates");
        expect(html).toContain("Could not merge foods.");
        expect(html).not.toContain("<details");
    });

    test("names are escaped", async () => {
        const html = renderSettingsDuplicatesV2Page({
            chrome,
            pairs: [pairOf({ subject: { name: XSS } })],
            refCounts: counts,
        });
        expect(html).toContain(XSS_ESCAPED);
        expect(html).not.toContain("<script>alert(1)");
        expect(await injectedAttributes(html)).toEqual([]);
    });
});

describe("the compare page", () => {
    test("titles the pair, radio rows for the keep (most-used checked), Keep apart and Merge into the kept food", () => {
        const html = renderSettingsDuplicateCompareV2Page({
            chrome,
            pair: pairOf(),
            refCounts: counts,
        });
        expect(html).toContain("Milk or Whole milk?");
        expect(html).toMatch(
            new RegExp(`type="radio"[^>]*name="keep_id" value="${A}" checked`),
        );
        expect(html).toMatch(
            new RegExp(
                `type="radio"[^>]*name="keep_id" value="${B}" aria-label`,
            ),
        );
        expect(html).toContain("6 uses");
        expect(html).toContain("1 use");
        expect(html).toContain("Merge into Milk");
        expect(html).toContain("Merge into Whole milk");
        expect(html).toContain("Keep apart");
        expect(html).toContain("Keep</h2>");
        expect(html).toContain("Values that differ</h2>");
        expect(html).toContain(
            'action="/settings/household/possible-duplicates/merge"',
        );
        expect(html).toContain(
            'action="/settings/household/possible-duplicates/keep-separate"',
        );
        expect(html).toContain('name="view" value="compare"');
        // The explaining lines are cut: they live in Help.
        expect(html).not.toContain("Pick the one to keep.");
        expect(html).not.toContain("comes from the food you keep");
    });

    test("Keep apart submits the separate form from the button row", () => {
        const html = renderSettingsDuplicateCompareV2Page({
            chrome,
            pair: pairOf(),
            refCounts: counts,
        });
        expect(html).toContain('<form id="fd-dup-separate"');
        expect(html).toMatch(/<button[^>]*form="fd-dup-separate"[^>]*>/);
    });

    test("conflicting values are a segmented choice with no pick until the person makes one", () => {
        const fresh = renderSettingsDuplicateCompareV2Page({
            chrome,
            pair: pairOf(),
            refCounts: counts,
        });
        expect(fresh).toContain('name="pick_calories"');
        expect(fresh).toContain(">60</span>");
        expect(fresh).toContain(">64</span>");
        // No pick radio starts checked: an unpicked value comes from the food
        // kept, whichever that is when the form posts.
        expect(fresh).toMatch(/name="keep_id" value="[^"]+" checked/);
        expect(fresh).not.toMatch(/name="pick_[a-z_]+" value="[^"]+" checked/);
        // The keep radios are one labelled group.
        expect(fresh).toContain('role="radiogroup" aria-label="Food to keep"');
        const again = renderSettingsDuplicateCompareV2Page({
            chrome,
            pair: pairOf(),
            refCounts: counts,
            mergePost: {
                foodA: A,
                foodB: B,
                keepId: B,
                picks: { calories: A },
            },
        });
        expect(again).toMatch(
            new RegExp(`name="keep_id" value="${B}" checked`),
        );
        expect(again).toMatch(
            new RegExp(`name="pick_calories" value="${A}" checked`),
        );
        expect(again).not.toMatch(
            new RegExp(`name="pick_calories" value="${B}" checked`),
        );
    });

    test("no conflict, no differ section; allergens are combined in a row", () => {
        const html = renderSettingsDuplicateCompareV2Page({
            chrome,
            pair: pairOf({
                subject: { calories: 60, allergens: ["milk"] },
                related: { calories: 60, allergens: ["egg"] },
            }),
            refCounts: counts,
        });
        expect(html).not.toContain("pick_");
        expect(html).not.toContain("Values that differ");
        expect(html).toContain("Allergens combined");
        expect(html).toContain("Milk, Egg");
    });

    test("names are escaped", async () => {
        const html = renderSettingsDuplicateCompareV2Page({
            chrome,
            pair: pairOf({ related: { name: XSS } }),
            refCounts: counts,
            error: XSS,
        });
        expect(html).toContain(XSS_ESCAPED);
        expect(html).not.toContain("<script>alert(1)");
        expect(await injectedAttributes(html)).toEqual([]);
    });
});
