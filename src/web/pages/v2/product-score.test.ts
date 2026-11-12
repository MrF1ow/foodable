import { describe, expect, test } from "bun:test";
import { newFood } from "../../../domain/foods.js";
import type { FoodQuality } from "../../../domain/foods.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { AppChromeBase } from "../../attention.js";
import {
    buildPreviewProductPageView,
    renderProductBody,
    renderProductV2Page,
} from "./product.js";
import {
    buildProductScoreSection,
    previewMemberCards,
    renderProductScoreSection,
} from "./product-score.js";

const HH = "hh-1";

const chrome: AppChromeBase = {
    theme: "light",
    attention: { count: 0, tabs: {} },
    flags: FIXTURE_APP_CHROME_FLAGS,
};

function quality(over: Partial<FoodQuality> = {}): FoodQuality {
    return {
        nutriscoreGrade: "a",
        novaGroup: 1,
        ecoscoreGrade: "b",
        additives: [],
        allergensTags: [],
        tracesTags: null,
        ingredientsAnalysisTags: [],
        labelsTags: [],
        fetchedAt: "2026-01-01T00:00:00.000Z",
        ...over,
    };
}

function scoredFood(
    over: Partial<FoodQuality> = {},
    extra: Record<string, unknown> = {},
) {
    return newFood({
        householdId: HH,
        kind: "food",
        name: "Greek yogurt, plain 2%",
        brand: "Fage",
        calories: 59,
        proteinG: 10,
        carbsG: 4,
        fatG: 0.4,
        sugarG: 4,
        saturatedFatG: 2,
        gramsPerEach: 170,
        offQuality: quality(over),
        ...extra,
    });
}

const members = [
    { id: "u1", name: "Ethan Flow", allergens: [] as const, dislikes: [] },
    {
        id: "u2",
        name: "Sam",
        allergens: ["peanut"] as const,
        dislikes: [],
    },
];

describe("renderProductScoreSection", () => {
    test("full data shows score, four parts, and household section", () => {
        const food = scoredFood();
        const cards = previewMemberCards(food, members);
        const section = buildProductScoreSection(food, cards)!;
        const html = renderProductScoreSection(food, section);
        expect(html).toContain("fd-product-score");
        expect(html).toContain("fd-score-big");
        expect(html).toContain("/ 100");
        expect(html).toContain("Your weights: Balanced");
        expect(html).toContain("Why this score");
        expect(html).toContain("Nutri-Score");
        expect(html).toContain("Green-Score");
        expect(html).toContain("For your household");
        expect(html).not.toContain("scored on");
        expect(html).toContain(
            "Parts with no data are left out, not counted against it.",
        );
        expect(html).toContain("fd-product-score__hero-aside");
    });

    test("breakdown lists sugar before Green-Score", () => {
        const food = scoredFood();
        const section = buildProductScoreSection(
            food,
            previewMemberCards(food, members),
        )!;
        const html = renderProductScoreSection(food, section);
        const sugarAt = html.indexOf(">Sugar<");
        const greenAt = html.indexOf("Green-Score");
        expect(sugarAt).toBeGreaterThan(-1);
        expect(greenAt).toBeGreaterThan(sugarAt);
    });

    test("saturated fat shows one decimal", () => {
        const food = scoredFood();
        const section = buildProductScoreSection(
            food,
            previewMemberCards(food, [members[0]!]),
        )!;
        const html = renderProductScoreSection(food, section);
        expect(html).toContain("2.0 g per 100 g");
    });

    test("partial data shows scored on N of 4", () => {
        const food = scoredFood({
            ecoscoreGrade: null,
            additives: null,
        });
        const section = buildProductScoreSection(
            food,
            previewMemberCards(food, members),
        )!;
        const html = renderProductScoreSection(food, section);
        expect(html).toMatch(/scored on \d+ of 4/);
        expect(html).toContain(
            "Parts with no data are left out, not counted against it.",
        );
    });

    test("no score block when OFF data cannot score", () => {
        const food = scoredFood({
            nutriscoreGrade: null,
            novaGroup: null,
            ecoscoreGrade: null,
            additives: null,
        });
        expect(buildProductScoreSection(food, [])).toBeNull();
        const view = buildPreviewProductPageView(chrome, food, { score: null });
        const html = renderProductBody(view);
        expect(html).not.toContain("fd-product-score");
        expect(html).not.toContain("Why this score");
    });

    test("allergen member gets an Avoid card", () => {
        const food = scoredFood({
            allergensTags: ["en:peanuts"],
        });
        const cards = previewMemberCards(food, members);
        const sam = cards.find((c) => c.id === "u2");
        expect(sam?.verdict).toBe("avoid");
        const html = renderProductScoreSection(
            food,
            buildProductScoreSection(food, cards)!,
        );
        expect(html).toContain("fd-member-verdict--avoid");
        expect(html).toContain(">Avoid<");
    });
});

describe("renderProductV2Page score integration", () => {
    test("packaged product page includes score between stock and nutrition", () => {
        const food = scoredFood();
        const section = buildProductScoreSection(
            food,
            previewMemberCards(food, [members[0]!]),
        )!;
        const html = renderProductV2Page(
            buildPreviewProductPageView(chrome, food, {
                barcodes: ["5201054017463"],
                stock: [{ locationName: "Fridge", quantityLabel: "2" }],
                score: section,
            }),
        );
        const scoreAt = html.indexOf("fd-product-score");
        const nutritionAt = html.indexOf("fd-product-nutrition");
        expect(scoreAt).toBeGreaterThan(-1);
        expect(nutritionAt).toBeGreaterThan(scoreAt);
    });
});

describe("the viewer's weights and switches on the product screen", () => {
    const processingOnly = {
        nutrition: 0,
        processing: 100,
        additives: 0,
        environment: 0,
    };

    function sectionFor(view?: Parameters<typeof buildProductScoreSection>[2]) {
        const food = scoredFood({ nutriscoreGrade: "a", novaGroup: 4 });
        return buildProductScoreSection(
            food,
            previewMemberCards(food, [members[0]!]),
            view,
        )!;
    }

    test("custom weights give a different score than the default, named Custom", () => {
        const byDefault = sectionFor();
        const custom = sectionFor({
            weights: processingOnly,
            preset: "custom",
        });
        expect(custom.score.score).not.toBe(byDefault.score.score);
        expect(byDefault.presetLabel).toBe("Balanced");
        expect(custom.presetLabel).toBe("Custom");
        const food = scoredFood({ nutriscoreGrade: "a", novaGroup: 4 });
        expect(renderProductScoreSection(food, custom)).toContain(
            "Your weights: Custom",
        );
    });

    test("a household default preset is named for the viewer", () => {
        expect(sectionFor({ preset: "planet" }).presetLabel).toBe("Planet");
    });

    test("warn on may contain off drops the trace line, on keeps it", () => {
        const food = scoredFood({ tracesTags: ["en:peanuts"] });
        const allergic = {
            id: "u2",
            name: "Sam",
            allergens: ["peanut"] as const,
            dislikes: [],
        };
        const on = previewMemberCards(food, [allergic])[0]!;
        const off = previewMemberCards(food, [
            { ...allergic, warnTraces: false },
        ])[0]!;
        expect(on.reason).toContain("May contain traces of peanut");
        expect(off.reason).toBe("No issues found for this product.");
    });
});
