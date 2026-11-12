import { describe, expect, test } from "bun:test";
import {
    breakdownValue,
    levelStatus,
    partValueStatus,
    SCORE_PART_LABELS,
} from "./product-score-display.js";
import {
    SCORE_PRESETS,
    scoreProduct,
    type ScoreQuality,
} from "./product-score.js";

const QUALITY: ScoreQuality = {
    nutriscoreGrade: "c",
    novaGroup: 3,
    ecoscoreGrade: "a-plus",
    additives: [
        { tag: "en:e330", risk: "none" },
        { tag: "en:e250", risk: "high" },
    ],
};

describe("part status bands", () => {
    test("a 0-100 value is good from 70, warn from 40, over below", () => {
        expect(partValueStatus(100)).toBe("good");
        expect(partValueStatus(70)).toBe("good");
        expect(partValueStatus(69)).toBe("warn");
        expect(partValueStatus(40)).toBe("warn");
        expect(partValueStatus(39)).toBe("over");
    });

    test("a nutrient level maps low / moderate / high, unknown reads warn", () => {
        expect(levelStatus("low")).toBe("good");
        expect(levelStatus("moderate")).toBe("warn");
        expect(levelStatus("high")).toBe("over");
        expect(levelStatus(null)).toBe("warn");
    });
});

describe("breakdownValue", () => {
    const scored = scoreProduct(QUALITY, SCORE_PRESETS.balanced);

    test("words every part as the Product screen does", () => {
        const of = (part: keyof typeof SCORE_PART_LABELS) =>
            breakdownValue(part, QUALITY, scored);
        expect(of("nutrition")).toEqual({
            label: "Nutri-Score",
            value: "C",
            status: "warn",
        });
        expect(of("processing")?.value).toBe("NOVA 3 · processed");
        expect(of("additives")?.value).toBe("2 additive(s), 1 high risk");
        expect(of("environment")?.value).toBe("A+");
    });

    test("no data for a part is null, never a made-up value", () => {
        const empty: ScoreQuality = {
            nutriscoreGrade: null,
            novaGroup: null,
            ecoscoreGrade: null,
            additives: null,
        };
        const none = scoreProduct(empty, SCORE_PRESETS.balanced);
        for (const part of Object.keys(SCORE_PART_LABELS) as Array<
            keyof typeof SCORE_PART_LABELS
        >) {
            expect(breakdownValue(part, empty, none)).toBeNull();
        }
    });

    test("an empty additives list reads None", () => {
        const q = { ...QUALITY, additives: [] };
        expect(
            breakdownValue(
                "additives",
                q,
                scoreProduct(q, SCORE_PRESETS.balanced),
            )?.value,
        ).toBe("None");
    });
});
