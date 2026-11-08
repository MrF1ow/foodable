import { expect, test } from "bun:test";
import { additiveRisk } from "./additive-risk.js";
import { qualityFromOff } from "./off-quality.js";

const FETCHED = "2026-11-07T12:00:00.000Z";

test("qualityFromOff: Nutella-shaped product", () => {
    const q = qualityFromOff(
        {
            nutriscore_grade: "e",
            additives_tags: [],
            allergens_tags: ["en:nuts"],
            ecoscore_grade: "d",
            ingredients_analysis_tags: [
                "en:palm-oil-content-unknown",
                "en:vegan-status-unknown",
                "en:vegetarian-status-unknown",
            ],
            labels_tags: ["en:no-gluten"],
            traces_tags: ["en:milk", "en:nuts", "en:soybeans"],
        },
        FETCHED,
    );
    expect(q.nutriscore_grade).toBe("e");
    expect(q.nova_group).toBeNull();
    expect(q.ecoscore_grade).toBe("d");
    expect(q.additives_tags).toEqual([]);
    expect(q.allergens_tags).toEqual(["en:nuts"]);
    expect(q.traces_tags).toEqual(["en:milk", "en:nuts", "en:soybeans"]);
    expect(q.fetched_at).toBe(FETCHED);
});

test("qualityFromOff: Coca-Cola-shaped product", () => {
    const q = qualityFromOff(
        {
            nutriscore_grade: "e",
            nova_group: 4,
            ecoscore_grade: "not-applicable",
            additives_tags: ["en:e150d", "en:e338"],
        },
        FETCHED,
    );
    expect(q.nutriscore_grade).toBe("e");
    expect(q.nova_group).toBe(4);
    expect(q.ecoscore_grade).toBeNull();
    expect(q.additives_tags).toEqual(["en:e150d", "en:e338"]);
});

test("qualityFromOff: ecoscore a+ and a-plus", () => {
    expect(
        qualityFromOff({ ecoscore_grade: "a+" }, FETCHED).ecoscore_grade,
    ).toBe("a-plus");
    expect(
        qualityFromOff({ ecoscore_grade: "a-plus" }, FETCHED).ecoscore_grade,
    ).toBe("a-plus");
    expect(
        qualityFromOff({ ecoscore_grade: "f" }, FETCHED).ecoscore_grade,
    ).toBe("f");
});

test("qualityFromOff: unknown grades and garbage input", () => {
    expect(qualityFromOff(null, FETCHED).nutriscore_grade).toBeNull();
    expect(
        qualityFromOff({ nutriscore_grade: "unknown" }, FETCHED)
            .nutriscore_grade,
    ).toBeNull();
    expect(qualityFromOff({ nova_group: "3" }, FETCHED).nova_group).toBe(3);
    expect(qualityFromOff({ nova_group: 5 }, FETCHED).nova_group).toBeNull();
    const tags = qualityFromOff(
        {
            allergens_tags: ["EN:Milk", " en:milk ", 42, "", "en:eggs"],
        },
        FETCHED,
    );
    expect(tags.allergens_tags).toEqual(["en:milk", "en:eggs"]);
});

test("additiveRisk tiers", () => {
    expect(additiveRisk("en:e250")).toBe("high");
    expect(additiveRisk("en:e150c")).toBe("moderate");
    expect(additiveRisk("en:e129")).toBe("none");
    expect(additiveRisk("en:e330")).toBeNull();
    expect(additiveRisk("  EN:E250 ")).toBe("high");
});
