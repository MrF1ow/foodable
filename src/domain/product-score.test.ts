import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { additiveRisk } from "./additive-risk.js";
import { qualityFromOff } from "./off-quality.js";
import {
    DEFAULT_SCORE_PRESET,
    nutrientLevel,
    productInfoRows,
    SCORE_PRESETS,
    scoreProduct,
    type ScoreQuality,
    type ScoreWeights,
} from "./product-score.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/off");
const FETCHED_AT = "2026-11-09T12:00:00.000Z";

function qualityFromFixture(product: unknown): ScoreQuality {
    const off = qualityFromOff(product, FETCHED_AT);
    return {
        nutriscoreGrade: off.nutriscore_grade,
        novaGroup: off.nova_group,
        ecoscoreGrade: off.ecoscore_grade,
        additives:
            off.additives_tags == null
                ? null
                : off.additives_tags.map((tag) => ({
                      tag,
                      risk: additiveRisk(tag),
                  })),
    };
}

async function loadFixture(name: string): Promise<ScoreQuality> {
    const raw = JSON.parse(
        await Bun.file(join(FIXTURE_DIR, `${name}.json`)).text(),
    ) as { product: unknown };
    return qualityFromFixture(raw.product);
}

test("nutrientLevel prefers OFF band for the kind", () => {
    expect(
        nutrientLevel("sugars", 30, {
            sugars: "moderate",
            "saturated-fat": "low",
        }),
    ).toBe("moderate");
    expect(
        nutrientLevel("saturated-fat", 0.5, { "saturated-fat": "high" }),
    ).toBe("high");
});

test("nutrientLevel derives sugars from per 100 g when OFF is absent", () => {
    expect(nutrientLevel("sugars", 5, null)).toBe("low");
    expect(nutrientLevel("sugars", 5.1, null)).toBe("moderate");
    expect(nutrientLevel("sugars", 22.5, null)).toBe("moderate");
    expect(nutrientLevel("sugars", 22.6, null)).toBe("high");
    expect(nutrientLevel("sugars", null, null)).toBeNull();
});

test("nutrientLevel derives saturated fat from per 100 g when OFF is absent", () => {
    expect(nutrientLevel("saturated-fat", 1.5, null)).toBe("low");
    expect(nutrientLevel("saturated-fat", 1.6, null)).toBe("moderate");
    expect(nutrientLevel("saturated-fat", 5, null)).toBe("moderate");
    expect(nutrientLevel("saturated-fat", 5.1, null)).toBe("high");
    expect(nutrientLevel("saturated-fat", null, null)).toBeNull();
});

test("nutrientLevel ignores invalid OFF values", () => {
    expect(nutrientLevel("sugars", 3, { sugars: "unknown" })).toBe("low");
});

test("productInfoRows returns sugar and saturated fat levels", () => {
    const rows = productInfoRows({
        sugarG: 56.3,
        saturatedFatG: 10.6,
        offNutrientLevels: {
            sugars: "high",
            "saturated-fat": "high",
        },
    });
    expect(rows).toEqual([
        { kind: "sugars", per100g: 56.3, level: "high" },
        { kind: "saturated-fat", per100g: 10.6, level: "high" },
    ]);
});

test("scoreProduct maps nutrition, NOVA, ecoscore a-plus and f", () => {
    const full: ScoreQuality = {
        nutriscoreGrade: "a",
        novaGroup: 1,
        ecoscoreGrade: "a-plus",
        additives: [],
    };
    const s = scoreProduct(full, SCORE_PRESETS.balanced);
    expect(s.score).toBe(100);
    expect(s.label).toBe("good");
    expect(s.partsUsed).toBe(4);
    expect(s.missing).toEqual([]);

    const fGrade: ScoreQuality = {
        ...full,
        ecoscoreGrade: "f",
        nutriscoreGrade: "e",
        novaGroup: 4,
    };
    const poor = scoreProduct(fGrade, SCORE_PRESETS.balanced);
    expect(poor.label).toBe("poor");
    const env = poor.breakdown.find((b) => b.part === "environment");
    expect(env?.value).toBe(0);
});

test("scoreProduct ignores negative, NaN and infinite custom weights", () => {
    const onlyNutrition: ScoreQuality = {
        nutriscoreGrade: "c",
        novaGroup: null,
        ecoscoreGrade: null,
        additives: null,
    };
    const negative = scoreProduct(onlyNutrition, {
        nutrition: 40,
        processing: 25,
        additives: 20,
        environment: -10,
    });
    expect(negative.label).toBe("not_enough_data");
    expect(negative.score).toBeNull();

    const nan = scoreProduct(
        {
            nutriscoreGrade: "a",
            novaGroup: 4,
            ecoscoreGrade: null,
            additives: null,
        },
        { nutrition: NaN, processing: 10, additives: 100, environment: 100 },
    );
    expect(nan.label).toBe("not_enough_data");

    const full: ScoreQuality = {
        nutriscoreGrade: "a",
        novaGroup: 1,
        ecoscoreGrade: "a-plus",
        additives: [],
    };
    const infinite = scoreProduct(full, {
        nutrition: Infinity,
        processing: Infinity,
        additives: 0,
        environment: 0,
    });
    expect(infinite.label).toBe("not_enough_data");
    expect(infinite.score).toBeNull();

    const allBad = scoreProduct(full, {
        nutrition: -1,
        processing: NaN,
        additives: 0,
        environment: -Infinity,
    });
    expect(allBad.label).toBe("not_enough_data");
});

test("scoreProduct rescales when one part is missing", () => {
    const q: ScoreQuality = {
        nutriscoreGrade: "b",
        novaGroup: 1,
        ecoscoreGrade: null,
        additives: [],
    };
    const s = scoreProduct(q, SCORE_PRESETS.balanced);
    expect(s.missing).toEqual(["environment"]);
    expect(s.partsUsed).toBe(3);
    expect(s.score).toBe(88);
    expect(s.label).toBe("good");
});

test("scoreProduct is not_enough_data below minimum known weight", () => {
    const q: ScoreQuality = {
        nutriscoreGrade: "a",
        novaGroup: null,
        ecoscoreGrade: null,
        additives: null,
    };
    const s = scoreProduct(q, SCORE_PRESETS.balanced);
    expect(s.score).toBeNull();
    expect(s.label).toBe("not_enough_data");
    expect(s.partsUsed).toBe(1);
});

test("scoreProduct caps additives when any high-risk additive is present", () => {
    const q: ScoreQuality = {
        nutriscoreGrade: "a",
        novaGroup: 1,
        ecoscoreGrade: "a",
        additives: [
            { tag: "en:e338", risk: "high" },
            { tag: "en:e450", risk: "high" },
        ],
    };
    const entry = scoreProduct(q, SCORE_PRESETS.balanced).breakdown.find(
        (b) => b.part === "additives",
    );
    expect(entry?.value).toBe(40);
});

test("scoreProduct with all zero weights is not_enough_data", () => {
    const q: ScoreQuality = {
        nutriscoreGrade: "a",
        novaGroup: 1,
        ecoscoreGrade: "a",
        additives: [],
    };
    const w: ScoreWeights = {
        nutrition: 0,
        processing: 0,
        additives: 0,
        environment: 0,
    };
    const s = scoreProduct(q, w);
    expect(s.label).toBe("not_enough_data");
});

test("each preset produces a numeric score for complete quality", () => {
    const q: ScoreQuality = {
        nutriscoreGrade: "c",
        novaGroup: 2,
        ecoscoreGrade: "c",
        additives: [{ tag: "en:e160c", risk: "none" }],
    };
    for (const preset of Object.keys(
        SCORE_PRESETS,
    ) as (keyof typeof SCORE_PRESETS)[]) {
        const s = scoreProduct(q, SCORE_PRESETS[preset]);
        expect(s.score).not.toBeNull();
    }
});

test("custom weights rescale like any other weight map", () => {
    const q: ScoreQuality = {
        nutriscoreGrade: "d",
        novaGroup: 3,
        ecoscoreGrade: "d",
        additives: [],
    };
    const custom: ScoreWeights = {
        nutrition: 10,
        processing: 10,
        additives: 10,
        environment: 70,
    };
    const s = scoreProduct(q, custom);
    expect(s.score).toBe(37);
});

test("DEFAULT_SCORE_PRESET is balanced", () => {
    expect(DEFAULT_SCORE_PRESET).toBe("balanced");
});

describe("OFF fixture scores (balanced preset)", () => {
    test("at least eight fixtures are present", async () => {
        const names = (await readdir(FIXTURE_DIR)).filter((f) =>
            f.endsWith(".json"),
        );
        expect(names.length).toBeGreaterThanOrEqual(8);
    });

    test("cola and chocolate spread rate poor; yoghurt and beans good", async () => {
        const cola = await loadFixture("cola");
        const spread = await loadFixture("chocolate-spread");
        const yoghurt = await loadFixture("yoghurt");
        const beans = await loadFixture("beans");

        expect(scoreProduct(cola, SCORE_PRESETS.balanced).label).toBe("poor");
        expect(scoreProduct(spread, SCORE_PRESETS.balanced).label).toBe("poor");
        expect(scoreProduct(yoghurt, SCORE_PRESETS.balanced).label).toBe(
            "good",
        );
        expect(scoreProduct(beans, SCORE_PRESETS.balanced).label).toBe("good");
    });

    test("fixture score table", async () => {
        const names = [
            "cola",
            "yoghurt",
            "crisps",
            "cereal",
            "bread",
            "chocolate-spread",
            "beans",
            "ready-meal",
        ];
        const rows: string[] = [];
        for (const name of names) {
            const q = await loadFixture(name);
            const s = scoreProduct(q, SCORE_PRESETS.balanced);
            rows.push(
                `${name}: score=${s.score ?? "null"} label=${s.label} parts=${s.partsUsed}/${s.partsTotal}`,
            );
        }
        expect(rows.join("\n")).toMatchSnapshot();
    });
});
