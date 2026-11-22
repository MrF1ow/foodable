import { describe, expect, test } from "bun:test";
import {
    mergeLogResults,
    recentHistoryStart,
    unitHintsForLog,
    type LogSearchGroupKind,
    type LogSearchSourceItem,
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

    test("a per-100 ml food is logged in ml; g and each need its density", () => {
        expect(
            unitHintsForLog({
                grams_per_each: null,
                grams_per_ml: null,
                basis: "100ml",
            }),
        ).toEqual(["ml"]);
        // each without a density cannot reach ml either.
        expect(
            unitHintsForLog({
                grams_per_each: 330,
                grams_per_ml: null,
                basis: "100ml",
            }),
        ).toEqual(["ml"]);
        expect(
            unitHintsForLog({
                grams_per_each: 50,
                grams_per_ml: 1.03,
                basis: "100ml",
            }),
        ).toEqual(["ml", "g", "each"]);
    });

    test("a pack serving is offered first as portion when its unit resolves", () => {
        const ml = { label: "1 tbsp (30 ml)", amount: 30, unit: "ml" as const };
        const g = { label: "1 slice (28 g)", amount: 28, unit: "g" as const };
        expect(unitHintsForLog({ basis: "100ml", serving: ml })).toEqual([
            "portion",
            "ml",
        ]);
        // A g serving on a per-100 ml food needs a density, like g does.
        expect(unitHintsForLog({ basis: "100ml", serving: g })).toEqual(["ml"]);
        expect(
            unitHintsForLog({ basis: "100ml", grams_per_ml: 0.92, serving: g }),
        ).toEqual(["portion", "ml", "g"]);
        expect(unitHintsForLog({ serving: g })).toEqual(["portion", "g"]);
        // ml with no density on a per-100 g food cannot be turned into grams.
        expect(unitHintsForLog({ serving: ml })).toEqual(["g"]);
        expect(unitHintsForLog({ grams_per_ml: 1, serving: ml })).toEqual([
            "portion",
            "g",
            "ml",
        ]);
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

describe("stock rows", () => {
    test("carry the fridge quantity for the subtitle, never as a log amount", () => {
        const result = mergeLogResults(
            {
                stock: [
                    {
                        kind: "stock",
                        id: "s1",
                        name: "Chicken thighs",
                        food_id: "f1",
                        source: "fridge",
                        stock_amount: 0.5,
                        stock_unit: "lb",
                    },
                ],
            },
            "chicken",
        );
        const item = result.groups[0]!.items[0]!;
        expect(item.stock_amount).toBe(0.5);
        expect(item.stock_unit).toBe("lb");
        expect(item.amount).toBeUndefined();
        expect(item.unit).toBeUndefined();
    });
});

describe("open target and loggable per kind", () => {
    function firstItem(kind: LogSearchGroupKind, item: LogSearchSourceItem) {
        const result = mergeLogResults({ [kind]: [item] }, "chicken");
        return result.groups[0]!.items[0]!;
    }

    test("a household food opens its food page and can be logged", () => {
        const item = firstItem("food", {
            kind: "food",
            id: "f1",
            name: "Chicken",
            food_id: "f1",
            source: "household",
        });
        expect(item.open).toBe("/foods/f1");
        expect(item.loggable).toBe(true);
    });

    test("a household product opens the same food page as a food", () => {
        const item = firstItem("food", {
            kind: "food",
            id: "p9",
            name: "Chicken breast",
            brand: "Kirkland",
            food_id: "p9",
            source: "household",
        });
        expect(item.open).toBe("/foods/p9");
        expect(item.loggable).toBe(true);
    });

    test("a recipe opens its recipe page and can be logged", () => {
        const item = firstItem("recipe", {
            kind: "recipe",
            id: "r1",
            recipe_id: "r1",
            name: "Chicken soup",
            source: "recipe",
        });
        expect(item.open).toBe("/recipes/r1");
        expect(item.loggable).toBe(true);
    });

    test("an unverified recipe still opens its page but cannot be logged", () => {
        const unverified = firstItem("recipe", {
            kind: "recipe",
            id: "r2",
            recipe_id: "r2",
            name: "Imported chicken stew",
            source: "recipe",
            verification: "unverified",
        });
        expect(unverified.open).toBe("/recipes/r2");
        expect(unverified.loggable).toBe(false);
        const verified = firstItem("recipe", {
            kind: "recipe",
            id: "r3",
            recipe_id: "r3",
            name: "Verified chicken stew",
            source: "recipe",
            verification: "verified",
        });
        expect(verified.loggable).toBe(true);
    });

    test("a past meal opens the prefilled log form and can be logged", () => {
        const result = mergeLogResults(
            {
                history: [
                    {
                        kind: "history",
                        id: "m1",
                        meal_id: "m1",
                        name: "Chicken and rice",
                        source: "meal",
                    },
                ],
            },
            "",
        );
        const item = result.groups[0]!.items[0]!;
        expect(item.open).toBe("/?log=meal:m1");
        expect(item.loggable).toBe(true);
    });

    test("a fridge item opens its fridge sheet and can be logged when it is a food", () => {
        const item = firstItem("stock", {
            kind: "stock",
            id: "s1",
            name: "Chicken thighs",
            food_id: "f1",
            source: "fridge",
        });
        expect(item.open).toBe("/kitchen/fridge?item=s1");
        expect(item.loggable).toBe(true);
    });

    test("a fridge item with no food behind it opens but cannot be logged", () => {
        const item = firstItem("stock", {
            kind: "stock",
            id: "s2",
            name: "Chicken stuff",
            source: "fridge",
        });
        expect(item.open).toBe("/kitchen/fridge?item=s2");
        expect(item.loggable).toBe(false);
    });

    test("an Open Food Facts row opens by barcode and can be logged", () => {
        const item = firstItem("off", {
            kind: "off",
            id: "off:111",
            name: "Chicken nuggets",
            barcode: "111",
            source: "off",
        });
        expect(item.open).toBe("/foods/by-barcode/111");
        expect(item.loggable).toBe(true);
    });

    test("an Open Food Facts row with no barcode cannot be logged", () => {
        const item = firstItem("off", {
            kind: "off",
            id: "off:x",
            name: "Chicken mystery",
            source: "off",
        });
        expect(item.loggable).toBe(false);
        expect(item.open).toBe("/foods");
    });

    test("ids are escaped in the open path", () => {
        const item = firstItem("off", {
            kind: "off",
            id: "off:a",
            name: "Chicken odd",
            barcode: "a/b c",
            source: "off",
        });
        expect(item.open).toBe("/foods/by-barcode/a%2Fb%20c");
    });
});
