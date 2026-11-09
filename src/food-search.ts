import {
    ONLINE_FOOD_LOOKUPS_PAUSED_MESSAGE,
    SOURCE_OFF,
    fetchProductsByNameFromOFF,
    foodLookupsOnline,
    putCachedFood,
    searchCachedFoodsByName,
    type FoodLookupOptions,
    type FoodResult,
} from "./foods.js";

type FoodSearchHooks = FoodLookupOptions & {
    searchCache?: (query: string) => Promise<FoodResult[]>;
    searchOff?: (query: string) => Promise<FoodResult[]>;
    remember?: (food: FoodResult) => Promise<void>;
};

function mergeBySource(hits: FoodResult[]): FoodResult[] {
    const bySource = new Map<string, FoodResult>();
    for (const hit of hits) {
        if (!bySource.has(hit.source)) bySource.set(hit.source, hit);
    }
    return [...bySource.values()];
}

function householdNamesMatchingQuery(
    query: string,
    householdNames: string[],
): string[] {
    const needle = query.trim().toLowerCase();
    return householdNames.filter((name) =>
        name.trim().toLowerCase().includes(needle),
    );
}

function isHouseholdHit(food: FoodResult, names: string[]): boolean {
    const hay = `${food.name} ${food.brand ?? ""}`.toLowerCase();
    const foodName = food.name.toLowerCase();
    return names.some((name) => {
        const n = name.trim().toLowerCase();
        if (!n) return false;
        return hay.includes(n) || n.includes(foodName);
    });
}

function rankHouseholdFirst(
    hits: FoodResult[],
    query: string,
    householdNames: string[],
): FoodResult[] {
    const matchingNames = householdNamesMatchingQuery(query, householdNames);
    if (matchingNames.length === 0) return hits;
    const boosted: FoodResult[] = [];
    const rest: FoodResult[] = [];
    for (const hit of hits) {
        if (isHouseholdHit(hit, matchingNames)) boosted.push(hit);
        else rest.push(hit);
    }
    return [...boosted, ...rest];
}

async function rememberOffHit(food: FoodResult): Promise<void> {
    await putCachedFood(SOURCE_OFF, food.barcode, food);
}

export async function searchFoodsByName(
    query: string,
    householdNames: string[] = [],
    hooks: FoodSearchHooks = {},
): Promise<FoodResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const searchCache = hooks.searchCache ?? searchCachedFoodsByName;
    const searchOff = hooks.searchOff ?? fetchProductsByNameFromOFF;
    const remember = hooks.remember ?? rememberOffHit;

    const cacheHits = await searchCache(trimmed);
    const online = foodLookupsOnline(hooks);
    if (!online) {
        if (hooks.notice) {
            hooks.notice.message = ONLINE_FOOD_LOOKUPS_PAUSED_MESSAGE;
        }
        return rankHouseholdFirst(
            mergeBySource(cacheHits),
            trimmed,
            householdNames,
        );
    }
    const offHits = await searchOff(trimmed);
    for (const hit of offHits) {
        await remember(hit);
    }
    return rankHouseholdFirst(
        mergeBySource([...cacheHits, ...offHits]),
        trimmed,
        householdNames,
    );
}
