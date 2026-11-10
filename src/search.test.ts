import { test, expect } from "bun:test";
import {
    escapeLikePattern,
    tokenizeQuery,
    groupMealVariations,
    formatMealSearchResults,
} from "./search.js";
import type { Meal } from "./db/nutrition.js";

function meal(overrides: Partial<Meal> = {}): Meal {
    return {
        id: "11111111-1111-1111-1111-111111111111",
        user_id: "user-1",
        logged_at: "2026-06-20T14:30:00.000Z",
        meal_type: "lunch",
        description: "Grilled chicken",
        calories: 500,
        protein_g: 40,
        carbs_g: 10,
        fat_g: 20,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        caffeine_mg: null,
        notes: null,
        idempotency_key: null,
        ...overrides,
    };
}

// --- escapeLikePattern ---

test("escapes LIKE metacharacters", () => {
    expect(escapeLikePattern("50%_off\\")).toBe("50\\%\\_off\\\\");
});

test("leaves plain text untouched", () => {
    expect(escapeLikePattern("oatmeal with banana")).toBe(
        "oatmeal with banana",
    );
});

// --- tokenizeQuery ---

test("splits on whitespace, lowercases, drops empties", () => {
    expect(tokenizeQuery("  Chicken   SALAD ")).toEqual(["chicken", "salad"]);
});

test("caps at 5 tokens", () => {
    expect(tokenizeQuery("a b c d e f g")).toEqual(["a", "b", "c", "d", "e"]);
});

test("returns empty array for blank query", () => {
    expect(tokenizeQuery("   ")).toEqual([]);
});

// --- groupMealVariations ---

test("merges case, whitespace, and trailing-punctuation variants", () => {
    const variations = groupMealVariations([
        meal({ id: "a", description: "Oatmeal with raisins" }),
        meal({ id: "b", description: "oatmeal  with raisins." }),
        meal({ id: "c", description: " OATMEAL WITH RAISINS " }),
    ]);
    expect(variations).toHaveLength(1);
    expect(variations[0]!.count).toBe(3);
});

test("keys on the sorted food_id set when every item has a food", () => {
    const eggs = "food-eggs";
    const toast = "food-toast";
    const item = (
        food_id: string,
        label: string,
    ): NonNullable<Meal["items"]>[number] => ({
        id: `i-${food_id}`,
        meal_id: "m",
        user_id: "user-1",
        household_id: "hh-1",
        food_id,
        recipe_id: null,
        label,
        amount: 1,
        unit: "each",
        grams: 50,
        portions: null,
        calories: 100,
        protein_g: 10,
        carbs_g: 1,
        fat_g: 5,
        fiber_g: 0,
        sugar_g: 0,
        alcohol_g: null,
        caffeine_mg: null,
        sort_order: 0,
        created_at: "2026-06-20T14:30:00.000Z",
    });
    const variations = groupMealVariations([
        meal({
            id: "a",
            description: "Eggs and toast",
            items: [item(eggs, "Eggs"), item(toast, "Toast")],
        }),
        meal({
            id: "b",
            description: "Breakfast plate",
            items: [item(toast, "Toast"), item(eggs, "Eggs")],
        }),
    ]);
    expect(variations).toHaveLength(1);
    expect(variations[0]!.count).toBe(2);
});

test("ignores item amounts when every item has a food", () => {
    const eggs = "food-eggs";
    const toast = "food-toast";
    const item = (
        food_id: string,
        amount: number,
    ): NonNullable<Meal["items"]>[number] => ({
        id: `i-${food_id}-${amount}`,
        meal_id: "m",
        user_id: "user-1",
        household_id: "hh-1",
        food_id,
        recipe_id: null,
        label: food_id,
        amount,
        unit: "each",
        grams: 50 * amount,
        portions: null,
        calories: 100,
        protein_g: 10,
        carbs_g: 1,
        fat_g: 5,
        fiber_g: 0,
        sugar_g: 0,
        alcohol_g: null,
        caffeine_mg: null,
        sort_order: 0,
        created_at: "2026-06-20T14:30:00.000Z",
    });
    const variations = groupMealVariations([
        meal({
            id: "a",
            description: "Small breakfast",
            items: [item(eggs, 1), item(toast, 1)],
        }),
        meal({
            id: "b",
            description: "Big breakfast",
            logged_at: "2026-06-21T14:30:00.000Z",
            items: [item(eggs, 3), item(toast, 2)],
        }),
    ]);
    expect(variations).toHaveLength(1);
    expect(variations[0]!.label).toBe("Big breakfast");
});

test("a food listed twice in one meal still groups by food", () => {
    const item = (id: string, food_id: string) =>
        ({
            id,
            food_id,
            recipe_id: null,
            label: food_id,
        }) as NonNullable<Meal["items"]>[number];
    const variations = groupMealVariations([
        meal({
            id: "a",
            description: "Eggs twice",
            items: [item("i1", "food-eggs"), item("i2", "food-eggs")],
        }),
        meal({
            id: "b",
            description: "eggs",
            logged_at: "2026-06-21T14:30:00.000Z",
            items: [item("i3", "food-eggs")],
        }),
    ]);
    expect(variations).toHaveLength(1);
});

test("does not group free-text meals with food-backed meals that share words", () => {
    const eggs = "food-eggs";
    const toast = "food-toast";
    const item = (food_id: string): NonNullable<Meal["items"]>[number] => ({
        id: `i-${food_id}`,
        meal_id: "m",
        user_id: "user-1",
        household_id: "hh-1",
        food_id,
        recipe_id: null,
        label: food_id,
        amount: 1,
        unit: "each",
        grams: 50,
        portions: null,
        calories: 100,
        protein_g: 10,
        carbs_g: 1,
        fat_g: 5,
        fiber_g: 0,
        sugar_g: 0,
        alcohol_g: null,
        caffeine_mg: null,
        sort_order: 0,
        created_at: "2026-06-20T14:30:00.000Z",
    });
    const variations = groupMealVariations([
        meal({
            id: "backed",
            description: "Eggs and toast",
            items: [item(eggs), item(toast)],
        }),
        meal({ id: "free", description: "Eggs and toast" }),
    ]);
    expect(variations).toHaveLength(2);
});

test("sorts by count desc, ties broken by recency", () => {
    const variations = groupMealVariations([
        meal({
            id: "a",
            description: "Oatmeal with banana",
            logged_at: "2026-06-01T08:00:00.000Z",
        }),
        meal({
            id: "b",
            description: "Oatmeal with raisins",
            logged_at: "2026-06-02T08:00:00.000Z",
        }),
        meal({
            id: "c",
            description: "Oatmeal with raisins",
            logged_at: "2026-06-03T08:00:00.000Z",
        }),
        meal({
            id: "d",
            description: "Oatmeal with honey",
            logged_at: "2026-06-04T08:00:00.000Z",
        }),
    ]);
    expect(variations.map((v) => v.label)).toEqual([
        "Oatmeal with raisins",
        "Oatmeal with honey",
        "Oatmeal with banana",
    ]);
});

test("label and lastLoggedAt come from the newest entry in the group", () => {
    const variations = groupMealVariations([
        meal({
            id: "a",
            description: "oatmeal with raisins",
            logged_at: "2026-06-01T08:00:00.000Z",
        }),
        meal({
            id: "b",
            description: "Oatmeal with raisins",
            logged_at: "2026-06-05T08:00:00.000Z",
        }),
    ]);
    expect(variations[0]!.label).toBe("Oatmeal with raisins");
    expect(variations[0]!.lastLoggedAt).toBe("2026-06-05T08:00:00.000Z");
});

test("typical macros are medians of non-null values", () => {
    const variations = groupMealVariations([
        meal({ id: "a", calories: 300, protein_g: 10 }),
        meal({ id: "b", calories: 350, protein_g: 12.4 }),
        meal({ id: "c", calories: 900, protein_g: null }),
    ]);
    // odd count → middle value
    expect(variations[0]!.typicalCalories).toBe(350);
    // nulls excluded, even count → average, rounded to 1 decimal
    expect(variations[0]!.typicalProteinG).toBe(11.2);
});

test("all-null macros yield null", () => {
    const variations = groupMealVariations([
        meal({ id: "a", calories: null, protein_g: null }),
        meal({ id: "b", calories: null, protein_g: null }),
    ]);
    expect(variations[0]!.typicalCalories).toBeNull();
    expect(variations[0]!.typicalProteinG).toBeNull();
});

// --- formatMealSearchResults ---

test("renders counts, typical macros, and last-logged date", () => {
    const text = formatMealSearchResults(
        [
            meal({
                id: "b",
                description: "Oatmeal with raisins",
                logged_at: "2026-06-05T08:00:00.000Z",
                calories: 350,
            }),
            meal({
                id: "a",
                description: "Oatmeal with raisins",
                logged_at: "2026-06-01T08:00:00.000Z",
                calories: 350,
            }),
        ],
        ["oatmeal"],
        "UTC",
    );
    expect(text).toContain('Found 2 past meals matching "oatmeal".');
    expect(text).toContain("logged 2×, last on 2026-06-05");
    expect(text).toContain("~350 kcal");
});

test("renders header with all query alternatives", () => {
    const text = formatMealSearchResults(
        [meal({ description: "Вівсянка з бананом" })],
        ["oatmeal", "вівсянка"],
        "UTC",
    );
    expect(text).toContain('matching "oatmeal" / "вівсянка".');
});

test("renders last-logged date in the user's timezone", () => {
    // 23:30 UTC on the 20th is already the 21st in Berlin (CEST, summer).
    const text = formatMealSearchResults(
        [meal({ logged_at: "2026-06-20T23:30:00.000Z" })],
        ["chicken"],
        "Europe/Berlin",
    );
    expect(text).toContain("last on 2026-06-21");
    expect(text).toContain("- 2026-06-21 lunch:");
});

test("caps variations and reports the hidden count", () => {
    const meals = Array.from({ length: 4 }, (_, i) =>
        meal({
            id: `id-${i}`,
            description: `Dish ${i}`,
            logged_at: `2026-06-0${i + 1}T08:00:00.000Z`,
        }),
    ).reverse();
    const text = formatMealSearchResults(meals, ["dish"], "UTC", {
        maxVariations: 2,
        recentCount: 5,
    });
    expect(text).toContain("(…and 2 more variations)");
    expect(text).not.toContain("3. ");
});

test("caps recent entries and includes ids", () => {
    const meals = Array.from({ length: 4 }, (_, i) =>
        meal({
            id: `id-${i}`,
            description: "Same dish",
            logged_at: `2026-06-0${i + 1}T08:00:00.000Z`,
        }),
    ).reverse();
    const text = formatMealSearchResults(meals, ["dish"], "UTC", {
        recentCount: 2,
    });
    expect(text).toContain("[id: id-3]");
    expect(text).toContain("[id: id-2]");
    expect(text).not.toContain("[id: id-1]");
});

test("renders '(no macros logged)' when every entry lacks macros", () => {
    const text = formatMealSearchResults(
        [
            meal({
                calories: null,
                protein_g: null,
                carbs_g: null,
                fat_g: null,
            }),
        ],
        ["soup"],
        "UTC",
    );
    expect(text).toContain("(no macros logged)");
    expect(text).not.toContain("~null");
});

// --- fiber / sugar / caffeine in the variation line ---
//
// The model is told to search before logging a repeat, so anything this output
// leaves out is what it re-derives or forgets every time. Showing only kcal and
// P/C/F was itself teaching that a meal is four numbers.

test("a variation carries fiber, sugar and caffeine when the history has them", () => {
    const text = formatMealSearchResults(
        [
            meal({ description: "Flat white", fiber_g: 0, sugar_g: 9 }),
            meal({ description: "Flat white", fiber_g: 0, sugar_g: 11 }),
        ].map((m) => ({ ...m, caffeine_mg: 95 })),
        ["flat white"],
        "UTC",
    );
    expect(text).toContain("0g fiber");
    expect(text).toContain("10g sugar");
    expect(text).toContain("95 mg caffeine");
});

// Median over the entries that HAVE the field, so a history where fiber was
// only recorded sometimes still surfaces the figure rather than dropping it.
test("mixed history reports the typical value of the entries that recorded one", () => {
    const [a, b] = groupMealVariations([
        meal({ description: "Porridge", fiber_g: 8 }),
        meal({ description: "Porridge", fiber_g: null }),
        meal({ description: "Steak", sugar_g: null, fiber_g: null }),
    ]);
    expect(a?.typicalFiberG).toBe(8);
    expect(b?.typicalFiberG).toBeNull();
});

// A null is absence, and the line must not claim a zero for it — that is the
// same null-vs-zero rule the read side is built on.
test("a nutrient nobody recorded is left out of the line entirely", () => {
    const text = formatMealSearchResults(
        [meal({ description: "Grilled chicken" })],
        ["chicken"],
        "UTC",
    );
    const line = text.split("\n").find((l) => l.startsWith("1. "))!;
    expect(line).not.toContain("fiber");
    expect(line).not.toContain("caffeine");
    // …and the closing instruction tells the model to fill it in this time.
    expect(text).toContain("missing data rather than a zero");
});

test("nutrients still show when the calorie figure is the missing one", () => {
    const text = formatMealSearchResults(
        [meal({ description: "Side salad", calories: null, fiber_g: 4 })],
        ["salad"],
        "UTC",
    );
    expect(text).toContain("4g fiber");
    expect(text).not.toContain("(no macros logged)");
});
