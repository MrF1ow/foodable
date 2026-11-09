import {
    buildBackgroundFlagContext,
    isEnabled as defaultIsEnabled,
    type FlagContext,
    type FlagName,
} from "./flags.js";
import { runAsSystem, withActor } from "./db/actor.js";
import { liveFoodsStore } from "./db/foods.js";
import { liveFridgeStore } from "./db/fridge.js";
import { liveGroceryStore } from "./db/grocery.js";
import { liveNoticeDismissalsStore } from "./db/notice-dismissals.js";
import { getHouseholdOwnerProfile } from "./db/household.js";
import {
    listRestockEnabledHouseholds,
    type RestockEnabledHouseholdRow,
} from "./db/restock.js";
import { liveRestockStore } from "./db/restock.js";
import { liveSettingsStore } from "./db/settings.js";
import {
    householdConfigFromRow,
    type HouseholdPreferences,
} from "./household.js";
import { runRestockCheck, startRestockRuns } from "./domain/restock.js";

export type RestockRunnerIsEnabled = (
    flag: FlagName,
    ctx: FlagContext,
) => boolean;

export function filterRestockRunnerHouseholds<
    T extends { id: string; preferences: HouseholdPreferences },
>(
    households: T[],
    log: (msg: string) => void,
    isEnabled: RestockRunnerIsEnabled = defaultIsEnabled,
): T[] {
    const out: T[] = [];
    for (const household of households) {
        const ctx = buildBackgroundFlagContext(household.id);
        if (!isEnabled("restock-runner", ctx)) {
            log(
                `[restock] household=${household.id.slice(0, 8)} skipped: restock runner disabled`,
            );
            continue;
        }
        out.push(household);
    }
    return out;
}

export function restockHouseholdsFromRows(
    rows: RestockEnabledHouseholdRow[],
    log: (msg: string) => void,
): Array<{ id: string; preferences: HouseholdPreferences }> {
    const out: Array<{ id: string; preferences: HouseholdPreferences }> = [];
    for (const row of rows) {
        const parsed = householdConfigFromRow({
            name: row.name,
            recipe_search_places: row.recipe_search_places,
            household_preferences: row.household_preferences,
        });
        if (!parsed.ok) {
            log(
                `[restock] household=${row.id.slice(0, 8)} skipped: ${parsed.error}`,
            );
            continue;
        }
        out.push({ id: row.id, preferences: parsed.value.preferences });
    }
    return out;
}

export function liveRestockCheckDeps() {
    const restock = liveRestockStore();
    const fridge = liveFridgeStore();
    const foods = liveFoodsStore();
    const grocery = liveGroceryStore();
    const settings = liveSettingsStore();
    const dismissals = liveNoticeDismissalsStore();
    return {
        // Finding which households are due spans every household, so it is
        // the system's; each household's own check then acts as that household.
        listEnabled: async () => {
            const rows = await runAsSystem("restock household list", () =>
                listRestockEnabledHouseholds(),
            );
            const log = (msg: string) => console.log(msg);
            const households = restockHouseholdsFromRows(rows, log);
            return filterRestockRunnerHouseholds(households, log);
        },
        getOwnerProfile: (householdId: string) =>
            getHouseholdOwnerProfile(householdId),
        fridge,
        foods,
        grocery,
        settings,
        dismissals,
        restock,
        forHousehold: <T>(householdId: string, work: () => Promise<T>) =>
            withActor({ kind: "household", householdId }, work),
    };
}

export function bootRestockRuns(): void {
    startRestockRuns(() => runRestockCheck(liveRestockCheckDeps()));
}
