import type { AuthContext } from "../auth-context.js";
import {
    buildHouseholdDigest,
    groceryListFoodIdsForSuggestions,
    usualsAtZeroForDigest,
    type HouseholdDigest,
    type HouseholdDigestInputs,
} from "../domain/household-digest.js";
import { buildDailyBuckets, isCalendarDate } from "../domain/insights.js";
import { restockPlan } from "../domain/restock.js";
import { effectiveFoodsFromListed } from "../domain/foods.js";
import { dismissedKeySet } from "../domain/notice-dismissals.js";
import { shiftLocalDate, todayInTz, zonedDayStartUtc } from "../domain/tz.js";
import {
    membersForHouseholdNutritionDigest,
    householdTimezone,
} from "../household.js";
import {
    getHouseholdConfig,
    getHouseholdOwnerProfile,
    listHouseholdMembers,
} from "./household.js";
import type { Profile } from "./profiles.js";
import { liveFridgeStore } from "./fridge.js";
import { liveStockStore } from "./stock.js";
import { liveGroceryStore } from "./grocery.js";
import { liveFoodsStore } from "./foods.js";
import { liveNoticeDismissalsStore } from "./notice-dismissals.js";
import { liveSettingsStore } from "./settings.js";
import {
    getMealsInRange,
    getWaterInRange,
    getGoalsForRange,
} from "./nutrition.js";
import { getProfile, timezoneFromProfile } from "./profiles.js";
import type { ViewerFlags } from "../viewer-flags.js";
import { isViewerFlagOn } from "../viewer-flags.js";
import type { AlcoholDisplay } from "../mcp/shared.js";
import { gateAlcohol } from "../mcp/shared.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDigestWeekEnd(
    weekOf: string | undefined,
    timezone: string,
): { end: string; start: string; today: string } {
    const today = todayInTz(timezone);
    const end = weekOf?.trim() || today;
    if (!DATE_RE.test(end)) {
        throw new Error("week_of must be YYYY-MM-DD.");
    }
    if (!isCalendarDate(end)) {
        throw new Error("week_of must be a real calendar date.");
    }
    const start = shiftLocalDate(end, -6);
    return { end, start, today };
}

export async function loadHouseholdDigestInputs(
    auth: AuthContext,
    viewerUserId: string | null,
    householdId: string,
    window: { from: string; to: string },
    today: string,
    timezone: string,
    householdConfig: Awaited<ReturnType<typeof getHouseholdConfig>>,
    ownerProfile: Profile | null,
    viewerAlcohol: AlcoholDisplay,
): Promise<HouseholdDigestInputs> {
    const movementSince = zonedDayStartUtc(window.from, timezone).toISOString();
    const [members, items, movements, groceryLines, dismissals] =
        await Promise.all([
            listHouseholdMembers(householdId),
            liveFridgeStore().listItems(householdId),
            liveStockStore().listMovements(
                householdId,
                undefined,
                movementSince,
            ),
            liveGroceryStore().listLines(householdId),
            liveNoticeDismissalsStore().listForHousehold(householdId),
        ]);
    const tz =
        timezone ||
        householdTimezone(
            householdConfig.preferences,
            ownerProfile ?? undefined,
        );
    const settings = liveSettingsStore();
    const stores = await settings.listStores(householdId);
    const sections = (
        await Promise.all(
            stores.map((store) => settings.listSections(store.id)),
        )
    ).flat();
    const visibleMembers = membersForHouseholdNutritionDigest(
        auth,
        viewerUserId,
        householdId,
        members,
    );

    const listed = await liveFoodsStore().listFoods(householdId);
    const foodsByIdFull = effectiveFoodsFromListed(listed);
    const groceryListFoodIds = groceryListFoodIdsForSuggestions(
        groceryLines,
        foodsByIdFull,
    );

    const displayNameByFoodId = new Map<string, string>();
    for (const food of listed) {
        displayNameByFoodId.set(food.id, food.name);
    }
    for (const item of items) {
        if (item.foodId && item.displayName) {
            displayNameByFoodId.set(item.foodId, item.displayName);
        }
    }

    const groceryPreferences =
        await settings.getGroceryPreferences(householdId);
    const restock = restockPlan({
        items,
        foodsById: foodsByIdFull,
        lines: groceryLines,
        dismissed: dismissedKeySet(dismissals),
        today,
        stores,
        sections,
        householdId,
        groceryPreferences,
    });
    const stock = {
        movements,
        fridgeItems: items,
        displayNameByFoodId,
    };
    const usualAtZero = usualsAtZeroForDigest({
        items,
        foods: listed,
        foodsById: foodsByIdFull,
        stores,
        lines: groceryLines,
        groceryPreferences,
    });

    const memberInputs = await Promise.all(
        visibleMembers.map(async (member) => {
            const profile = await getProfile(member.userId);
            const memberTz = timezoneFromProfile(profile) ?? tz;
            const [meals, water, { forDate }] = await Promise.all([
                getMealsInRange(
                    member.userId,
                    window.from,
                    window.to,
                    memberTz,
                ),
                getWaterInRange(
                    member.userId,
                    window.from,
                    window.to,
                    memberTz,
                ),
                getGoalsForRange(member.userId, window.from, window.to),
            ]);
            const buckets = buildDailyBuckets(
                meals,
                water,
                window.from,
                window.to,
                memberTz,
            );
            const memberTracksAlcohol =
                profile?.alcohol_tracking_enabled ?? false;
            const showAlcohol =
                viewerAlcohol != null && memberTracksAlcohol
                    ? viewerAlcohol
                    : null;
            const gatedBuckets = gateAlcohol(buckets, showAlcohol);
            return {
                memberId: member.userId,
                displayName: member.displayName,
                buckets: gatedBuckets,
                goalsOn: forDate,
            };
        }),
    );

    return {
        timezone: tz,
        today,
        window,
        fridgeItems: items,
        stock,
        members: memberInputs,
        restockLines: restock.lines,
        usualAtZero,
        groceryLines,
        groceryListFoodIds,
    };
}

export async function buildHouseholdDigestForViewer(
    auth: AuthContext,
    viewerUserId: string | null,
    householdId: string,
    weekOf: string | undefined,
    viewerAlcohol: AlcoholDisplay,
): Promise<HouseholdDigest> {
    const config = await getHouseholdConfig(householdId);
    const owner = await getHouseholdOwnerProfile(householdId);
    const tz = householdTimezone(config.preferences, owner ?? undefined);
    const { end, start, today } = parseDigestWeekEnd(weekOf, tz);
    const inputs = await loadHouseholdDigestInputs(
        auth,
        viewerUserId,
        householdId,
        { from: start, to: end },
        today,
        tz,
        config,
        owner,
        viewerAlcohol,
    );
    return buildHouseholdDigest(inputs);
}

export function householdDigestFlagOn(flags: ViewerFlags): boolean {
    return isViewerFlagOn(flags, "mcp-household-digest");
}
