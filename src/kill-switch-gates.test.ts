// The kill-switch gates (online food lookups, the recipe link reader, the
// restock runner) ask through the pin runtime by default, so a Railway outage
// keeps a household's last-known value instead of falling back to on.
import { afterEach, describe, expect, test } from "bun:test";
import { createMemoryFlagPinStore } from "./domain/flag-pins.js";
import {
    createRailwayFlags,
    resetFlagsForTests,
    setFlagsForTests,
    type RailwayFlagsSdk,
} from "./flags.js";
import { createFlagPinRuntime, setFlagPinsForTests } from "./flag-pins.js";
import { foodLookupsOnline } from "./foods.js";
import {
    recipeImportFetcher,
    recipeLinkReaderEnabled,
} from "./recipe-url-fetcher.js";
import { filterRestockRunnerHouseholds } from "./restock-runner.js";
import { EMPTY_HOUSEHOLD_PREFERENCES } from "./household.js";

const H1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const H2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * A Railway SDK that turns the given flag off for H1 while healthy, and
 * answers STALE with the registry default for everything once `stale` is set.
 */
function railwayOutage(flag: string) {
    const state = { stale: false };
    const sdk: RailwayFlagsSdk = {
        synced: true,
        init: async () => {},
        evaluateBoolean: (name, ctx, fallback) => {
            if (state.stale) {
                return { value: fallback, reason: "STALE" } as ReturnType<
                    RailwayFlagsSdk["evaluateBoolean"]
                >;
            }
            const off = name === flag && ctx?.household_id === H1;
            return {
                value: !off,
                reason: off ? "TARGETING_MATCH" : "NO_MATCH",
            } as ReturnType<RailwayFlagsSdk["evaluateBoolean"]>;
        },
        evaluateNumber: (_name, _ctx, fallback) =>
            ({ value: fallback, reason: "NOT_FOUND" }) as ReturnType<
                RailwayFlagsSdk["evaluateNumber"]
            >,
    } as RailwayFlagsSdk;
    const reader = createRailwayFlags(sdk);
    reader.markInitDone();
    setFlagsForTests(reader);
    setFlagPinsForTests(
        createFlagPinRuntime({
            store: createMemoryFlagPinStore(),
            sleep: async () => {},
        }),
    );
    return {
        goStale() {
            state.stale = true;
        },
    };
}

afterEach(() => {
    resetFlagsForTests();
    setFlagPinsForTests(null);
});

describe("kill-switch gates during a Railway outage", () => {
    test("online food lookups stay off for the household that had them off", async () => {
        const outage = railwayOutage("off-lookups");
        expect(await foodLookupsOnline({ householdId: H1 })).toBe(false);
        expect(await foodLookupsOnline({ householdId: H2 })).toBe(true);

        outage.goStale();
        expect(await foodLookupsOnline({ householdId: H1 })).toBe(false);
        // H2 was read on, and a household never read falls back to on.
        expect(await foodLookupsOnline({ householdId: H2 })).toBe(true);
        expect(
            await foodLookupsOnline({
                householdId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            }),
        ).toBe(true);
    });

    test("the recipe link reader stays off for the household that had it off", async () => {
        const outage = railwayOutage("recipe-link-reader");
        expect(await recipeLinkReaderEnabled(H1)).toBe(false);

        outage.goStale();
        expect(await recipeLinkReaderEnabled(H1)).toBe(false);
        expect(await recipeLinkReaderEnabled(H2)).toBe(true);

        const fetcher = await recipeImportFetcher({ householdId: H1 });
        expect(await fetcher.robotsAllows("https://example.com/recipe")).toBe(
            false,
        );
        const page = await fetcher.fetchPage("https://example.com/recipe", {
            accept: ["text/html"],
        });
        expect(page.ok).toBe(false);
    });

    test("the restock runner keeps skipping the household that had it off", async () => {
        const outage = railwayOutage("restock-runner");
        const households = [
            { id: H1, preferences: EMPTY_HOUSEHOLD_PREFERENCES },
            { id: H2, preferences: EMPTY_HOUSEHOLD_PREFERENCES },
        ];
        const before = await filterRestockRunnerHouseholds(
            households,
            () => {},
        );
        expect(before.map((h) => h.id)).toEqual([H2]);

        outage.goStale();
        const logs: string[] = [];
        const during = await filterRestockRunnerHouseholds(households, (m) =>
            logs.push(m),
        );
        expect(during.map((h) => h.id)).toEqual([H2]);
        expect(logs).toEqual([
            "[restock] household=aaaaaaaa skipped: restock runner disabled",
        ]);
    });
});
