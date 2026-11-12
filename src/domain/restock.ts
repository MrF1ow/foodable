import type { RestockPreferences } from "../household.js";
import type { EffectiveFood, Food, RestockSchedule } from "./foods.js";
import {
    effectiveFoodsFromListed,
    familyOf,
    foodDisplayName,
    usualLowLevel,
} from "./foods.js";
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
    GroceryPreferences,
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
    /** Schedules mode runs a pass on every day, not only the restock day. */
    anyWeekday = false,
): boolean {
    if (!restock.enabled) return false;
    if (!anyWeekday && nowInTz.weekday !== restock.weekday) return false;
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

export type DueUsual = {
    food: EffectiveFood;
    /** Why it is due, in words: "weekly, last bought 8 days ago" / "3 left, below 6". */
    reason: string;
    trigger: "schedule" | "low";
};

/**
 * The `grocery.running_low` notice for a usual that has fallen below its
 * level. The notices and the restock runner both build it here, so the
 * dismissal key (the usual, scoped to its last restock) cannot drift between
 * what the user dismissed and what the runner skips.
 */
export function runningLowNotice(food: EffectiveFood, reason: string): Notice {
    return {
        code: "grocery.running_low",
        severity: NOTICE_SEVERITY["grocery.running_low"],
        subject: { kind: "food", id: food.id },
        related: [],
        params: {
            name: foodDisplayName(food),
            foodId: food.id,
            reason,
            // A dismissal holds until the usual is next restocked.
            dismissScope: food.lastRestockedOn ?? "",
        },
    };
}

const MS_PER_DAY = 86_400_000;

/**
 * A ticked line is bought but not yet put away, so the fridge still reads low
 * and it covers a low usual for this many days; after that it is a stale tick
 * and the usual may be added again.
 */
export const TICKED_COVERS_LOW_DAYS = 7;

/**
 * Ticking stamps the usual's `lastRestockedOn`, so a stamp older than the
 * window means the tick is stale. No stamp means the tick's age is unknown,
 * and it still covers: a stale line is only provable, never guessed.
 */
function tickIsRecent(lastRestockedOn: string | null, today: string): boolean {
    if (lastRestockedOn == null) return true;
    const since = daysBetween(lastRestockedOn, today);
    return since != null && since < TICKED_COVERS_LOW_DAYS;
}

function parseDay(iso: string): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isFinite(t) ? t : null;
}

/** Whole calendar days from `from` to `to`; UTC date math, so DST never shifts it. */
function daysBetween(from: string, to: string): number | null {
    const a = parseDay(from);
    const b = parseDay(to);
    if (a == null || b == null) return null;
    return Math.round((b - a) / MS_PER_DAY);
}

/** The same day one calendar month on, clamped to the end of a shorter month (Jan 31 -> Feb 28). */
function addCalendarMonth(iso: string): string | null {
    const t = parseDay(iso);
    if (t == null) return null;
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    const lastOfNext = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
    return new Date(Date.UTC(y, m + 1, Math.min(day, lastOfNext)))
        .toISOString()
        .slice(0, 10);
}

function scheduleReason(label: string, since: number | null): string {
    if (since == null) return `${label}, not bought yet`;
    return `${label}, last bought ${since} day${since === 1 ? "" : "s"} ago`;
}

/**
 * The schedule half of "due": only on the household's restock day, and never
 * while paused. Weekly is due 7 or more days after the last restock, every N
 * weeks 7N or more, monthly once a calendar month has passed (same day of the
 * month, clamped to the end of a shorter one). A usual never restocked is due
 * on its first restock day. Returns the reason, or null when not due.
 */
function scheduleDueReason(food: EffectiveFood, today: string): string | null {
    const last = food.lastRestockedOn;
    const since = last == null ? null : daysBetween(last, today);
    if (last != null && since == null) return null;
    switch (food.restockSchedule) {
        case "weekly":
            return since == null || since >= 7
                ? scheduleReason("weekly", since)
                : null;
        case "every_n_weeks": {
            const n = food.restockEveryWeeks;
            if (n == null || !Number.isInteger(n) || n < 1) return null;
            return since == null || since >= 7 * n
                ? scheduleReason(`every ${n} week${n === 1 ? "" : "s"}`, since)
                : null;
        }
        case "monthly": {
            if (last == null) return scheduleReason("monthly", null);
            const next = addCalendarMonth(last);
            return next != null && today >= next
                ? scheduleReason("monthly", since)
                : null;
        }
        default:
            return null;
    }
}

function formatAmount(amount: number): string {
    return String(Math.round(amount * 100) / 100);
}

/**
 * The low half: stock of the usual's family, summed into the unit the level is
 * measured in (the usual amount's unit), is strictly below the level. A stock
 * row that cannot be converted (a missing grams-per-each or per-ml) makes the
 * total unknown, and unknown is never low. No level means nothing to compare.
 */
function lowReason(
    food: EffectiveFood,
    stock: readonly FridgeItem[],
    foodsById: ReadonlyMap<string, EffectiveFood>,
): string | null {
    const level = usualLowLevel(food);
    if (level == null) return null;
    const unit = food.usualAmount?.unit ?? food.defaultUnit;
    if (!unit) return null;
    let total = 0;
    for (const item of stock) {
        if (item.kind !== "food" && item.kind !== "supply") continue;
        if (!item.foodId) continue;
        const row = foodsById.get(item.foodId);
        const family = row ? familyOf(row) : item.foodId;
        if (family !== food.id) continue;
        const converted = convertStockAmount(
            item.quantity.amount,
            item.quantity.unit,
            unit,
            {
                gramsPerEach: row?.gramsPerEach ?? food.gramsPerEach,
                gramsPerMl: row?.gramsPerMl ?? food.gramsPerMl,
            },
        );
        if (converted == null) return null;
        total += converted;
    }
    total = Math.round(total * 1000) / 1000;
    if (!(total < level)) return null;
    return `${formatAmount(total)} left, below ${formatAmount(level)}`;
}

/** Whether `today` (household-local `YYYY-MM-DD`) falls on the restock weekday (0 = Sunday). */
function isRestockDayOn(today: string, householdRestockDay: number): boolean {
    const todayMs = parseDay(today);
    return (
        todayMs != null && new Date(todayMs).getUTCDay() === householdRestockDay
    );
}

/**
 * Which usuals are due for the list: by schedule on the household's restock
 * day (`householdRestockDay`, 0 = Sunday like `dowInTz`), or any day because
 * stock is low (only when the usual opted into add-when-low). Paused usuals
 * are never due. `today` is the household-local `YYYY-MM-DD`. `usuals` are
 * the plain foods' effective rows; `stock` the fridge items, matched to a
 * usual through the family of each item's food in `foodsById`. Schedule wins
 * over low when both apply.
 */
export function usualsDue(
    usuals: readonly EffectiveFood[],
    stock: readonly FridgeItem[],
    today: string,
    householdRestockDay: number,
    foodsById: ReadonlyMap<string, EffectiveFood> = new Map(),
): DueUsual[] {
    const todayMs = parseDay(today);
    if (todayMs == null) return [];
    const isRestockDay = isRestockDayOn(today, householdRestockDay);
    const out: DueUsual[] = [];
    for (const food of usuals) {
        if (food.restockPaused || food.archivedAt || food.genericFoodId) {
            continue;
        }
        if (isRestockDay) {
            const reason = scheduleDueReason(food, today);
            if (reason != null) {
                out.push({ food, reason, trigger: "schedule" });
                continue;
            }
        }
        if (food.restockWhenLow) {
            const reason = lowReason(food, stock, foodsById);
            if (reason != null) out.push({ food, reason, trigger: "low" });
        }
    }
    return out;
}

/**
 * A usual: a plain, live food that has a schedule or is added when low. The
 * restock runner and `list_usuals` both pick their usuals with this, paused
 * ones included (paused only stops them being due).
 */
export function isUsualFood(food: Food): boolean {
    return (
        !food.genericFoodId &&
        !food.archivedAt &&
        (food.restockSchedule != null || food.restockWhenLow)
    );
}

export type UsualListRow = {
    foodId: string;
    name: string;
    /** The usual product's display name, or null when the food has none. */
    productName: string | null;
    storeId: string | null;
    storeName: string | null;
    /** The usual amount to add; null means 1 of the default unit. */
    amount: number | null;
    unit: string;
    schedule: RestockSchedule | null;
    everyWeeks: number | null;
    lastRestockedOn: string | null;
    restockWhenLow: boolean;
    /** The level stock is compared with when add-when-low is on, else null. */
    lowLevel: number | null;
    paused: boolean;
    due: { reason: string; trigger: "schedule" | "low" } | null;
};

/**
 * Every usual of the household with its schedule and low settings and whether
 * it is due today (and why), straight from `usualsDue`. Due usuals come
 * first, then the rest by name; `isRestockDay` is the same check `usualsDue`
 * makes. `listed` is the whole catalog so a usual's
 * product and family stock resolve; `today` is the household-local date.
 */
export function usualsList(input: {
    listed: readonly Food[];
    stock: readonly FridgeItem[];
    stores: readonly Pick<GroceryStore, "id" | "name">[];
    today: string;
    householdRestockDay: number;
}): { rows: UsualListRow[]; isRestockDay: boolean } {
    const foodsById = effectiveFoodsFromListed(input.listed);
    const usuals = input.listed
        .filter(isUsualFood)
        .map((food) => foodsById.get(food.id))
        .filter((food): food is EffectiveFood => food != null);
    const due = new Map(
        usualsDue(
            usuals,
            input.stock,
            input.today,
            input.householdRestockDay,
            foodsById,
        ).map((row) => [row.food.id, row]),
    );
    const storeNames = new Map(input.stores.map((s) => [s.id, s.name]));
    const rows = usuals.map((food): UsualListRow => {
        const hit = due.get(food.id);
        return {
            foodId: food.id,
            name: food.name,
            productName: food.product ? foodDisplayName(food.product) : null,
            storeId: food.usualStoreId,
            storeName:
                food.usualStoreId != null
                    ? (storeNames.get(food.usualStoreId) ?? null)
                    : null,
            amount: food.usualAmount?.amount ?? null,
            unit: food.usualAmount?.unit ?? food.defaultUnit,
            schedule: food.restockSchedule,
            everyWeeks: food.restockEveryWeeks,
            lastRestockedOn: food.lastRestockedOn,
            restockWhenLow: food.restockWhenLow,
            lowLevel: food.restockWhenLow ? usualLowLevel(food) : null,
            paused: food.restockPaused,
            due: hit ? { reason: hit.reason, trigger: hit.trigger } : null,
        };
    });
    rows.sort(
        (a, b) =>
            Number(b.due != null) - Number(a.due != null) ||
            a.name.localeCompare(b.name),
    );
    return {
        rows,
        isRestockDay: isRestockDayOn(input.today, input.householdRestockDay),
    };
}

type RestockPlacement = { storeId: string; sectionId: string };

/** The store and section a restock line for `plain` lands in; null when the store has no section. */
function placeRestockLine(
    input: Pick<
        RestockPlanInput,
        "stores" | "sections" | "lines" | "groceryPreferences"
    >,
    plain: EffectiveFood,
    familyById: ReadonlyMap<string, string>,
): RestockPlacement | null {
    const { storeId } = pickGroceryStore({
        chosenStoreId: null,
        usualStoreId: plain.usualStoreId,
        stores: input.stores,
        lines: input.lines,
        foodId: plain.id,
        familyById,
        prefs: input.groceryPreferences,
    });

    const storeSections = input.sections.filter(
        (row) => row.storeId === storeId,
    );
    const suggested = suggestGrocerySection({
        sections: storeSections,
        allSections: input.sections,
        lines: input.lines,
        kind: plain.kind === "supply" ? "supply" : "food",
        foodId: plain.id,
        displayName: plain.name,
        familyById,
    });
    const other = storeSections.find((row) => row.isOther);
    const sectionId = suggested?.id ?? other?.id;
    if (!sectionId) return null;
    return { storeId, sectionId };
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
    groceryPreferences?: GroceryPreferences;
    /** Usuals due by schedule or low stock; empty or absent keeps the expiring lines only. */
    dueUsuals?: readonly DueUsual[];
    /** False skips the expiring-food lines (a low-stock-only pass); default true. */
    expiring?: boolean;
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

    // An unticked line for a family always covers it. A ticked line covers
    // only a low or expiring family, and only while the tick is recent
    // (`TICKED_COVERS_LOW_DAYS`), in the expiring and the usual loops alike.
    const openFamilies = new Set<string>();
    const tickedFamilies = new Set<string>();
    for (const line of input.lines) {
        if (!line.foodId) continue;
        const family = familyById.get(line.foodId) ?? line.foodId;
        (line.checked ? tickedFamilies : openFamilies).add(family);
    }
    const recentTickCovers = (family: string, food: EffectiveFood): boolean =>
        tickedFamilies.has(family) &&
        tickIsRecent(food.lastRestockedOn, input.today);

    const dueByFamily = new Map<
        string,
        { plainId: string; items: FridgeItem[] }
    >();

    for (const item of input.expiring === false ? [] : input.items) {
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
        if (
            onGroceryList(sample, input.lines, input.foodsById) ||
            // Only a stamped tick counts here: an unstamped ticked line has
            // no provable age and must not hold back an expiring item.
            (plain.lastRestockedOn != null && recentTickCovers(plainId, plain))
        ) {
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

        const placed = placeRestockLine(input, plain, familyById);
        if (!placed) continue;
        const { storeId, sectionId } = placed;

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
            note: null,
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

    const lines = planned.map((row) => row.line);

    const sortedDue = [...(input.dueUsuals ?? [])].sort((a, b) =>
        a.food.name.localeCompare(b.food.name),
    );
    for (const { food, reason, trigger } of sortedDue) {
        const family = familyOf(food);
        const alreadyListed =
            openFamilies.has(family) ||
            (trigger === "low" && recentTickCovers(family, food)) ||
            lines.some((line) => line.foodId === food.id);
        if (alreadyListed) {
            counts.skippedOnList += 1;
            continue;
        }
        if (
            trigger === "low" &&
            isDismissedIn(runningLowNotice(food, reason), input.dismissed)
        ) {
            counts.skippedDismissed += 1;
            continue;
        }
        const placed = placeRestockLine(input, food, familyById);
        if (!placed) continue;
        lines.push({
            id: crypto.randomUUID(),
            householdId: input.householdId,
            storeId: placed.storeId,
            sectionId: placed.sectionId,
            kind: food.kind === "supply" ? "supply" : "food",
            displayName: food.name,
            quantity: pickGroceryAmount({
                usual: food.usualAmount,
                food: { defaultUnit: food.defaultUnit },
            }).quantity,
            foodId: food.id,
            checked: false,
            source: "restock",
            sourceFridgeItemId: null,
            note: null,
        });
    }

    return { lines, counts };
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

export type RestockSource = "legacy" | "schedules";

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
    /**
     * Where the lines come from: `legacy` is the expiring-food lines alone;
     * `schedules` adds the usuals that are due. Absent means `legacy`.
     */
    source?: RestockSource;
    logger?: { log: (msg: string) => void };
    /** Runs one household's check; the live runner acts as that household. */
    forHousehold?: <T>(
        householdId: string,
        work: () => Promise<T>,
    ) => Promise<T>;
};

export async function runRestockCheck(
    deps: RestockCheckDeps,
    now = new Date(),
): Promise<void> {
    const log = deps.logger?.log ?? ((msg: string) => console.log(msg));
    const forHousehold =
        deps.forHousehold ??
        (<T>(_id: string, work: () => Promise<T>) => work());
    const households = await deps.listEnabled();
    for (const household of households) {
        const id8 = household.id.slice(0, 8);
        try {
            await forHousehold(household.id, async () => {
                const owner = await deps.getOwnerProfile(household.id);
                const tz = householdTimezone(household.preferences, owner);
                const clock = localClock(now, tz);
                const restock = household.preferences.restock;
                // Schedules mode checks once a day (the same lastRunOn marker):
                // low usuals any day, expiring food and schedules on the restock day.
                const schedules = deps.source === "schedules";
                if (!restockDue(restock, clock, schedules)) return;

                const householdId = household.id;
                const [items, lines, dismissals, stores, groceryPreferences] =
                    await Promise.all([
                        deps.fridge.listItems(householdId),
                        deps.grocery.listLines(householdId),
                        deps.dismissals.listForHousehold(householdId),
                        deps.settings.listStores(householdId),
                        deps.settings.getGroceryPreferences(householdId),
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
                const usualIds = schedules
                    ? listed.filter(isUsualFood).map((f) => f.id)
                    : [];
                for (const id of usualIds) foodIds.add(id);
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
                const dueUsuals = schedules
                    ? usualsDue(
                          usualIds
                              .map((id) => foodsById.get(id))
                              .filter((f): f is EffectiveFood => f != null),
                          items,
                          clock.date,
                          restock.weekday,
                          foodsById,
                      )
                    : undefined;
                const plan = restockPlan({
                    items,
                    foodsById,
                    lines,
                    dismissed: dismissedKeySet(dismissals),
                    today: clock.date,
                    stores,
                    sections,
                    householdId,
                    groceryPreferences,
                    dueUsuals,
                    expiring: !schedules || clock.weekday === restock.weekday,
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
                    return;
                }
                log(
                    `[restock] household=${id8} date=${clock.date} added=${plan.lines.length} skipped_on_list=${plan.counts.skippedOnList} skipped_fresh=${plan.counts.skippedFresh} skipped_dismissed=${plan.counts.skippedDismissed}${dueUsuals ? ` due_usuals=${dueUsuals.length}` : ""}`,
                );
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log(`[restock] household=${id8} failed: ${message}`);
        }
    }
}

// Per instance by design: overlap guard; restock plans write idempotently to Postgres.
let restockRunning = false;

export function startRestockRuns(runCheck: () => Promise<void>): void {
    setInterval(() => {
        if (restockRunning) return;
        restockRunning = true;
        runCheck()
            .catch((err: unknown) => {
                console.error(
                    `[restock] failed: ${err instanceof Error ? err.message : String(err)}`,
                );
            })
            .finally(() => {
                restockRunning = false;
            });
    }, RESTOCK_CHECK_MS);
}
