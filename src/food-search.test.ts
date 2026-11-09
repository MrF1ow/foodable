import { test, expect, mock, beforeEach, afterEach, describe } from "bun:test";
import { searchFoodsByName } from "./food-search.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "./flags.js";
import {
    ONLINE_FOOD_LOOKUPS_PAUSED_MESSAGE,
    type FoodResult,
} from "./foods.js";

const realFetch = globalThis.fetch;

function mockFetch(impl: (url: string) => Response | Promise<Response>) {
    globalThis.fetch = mock((input: string | URL | Request) =>
        Promise.resolve(impl(String(input))),
    ) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function food(
    over: Partial<FoodResult> & Pick<FoodResult, "name" | "barcode">,
): FoodResult {
    return {
        brand: null,
        serving: "100 g",
        calories: 80,
        protein_g: 11,
        carbs_g: 3,
        fat_g: 2,
        fiber_g: 0,
        sugar_g: 3,
        alcohol_g: null,
        nutriscore_grade: null,
        nova_group: null,
        source: `off:${over.barcode}`,
        source_name: "openfoodfacts",
        ...over,
    };
}

beforeEach(() => {
    process.env.OFF_USER_AGENT = "foodable-test (test@example.com)";
});

afterEach(() => {
    globalThis.fetch = realFetch;
});

describe("searchFoodsByName", () => {
    test('searchFoodsByName("cottage") returns a FoodResult with a stable source id', async () => {
        mockFetch((url) => {
            expect(url).toContain("cgi/search.pl");
            expect(url).toContain("search_terms=cottage");
            return jsonResponse({
                products: [
                    {
                        code: "070852010016",
                        product_name: "Good Culture Cottage Cheese",
                        brands: "Good Culture",
                        nutriments: {
                            "energy-kcal_100g": 80,
                            proteins_100g: 11,
                        },
                    },
                ],
            });
        });

        const results = await searchFoodsByName("cottage", [], {
            searchCache: async () => [],
        });
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.source).toBe("off:070852010016");
        expect(results[0]!.name).toBe("Good Culture Cottage Cheese");
        expect(results[0]!.source_name).toBe("openfoodfacts");
        expect(results[0]!.barcode).toBe("070852010016");
    });

    test("returns a cache hit even when Open Food Facts is empty", async () => {
        const cached = food({
            name: "Cached Cottage Cheese",
            barcode: "111111111111",
            calories: 90,
        });

        const results = await searchFoodsByName("cottage", [], {
            searchCache: async (query) => {
                expect(query).toBe("cottage");
                return [cached];
            },
            searchOff: async () => [],
        });

        expect(results).toEqual([cached]);
        expect(results[0]!.source).toBe("off:111111111111");
    });

    test("upserts Open Food Facts hits into food_cache", async () => {
        const remembered: FoodResult[] = [];
        mockFetch(() =>
            jsonResponse({
                products: [
                    {
                        code: "070852010016",
                        product_name: "Good Culture Cottage Cheese",
                        brands: "Good Culture",
                        nutriments: {
                            "energy-kcal_100g": 80,
                            proteins_100g: 11,
                        },
                    },
                ],
            }),
        );

        const results = await searchFoodsByName("cottage", [], {
            searchCache: async () => [],
            remember: async (hit) => {
                remembered.push(hit);
            },
        });

        expect(results).toHaveLength(1);
        expect(remembered).toHaveLength(1);
        expect(remembered[0]!.source).toBe("off:070852010016");
        expect(remembered[0]!.name).toBe("Good Culture Cottage Cheese");
    });

    test("ranks a household fridge or recipe name above a distant OFF hit", async () => {
        mockFetch(() =>
            jsonResponse({
                products: [
                    {
                        code: "999999999999",
                        product_name: "Cottage Pie Mix",
                        brands: "Generic Brand",
                        nutriments: { "energy-kcal_100g": 140 },
                    },
                    {
                        code: "070852010016",
                        product_name: "Good Culture Cottage Cheese",
                        brands: "Good Culture",
                        nutriments: {
                            "energy-kcal_100g": 80,
                            proteins_100g: 11,
                        },
                    },
                ],
            }),
        );

        const results = await searchFoodsByName(
            "cottage",
            ["Good Culture Cottage Cheese"],
            { searchCache: async () => [] },
        );

        expect(results.length).toBeGreaterThanOrEqual(2);
        expect(results[0]!.name).toBe("Good Culture Cottage Cheese");
        expect(results[0]!.source).toBe("off:070852010016");
        expect(results.some((hit) => hit.name === "Cottage Pie Mix")).toBe(
            true,
        );
        expect(
            results.findIndex((hit) => hit.name === "Cottage Pie Mix"),
        ).toBeGreaterThan(0);
    });

    test("throws when OFF_USER_AGENT is unset", async () => {
        delete process.env.OFF_USER_AGENT;
        expect(
            searchFoodsByName("cottage", [], { searchCache: async () => [] }),
        ).rejects.toThrow(/OFF_USER_AGENT/);
    });

    test("skips Open Food Facts when isEnabled returns false", async () => {
        let offCalled = false;
        mockFetch(() => {
            throw new Error("fetch must not run");
        });
        const notice = { message: null as string | null };
        const cached = food({
            name: "Saved Cottage Cheese",
            barcode: "111111111111",
        });
        const results = await searchFoodsByName("cottage", [], {
            householdId: "hh-test",
            isEnabled: () => false,
            notice,
            searchCache: async () => [cached],
            searchOff: async () => {
                offCalled = true;
                return [];
            },
        });
        expect(offCalled).toBe(false);
        expect(results).toEqual([cached]);
        expect(notice.message).toBe(ONLINE_FOOD_LOOKUPS_PAUSED_MESSAGE);
    });

    test("default isEnabled respects off-lookups flag via householdId", async () => {
        setFlagsForTests(createMemoryFlags({ "off-lookups": false }));
        try {
            let offCalled = false;
            mockFetch(() => {
                throw new Error("fetch must not run");
            });
            await searchFoodsByName("cottage", [], {
                householdId: "hh-web-search",
                searchCache: async () => [],
                searchOff: async () => {
                    offCalled = true;
                    return [];
                },
            });
            expect(offCalled).toBe(false);
        } finally {
            resetFlagsForTests();
        }
    });

    test("returns an empty list for a blank query without fetching", async () => {
        let fetched = false;
        mockFetch(() => {
            fetched = true;
            return jsonResponse({ products: [] });
        });
        expect(await searchFoodsByName("   ")).toEqual([]);
        expect(fetched).toBe(false);
    });
});
