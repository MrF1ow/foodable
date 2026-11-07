import type { RestockPreferences } from "../household.js";
import type { EffectiveFood } from "./foods.js";
import { familyOf } from "./foods.js";
import type { FridgeItem } from "./fridge.js";
import {
    pickGroceryAmount,
    pickGroceryStore,
    suggestGrocerySection,
    onGroceryList,
    type GroceryLine,
} from "./grocery.js";
import { dismissedKeySet, isDismissedIn } from "./notice-dismissals.js";
import type { NoticeDismissalsStore } from "./notice-dismissals.js";
import { NOTICE_SEVERITY, type Notice } from "./notices.js";
import { convertStockAmount, daysUntilExpiry, fridgeNotices } from "./stock.js";
import type {
    GrocerySection,
    GroceryStore,
    SettingsStore,
} from "./settings.js";
import type { FridgeStore } from "./fridge.js";
import type { FoodsStore } from "./foods.js";
import type { GroceryListStore } from "./grocery.js";
import { effectiveFoodsByIds } from "./foods.js";
import { isQuantityUnit } from "./quantity.js";
import { dateInTz, dowInTz } from "./tz.js";
import { householdTimezone } from "../household.js";
import type { HouseholdPreferences } from "../household.js";

export const RESTOCK_CHECK_MS = 15 * 60_000;

function addCalendarDays(iso: string, days: number): string {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

export function localClock(
    instant: Date,
    tz: string,
): { date: string; weekday: number; time: string } {
    const date = dateInTz(instant, tz);
    const weekday = dowInTz(instant, tz);
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(instant);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    let hour = get("hour");
    if (hour === "24") hour = "00";
    const time = `${hour}:${get("minute")}`;
    return { date, weekday, time };
}

export function restockDue(
    restock: RestockPreferences,
    nowInTz: { date: string; weekday: number; time: string },
): boolean {
    if (!restock.enabled) return false;
    if (nowInTz.weekday !== restock.weekday) return false;
    if (nowInTz.time < restock.time) return false;
    if (restock.lastRunOn != null && restock.lastRunOn >= nowInTz.date) {
        return false;
    }
    return true;
}

function itemFamilyId(
    item: Pick<FridgeItem, "foodId">,
    foodsById: ReadonlyMap<string, EffectiveFood>,
): string | null {
    if (!item.foodId) return null;
    const row = foodsById.get(item.foodId);
    return row ? familyOf(row) : item.foodId;
}

function familyHasFreshStock(
    familyId: string,
    items: readonly FridgeItem[],
    foodsById: ReadonlyMap<string, EffectiveFood>,
    today: string,
    horizonEnd: string,
): boolean {
    for (const item of items) {
        if (item.kind !== "food" || !item.foodId) continue;
        const fam = itemFamilyId(item, foodsById);
        if (fam !== familyId) continue;
        if (!item.expiresOn) return true;
        if (item.expiresOn > horizonEnd) return true;
    }
    return false;
}

function isDueItem(
    item: FridgeItem,
    today: string,
    windowEnd: string,
    dismissed: ReadonlySet<string>,
): boolean {
    if (item.kind !== "food" || item.foodId == null) return false;
    const exp = item.expiresOn;
    if (!exp || exp < today || exp > windowEnd) return false;
    const notices = fridgeNotices([item], today);
    const expiring = notices.find((n) => n.code === "fridge.expiring");
    if (!expiring) return false;
    if (isDismissedIn(expiring, dismissed)) return false;
    return true;
}

export type RestockPlanInput = {
    items: FridgeItem[];
    foodsById: ReadonlyMap<string, EffectiveFood>;
    lines: GroceryLine[];
    dismissed: ReadonlySet<string>;
    today: string;
    stores: GroceryStore[];
    sections: GrocerySection[];
    householdId: string;
};

export type RestockPlanResult = {
    lines: GroceryLine[];
    counts: {
        skippedOnList: number;
        skippedFresh: number;
        skippedDismissed: number;
    };
};

export function restockPlan(input: RestockPlanInput): RestockPlanResult {
    const counts = {
        skippedOnList: 0,
        skippedFresh: 0,
        skippedDismissed: 0,
    };
    if (input.stores.length === 0) {
        return { lines: [], counts };
    }

    const windowEnd = addCalendarDays(input.today, 6);
    const familyById = new Map<string, string>();
    for (const [id, food] of input.foodsById) {
        familyById.set(id, familyOf(food));
    }

    const dueByFamily = new Map<
        string,
        { plainId: string; items: FridgeItem[] }
    >();

    for (const item of input.items) {
        if (!isDueItem(item, input.today, windowEnd, input.dismissed)) {
            if (item.kind === "food" && item.foodId && item.expiresOn) {
                const exp = item.expiresOn;
                if (exp >= input.today && exp <= windowEnd) {
                    const notices = fridgeNotices([item], input.today);
                    const expiring = notices.find(
                        (n) => n.code === "fridge.expiring",
                    );
                    if (expiring && isDismissedIn(expiring, input.dismissed)) {
                        counts.skippedDismissed += 1;
                    }
                }
            }
            continue;
        }
        const fam =
            itemFamilyId(item, input.foodsById) ?? item.foodId ?? item.id;
        const plainId = fam;
        const bucket = dueByFamily.get(fam) ?? {
            plainId,
            items: [] as FridgeItem[],
        };
        bucket.items.push(item);
        dueByFamily.set(fam, bucket);
    }

    type Planned = {
        line: GroceryLine;
        sortExpiry: string;
        sortName: string;
    };
    const planned: Planned[] = [];

    for (const { plainId, items: dueItems } of dueByFamily.values()) {
        const plain = input.foodsById.get(plainId);
        if (!plain) continue;

        const sample = dueItems[0]!;
        if (onGroceryList(sample, input.lines, input.foodsById)) {
            counts.skippedOnList += 1;
            continue;
        }
        if (
            familyHasFreshStock(
                plainId,
                input.items,
                input.foodsById,
                input.today,
                windowEnd,
            )
        ) {
            counts.skippedFresh += 1;
            continue;
        }

        dueItems.sort((a, b) => {
            const byExp = (a.expiresOn ?? "").localeCompare(b.expiresOn ?? "");
            if (byExp !== 0) return byExp;
            return 0;
        });
        const soonest = dueItems[0]!;

        const { storeId } = pickGroceryStore({
            chosenStoreId: null,
            usualStoreId: plain.usualStoreId,
            stores: input.stores,
            lines: input.lines,
            foodId: plainId,
            familyById,
        });

        const storeSections = input.sections.filter(
            (row) => row.storeId === storeId,
        );
        const suggested = suggestGrocerySection({
            sections: storeSections,
            allSections: input.sections,
            lines: input.lines,
            kind: plain.kind === "supply" ? "supply" : "food",
            foodId: plainId,
            displayName: plain.name,
            familyById,
        });
        const other = storeSections.find((row) => row.isOther);
        const sectionId = suggested?.id ?? other?.id;
        if (!sectionId) continue;

        let quantity = pickGroceryAmount({
            usual: plain.usualAmount,
            food: { defaultUnit: plain.defaultUnit },
        }).quantity;

        if (plain.usualAmount == null) {
            const toUnit = soonest.quantity.unit;
            let sum: number | null = 0;
            for (const due of dueItems) {
                const from = due.quantity;
                const itemFood = due.foodId
                    ? input.foodsById.get(due.foodId)
                    : undefined;
                const merged = {
                    gramsPerEach: itemFood?.gramsPerEach ?? plain.gramsPerEach,
                    gramsPerMl: itemFood?.gramsPerMl ?? plain.gramsPerMl,
                };
                const converted = convertStockAmount(
                    from.amount,
                    from.unit,
                    toUnit,
                    merged,
                );
                if (converted == null) {
                    sum = null;
                    break;
                }
                sum! += converted;
            }
            if (sum != null) {
                quantity = { amount: sum, unit: toUnit };
            } else {
                quantity = { ...soonest.quantity };
            }
            if (!isQuantityUnit(quantity.unit)) {
                quantity = pickGroceryAmount({
                    usual: plain.usualAmount,
                    food: { defaultUnit: plain.defaultUnit },
                }).quantity;
            } else {
                quantity = pickGroceryAmount({
                    amount: quantity.amount,
                    unit: quantity.unit,
                    usual: plain.usualAmount,
                    food: { defaultUnit: plain.defaultUnit },
                }).quantity;
            }
        }

        const line: GroceryLine = {
            id: crypto.randomUUID(),
            householdId: input.householdId,
            storeId,
            sectionId,
            kind: plain.kind === "supply" ? "supply" : "food",
            displayName: plain.name,
            quantity,
            foodId: plainId,
            checked: false,
            source: "restock",
            sourceFridgeItemId: soonest.id,
        };
        planned.push({
            line,
            sortExpiry: soonest.expiresOn ?? "",
            sortName: plain.name,
        });
    }

    planned.sort((a, b) => {
        const byExp = a.sortExpiry.localeCompare(b.sortExpiry);
        if (byExp !== 0) return byExp;
        return a.sortName.localeCompare(b.sortName);
    });

    return {
        lines: planned.map((row) => row.line),
        counts,
    };
}

export function groceryRestockNotices(
    lines: readonly GroceryLine[],
    fridgeItems: readonly FridgeItem[],
    today: string,
): Notice[] {
    const byId = new Map(fridgeItems.map((item) => [item.id, item]));
    const out: Notice[] = [];
    for (const line of lines) {
        if (line.checked || line.source !== "restock") continue;
        const sourceId = line.sourceFridgeItemId;
        const item = sourceId ? byId.get(sourceId) : undefined;
        const params: Record<string, string | number | string[]> = {
            name: line.displayName,
        };
        const related: Notice["related"] = [];
        if (item) {
            params.itemName = item.displayName;
            params.expiresOn = item.expiresOn ?? "";
            if (item.expiresOn) {
                params.daysLeft = daysUntilExpiry(today, item.expiresOn);
            }
            related.push({
                kind: "fridge_item",
                id: item.id,
                name: item.displayName,
            });
        }
        out.push({
            code: "grocery.restocked",
            severity: NOTICE_SEVERITY["grocery.restocked"],
            subject: { kind: "grocery_line", id: line.id },
            related,
            params,
        });
    }
    return out;
}

export type RestockStore = {
    commitRestockRun(
        householdId: string,
        runOn: string,
        lines: GroceryLine[],
    ): Promise<boolean>;
};

export type MemoryRestockStoreOpts = {
    grocery: GroceryListStore;
    getPrefs: () => HouseholdPreferences;
    setPrefs: (prefs: HouseholdPreferences) => void;
    failOnInsert?: () => void;
};

export function createMemoryRestockStore(
    opts: MemoryRestockStoreOpts,
): RestockStore {
    return {
        async commitRestockRun(householdId, runOn, lines) {
            const prefs = opts.getPrefs();
            const last = prefs.restock.lastRunOn;
            if (last != null && last >= runOn) return false;
            const inserted: string[] = [];
            try {
                for (const line of lines) {
                    opts.failOnInsert?.();
                    await opts.grocery.insertLine(line);
                    inserted.push(line.id);
                }
                opts.setPrefs({
                    ...prefs,
                    restock: { ...prefs.restock, lastRunOn: runOn },
                });
                return true;
            } catch {
                for (const id of inserted) {
                    await opts.grocery.deleteLine(householdId, id);
                }
                throw new Error("restock commit failed");
            }
        },
    };
}

export type RestockCheckDeps = {
    listEnabled: () => Promise<
        Array<{ id: string; preferences: HouseholdPreferences }>
    >;
    getOwnerProfile: (
        householdId: string,
    ) => Promise<{ timezone: string | null } | null>;
    fridge: FridgeStore;
    foods: FoodsStore;
    grocery: GroceryListStore;
    settings: SettingsStore;
    dismissals: NoticeDismissalsStore;
    restock: RestockStore;
    logger?: { log: (msg: string) => void };
};

export async function runRestockCheck(
    deps: RestockCheckDeps,
    now = new Date(),
): Promise<void> {
    const log = deps.logger?.log ?? ((msg: string) => console.log(msg));
    const households = await deps.listEnabled();
    for (const household of households) {
        const id8 = household.id.slice(0, 8);
        try {
            const owner = await deps.getOwnerProfile(household.id);
            const tz = householdTimezone(household.preferences, owner);
            const clock = localClock(now, tz);
            const restock = household.preferences.restock;
            if (!restockDue(restock, clock)) continue;

            const householdId = household.id;
            const [items, lines, dismissals, stores] = await Promise.all([
                deps.fridge.listItems(householdId),
                deps.grocery.listLines(householdId),
                deps.dismissals.listForHousehold(householdId),
                deps.settings.listStores(householdId),
            ]);
            const sectionLists = await Promise.all(
                stores.map((store) => deps.settings.listSections(store.id)),
            );
            const sections = sectionLists.flat();
            const foodIds = new Set<string>();
            for (const item of items) {
                if (item.foodId) foodIds.add(item.foodId);
            }
            for (const line of lines) {
                if (line.foodId) foodIds.add(line.foodId);
            }
            const listed = await deps.foods.listFoods(householdId);
            const families = new Set<string>();
            for (const id of foodIds) {
                const row = listed.find((f) => f.id === id);
                if (row) families.add(familyOf(row));
            }
            for (const fam of families) {
                foodIds.add(fam);
            }
            const foodsById = await effectiveFoodsByIds(
                deps.foods,
                householdId,
                [...foodIds],
            );
            const plan = restockPlan({
                items,
                foodsById,
                lines,
                dismissed: dismissedKeySet(dismissals),
                today: clock.date,
                stores,
                sections,
                householdId,
            });
            const committed = await deps.restock.commitRestockRun(
                householdId,
                clock.date,
                plan.lines,
            );
            if (!committed) {
                log(
                    `[restock] household=${id8} date=${clock.date} already ran`,
                );
                continue;
            }
            log(
                `[restock] household=${id8} date=${clock.date} added=${plan.lines.length} skipped_on_list=${plan.counts.skippedOnList} skipped_fresh=${plan.counts.skippedFresh} skipped_dismissed=${plan.counts.skippedDismissed}`,
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log(`[restock] household=${id8} failed: ${message}`);
        }
    }
}

let restockRunning = false;

export function startRestockRuns(runCheck: () => Promise<void>): void {
    setInterval(() => {
        if (restockRunning) return;
        restockRunning = true;
        runCheck().finally(() => {
            restockRunning = false;
        });
    }, RESTOCK_CHECK_MS);
}
