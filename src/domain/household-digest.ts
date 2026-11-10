import type { EffectiveFood, Food } from "./foods.js";
import { familyOf, usualProductRows } from "./foods.js";
import type { GroceryLine } from "./grocery.js";
import type { FridgeItem } from "./fridge.js";
import {
    type DailyBucket,
    type GoalsByDate,
    type GoalDayField,
    computeWeeklyDigest,
} from "./insights.js";
import {
    listExpiring,
    daysUntilExpiry,
    type StockMovement,
    type StockReason,
} from "./stock.js";
import { dateInTz } from "./tz.js";

function mean(values: number[]): number {
    if (values.length === 0) return 0;
    let sum = 0;
    for (const v of values) sum += v;
    return sum / values.length;
}

function round(n: number, places = 1): number {
    const f = 10 ** places;
    return Math.round(n * f) / f;
}

function nonEmpty(b: DailyBucket): boolean {
    return b.meals.length > 0 || b.waterMl > 0;
}

function goalNumber(
    goalsOn: GoalsByDate,
    date: string,
    field: GoalDayField,
): number | null {
    return goalsOn(date)?.[field] ?? null;
}

/** Whether a floor target is meaningful (see insights weekly digest). */
function floorTargetApplies(target: number | null): boolean {
    return target != null && target > 0;
}

export type CalorieDayGrade =
    "on_target" | "under" | "over" | "no_goal" | "no_data";

/** Grade one day's calories against that calendar day's own goal (±10% band). */
export function gradeCaloriesForDay(
    calories: number,
    goal: number | null,
): CalorieDayGrade {
    if (!floorTargetApplies(goal)) return "no_goal";
    const g = goal!;
    if (calories >= g * 0.9 && calories <= g * 1.1) return "on_target";
    return calories < g ? "under" : "over";
}

type DigestTarget =
    | { kind: "full"; value: number; averaged: boolean }
    | { kind: "partial"; covered: number; total: number }
    | { kind: "none" };

function digestTarget(
    buckets: readonly DailyBucket[],
    goalsOn: GoalsByDate,
    field: GoalDayField,
): DigestTarget {
    const raw = buckets.map((b) => goalNumber(goalsOn, b.date, field));
    const applicable = raw.filter((t): t is number => floorTargetApplies(t));
    if (applicable.length === 0) return { kind: "none" };
    if (applicable.length < buckets.length) {
        return {
            kind: "partial",
            covered: applicable.length,
            total: buckets.length,
        };
    }
    if (applicable.every((t) => t === applicable[0])) {
        return { kind: "full", value: applicable[0]!, averaged: false };
    }
    return { kind: "full", value: round(mean(applicable)), averaged: true };
}

export type HouseholdDigestExpiringItem = {
    fridgeItemId: string;
    displayName: string;
    expiresOn: string;
    quantityAmount: number;
    quantityUnit: string;
    daysLeft: number;
};

export type HouseholdDigestRanOut = {
    movementId: string;
    foodId: string;
    displayName: string;
    at: string;
    reason: StockReason;
};

export type HouseholdDigestDayNutrition = {
    date: string;
    calories: number;
    protein_g: number;
    calorieGoal: number | null;
    proteinGoal: number | null;
    calorieGrade: CalorieDayGrade;
};

export type HouseholdDigestMemberNutrition = {
    memberId: string;
    displayName: string;
    daysLogged: number;
    windowDays: number;
    avgCalories: number;
    calorieTarget: DigestTarget;
    avgProtein_g: number;
    proteinTarget: DigestTarget;
    /** Closest logged day to that day's own calorie goal (same rule as insights weekly digest). */
    bestDay: {
        date: string;
        calories: number;
        calorieGoal: number | null;
    } | null;
    /** Furthest logged day from that day's own calorie goal (same rule as insights weekly digest). */
    roughestDay: {
        date: string;
        calories: number;
        calorieGoal: number | null;
    } | null;
    /** Full weekly nutrient summary (computeWeeklyDigest) for all graded targets. */
    summary: string;
    days: HouseholdDigestDayNutrition[];
};

export type HouseholdDigestSuggestion = {
    foodId: string;
    displayName: string;
    storeId: string;
    quantityAmount: number;
    quantityUnit: string;
    source: "restock" | "usual";
};

export type HouseholdDigest = {
    timezone: string;
    today: string;
    window: { from: string; to: string };
    expiring: HouseholdDigestExpiringItem[];
    ranOut: HouseholdDigestRanOut[];
    members: HouseholdDigestMemberNutrition[];
    suggestions: HouseholdDigestSuggestion[];
    text: string;
};

export type HouseholdDigestMemberInput = {
    memberId: string;
    displayName: string;
    buckets: readonly DailyBucket[];
    goalsOn: GoalsByDate;
};

export type HouseholdDigestUsualAtZero = {
    foodId: string;
    displayName: string;
    storeId: string;
    quantity: { amount: number; unit: string };
};

export type HouseholdDigestStockInput = {
    /** Movements with created_at on or after the window start (household tz). */
    movements: readonly StockMovement[];
    /** Current fridge rows. */
    fridgeItems: readonly FridgeItem[];
    displayNameByFoodId: ReadonlyMap<string, string>;
};

export type HouseholdDigestInputs = {
    timezone: string;
    today: string;
    window: { from: string; to: string };
    fridgeItems: readonly FridgeItem[];
    stock: HouseholdDigestStockInput;
    members: readonly HouseholdDigestMemberInput[];
    restockLines: readonly GroceryLine[];
    usualAtZero: readonly HouseholdDigestUsualAtZero[];
    groceryLines: readonly GroceryLine[];
    /** Plain and product ids already on the grocery list (expanded via food links). */
    groceryListFoodIds: ReadonlySet<string>;
};

const RAN_OUT_REASONS = new Set<StockReason>([
    "cook",
    "eat",
    "discard",
    "adjust",
]);

function movementLocalDate(movement: StockMovement, tz: string): string {
    return dateInTz(movement.createdAt, tz);
}

function inWindow(date: string, window: { from: string; to: string }): boolean {
    return date >= window.from && date <= window.to;
}

function isRanOutDecrement(movement: StockMovement): boolean {
    if (!RAN_OUT_REASONS.has(movement.reason)) return false;
    return movement.delta < 0;
}

function unitKey(foodId: string, unit: string): string {
    return `${foodId}\0${unit}`;
}

function movementIsAfter(a: StockMovement, b: StockMovement): boolean {
    const byTime = a.createdAt.localeCompare(b.createdAt);
    if (byTime > 0) return true;
    if (byTime < 0) return false;
    return a.id.localeCompare(b.id) > 0;
}

function currentStockByFoodUnit(
    items: readonly FridgeItem[],
): Map<string, number> {
    const totals = new Map<string, number>();
    for (const item of items) {
        // Supplies write ledger movements too, so they count as stock.
        if (item.foodId == null) continue;
        const key = unitKey(item.foodId, item.quantity.unit);
        totals.set(key, (totals.get(key) ?? 0) + item.quantity.amount);
    }
    return totals;
}

function unitsForFood(
    foodId: string,
    items: readonly FridgeItem[],
    movements: readonly StockMovement[],
): Set<string> {
    const units = new Set<string>();
    for (const item of items) {
        if (item.foodId === foodId) units.add(item.quantity.unit);
    }
    for (const movement of movements) {
        if (movement.foodId === foodId) units.add(movement.unit);
    }
    return units;
}

/** Stock of `unit` immediately after `at` (inclusive of `at`'s own delta). */
function balanceAfterMovement(
    foodId: string,
    unit: string,
    at: StockMovement,
    currentByUnit: Map<string, number>,
    movements: readonly StockMovement[],
): number {
    const current = currentByUnit.get(unitKey(foodId, unit)) ?? 0;
    let later = 0;
    for (const movement of movements) {
        if (movement.foodId !== foodId || movement.unit !== unit) continue;
        if (movementIsAfter(movement, at)) later += movement.delta;
    }
    // Stock is stored rounded but deltas are not, so 0.9 - (1.1 - 0.2)
    // must still read as zero: round away the float residue.
    return Math.round((current - later) * 1e6) / 1e6;
}

function foodDepletedAfterMovement(
    foodId: string,
    movement: StockMovement,
    currentByUnit: Map<string, number>,
    movements: readonly StockMovement[],
    fridgeItems: readonly FridgeItem[],
): boolean {
    const units = unitsForFood(foodId, fridgeItems, movements);
    for (const unit of units) {
        const balance = balanceAfterMovement(
            foodId,
            unit,
            movement,
            currentByUnit,
            movements,
        );
        if (balance > 0) return false;
    }
    return true;
}

function buildExpiring(
    items: readonly FridgeItem[],
    today: string,
): HouseholdDigestExpiringItem[] {
    const raw = listExpiring(items, today, 7).filter(
        (item) => item.expiresOn != null && item.expiresOn >= today,
    );
    return raw
        .map((item) => ({
            fridgeItemId: item.id,
            displayName: item.displayName,
            expiresOn: item.expiresOn!,
            quantityAmount: item.quantity.amount,
            quantityUnit: item.quantity.unit,
            daysLeft: daysUntilExpiry(today, item.expiresOn!),
        }))
        .sort((a, b) => {
            const byDate = a.expiresOn.localeCompare(b.expiresOn);
            if (byDate !== 0) return byDate;
            const byName = a.displayName.localeCompare(b.displayName);
            if (byName !== 0) return byName;
            return a.fridgeItemId.localeCompare(b.fridgeItemId);
        });
}

export function ranOutInWindow(
    stock: HouseholdDigestStockInput,
    window: { from: string; to: string },
    timezone: string,
): HouseholdDigestRanOut[] {
    const currentByUnit = currentStockByFoodUnit(stock.fridgeItems);
    const lastByFood = new Map<string, StockMovement>();

    for (const movement of stock.movements) {
        if (!isRanOutDecrement(movement)) continue;
        const localDate = movementLocalDate(movement, timezone);
        if (!inWindow(localDate, window)) continue;
        if (
            balanceAfterMovement(
                movement.foodId,
                movement.unit,
                movement,
                currentByUnit,
                stock.movements,
            ) !== 0
        ) {
            continue;
        }
        if (
            !foodDepletedAfterMovement(
                movement.foodId,
                movement,
                currentByUnit,
                stock.movements,
                stock.fridgeItems,
            )
        ) {
            continue;
        }

        const prev = lastByFood.get(movement.foodId);
        if (
            !prev ||
            movement.createdAt.localeCompare(prev.createdAt) > 0 ||
            (movement.createdAt === prev.createdAt &&
                movement.id.localeCompare(prev.id) > 0)
        ) {
            lastByFood.set(movement.foodId, movement);
        }
    }

    const out: HouseholdDigestRanOut[] = [];
    for (const movement of lastByFood.values()) {
        const displayName =
            stock.displayNameByFoodId.get(movement.foodId) ?? movement.foodId;
        out.push({
            movementId: movement.id,
            foodId: movement.foodId,
            displayName,
            at: movement.createdAt,
            reason: movement.reason,
        });
    }

    return out.sort(
        (a, b) =>
            a.at.localeCompare(b.at) ||
            a.displayName.localeCompare(b.displayName) ||
            a.movementId.localeCompare(b.movementId),
    );
}

function buildMemberNutrition(
    member: HouseholdDigestMemberInput,
): HouseholdDigestMemberNutrition {
    const buckets = member.buckets;
    const logged = buckets.filter(nonEmpty);
    const summary = computeWeeklyDigest([...buckets], member.goalsOn);
    const days: HouseholdDigestDayNutrition[] = buckets.map((b) => {
        const calorieGoal = goalNumber(
            member.goalsOn,
            b.date,
            "daily_calories",
        );
        const proteinGoal = goalNumber(
            member.goalsOn,
            b.date,
            "daily_protein_g",
        );
        return {
            date: b.date,
            calories: b.calories,
            protein_g: b.protein_g,
            calorieGoal,
            proteinGoal,
            // A day with nothing logged is unknown, not "under".
            calorieGrade:
                b.meals.length === 0
                    ? "no_data"
                    : gradeCaloriesForDay(b.calories, calorieGoal),
        };
    });

    let bestDay: HouseholdDigestMemberNutrition["bestDay"] = null;
    let roughestDay: HouseholdDigestMemberNutrition["roughestDay"] = null;

    if (logged.length > 0) {
        const perDayTargets = logged.every((b) =>
            floorTargetApplies(
                goalNumber(member.goalsOn, b.date, "daily_calories"),
            ),
        );
        if (perDayTargets) {
            const best = logged.reduce((a, b) => {
                const ta = goalNumber(
                    member.goalsOn,
                    a.date,
                    "daily_calories",
                )!;
                const tb = goalNumber(
                    member.goalsOn,
                    b.date,
                    "daily_calories",
                )!;
                return Math.abs(a.calories - ta) <= Math.abs(b.calories - tb)
                    ? a
                    : b;
            });
            const rough = logged.reduce((a, b) => {
                const ta = goalNumber(
                    member.goalsOn,
                    a.date,
                    "daily_calories",
                )!;
                const tb = goalNumber(
                    member.goalsOn,
                    b.date,
                    "daily_calories",
                )!;
                return Math.abs(a.calories - ta) >= Math.abs(b.calories - tb)
                    ? a
                    : b;
            });
            bestDay = {
                date: best.date,
                calories: best.calories,
                calorieGoal: goalNumber(
                    member.goalsOn,
                    best.date,
                    "daily_calories",
                ),
            };
            roughestDay = {
                date: rough.date,
                calories: rough.calories,
                calorieGoal: goalNumber(
                    member.goalsOn,
                    rough.date,
                    "daily_calories",
                ),
            };
        } else {
            const best = logged.reduce((a, b) =>
                a.calories < b.calories ? a : b,
            );
            const rough = logged.reduce((a, b) =>
                a.calories > b.calories ? a : b,
            );
            bestDay = {
                date: best.date,
                calories: best.calories,
                calorieGoal: goalNumber(
                    member.goalsOn,
                    best.date,
                    "daily_calories",
                ),
            };
            roughestDay = {
                date: rough.date,
                calories: rough.calories,
                calorieGoal: goalNumber(
                    member.goalsOn,
                    rough.date,
                    "daily_calories",
                ),
            };
        }
    }

    return {
        memberId: member.memberId,
        displayName: member.displayName,
        daysLogged: logged.length,
        windowDays: buckets.length,
        avgCalories: round(mean(buckets.map((b) => b.calories))),
        calorieTarget: digestTarget(buckets, member.goalsOn, "daily_calories"),
        avgProtein_g: round(mean(buckets.map((b) => b.protein_g))),
        proteinTarget: digestTarget(buckets, member.goalsOn, "daily_protein_g"),
        bestDay,
        roughestDay,
        summary,
        days,
    };
}

function mergeSuggestions(
    restockLines: readonly GroceryLine[],
    usualAtZero: readonly HouseholdDigestUsualAtZero[],
    onList: ReadonlySet<string>,
): HouseholdDigestSuggestion[] {
    const byFood = new Map<string, HouseholdDigestSuggestion>();

    for (const line of restockLines) {
        if (!line.foodId || onList.has(line.foodId)) continue;
        byFood.set(line.foodId, {
            foodId: line.foodId,
            displayName: line.displayName,
            storeId: line.storeId,
            quantityAmount: line.quantity.amount,
            quantityUnit: line.quantity.unit,
            source: "restock",
        });
    }

    for (const row of usualAtZero) {
        if (onList.has(row.foodId)) continue;
        if (byFood.has(row.foodId)) continue;
        byFood.set(row.foodId, {
            foodId: row.foodId,
            displayName: row.displayName,
            storeId: row.storeId,
            quantityAmount: row.quantity.amount,
            quantityUnit: row.quantity.unit,
            source: "usual",
        });
    }

    return [...byFood.values()].sort(
        (a, b) =>
            a.displayName.localeCompare(b.displayName) ||
            a.foodId.localeCompare(b.foodId),
    );
}

/** Grocery list food ids plus linked plain / usual-product ids for suggestion exclusion. */
export function groceryListFoodIdsForSuggestions(
    lines: readonly GroceryLine[],
    foodsById: ReadonlyMap<
        string,
        Pick<Food, "usualProductId" | "genericFoodId">
    >,
): Set<string> {
    const ids = new Set<string>();
    for (const line of lines) {
        if (!line.foodId) continue;
        ids.add(line.foodId);
        const food = foodsById.get(line.foodId);
        if (food?.usualProductId) ids.add(food.usualProductId);
        if (food?.genericFoodId) ids.add(food.genericFoodId);
    }
    return ids;
}

function renderDigestText(digest: Omit<HouseholdDigest, "text">): string {
    const lines: string[] = [];
    lines.push(
        `Household digest — ${digest.window.from} to ${digest.window.to} (${digest.timezone})`,
    );
    lines.push("");

    if (digest.expiring.length === 0) {
        lines.push("Nothing expires in the next 7 days.");
    } else {
        lines.push("Expiring soon:");
        for (const item of digest.expiring) {
            const left =
                item.daysLeft === 0
                    ? "today"
                    : item.daysLeft === 1
                      ? "tomorrow"
                      : `in ${item.daysLeft} days`;
            lines.push(
                `  ${item.displayName} (${item.quantityAmount} ${item.quantityUnit}) — ${item.expiresOn} (${left})`,
            );
        }
    }

    lines.push("");
    if (digest.ranOut.length === 0) {
        lines.push("Nothing ran out this week.");
    } else {
        lines.push("Ran out:");
        for (const row of digest.ranOut) {
            const day = movementLocalDate(
                { createdAt: row.at } as StockMovement,
                digest.timezone,
            );
            lines.push(`  ${row.displayName} — ${day} (${row.reason})`);
        }
    }

    lines.push("");
    if (digest.members.length === 0) {
        lines.push("No household nutrition to report.");
    } else {
        lines.push("Nutrition by member:");
        for (const member of digest.members) {
            if (member.daysLogged === 0) {
                lines.push(
                    `  ${member.displayName}: no days logged this week.`,
                );
                continue;
            }
            lines.push(`  ${member.displayName}:`);
            for (const row of member.summary.split("\n")) {
                if (row.length === 0) continue;
                lines.push(`    ${row}`);
            }
        }
    }

    lines.push("");
    if (digest.suggestions.length === 0) {
        lines.push("No grocery suggestions.");
    } else {
        lines.push("Suggested grocery lines:");
        for (const s of digest.suggestions) {
            lines.push(
                `  ${s.displayName} — ${s.quantityAmount} ${s.quantityUnit} (${s.source})`,
            );
        }
    }

    return lines.join("\n");
}

function familyHasPositiveStock(
    familyId: string,
    items: readonly FridgeItem[],
    foodsById: ReadonlyMap<string, EffectiveFood>,
): boolean {
    for (const item of items) {
        // Supplies have usual products too, so their stock counts.
        if (item.foodId == null) continue;
        const food = foodsById.get(item.foodId);
        const fam = food ? familyOf(food) : item.foodId;
        if (fam !== familyId) continue;
        if (item.quantity.amount > 0) return true;
    }
    return false;
}

export function usualsAtZeroForDigest(input: {
    items: readonly FridgeItem[];
    foods: readonly Food[];
    foodsById: ReadonlyMap<string, EffectiveFood>;
    stores: readonly { id: string }[];
}): HouseholdDigestUsualAtZero[] {
    const { rows } = usualProductRows({ foods: input.foods });
    const out: HouseholdDigestUsualAtZero[] = [];
    const defaultStore = input.stores[0]?.id ?? "";
    for (const row of rows) {
        if (!row.usual) continue;
        const effective = input.foodsById.get(row.food.id) ?? row.food;
        const familyId = familyOf(effective);
        if (familyHasPositiveStock(familyId, input.items, input.foodsById)) {
            continue;
        }
        const amount = effective.usualAmount?.amount ?? 1;
        const unit =
            effective.usualAmount?.unit ?? effective.defaultUnit ?? "each";
        const storeId = effective.usualStoreId ?? defaultStore;
        if (!storeId) continue;
        out.push({
            foodId: row.food.id,
            displayName: row.food.name,
            storeId,
            quantity: { amount, unit },
        });
    }
    return out.sort(
        (a, b) =>
            a.displayName.localeCompare(b.displayName) ||
            a.foodId.localeCompare(b.foodId),
    );
}

export function movementsInDigestWindow(
    movements: readonly StockMovement[],
    window: { from: string; to: string },
    timezone: string,
): StockMovement[] {
    return movements.filter((movement) =>
        inWindow(movementLocalDate(movement, timezone), window),
    );
}

export function buildHouseholdDigest(
    inputs: HouseholdDigestInputs,
): HouseholdDigest {
    const expiring = buildExpiring(inputs.fridgeItems, inputs.today);
    const ranOut = ranOutInWindow(inputs.stock, inputs.window, inputs.timezone);
    const members = inputs.members
        .map(buildMemberNutrition)
        .sort(
            (a, b) =>
                a.displayName.localeCompare(b.displayName) ||
                a.memberId.localeCompare(b.memberId),
        );
    const suggestions = mergeSuggestions(
        inputs.restockLines,
        inputs.usualAtZero,
        inputs.groceryListFoodIds,
    );

    const partial: Omit<HouseholdDigest, "text"> = {
        timezone: inputs.timezone,
        today: inputs.today,
        window: inputs.window,
        expiring,
        ranOut,
        members,
        suggestions,
    };

    return { ...partial, text: renderDigestText(partial) };
}
