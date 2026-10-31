import { test, expect } from "bun:test";
import {
    EMPTY_HOUSEHOLD_PREFERENCES,
    householdConfigFromRow,
    householdConfigToColumns,
    mergeHouseholdConfig,
    parseHouseholdConfigPatch,
    type HouseholdConfig,
} from "./household.js";

const current: HouseholdConfig = {
    name: "Home",
    recipeSearchPlaces: [{ name: "Costco", kind: "grocery", url: null }],
    preferences: {
        constraints: ["nut-free"],
        budget: "tight",
        shoppingCadence: "weekly",
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
        },
    });
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
