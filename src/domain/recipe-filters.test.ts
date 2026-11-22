import { describe, expect, test } from "bun:test";
import type { Recipe, RecipeFilterFlags } from "./recipes.js";
import {
    applyFilters,
    filterParamValue,
    matchesRecipeQuery,
    parseFilterParam,
    RECIPE_FILTERS,
    type RecipeFilterContext,
} from "./recipe-filters.js";

function recipe(id: string, name = id): Recipe {
    return {
        id,
        householdId: "hh",
        creatorId: "u",
        name,
        yieldPortions: 2,
        instructions: null,
        sourceUrl: null,
        tags: [],
        notes: null,
        prepMinutes: null,
        cookMinutes: null,
        verification: "verified",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };
}

function flags(over: Partial<RecipeFilterFlags> = {}): RecipeFilterFlags {
    return {
        cookable: false,
        highProtein: false,
        quick: false,
        missingCount: 3,
        hasIngredients: true,
        ...over,
    };
}

function ctx(
    byId: Record<string, Partial<RecipeFilterFlags>>,
    favourites: string[] = [],
): RecipeFilterContext {
    return {
        flags: new Map(
            Object.entries(byId).map(([id, over]) => [id, flags(over)]),
        ),
        favouriteIds: new Set(favourites),
    };
}

function filterById(id: string) {
    const found = RECIPE_FILTERS.find((entry) => entry.id === id);
    if (!found) throw new Error(`no filter ${id}`);
    return found;
}

describe("RECIPE_FILTERS", () => {
    test("ids are unique and each has a label", () => {
        const ids = RECIPE_FILTERS.map((entry) => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual(["cookable", "protein", "quick", "favourites"]);
        for (const entry of RECIPE_FILTERS) expect(entry.label).not.toBe("");
    });

    test("cookable keeps a recipe the fridge covers", () => {
        const c = ctx({ a: { cookable: true }, b: {} });
        const test_ = filterById("cookable").test;
        expect(test_(recipe("a"), c)).toBe(true);
        expect(test_(recipe("b"), c)).toBe(false);
    });

    test("protein keeps a high-protein recipe", () => {
        const c = ctx({ a: { highProtein: true }, b: {} });
        const test_ = filterById("protein").test;
        expect(test_(recipe("a"), c)).toBe(true);
        expect(test_(recipe("b"), c)).toBe(false);
    });

    test("quick keeps a recipe with a known total time of 30 minutes or less", () => {
        const c = ctx({ a: { quick: true }, b: {} });
        const test_ = filterById("quick").test;
        expect(test_(recipe("a"), c)).toBe(true);
        expect(test_(recipe("b"), c)).toBe(false);
    });

    test("favourites keeps a starred recipe", () => {
        const c = ctx({ a: {}, b: {} }, ["a"]);
        const test_ = filterById("favourites").test;
        expect(test_(recipe("a"), c)).toBe(true);
        expect(test_(recipe("b"), c)).toBe(false);
    });

    test("a recipe with no flags never passes a flag filter", () => {
        const c = ctx({});
        for (const id of ["cookable", "protein", "quick"]) {
            expect(filterById(id).test(recipe("x"), c)).toBe(false);
        }
    });
});

describe("applyFilters", () => {
    const recipes = [recipe("a"), recipe("b"), recipe("c"), recipe("d")];
    const c = ctx(
        {
            a: { cookable: true, quick: true },
            b: { cookable: true },
            c: { quick: true },
            d: {},
        },
        ["a", "c"],
    );

    test("no ids keeps everything, in order", () => {
        expect(applyFilters(recipes, [], c).map((r) => r.id)).toEqual([
            "a",
            "b",
            "c",
            "d",
        ]);
    });

    test("one id narrows", () => {
        expect(applyFilters(recipes, ["cookable"], c).map((r) => r.id)).toEqual(
            ["a", "b"],
        );
    });

    test("several ids combine with AND", () => {
        expect(
            applyFilters(recipes, ["cookable", "quick"], c).map((r) => r.id),
        ).toEqual(["a"]);
        expect(
            applyFilters(recipes, ["quick", "favourites"], c).map((r) => r.id),
        ).toEqual(["a", "c"]);
        expect(
            applyFilters(recipes, ["cookable", "quick", "favourites"], c).map(
                (r) => r.id,
            ),
        ).toEqual(["a"]);
        expect(
            applyFilters(recipes, ["cookable", "favourites", "protein"], c),
        ).toEqual([]);
    });

    test("an unknown id is ignored, not a reason to drop everything", () => {
        expect(
            applyFilters(recipes, ["nonsense", "cookable"], c).map((r) => r.id),
        ).toEqual(["a", "b"]);
    });
});

describe("parseFilterParam", () => {
    test("undefined and empty are no filter", () => {
        expect(parseFilterParam(undefined)).toEqual([]);
        expect(parseFilterParam("")).toEqual([]);
        expect(parseFilterParam(" , ,")).toEqual([]);
    });

    test("reads a comma list in order", () => {
        expect(parseFilterParam("quick,cookable")).toEqual([
            "quick",
            "cookable",
        ]);
        expect(parseFilterParam(" quick , cookable ")).toEqual([
            "quick",
            "cookable",
        ]);
    });

    test("drops unknown ids", () => {
        expect(parseFilterParam("nonsense,quick,")).toEqual(["quick"]);
        expect(parseFilterParam("nonsense")).toEqual([]);
    });

    test("drops duplicates", () => {
        expect(parseFilterParam("quick,quick,cookable,quick")).toEqual([
            "quick",
            "cookable",
        ]);
    });

    test("filterParamValue round-trips", () => {
        expect(filterParamValue(["quick", "cookable"])).toBe("quick,cookable");
        expect(filterParamValue([])).toBe("");
        expect(
            parseFilterParam(filterParamValue(["protein", "favourites"])),
        ).toEqual(["protein", "favourites"]);
    });
});

describe("matchesRecipeQuery", () => {
    test("an empty query matches, a name match ignores case and padding", () => {
        expect(matchesRecipeQuery(recipe("a", "Egg Fried Rice"), "  ")).toBe(
            true,
        );
        expect(
            matchesRecipeQuery(recipe("a", "Egg Fried Rice"), " fried "),
        ).toBe(true);
        expect(matchesRecipeQuery(recipe("a", "Egg Fried Rice"), "curry")).toBe(
            false,
        );
    });
});
