import { liveFoodsStore } from "./db/foods.js";
import { liveFridgeStore } from "./db/fridge.js";
import { liveGroceryStore } from "./db/grocery.js";
import { liveNoticeDismissalsStore } from "./db/notice-dismissals.js";
import { getHouseholdOwnerProfile } from "./db/household.js";
import { listRestockEnabledHouseholds } from "./db/restock.js";
import { liveRestockStore } from "./db/restock.js";
import { liveSettingsStore } from "./db/settings.js";
import { householdConfigFromRow } from "./household.js";
import { runRestockCheck, startRestockRuns } from "./domain/restock.js";

function liveRestockCheckDeps() {
    const restock = liveRestockStore();
    const fridge = liveFridgeStore();
    const foods = liveFoodsStore();
    const grocery = liveGroceryStore();
    const settings = liveSettingsStore();
    const dismissals = liveNoticeDismissalsStore();
    return {
        listEnabled: async () => {
            const rows = await listRestockEnabledHouseholds();
            return rows
                .map((row) => {
                    const parsed = householdConfigFromRow({
                        name: "",
                        recipe_search_places: [],
                        household_preferences: row.household_preferences,
                    });
                    if (!parsed.ok) return null;
                    return {
                        id: row.id,
                        preferences: parsed.value.preferences,
                    };
                })
                .filter((row) => row != null);
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
