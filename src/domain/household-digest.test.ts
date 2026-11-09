import { test, expect } from "bun:test";
import type { Meal, NutritionGoals } from "../db/nutrition.js";
import type { FridgeItem } from "./fridge.js";
import type { GroceryLine } from "./grocery.js";
import {
    buildHouseholdDigest,
    gradeCaloriesForDay,
    groceryListFoodIdsForSuggestions,
    ranOutInWindow,
    type HouseholdDigestInputs,
    type HouseholdDigestStockInput,
} from "./household-digest.js";
import {
    buildDailyBuckets,
    computeWeeklyDigest,
    goalsResolver,
    type GoalDayOverride,
} from "./insights.js";
import { gateAlcohol } from "../mcp/shared.js";
import { zonedDayStartUtc } from "./tz.js";
import { applyMovement, createMemoryStockStore } from "./stock.js";
import {
    createMemoryFoodsStore,
    findOrCreateManualFood,
    updateFood,
} from "./foods.js";
import { addLocation, createMemoryFridgeStore } from "./fridge.js";

const HH = "hh-1";
const WINDOW = { from: "2026-06-01", to: "2026-06-07" };
const TZ = "UTC";
const WINDOW_MOVEMENT_SINCE = zonedDayStartUtc(WINDOW.from, TZ).toISOString();

async function movementsSinceWindow(
    stock: ReturnType<typeof createMemoryStockStore>,
): Promise<HouseholdDigestStockInput["movements"]> {
    const rows = await stock.listMovements(
        HH,
        undefined,
        WINDOW_MOVEMENT_SINCE,
    );
    return rows;
}

function goals(fields: Partial<NutritionGoals> = {}): NutritionGoals {
    return {
        user_id: "u1",
        daily_calories: 2000,
        daily_protein_g: 150,
        daily_carbs_g: null,
        daily_fat_g: null,
        daily_fiber_g: null,
        daily_sugar_g: null,
        daily_alcohol_g: null,
        daily_caffeine_mg: null,
        daily_water_ml: null,
        target_weight_g: null,
        updated_at: "2026-06-02T00:00:00Z",
        ...fields,
    };
}

function meal(logged_at: string, fields: Partial<Meal> = {}): Meal {
    return {
        id: `m-${logged_at}`,
        user_id: "u1",
        logged_at,
        meal_type: "lunch",
        description: "test",
        calories: 500,
        protein_g: 30,
        carbs_g: 50,
        fat_g: 20,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        caffeine_mg: null,
        notes: null,
        idempotency_key: null,
        ...fields,
    };
}

function fridgeItem(
    id: string,
    name: string,
    expiresOn: string | null,
    foodId = "f1",
    amount = 2,
): FridgeItem {
    return {
        id,
        householdId: HH,
        locationId: "loc",
        kind: "food",
        displayName: name,
        quantity: { amount, unit: "each" },
        foodId,
        expiresOn,
    };
}

function groceryLine(
    id: string,
    foodId: string | null,
    name: string,
): GroceryLine {
    return {
        id,
        householdId: HH,
        storeId: "store",
        sectionId: "sec",
        kind: "food",
        displayName: name,
        quantity: { amount: 1, unit: "each" },
        foodId,
        checked: false,
        source: "manual",
        sourceFridgeItemId: null,
        note: null,
    };
}

function stockInput(
    overrides: Partial<HouseholdDigestStockInput> = {},
): HouseholdDigestStockInput {
    return {
        movements: [],
        fridgeItems: [],
        displayNameByFoodId: new Map(),
        ...overrides,
    };
}

function baseInputs(
    overrides: Partial<HouseholdDigestInputs> = {},
): HouseholdDigestInputs {
    return {
        timezone: TZ,
        today: "2026-06-05",
        window: WINDOW,
        fridgeItems: [],
        stock: stockInput(),
        members: [],
        restockLines: [],
        usualAtZero: [],
        groceryLines: [],
        groceryListFoodIds: new Set(),
        ...overrides,
    };
}

async function ledgerRanOutScenario() {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const milk = await findOrCreateManualFood(foods, HH, "food", "Milk");
    await updateFood(foods, HH, milk.id, { defaultUnit: "each" });
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: milk.id,
        delta: 2,
        unit: "each",
        reason: "purchase",
        locationId: loc.id,
        now: new Date("2026-06-03T09:00:00Z"),
    });
    const itemId = (await fridge.listItems(HH))[0]!.id;
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: milk.id,
        delta: -2,
        unit: "each",
        reason: "eat",
        fridgeItemId: itemId,
        now: new Date("2026-06-04T10:00:00Z"),
    });
    const afterItems = await fridge.listItems(HH);
    const movements = await movementsSinceWindow(stock);
    return { milk, afterItems, movements };
}

test("buildHouseholdDigest populates all four sections", async () => {
    const { milk, afterItems, movements } = await ledgerRanOutScenario();
    const buckets = buildDailyBuckets(
        [meal("2026-06-03T12:00:00Z", { calories: 2100, protein_g: 140 })],
        [],
        "2026-06-01",
        "2026-06-07",
        TZ,
    );
    const digest = buildHouseholdDigest(
        baseInputs({
            fridgeItems: [fridgeItem("fi-yog", "Yogurt", "2026-06-08")],
            stock: stockInput({
                movements,
                fridgeItems: afterItems,
                displayNameByFoodId: new Map([[milk.id, "Milk"]]),
            }),
            members: [
                {
                    memberId: "u1",
                    displayName: "Alex",
                    buckets,
                    goalsOn: goalsResolver(goals(), []),
                },
            ],
            restockLines: [groceryLine("g1", "f-bread", "Bread")],
            usualAtZero: [
                {
                    foodId: "f-eggs",
                    displayName: "Eggs",
                    storeId: "store",
                    quantity: { amount: 12, unit: "each" },
                },
            ],
        }),
    );

    expect(digest.expiring).toHaveLength(1);
    expect(digest.ranOut).toHaveLength(1);
    expect(digest.members).toHaveLength(1);
    expect(digest.suggestions).toHaveLength(2);
    expect(digest.text).toContain("Expiring soon:");
    expect(digest.text).toContain("Ran out:");
    expect(digest.text).toContain("Nutrition by member:");
    expect(digest.text).toContain("Suggested grocery lines:");
});

test("buildHouseholdDigest empty household renders one-line empty sections", () => {
    const digest = buildHouseholdDigest(baseInputs());
    expect(digest.expiring).toEqual([]);
    expect(digest.ranOut).toEqual([]);
    expect(digest.members).toEqual([]);
    expect(digest.suggestions).toEqual([]);
    expect(digest.text).toContain("Nothing expires in the next 7 days.");
    expect(digest.text).toContain("Nothing ran out this week.");
    expect(digest.text).toContain("No household nutrition to report.");
    expect(digest.text).toContain("No grocery suggestions.");
});

test("gradeCaloriesForDay uses that day's own goal", () => {
    expect(gradeCaloriesForDay(2800, 2800)).toBe("on_target");
    expect(gradeCaloriesForDay(2800, 2000)).toBe("over");
    expect(gradeCaloriesForDay(1500, 2000)).toBe("under");
});

test("per-day override is graded against its own training-day goal", () => {
    const overrides: GoalDayOverride[] = [
        {
            user_id: "u1",
            date: "2026-06-03",
            updated_at: "2026-06-01T00:00:00Z",
            daily_calories: 2800,
            daily_protein_g: null,
            daily_carbs_g: null,
            daily_fat_g: null,
            daily_fiber_g: null,
            daily_sugar_g: null,
            daily_alcohol_g: null,
            daily_caffeine_mg: null,
            daily_water_ml: null,
        },
    ];
    const buckets = buildDailyBuckets(
        [meal("2026-06-03T12:00:00Z", { calories: 2800, protein_g: 30 })],
        [],
        "2026-06-03",
        "2026-06-03",
        TZ,
    );
    const digest = buildHouseholdDigest(
        baseInputs({
            members: [
                {
                    memberId: "u1",
                    displayName: "Alex",
                    buckets,
                    goalsOn: goalsResolver(
                        goals({ daily_calories: 2000 }),
                        overrides,
                    ),
                },
            ],
        }),
    );
    const day = digest.members[0]!.days[0]!;
    expect(day.calorieGoal).toBe(2800);
    expect(day.calorieGrade).toBe("on_target");
    expect(digest.members[0]!.summary).toBe(
        computeWeeklyDigest(
            [...buckets],
            goalsResolver(goals({ daily_calories: 2000 }), overrides),
        ),
    );
});

test("listExpiring horizon respects household today near midnight UTC", () => {
    const digest = buildHouseholdDigest(
        baseInputs({
            timezone: "Pacific/Auckland",
            today: "2026-06-06",
            fridgeItems: [
                fridgeItem("fi-1", "Cream", "2026-06-07"),
                fridgeItem("fi-2", "Later", "2026-06-15"),
            ],
        }),
    );
    expect(digest.expiring.map((i) => i.displayName)).toEqual(["Cream"]);
    expect(digest.expiring[0]!.daysLeft).toBe(1);
});

test("expiring sorts ties by fridge item id", () => {
    const digest = buildHouseholdDigest(
        baseInputs({
            fridgeItems: [
                fridgeItem("fi-b", "Same", "2026-06-07"),
                fridgeItem("fi-a", "Same", "2026-06-07"),
            ],
        }),
    );
    expect(digest.expiring.map((i) => i.fridgeItemId)).toEqual([
        "fi-a",
        "fi-b",
    ]);
});

test("ranOutInWindow reports food ran out via real ledger (item deleted)", async () => {
    const { milk, afterItems, movements } = await ledgerRanOutScenario();
    const ranOut = ranOutInWindow(
        stockInput({
            movements,
            fridgeItems: afterItems,
            displayNameByFoodId: new Map([[milk.id, "Milk"]]),
        }),
        WINDOW,
        TZ,
    );
    expect(ranOut).toHaveLength(1);
    expect(ranOut[0]!.foodId).toBe(milk.id);
    expect(ranOut[0]!.reason).toBe("eat");
});

test("ranOutInWindow ignores decrement before window", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const beans = await findOrCreateManualFood(foods, HH, "food", "Beans");
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: beans.id,
        delta: 1,
        unit: "each",
        reason: "purchase",
        locationId: loc.id,
    });
    const itemId = (await fridge.listItems(HH))[0]!.id;
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: beans.id,
        delta: -1,
        unit: "each",
        reason: "eat",
        fridgeItemId: itemId,
        now: new Date("2026-05-28T10:00:00Z"),
    });
    const movements = await movementsSinceWindow(stock);
    const ranOut = ranOutInWindow(
        stockInput({
            movements,
            fridgeItems: await fridge.listItems(HH),
            displayNameByFoodId: new Map([[beans.id, "Beans"]]),
        }),
        WINDOW,
        TZ,
    );
    expect(ranOut).toHaveLength(0);
});

test("ranOutInWindow skips food still in stock after partial eat", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const oats = await findOrCreateManualFood(foods, HH, "food", "Oats");
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: oats.id,
        delta: 3,
        unit: "each",
        reason: "purchase",
        locationId: loc.id,
    });
    const itemId = (await fridge.listItems(HH))[0]!.id;
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: oats.id,
        delta: -1,
        unit: "each",
        reason: "eat",
        fridgeItemId: itemId,
        now: new Date("2026-06-03T10:00:00Z"),
    });
    const ranOut = ranOutInWindow(
        stockInput({
            movements: await movementsSinceWindow(stock),
            fridgeItems: await fridge.listItems(HH),
            displayNameByFoodId: new Map([[oats.id, "Oats"]]),
        }),
        WINDOW,
        TZ,
    );
    expect(ranOut).toHaveLength(0);
});

test("ranOutInWindow Eggs: partial eat in window then zero after window is not listed", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const eggs = await findOrCreateManualFood(foods, HH, "food", "Eggs");
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: eggs.id,
        delta: 2,
        unit: "each",
        reason: "purchase",
        locationId: loc.id,
        now: new Date("2026-05-25T10:00:00Z"),
    });
    const itemId = (await fridge.listItems(HH))[0]!.id;
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: eggs.id,
        delta: -1,
        unit: "each",
        reason: "eat",
        fridgeItemId: itemId,
        now: new Date("2026-06-03T10:00:00Z"),
    });
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: eggs.id,
        delta: -1,
        unit: "each",
        reason: "eat",
        fridgeItemId: itemId,
        now: new Date("2026-06-10T10:00:00Z"),
    });
    const ranOut = ranOutInWindow(
        stockInput({
            movements: await movementsSinceWindow(stock),
            fridgeItems: await fridge.listItems(HH),
            displayNameByFoodId: new Map([[eggs.id, "Eggs"]]),
        }),
        WINDOW,
        TZ,
    );
    expect(ranOut).toHaveLength(0);
});

test("ranOutInWindow Yogurt: eat to zero in window then restock is still listed", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const yogurt = await findOrCreateManualFood(foods, HH, "food", "Yogurt");
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: yogurt.id,
        delta: 1,
        unit: "each",
        reason: "purchase",
        locationId: loc.id,
        now: new Date("2026-06-02T10:00:00Z"),
    });
    let itemId = (await fridge.listItems(HH))[0]!.id;
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: yogurt.id,
        delta: -1,
        unit: "each",
        reason: "eat",
        fridgeItemId: itemId,
        now: new Date("2026-06-03T10:00:00Z"),
    });
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: yogurt.id,
        delta: 1,
        unit: "each",
        reason: "purchase",
        locationId: loc.id,
        now: new Date("2026-06-04T10:00:00Z"),
    });
    const ranOut = ranOutInWindow(
        stockInput({
            movements: await movementsSinceWindow(stock),
            fridgeItems: await fridge.listItems(HH),
            displayNameByFoodId: new Map([[yogurt.id, "Yogurt"]]),
        }),
        WINDOW,
        TZ,
    );
    expect(ranOut).toHaveLength(1);
    expect(ranOut[0]!.reason).toBe("eat");
});

test("ranOutInWindow food with stock in another location is not listed", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const pantry = await addLocation(fridge, HH, "Pantry");
    const fridgeLoc = await addLocation(fridge, HH, "Fridge");
    const flour = await findOrCreateManualFood(foods, HH, "food", "Flour");
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: flour.id,
        delta: 1,
        unit: "kg",
        reason: "purchase",
        locationId: pantry.id,
        now: new Date("2026-06-01T10:00:00Z"),
    });
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: flour.id,
        delta: 1,
        unit: "kg",
        reason: "purchase",
        locationId: fridgeLoc.id,
        now: new Date("2026-06-01T11:00:00Z"),
    });
    const fridgeItemRow = (await fridge.listItems(HH)).find(
        (i) => i.locationId === fridgeLoc.id,
    )!;
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: flour.id,
        delta: -1,
        unit: "kg",
        reason: "eat",
        fridgeItemId: fridgeItemRow.id,
        now: new Date("2026-06-05T10:00:00Z"),
    });
    const ranOut = ranOutInWindow(
        stockInput({
            movements: await movementsSinceWindow(stock),
            fridgeItems: await fridge.listItems(HH),
            displayNameByFoodId: new Map([[flour.id, "Flour"]]),
        }),
        WINDOW,
        TZ,
    );
    expect(ranOut).toHaveLength(0);
});

test("ranOutInWindow two units: zero on one unit while the other still has stock", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const honey = await findOrCreateManualFood(foods, HH, "food", "Honey");
    await updateFood(foods, HH, honey.id, {
        defaultUnit: "g",
        gramsPerMl: 1.4,
    });
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: honey.id,
        delta: 500,
        unit: "g",
        reason: "purchase",
        locationId: loc.id,
        now: new Date("2026-06-01T10:00:00Z"),
    });
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: honey.id,
        delta: 1,
        unit: "each",
        reason: "purchase",
        locationId: loc.id,
        now: new Date("2026-06-01T11:00:00Z"),
    });
    const jar = (await fridge.listItems(HH)).find(
        (i) => i.quantity.unit === "each",
    )!;
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: honey.id,
        delta: -1,
        unit: "each",
        reason: "eat",
        fridgeItemId: jar.id,
        now: new Date("2026-06-04T10:00:00Z"),
    });
    const ranOut = ranOutInWindow(
        stockInput({
            movements: await movementsSinceWindow(stock),
            fridgeItems: await fridge.listItems(HH),
            displayNameByFoodId: new Map([[honey.id, "Honey"]]),
        }),
        WINDOW,
        TZ,
    );
    expect(ranOut).toHaveLength(0);
});

test("gated buckets omit alcohol from member digest text", () => {
    const buckets = buildDailyBuckets(
        [meal("2026-06-03T12:00:00Z", { alcohol_g: 14 })],
        [],
        WINDOW.from,
        WINDOW.to,
        TZ,
    );
    const goalsOn = goalsResolver(goals({ daily_alcohol_g: 20 }), []);
    const gated = gateAlcohol(buckets, null);
    const digest = buildHouseholdDigest(
        baseInputs({
            members: [
                {
                    memberId: "u1",
                    displayName: "Alex",
                    buckets: gated,
                    goalsOn,
                },
            ],
        }),
    );
    expect(digest.members[0]!.summary).not.toMatch(/Alcohol/i);
    expect(digest.text).not.toMatch(/Alcohol/i);

    const withAlcohol = buildHouseholdDigest(
        baseInputs({
            members: [
                {
                    memberId: "u1",
                    displayName: "Alex",
                    buckets: gateAlcohol(buckets, "us"),
                    goalsOn,
                },
            ],
        }),
    );
    expect(withAlcohol.members[0]!.summary).toMatch(/Alcohol/i);
});

test("suggestions dedupe by food and skip lines already on the grocery list", () => {
    const digest = buildHouseholdDigest(
        baseInputs({
            restockLines: [
                groceryLine("g1", "f-eggs", "Eggs (restock)"),
                groceryLine("g2", "f-milk", "Milk"),
            ],
            usualAtZero: [
                {
                    foodId: "f-eggs",
                    displayName: "Eggs (usual)",
                    storeId: "store",
                    quantity: { amount: 6, unit: "each" },
                },
                {
                    foodId: "f-butter",
                    displayName: "Butter",
                    storeId: "store",
                    quantity: { amount: 1, unit: "each" },
                },
            ],
            groceryListFoodIds: new Set(["f-milk"]),
        }),
    );
    expect(digest.suggestions.map((s) => s.foodId).sort()).toEqual([
        "f-butter",
        "f-eggs",
    ]);
    expect(digest.suggestions.find((s) => s.foodId === "f-eggs")!.source).toBe(
        "restock",
    );
    expect(digest.suggestions.some((s) => s.foodId === "f-milk")).toBe(false);
});

test("groceryListFoodIdsForSuggestions excludes usual product when plain is on list", () => {
    const foodsById = new Map([
        [
            "plain-milk",
            {
                usualProductId: "prod-organic",
                genericFoodId: null,
            },
        ],
        [
            "prod-organic",
            {
                usualProductId: null,
                genericFoodId: "plain-milk",
            },
        ],
    ]);
    const ids = groceryListFoodIdsForSuggestions(
        [groceryLine("g1", "plain-milk", "Milk")],
        foodsById,
    );
    expect(ids.has("plain-milk")).toBe(true);
    expect(ids.has("prod-organic")).toBe(true);

    const digest = buildHouseholdDigest(
        baseInputs({
            usualAtZero: [
                {
                    foodId: "prod-organic",
                    displayName: "Organic Milk",
                    storeId: "store",
                    quantity: { amount: 1, unit: "L" },
                },
            ],
            groceryListFoodIds: ids,
        }),
    );
    expect(digest.suggestions).toHaveLength(0);
});
