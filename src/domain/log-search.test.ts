import { describe, expect, test } from "bun:test";
import {
    mergeLogResults,
    recentHistoryStart,
    unitHintsForLog,
    type LogSearchSources,
} from "./log-search.js";

const HH_EGG = "food-egg";
const HH_PLANT = "food-plant";
const STOCK_EGG = "stock-egg";

function sources(partial: LogSearchSources): LogSearchSources {
    return partial;
}

describe("mergeLogResults", () => {
    test("dedupes the same food_id from stock when it is already in the food group", () => {
        const result = mergeLogResults(
            sources({
                food: [
                    {
                        kind: "food",
                        id: HH_EGG,
                        name: "Eggs",
                        food_id: HH_EGG,
                        source: "household",
                        grams_per_each: null,
                        grams_per_ml: null,
                    },
                ],
                stock: [
                    {
                        kind: "stock",
                        id: STOCK_EGG,
                        name: "Eggs (fridge)",
                        food_id: HH_EGG,
                        source: "fridge",
                        grams_per_each: null,
                        grams_per_ml: null,
                    },
                ],
            }),
            "egg",
        );
        expect(result.groups.map((g) => g.kind)).toEqual(["food"]);
        expect(result.groups[0]!.items).toHaveLength(1);
        expect(result.groups[0]!.items[0]!.id).toBe(HH_EGG);
    });

    test("ranks an exact name match ahead of a prefix-only match", () => {
        const result = mergeLogResults(
            sources({
                stock: [
                    {
                        kind: "stock",
                        id: HH_PLANT,
                        name: "Eggplant",
                        food_id: HH_PLANT,
                        source: "fridge",
                    },
                    {
                        kind: "stock",
                        id: HH_EGG,
                        name: "Egg",
                        food_id: HH_EGG,
                        source: "fridge",
                    },
                ],
            }),
            "egg",
        );
        const names = result.groups[0]!.items.map((i) => i.name);
        expect(names).toEqual(["Egg", "Eggplant"]);
    });

    test("omits the off group when no off items are supplied", () => {
        const result = mergeLogResults(
            sources({
                food: [
                    {
                        kind: "food",
                        id: HH_EGG,
                        name: "Eggs",
                        food_id: HH_EGG,
                        source: "household",
                    },
                ],
            }),
            "egg",
        );
        expect(result.groups.some((g) => g.kind === "off")).toBe(false);
    });

    test("includes the off group when off items are supplied", () => {
        const result = mergeLogResults(
            sources({
                off: [
                    {
                        kind: "off",
                        id: "off:123",
                        name: "OE Egg",
                        barcode: "123",
                        source: "off:123",
                    },
                ],
            }),
            "egg",
        );
        expect(result.groups.map((g) => g.kind)).toEqual(["off"]);
        expect(result.groups[0]!.items[0]!.barcode).toBe("123");
    });

    test("empty query returns only recent history, ordered newest first", () => {
        const result = mergeLogResults(
            sources({
                food: [
                    {
                        kind: "food",
                        id: HH_EGG,
                        name: "Eggs",
                        food_id: HH_EGG,
                        source: "household",
                    },
                ],
                history: [
                    {
                        kind: "history",
                        id: "meal-2",
                        name: "Oatmeal",
                        source: "meal",
                        logged_at: "2026-01-02T12:00:00.000Z",
                    },
                    {
                        kind: "history",
                        id: "meal-1",
                        name: "Eggs",
                        food_id: HH_EGG,
                        source: "meal",
                        logged_at: "2026-01-03T08:00:00.000Z",
                    },
                ],
            }),
            "",
        );
        expect(result.groups.map((g) => g.kind)).toEqual(["history"]);
        expect(result.groups[0]!.items.map((i) => i.id)).toEqual([
            "meal-1",
            "meal-2",
        ]);
    });
});

describe("unitHintsForLog", () => {
    test("always offers grams", () => {
        expect(
            unitHintsForLog({ grams_per_each: null, grams_per_ml: null }),
        ).toEqual(["g"]);
    });

    test("offers ml and each only when factors exist", () => {
        expect(
            unitHintsForLog({ grams_per_each: 50, grams_per_ml: 1.03 }),
        ).toEqual(["g", "ml", "each"]);
        expect(
            unitHintsForLog({ grams_per_each: null, grams_per_ml: null }),
        ).toEqual(["g"]);
    });

    test("recipes offer portion only", () => {
        expect(
            unitHintsForLog(
                { grams_per_each: null, grams_per_ml: null },
                { recipe: true },
            ),
        ).toEqual(["portion"]);
    });
});

describe("mergeLogResults trusts what a source matched", () => {
    test("keeps household foods in their search's order, even when the query is not a substring", () => {
        const result = mergeLogResults(
            sources({
                food: [
                    {
                        kind: "food",
                        id: "food-egg",
                        name: "Egg",
                        food_id: "food-egg",
                        source: "household",
                    },
                    {
                        kind: "food",
                        id: "food-duck",
                        name: "Duck eggs",
                        food_id: "food-duck",
                        source: "household",
                    },
                ],
            }),
            "eggs",
        );
        expect(result.groups[0]!.items.map((i) => i.name)).toEqual([
            "Egg",
            "Duck eggs",
        ]);
    });

    test("keeps history and Open Food Facts rows their own search returned", () => {
        const result = mergeLogResults(
            sources({
                history: [
                    {
                        kind: "history",
                        id: "meal-1",
                        name: "Rice and fried eggs",
                        source: "meal",
                    },
                ],
                off: [
                    {
                        kind: "off",
                        id: "off:1",
                        name: "Coca-Cola",
                        barcode: "5449000000996",
                        source: "off:1",
                    },
                ],
            }),
            "coke",
        );
        expect(result.groups.map((g) => g.kind)).toEqual(["history", "off"]);
    });

    test("matches recipes and stock by words: plurals, word order, and drops the rest", () => {
        const result = mergeLogResults(
            sources({
                recipe: [
                    {
                        kind: "recipe",
                        id: "r-salad",
                        name: "Egg salad",
                        source: "recipe",
                    },
                    {
                        kind: "recipe",
                        id: "r-chili",
                        name: "Chili",
                        source: "recipe",
                    },
                ],
            }),
            "eggs",
        );
        expect(result.groups).toEqual([
            {
                kind: "recipe",
                items: [expect.objectContaining({ name: "Egg salad" })],
            },
        ]);
        const swapped = mergeLogResults(
            sources({
                stock: [
                    {
                        kind: "stock",
                        id: "s-rice",
                        name: "Fried rice",
                        source: "fridge",
                    },
                ],
            }),
            "rice fried",
        );
        expect(swapped.groups[0]!.items.map((i) => i.name)).toEqual([
            "Fried rice",
        ]);
    });
});

describe("recentHistoryStart", () => {
    test("counts calendar days back from local today, across a DST change", () => {
        // Los Angeles left DST on 2026-11-01; local 2026-11-01 23:30 is
        // 2026-11-02T07:30Z, and 14 days back is 2026-10-18.
        expect(recentHistoryStart("2026-11-01", 14)).toBe("2026-10-18");
        expect(recentHistoryStart("2026-03-01", 14)).toBe("2026-02-15");
    });
});
