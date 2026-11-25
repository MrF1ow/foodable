import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { VersionsCompare } from "../../../domain/recipe-variants.js";
import {
    compareLines,
    makeBaseSheetId,
    renderRecipeCompareBody,
    type RecipeCompareV2View,
} from "./recipes-page-compare.js";

const chrome = { theme: "light" as const, flags: FIXTURE_APP_CHROME_FLAGS };
const oz = (amount: number) => ({ amount, unit: "oz" });
const thighs = {
    ingredientId: "i-thighs",
    displayName: "Chicken thighs",
    base: oz(6),
};

const COMPARE: VersionsCompare = {
    recipeId: "r1",
    base: [
        {
            ingredientId: "i-thighs",
            displayName: "Chicken thighs",
            foodId: "f-thighs",
            quantity: oz(6),
        },
        {
            ingredientId: "i-fish",
            displayName: "Fish sauce",
            foodId: "f-fish",
            quantity: { amount: 1, unit: "tbsp" },
        },
        {
            ingredientId: "i-salt",
            displayName: "Salt",
            foodId: "f-salt",
            quantity: null,
        },
    ],
    versions: [
        {
            userId: "u-ethan",
            overrideCount: 1,
            differences: [
                {
                    kind: "amount",
                    ref: "i-thighs",
                    rowKey: "a@1",
                    ...thighs,
                    version: oz(8),
                },
            ],
        },
        {
            userId: "u-mia",
            overrideCount: 3,
            differences: [
                {
                    kind: "amount",
                    ref: "i-thighs",
                    rowKey: "b@1",
                    ...thighs,
                    version: oz(10),
                },
                {
                    kind: "removed",
                    ref: "i-fish",
                    rowKey: "c@1",
                    ingredientId: "i-fish",
                    displayName: "Fish sauce",
                    base: { amount: 1, unit: "tbsp" },
                },
                {
                    kind: "added",
                    ref: "d",
                    rowKey: "d@1",
                    ingredientId: null,
                    displayName: "Chili flakes",
                    foodId: "f-chili",
                    version: { amount: 1, unit: "tsp" },
                },
            ],
        },
    ],
    usingBase: ["u-sarah"],
};

const view = (
    over: Partial<RecipeCompareV2View> = {},
): RecipeCompareV2View => ({
    chrome: chrome as never,
    recipeId: "r1",
    recipeName: "Simple Pad See Ew",
    compare: COMPARE,
    people: [
        { userId: "u-ethan", name: "Ethan", resetRowKeys: ["a@1"] },
        { userId: "u-sarah", name: "Sarah" },
        {
            userId: "u-mia",
            name: "Mia",
            resetRowKeys: ["b@1", "c@1", "d@1"],
        },
    ],
    ...over,
});

const NAMES = new Map([
    ["u-ethan", "Ethan"],
    ["u-mia", "Mia"],
]);

const labels = (html: string) =>
    [...html.matchAll(/<span class="fd-menu__label">([^<]*)<\/span>/g)].map(
        (m) => m[1],
    );
const titles = (html: string) =>
    [
        ...html.matchAll(
            /<span class="fd-item-row__title"[^>]*>([^<]*)<\/span>/g,
        ),
    ].map((m) => m[1]);
const subtitles = (html: string) =>
    [
        ...html.matchAll(
            /<span class="fd-item-row__subtitle">([^<]*)<\/span>/g,
        ),
    ].map((m) => m[1]);
/** The markup of one person's row, up to the next row. */
const rowOf = (html: string, name: string) =>
    html
        .split('<li class="fd-item-row">')
        .find((row) => row.includes(`title="${name}"`)) ?? "";

describe("compareLines", () => {
    test("one row per ingredient people differ on, the base then each person", () => {
        expect(compareLines(COMPARE, NAMES)).toEqual([
            {
                key: "i-thighs",
                title: "Chicken thighs",
                subtitle: "Base 6 oz · Ethan 8 oz · Mia 10 oz",
            },
            {
                key: "i-fish",
                title: "Fish sauce",
                subtitle: "Base 1 tbsp · Mia none",
            },
            {
                key: "added:f-chili",
                title: "Chili flakes",
                subtitle: "Not in base · Mia 1 tsp",
            },
        ]);
    });

    test("a swap names the food, and a line with no amount says to taste", () => {
        const lines = compareLines(
            {
                ...COMPARE,
                versions: [
                    {
                        userId: "u-mia",
                        overrideCount: 2,
                        differences: [
                            {
                                kind: "swapped",
                                ref: "i-thighs",
                                rowKey: "s@1",
                                ...thighs,
                                foodId: "f-tofu",
                                foodName: "Tofu",
                                version: oz(8),
                            },
                            {
                                kind: "amount",
                                ref: "i-salt",
                                rowKey: "t@1",
                                ingredientId: "i-salt",
                                displayName: "Salt",
                                base: null,
                                version: { amount: 1, unit: "tsp" },
                            },
                        ],
                    },
                ],
                usingBase: [],
            },
            NAMES,
        );
        expect(lines.map((l) => l.subtitle)).toEqual([
            "Base 6 oz · Mia Tofu 8 oz",
            "Base to taste · Mia 1 tsp",
        ]);
    });

    test("the same food added by two people is one row", () => {
        const added = (rowKey: string, amount: number) => ({
            kind: "added" as const,
            ref: rowKey,
            rowKey,
            ingredientId: null,
            displayName: "Chili flakes",
            foodId: "f-chili",
            version: { amount, unit: "tsp" },
        });
        const lines = compareLines(
            {
                ...COMPARE,
                versions: [
                    {
                        userId: "u-ethan",
                        overrideCount: 1,
                        differences: [added("e@1", 2)],
                    },
                    {
                        userId: "u-mia",
                        overrideCount: 1,
                        differences: [added("m@1", 1)],
                    },
                ],
                usingBase: [],
            },
            NAMES,
        );
        expect(lines).toHaveLength(1);
        expect(lines[0]!.subtitle).toBe(
            "Not in base · Ethan 2 tsp · Mia 1 tsp",
        );
    });
});

describe("the compare page", () => {
    const html = renderRecipeCompareBody(view());

    test("a Detail bar titled Compare versions goes back to the recipe, with the recipe's name under it", () => {
        expect(html).toContain(
            '<h1 class="fd-detail-bar__title">Compare versions</h1>',
        );
        expect(html).toContain('href="/recipes/r1"');
        expect(html).toContain("Simple Pad See Ew");
    });

    test("Different from base, then People, each person's change count", () => {
        expect(html.indexOf("Different from base")).toBeLessThan(
            html.indexOf(">People<"),
        );
        expect(titles(html)).toEqual([
            "Chicken thighs",
            "Fish sauce",
            "Chili flakes",
            "Ethan",
            "Sarah",
            "Mia",
            // The Make-the-base sheets of Ethan and Mia.
            "Chicken thighs",
            "Chicken thighs",
            "Chili flakes",
        ]);
        expect(subtitles(html)).toContain("1 change");
        expect(subtitles(html)).toContain("2 changes · 1 added");
        expect(subtitles(html)).toContain("No version yet");
    });

    test("only a version has a ⋯, with Align to base, Make theirs the base and Delete their version", () => {
        expect(rowOf(html, "Sarah")).not.toContain("data-fd-menu-trigger");
        const mia = rowOf(html, "Mia");
        expect(labels(mia).filter((l) => l !== "Cancel")).toEqual([
            "Align Mia to base",
            "Align",
            "Make Mia's the base",
            "Delete Mia's version",
            "Delete",
        ]);
        // Align is plain; Delete keeps the danger tone. Both ask in place.
        const arms = [
            ...mia.matchAll(
                /<button type="button" class="([^"]*)" role="menuitem" data-fd-menu-arm>/g,
            ),
        ].map((m) => m[1]!.includes("fd-menu__item--danger"));
        expect(arms).toEqual([false, true]);
        // Both take back the person's rows: they confirm in place first.
        expect(mia.match(/data-fd-menu-confirm/g)).toHaveLength(2);
        expect(mia).toContain('commandfor="fd-compare-base-u-mia"');
    });

    test("the reset posts what the page showed, and the confirm asks first", () => {
        const mia = rowOf(html, "Mia");
        const forms = [
            ...mia.matchAll(
                /<form[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g,
            ),
        ];
        expect(forms).toHaveLength(2);
        for (const [, action, inner] of forms) {
            expect(action).toBe("/recipes/r1/versions/reset");
            expect(inner).toContain('name="user_id" value="u-mia"');
            expect(inner).toContain('name="confirm" value="1"');
            expect(inner).toContain('name="back" value="compare"');
            expect(
                [...inner!.matchAll(/name="row_keys" value="([^"]+)"/g)].map(
                    (m) => m[1],
                ),
            ).toEqual(["b@1", "c@1", "d@1"]);
        }
        // The confirm row is hidden until the item is pressed.
        expect(mia).toContain(
            'role="group" aria-label="Confirm Delete" hidden',
        );
    });

    test("Make theirs the base lists what align can push, not a removal, and Use posts it", () => {
        const sheet = html.slice(
            html.indexOf(`id="${makeBaseSheetId("u-mia")}"`),
        );
        expect(titles(sheet.slice(0, sheet.indexOf("</dialog>")))).toEqual([
            "Chicken thighs",
            "Chili flakes",
        ]);
        const posts = [
            ...sheet.matchAll(
                /<form[^>]*action="\/recipes\/r1\/versions\/align"[^>]*>([\s\S]*?)<\/form>/g,
            ),
        ];
        expect(posts).toHaveLength(2);
        expect(posts[0]![1]).toContain('name="user_id" value="u-mia"');
        expect(posts[0]![1]).toContain('name="ingredient_id" value="i-thighs"');
        expect(posts[0]![1]).toContain('name="row_key" value="b@1"');
        expect(posts[1]![1]).toContain('name="ingredient_id" value="d"');
        expect(posts[1]![1]).toContain('name="row_key" value="d@1"');
        expect(posts[0]![1]).toContain(">Use<");
    });

    test("a person who only removed things has no Make-the-base item or sheet", () => {
        const onlyRemoved = renderRecipeCompareBody(
            view({
                compare: {
                    ...COMPARE,
                    versions: [COMPARE.versions[1]!].map((v) => ({
                        ...v,
                        differences: v.differences.filter(
                            (d) => d.kind === "removed",
                        ),
                    })),
                    usingBase: [],
                },
            }),
        );
        expect(onlyRemoved).not.toContain("Make Mia&#39;s the base");
        expect(onlyRemoved).not.toContain("Make Mia's the base");
        expect(onlyRemoved).not.toContain("fd-compare-base-u-mia");
        expect(labels(rowOf(onlyRemoved, "Mia"))).toContain(
            "Delete Mia's version",
        );
    });

    test("when nobody differs it says everyone uses the base, and no one has a ⋯", () => {
        const none = renderRecipeCompareBody(
            view({
                compare: {
                    ...COMPARE,
                    versions: [],
                    usingBase: ["u-ethan", "u-sarah", "u-mia"],
                },
            }),
        );
        expect(none).toContain("Everyone uses the base.");
        expect(none).not.toContain("data-fd-menu-trigger");
        expect(none).not.toContain("<dialog");
    });

    test("names are escaped", () => {
        const xss = renderRecipeCompareBody(
            view({
                people: [
                    {
                        userId: "u-ethan",
                        name: "<img src=x>",
                        resetRowKeys: ["a@1"],
                    },
                ],
                compare: {
                    ...COMPARE,
                    versions: [COMPARE.versions[0]!],
                    usingBase: [],
                },
            }),
        );
        expect(xss).not.toContain("<img src=x>");
        expect(xss).toContain("&lt;img src=x&gt;");
    });

    test("a refusal shows in place", () => {
        expect(
            renderRecipeCompareBody(
                view({ error: "Their change changed; look again." }),
            ),
        ).toContain('role="alert">Their change changed; look again.');
    });
});

test("a person who only added a line reads that alone, not as a change", async () => {
    const { changeSummary } = await import("./recipes-page-compare.js");
    const added = { kind: "added" } as never;
    const amount = { kind: "amount" } as never;
    expect(changeSummary([added])).toBe("1 added");
    expect(changeSummary([amount, added])).toBe("1 change · 1 added");
});
