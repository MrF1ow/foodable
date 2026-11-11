import { test, expect } from "bun:test";
import {
    DEFAULT_RESTOCK,
    EMPTY_HOUSEHOLD_PREFERENCES,
    householdConfigFromRow,
    householdConfigToColumns,
    householdTimezone,
    isRestockTime,
    isRestockWeekday,
    mergeHouseholdConfig,
    parseHouseholdConfigPatch,
    RESTOCK_ENABLED_ERROR,
    RESTOCK_WEEKDAY_ERROR,
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
        timezone: "Europe/Kyiv",
        restock: {
            enabled: true,
            weekday: 6,
            time: "07:00",
            lastRunOn: "2026-11-01",
        },
        unverifiedRecipeExpiryDays: null,
        socialReaders: { tiktok: false, facebook: false },
    },
};

test("plurals_same_food parses as boolean", () => {
    expect(parseHouseholdConfigPatch({ plurals_same_food: true })).toEqual({
        ok: true,
        value: { pluralsSameFood: true },
    });
    expect(parseHouseholdConfigPatch({ plurals_same_food: "yes" })).toEqual({
        ok: false,
        error: expect.stringContaining("singular and plural"),
    });
});

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
            timezone: "Europe/Kyiv",
            restock: current.preferences.restock,
            unverifiedRecipeExpiryDays: null,
            socialReaders: { tiktok: false, facebook: false },
        },
    });
});

test("merge preserves lastRunOn when restock fields change", () => {
    const parsed = parseHouseholdConfigPatch({
        restock_enabled: false,
        restock_time: "08:30",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const merged = mergeHouseholdConfig(current, parsed.value);
    expect(merged.preferences.restock.lastRunOn).toBe("2026-11-01");
    expect(merged.preferences.restock.enabled).toBe(false);
    expect(merged.preferences.restock.time).toBe("08:30");
});

test("preferences patch ignores socialReaders", () => {
    const parsed = parseHouseholdConfigPatch({
        preferences: {
            social_readers: { tiktok: true, facebook: true },
            budget: "low",
        },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
        (parsed.value.preferences as { socialReaders?: unknown } | undefined)
            ?.socialReaders,
    ).toBeUndefined();
    expect(
        mergeHouseholdConfig(current, parsed.value).preferences.socialReaders,
    ).toEqual({ tiktok: false, facebook: false });
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

test("fromRow tolerates production shape with constraints only", () => {
    const parsed = householdConfigFromRow({
        name: "Home",
        recipe_search_places: [],
        household_preferences: {
            constraints: ["vegan"],
            budget: "medium",
            shoppingCadence: "weekly",
        },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.preferences.timezone).toBeNull();
    expect(parsed.value.preferences.restock).toEqual(DEFAULT_RESTOCK);
});

test("fromRow forgives malformed restock fields", () => {
    const parsed = householdConfigFromRow({
        name: "Home",
        recipe_search_places: [],
        household_preferences: {
            restock: {
                enabled: "yes",
                weekday: 9,
                time: "7:00",
                lastRunOn: "not-a-date",
            },
            timezone: 12,
        },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.preferences.timezone).toBeNull();
    expect(parsed.value.preferences.restock).toEqual(DEFAULT_RESTOCK);
});

test("fromRow drops invalid timezone string", () => {
    const parsed = householdConfigFromRow({
        name: "Home",
        recipe_search_places: [],
        household_preferences: { timezone: "Mars/Phobos" },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.preferences.timezone).toBeNull();
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

test("isRestockWeekday accepts 0–6 and rejects junk", () => {
    expect(isRestockWeekday(0)).toBe(true);
    expect(isRestockWeekday(6)).toBe(true);
    expect(isRestockWeekday(7)).toBe(false);
    expect(isRestockWeekday(-1)).toBe(false);
    expect(isRestockWeekday(1.5)).toBe(false);
    expect(isRestockWeekday(NaN)).toBe(false);
    expect(isRestockWeekday("3")).toBe(false);
});

test("isRestockTime accepts HH:MM and rejects junk", () => {
    expect(isRestockTime("00:00")).toBe(true);
    expect(isRestockTime("07:00")).toBe(true);
    expect(isRestockTime("23:59")).toBe(true);
    expect(isRestockTime("7:00")).toBe(false);
    expect(isRestockTime("24:00")).toBe(false);
    expect(isRestockTime("12:60")).toBe(false);
    expect(isRestockTime("07:00:00")).toBe(false);
    expect(isRestockTime("")).toBe(false);
});

test("parseHouseholdConfigPatch validates timezone weekday and time", () => {
    expect(parseHouseholdConfigPatch({ timezone: "Mars/Phobos" })).toEqual({
        ok: false,
        error: "Enter a valid IANA timezone.",
    });
    expect(parseHouseholdConfigPatch({ restock_weekday: 7 })).toEqual({
        ok: false,
        error: "Pick a day from Sunday to Saturday.",
    });
    expect(parseHouseholdConfigPatch({ restock_time: "24:00" })).toEqual({
        ok: false,
        error: "Enter a time as HH:MM, 24-hour.",
    });
});

test("parseRestockPatchFields rejects non-boolean enabled and non-numeric weekday", () => {
    expect(parseHouseholdConfigPatch({ restock_enabled: "yes" })).toEqual({
        ok: false,
        error: RESTOCK_ENABLED_ERROR,
    });
    expect(parseHouseholdConfigPatch({ restock_enabled: 1 })).toEqual({
        ok: false,
        error: RESTOCK_ENABLED_ERROR,
    });
    for (const weekday of ["", null, true, "3"] as const) {
        expect(parseHouseholdConfigPatch({ restock_weekday: weekday })).toEqual(
            { ok: false, error: RESTOCK_WEEKDAY_ERROR },
        );
    }
    expect(parseHouseholdConfigPatch({ restock_weekday: 1.5 })).toEqual({
        ok: false,
        error: RESTOCK_WEEKDAY_ERROR,
    });
});

test("householdTimezone resolution", () => {
    expect(
        householdTimezone(
            { timezone: "Europe/Kyiv" },
            { timezone: "America/Los_Angeles" },
        ),
    ).toBe("Europe/Kyiv");
    expect(
        householdTimezone(
            { timezone: null },
            { timezone: "America/Los_Angeles" },
        ),
    ).toBe("America/Los_Angeles");
    expect(householdTimezone({ timezone: null }, null)).toBe("UTC");
    expect(
        householdTimezone(
            { timezone: "Mars/Phobos" },
            { timezone: "America/Los_Angeles" },
        ),
    ).toBe("America/Los_Angeles");
    expect(
        householdTimezone(
            { timezone: "Mars/Phobos" },
            { timezone: "also-bad" },
        ),
    ).toBe("UTC");
});
