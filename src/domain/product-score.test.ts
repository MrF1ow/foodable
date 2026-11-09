import { expect, test } from "bun:test";
import { nutrientLevel } from "./product-score.js";

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
