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
        listEnabled: async () => {
            const rows = await listRestockEnabledHouseholds();
            return restockHouseholdsFromRows(rows, (msg) => console.log(msg));
        },
        getOwnerProfile: (householdId: string) =>
            getHouseholdOwnerProfile(householdId),
        fridge,
        foods,
        grocery,
        settings,
        dismissals,
        restock,
    };
}

export function bootRestockRuns(): void {
    startRestockRuns(() => runRestockCheck(liveRestockCheckDeps()));
}
