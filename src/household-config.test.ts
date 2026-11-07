import { test, expect } from "bun:test";
import {
    EMPTY_HOUSEHOLD_PREFERENCES,
    householdConfigFromRow,
    householdConfigToColumns,
    mergeHouseholdConfig,
    parseHouseholdConfigPatch,
    parseUnverifiedRecipeExpiryDays,
    type HouseholdConfig,
} from "./household.js";

const current: HouseholdConfig = {
    name: "Home",
    recipeSearchPlaces: [{ name: "Costco", kind: "grocery", url: null }],
    preferences: {
        constraints: ["nut-free"],
        budget: "tight",
        shoppingCadence: "weekly",
        unverifiedRecipeExpiryDays: null,
    },
};

test("parse rejects an unknown recipe place kind and leaves merge unused", () => {
    const parsed = parseHouseholdConfigPatch({
        recipe_search_places: [
            { name: "Costco", kind: "warehouse", url: null },
        ],
    });
    expect(parsed).toEqual({
        ok: false,
        error: "Unknown recipe place kind.",
    });
    expect(mergeHouseholdConfig(current, {})).toEqual(current);
});

test("preference merge keeps unspecified fields", () => {
    const parsed = parseHouseholdConfigPatch({
        preferences: { budget: "ok", shopping_cadence: "monthly" },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(mergeHouseholdConfig(current, parsed.value)).toEqual({
        ...current,
        preferences: {
            constraints: ["nut-free"],
            budget: "ok",
            shoppingCadence: "monthly",
            unverifiedRecipeExpiryDays: null,
        },
    });
});

test("unverified recipe expiry defaults null and validates range", () => {
    expect(parseUnverifiedRecipeExpiryDays(undefined, true)).toEqual({
        ok: true,
        value: null,
    });
    expect(parseUnverifiedRecipeExpiryDays(30, false)).toEqual({
        ok: true,
        value: 30,
    });
    expect(parseUnverifiedRecipeExpiryDays(0, false).ok).toBe(false);
    expect(parseUnverifiedRecipeExpiryDays("nope", false).ok).toBe(false);
});

test("a missing preferences object on a row becomes empty preferences", () => {
    const parsed = householdConfigFromRow({
        name: "Home",
        recipe_search_places: [],
        household_preferences: {},
    });
    expect(parsed).toEqual({
        ok: true,
        value: {
            name: "Home",
            recipeSearchPlaces: [],
            preferences: EMPTY_HOUSEHOLD_PREFERENCES,
        },
    });
});

test("toColumns then fromRow returns the same config", () => {
    const parsed = householdConfigFromRow(householdConfigToColumns(current));
    expect(parsed).toEqual({ ok: true, value: current });
});

test("fromRow rejects a donor type place instead of mapping it", () => {
    const parsed = householdConfigFromRow({
        name: "Home",
        recipe_search_places: [{ name: "Costco", type: "grocery" }],
        household_preferences: {},
    });
    expect(parsed).toEqual({
        ok: false,
        error: "Unknown recipe place kind.",
    });
});
