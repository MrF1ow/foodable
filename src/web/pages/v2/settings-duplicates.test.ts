import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { newFood, type PossibleDuplicatePair } from "../../../domain/foods.js";
import {
    injectedAttributes,
    XSS,
    XSS_ESCAPED,
} from "../../components/v2/test-helpers.js";
import { renderHouseholdNav } from "../../components/settings-nav.js";
import {
    DUPLICATES_PATH,
    duplicateComparePath,
    duplicatesBackFrom,
    duplicatesLink,
    findDuplicatePair,
    renderSettingsDuplicateCompareV2Page,
    renderSettingsDuplicatesV2Page,
} from "./settings-duplicates.js";

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
    test("shows each pair with its uses and a menu of four actions", () => {
        const html = renderSettingsDuplicatesV2Page({
            chrome,
            pairs: [pairOf()],
            refCounts: counts,
        });
        expect(html).toContain(`id="dup-${A}-${B}"`);
        expect(html).toContain("Milk · Whole milk");
        expect(html).toContain("6 uses and 1 use");
        expect(html).toContain("Use ⋯ to merge or keep them apart.");
        expect(html).toContain("Merge into Milk");
        expect(html).toContain("Keeps Milk · 6 uses");
        expect(html).toContain("Merge into Whole milk");
        expect(html).toContain("Not the same");
        expect(html).toContain("More…");
        expect(html).toContain(`href="${DUPLICATES_PATH}/${A}/${B}"`);
        expect(html).toContain('aria-label="Actions for Milk · Whole milk"');
    });

    test("Merge into B posts keep_id=B with both foods and the list as back", () => {
        const html = renderSettingsDuplicatesV2Page({
            chrome,
            pairs: [pairOf()],
            refCounts: counts,
        });
        expect(html).toContain(
            `<input type="hidden" name="food_a" value="${A}"><input type="hidden" name="food_b" value="${B}"><input type="hidden" name="back" value="${DUPLICATES_PATH}"><input type="hidden" name="keep_id" value="${B}">`,
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
        expect(html).toContain("No possible duplicates.");
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

    test("the Saved foods & recipes link carries the count only above zero", () => {
        expect(duplicatesLink(3)).toContain(
            '<span class="fd-settings-menu__badge">3</span>',
        );
        expect(duplicatesLink(0)).not.toContain("fd-settings-menu__badge");
        expect(duplicatesLink(0)).toContain(`href="${DUPLICATES_PATH}"`);
    });
});

describe("the compare page", () => {
    test("titles the pair, radios the keep (most-used checked), Merge and Keep them separate", () => {
        const html = renderSettingsDuplicateCompareV2Page({
            chrome,
            pair: pairOf(),
            refCounts: counts,
        });
        expect(html).toContain("Milk or Whole milk?");
        expect(html).toContain("Pick the one to keep.");
        expect(html).toContain(
            `name="keep_id" value="${A}" data-fd-dup-keep="a" checked`,
        );
        expect(html).toContain(
            `name="keep_id" value="${B}" data-fd-dup-keep="b">`,
        );
        expect(html).toContain("6 uses");
        expect(html).toContain("1 use");
        expect(html).toContain("Merge into Milk");
        expect(html).toContain("Merge into Whole milk");
        expect(html).toContain("Keep them separate");
        expect(html).toContain(
            'action="/settings/household/possible-duplicates/merge"',
        );
        expect(html).toContain(
            'action="/settings/household/possible-duplicates/keep-separate"',
        );
        expect(html).toContain('name="view" value="compare"');
    });

    test("conflicting values get pick radios, none checked until a refused post carried one", () => {
        const fresh = renderSettingsDuplicateCompareV2Page({
            chrome,
            pair: pairOf(),
            refCounts: counts,
        });
        expect(fresh).toContain('name="pick_calories"');
        expect(fresh).toContain("Milk: 60");
        expect(fresh).toContain("Whole milk: 64");
        // A pre-checked pick would not follow the keep radio: switching the keep
        // would still take the first-kept food's value. Unposted picks use the
        // kept food's value on the server.
        expect(fresh).not.toMatch(/name="pick_[a-z_]+" value="[^"]+" checked/);
        expect(fresh).toContain("comes from the food you keep");
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
        expect(again).toContain(
            `name="keep_id" value="${B}" data-fd-dup-keep="b" checked`,
        );
        expect(again).toMatch(
            new RegExp(`name="pick_calories" value="${A}" checked`),
        );
        expect(again).not.toMatch(
            new RegExp(`name="pick_calories" value="${B}" checked`),
        );
    });

    test("no conflict, no pick section; allergens are combined in a note", () => {
        const html = renderSettingsDuplicateCompareV2Page({
            chrome,
            pair: pairOf({
                subject: { calories: 60, allergens: ["milk"] },
                related: { calories: 60, allergens: ["egg"] },
            }),
            refCounts: counts,
        });
        expect(html).not.toContain("pick_");
        expect(html).toContain("Allergens are combined:");
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

test("the household sub-nav links Possible duplicates to its Saved foods & recipes home", () => {
    const html = renderHouseholdNav("members", { possibleDuplicates: 2 });
    expect(html).toContain('href="/settings/saved/duplicates"');
    expect(html).not.toContain("/settings/household/possible-duplicates");
});
