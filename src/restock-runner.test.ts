import { expect, test } from "bun:test";
import { createMemoryFlags } from "./flags.js";
import { EMPTY_HOUSEHOLD_PREFERENCES } from "./household.js";
import {
    filterRestockRunnerHouseholds,
    restockHouseholdsFromRows,
} from "./restock-runner.js";
import type { RestockEnabledHouseholdRow } from "./db/restock.js";

test("restockHouseholdsFromRows keeps household with valid name", () => {
    const logs: string[] = [];
    const row: RestockEnabledHouseholdRow = {
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        name: "Test household",
        recipe_search_places: [],
        household_preferences: {
            ...EMPTY_HOUSEHOLD_PREFERENCES,
            restock: {
                enabled: true,
                weekday: 6,
                time: "07:00",
                lastRunOn: null,
            },
        },
    };
    const got = restockHouseholdsFromRows([row], (m) => logs.push(m));
    expect(got).toHaveLength(1);
    expect(got[0]!.id).toBe(row.id);
    expect(got[0]!.preferences.restock.enabled).toBe(true);
    expect(logs).toHaveLength(0);
});

test("restockHouseholdsFromRows logs and skips malformed row", () => {
    const logs: string[] = [];
    const row: RestockEnabledHouseholdRow = {
        id: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
        name: "   ",
        recipe_search_places: [],
        household_preferences: EMPTY_HOUSEHOLD_PREFERENCES,
    };
    expect(restockHouseholdsFromRows([row], (m) => logs.push(m))).toHaveLength(
        0,
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]).toBe(
        "[restock] household=bbbbbbbb skipped: Enter a household name.",
    );
    expect(logs[0]).not.toMatch(/Eggs|Milk/i);
});

test("filterRestockRunnerHouseholds skips only households with restock-runner off", async () => {
    const hhOn = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const hhOff = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const flags = createMemoryFlags({
        "restock-runner": (ctx) => ctx.household_id === hhOn,
    });
    const prefs = {
        ...EMPTY_HOUSEHOLD_PREFERENCES,
        restock: {
            enabled: true,
            weekday: 6 as const,
            time: "00:00",
            lastRunOn: null,
        },
    };
    const logs: string[] = [];
    const filtered = await filterRestockRunnerHouseholds(
        [
            { id: hhOn, preferences: prefs },
            { id: hhOff, preferences: prefs },
        ],
        (m) => logs.push(m),
        flags.isEnabled.bind(flags),
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe(hhOn);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toBe(
        "[restock] household=bbbbbbbb skipped: restock runner disabled",
    );
});
