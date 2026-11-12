import { describe, expect, test } from "bun:test";
import { createMemoryFoodsStore, newFood, type Food } from "./foods.js";
import {
    GroceryInputError,
    createMemoryGroceryStore,
    resolveGroceryLineSource,
} from "./grocery.js";
import type { RecipePlan, PlanSlot } from "./plan.js";
import {
    addMissingToGroceries,
    addPlanDays,
    missingForPlan,
    unknownMissingNotice,
    weekPlan,
    type PlanRecipe,
} from "./plan-week.js";
import { createGroceryStore, createMemorySettingsStore } from "./settings.js";

const HH = "hh-plan";

let counter = 0;
function plan(
    recipeId: string,
    date: string,
    slot: PlanSlot = "dinner",
    servings = 1,
): RecipePlan {
    counter += 1;
    return {
        id: `plan-${counter}`,
        householdId: HH,
        recipeId,
        date,
        slot,
        servings,
        createdBy: null,
        createdAt: `2026-11-01T00:00:${String(counter).padStart(2, "0")}+00:00`,
    };
}

function recipe(
    id: string,
    yieldPortions: number,
    ingredients: PlanRecipe["ingredients"],
): PlanRecipe {
    return { id, name: `Recipe ${id}`, yieldPortions, ingredients };
}

const FLOUR = "food-flour";
const EGGS = "food-eggs";
const MILK = "food-milk";
const SALT = "food-salt";
const MILK_BRAND = "food-milk-brand";

function factors(
    over: { gramsPerEach?: number | null; gramsPerMl?: number | null } = {},
) {
    return { gramsPerEach: null, gramsPerMl: null, ...over };
}

describe("weekPlan", () => {
    test("lists seven days from `from`, plans in slot order", () => {
        const plans = [
            plan("r", "2026-11-14", "dinner"),
            plan("r", "2026-11-14", "breakfast"),
            plan("r", "2026-11-12", "snack"),
            plan("r", "2026-11-12", "lunch"),
        ];
        const week = weekPlan(plans, "2026-11-12");
        expect(week.map((d) => d.date)).toEqual([
            "2026-11-12",
            "2026-11-13",
            "2026-11-14",
            "2026-11-15",
            "2026-11-16",
            "2026-11-17",
            "2026-11-18",
        ]);
        expect(week[0]!.plans.map((p) => p.slot)).toEqual(["lunch", "snack"]);
        expect(week[1]!.plans).toEqual([]);
        expect(week[2]!.plans.map((p) => p.slot)).toEqual([
            "breakfast",
            "dinner",
        ]);
    });

    test("hides plans before today and after the week without touching them", () => {
        const past = plan("r", "2026-11-11");
        const tooLate = plan("r", "2026-11-19");
        const today = plan("r", "2026-11-12");
        const week = weekPlan([past, tooLate, today], "2026-11-12");
        expect(week.flatMap((d) => d.plans.map((p) => p.id))).toEqual([
            today.id,
        ]);
        expect(past.date).toBe("2026-11-11");
    });

    test("crosses month and year ends", () => {
        const week = weekPlan([], "2026-12-29");
        expect(week.map((d) => d.date).slice(-3)).toEqual([
            "2027-01-02",
            "2027-01-03",
            "2027-01-04",
        ]);
        expect(addPlanDays("2028-02-28", 1)).toBe("2028-02-29");
        expect(addPlanDays("2026-11-12", -12)).toBe("2026-10-31");
    });
});

describe("missingForPlan", () => {
    const pancakes = recipe("pancakes", 4, [
        {
            displayName: "Flour",
            quantity: { amount: 200, unit: "g" },
            foodId: FLOUR,
        },
        {
            displayName: "Eggs",
            quantity: { amount: 2, unit: "each" },
            foodId: EGGS,
        },
    ]);

    test("scales by servings over yield and lists everything with no stock", () => {
        const lines = missingForPlan(
            [plan("pancakes", "2026-11-12", "dinner", 2)],
            [pancakes],
            [],
            { from: "2026-11-12", days: 7 },
        );
        expect(lines.map((l) => [l.displayName, l.missing])).toEqual([
            ["Eggs", { amount: 1, unit: "each" }],
            ["Flour", { amount: 100, unit: "g" }],
        ]);
        expect(lines.every((l) => !l.unknown && !l.unmeasured)).toBe(true);
        expect(lines[1]!.neededBy).toEqual([
            {
                planId: expect.any(String),
                recipeId: "pancakes",
                recipeName: "Recipe pancakes",
                date: "2026-11-12",
                slot: "dinner",
                servings: 2,
                need: { amount: 100, unit: "g" },
            },
        ]);
    });

    test("partial stock leaves the remainder; full stock omits the food", () => {
        const lines = missingForPlan(
            [plan("pancakes", "2026-11-12", "dinner", 4)],
            [pancakes],
            [
                { foodId: FLOUR, quantity: { amount: 120, unit: "g" } },
                { foodId: EGGS, quantity: { amount: 6, unit: "each" } },
            ],
            { from: "2026-11-12", days: 7 },
        );
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({
            displayName: "Flour",
            need: { amount: 200, unit: "g" },
            have: { amount: 120, unit: "g" },
            missing: { amount: 80, unit: "g" },
            unknown: false,
        });
    });

    test("stock in another unit of the same kind is converted", () => {
        const lines = missingForPlan(
            [plan("pancakes", "2026-11-12", "dinner", 4)],
            [pancakes],
            [
                { foodId: FLOUR, quantity: { amount: 4, unit: "oz" } },
                { foodId: EGGS, quantity: { amount: 2, unit: "each" } },
            ],
            { from: "2026-11-12", days: 7 },
        );
        expect(lines).toHaveLength(1);
        expect(lines[0]!.missing).toEqual({ amount: 86.6, unit: "g" });
    });

    test("two plans of the same recipe add up before stock is taken off", () => {
        const lines = missingForPlan(
            [
                plan("pancakes", "2026-11-12", "dinner", 4),
                plan("pancakes", "2026-11-14", "breakfast", 4),
            ],
            [pancakes],
            [{ foodId: FLOUR, quantity: { amount: 300, unit: "g" } }],
            { from: "2026-11-12", days: 7 },
        );
        const flour = lines.find((l) => l.displayName === "Flour")!;
        expect(flour.need).toEqual({ amount: 400, unit: "g" });
        expect(flour.missing).toEqual({ amount: 100, unit: "g" });
        expect(flour.neededBy.map((n) => n.date)).toEqual([
            "2026-11-12",
            "2026-11-14",
        ]);
        const eggs = lines.find((l) => l.displayName === "Eggs")!;
        expect(eggs.missing).toEqual({ amount: 4, unit: "each" });
    });

    test("different recipes share one need per food family", () => {
        const bread = recipe("bread", 1, [
            {
                displayName: "Flour",
                quantity: { amount: 500, unit: "g" },
                foodId: FLOUR,
            },
        ]);
        const lines = missingForPlan(
            [
                plan("pancakes", "2026-11-12", "dinner", 4),
                plan("bread", "2026-11-13", "lunch", 1),
            ],
            [pancakes, bread],
            [{ foodId: FLOUR, quantity: { amount: 100, unit: "g" } }],
            { from: "2026-11-12", days: 7 },
        );
        const flour = lines.find((l) => l.displayName === "Flour")!;
        expect(flour.missing).toEqual({ amount: 600, unit: "g" });
        expect(flour.neededBy.map((n) => n.recipeId)).toEqual([
            "pancakes",
            "bread",
        ]);
    });

    test("stock of a product counts toward its plain food", () => {
        const latte = recipe("latte", 1, [
            {
                displayName: "Milk",
                quantity: { amount: 200, unit: "ml" },
                foodId: MILK,
            },
        ]);
        const foodsById = new Map([
            [MILK, { ...factors(), genericFoodId: null }],
            [MILK_BRAND, { ...factors(), genericFoodId: MILK }],
        ]);
        const lines = missingForPlan(
            [plan("latte", "2026-11-12")],
            [latte],
            [{ foodId: MILK_BRAND, quantity: { amount: 500, unit: "ml" } }],
            { from: "2026-11-12", days: 7, foodsById },
        );
        expect(lines).toEqual([]);
    });

    test("the window bounds which plans count, and `days` is a parameter", () => {
        const plans = [
            plan("pancakes", "2026-11-11", "dinner", 4),
            plan("pancakes", "2026-11-12", "dinner", 4),
            plan("pancakes", "2026-11-14", "dinner", 4),
            plan("pancakes", "2026-11-15", "dinner", 4),
        ];
        const flourNeeded = (days: number) =>
            missingForPlan(plans, [pancakes], [], {
                from: "2026-11-12",
                days,
            }).find((l) => l.displayName === "Flour")?.need?.amount;
        expect(flourNeeded(1)).toBe(200);
        expect(flourNeeded(3)).toBe(400);
        expect(flourNeeded(4)).toBe(600);
        expect(flourNeeded(7)).toBe(600);
    });

    test("a unit that cannot convert is unknown with the recipe's full amount", () => {
        const cake = recipe("cake", 1, [
            {
                displayName: "Flour",
                quantity: { amount: 2, unit: "cup" },
                foodId: FLOUR,
            },
        ]);
        const lines = missingForPlan(
            [plan("cake", "2026-11-12")],
            [cake],
            [{ foodId: FLOUR, quantity: { amount: 500, unit: "g" } }],
            {
                from: "2026-11-12",
                days: 7,
                foodsById: new Map([[FLOUR, factors()]]),
            },
        );
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({
            displayName: "Flour",
            unknown: true,
            have: null,
            missing: { amount: 2, unit: "cup" },
        });
    });

    test("a known density turns the same stock into an answer", () => {
        const cake = recipe("cake", 1, [
            {
                displayName: "Flour",
                quantity: { amount: 500, unit: "ml" },
                foodId: FLOUR,
            },
        ]);
        const lines = missingForPlan(
            [plan("cake", "2026-11-12")],
            [cake],
            [{ foodId: FLOUR, quantity: { amount: 200, unit: "g" } }],
            {
                from: "2026-11-12",
                days: 7,
                foodsById: new Map([[FLOUR, factors({ gramsPerMl: 0.5 })]]),
            },
        );
        // 200 g at 0.5 g/ml holds 400 ml, so 100 ml is short.
        expect(lines[0]).toMatchObject({
            unknown: false,
            have: { amount: 400, unit: "ml" },
            missing: { amount: 100, unit: "ml" },
        });
    });

    test("needs in a unit that cannot join the first come back as their own unknown line", () => {
        const a = recipe("a", 1, [
            {
                displayName: "Flour",
                quantity: { amount: 300, unit: "g" },
                foodId: FLOUR,
            },
        ]);
        const b = recipe("b", 1, [
            {
                displayName: "Flour",
                quantity: { amount: 1, unit: "cup" },
                foodId: FLOUR,
            },
        ]);
        const lines = missingForPlan(
            [plan("a", "2026-11-12"), plan("b", "2026-11-13")],
            [a, b],
            [{ foodId: FLOUR, quantity: { amount: 100, unit: "g" } }],
            {
                from: "2026-11-12",
                days: 7,
                foodsById: new Map([[FLOUR, factors()]]),
            },
        );
        expect(
            lines.map((l) => [l.missing, l.unknown, l.neededBy[0]!.recipeId]),
        ).toEqual([
            [{ amount: 200, unit: "g" }, false, "a"],
            [{ amount: 1, unit: "cup" }, true, "b"],
        ]);
    });

    describe("stock that cannot be counted", () => {
        const eggsFood = new Map([[EGGS, factors()]]);
        const run = (
            recipes: PlanRecipe[],
            stock: Parameters<typeof missingForPlan>[2],
            plans = recipes.map((r) => plan(r.id, "2026-11-12")),
        ) =>
            missingForPlan(plans, recipes, stock, {
                from: "2026-11-12",
                days: 7,
                foodsById: eggsFood,
            });
        const eggs = (id: string, amount: number, unit: string) =>
            recipe(id, 1, [
                {
                    displayName: "Eggs",
                    quantity: { amount, unit },
                    foodId: EGGS,
                },
            ]);

        test("counted stock that covers the need leaves no line, whatever else is held", () => {
            expect(
                run(
                    [eggs("r", 200, "g")],
                    [
                        { foodId: EGGS, quantity: { amount: 300, unit: "g" } },
                        { foodId: EGGS, quantity: { amount: 2, unit: "each" } },
                    ],
                ),
            ).toEqual([]);
        });

        test("counted stock that falls short, beside stock that cannot be counted, is unknown with the full need", () => {
            const lines = run(
                [eggs("r", 200, "g")],
                [
                    { foodId: EGGS, quantity: { amount: 100, unit: "g" } },
                    { foodId: EGGS, quantity: { amount: 2, unit: "each" } },
                ],
            );
            expect(lines).toHaveLength(1);
            expect(lines[0]).toMatchObject({
                unknown: true,
                have: { amount: 100, unit: "g" },
                missing: { amount: 200, unit: "g" },
            });
            expect(unknownMissingNotice(lines[0]!)).toContain("the full 200 g");
        });

        test("needs of another kind of unit take stock in their own unit, in any plan order", () => {
            const a = eggs("a", 100, "g");
            const b = eggs("b", 2, "each");
            const stock = [
                { foodId: EGGS, quantity: { amount: 12, unit: "each" } },
            ];
            for (const recipes of [
                [a, b],
                [b, a],
            ]) {
                const lines = run(recipes, stock);
                expect(lines.map((l) => [l.missing, l.unknown])).toEqual([
                    [{ amount: 100, unit: "g" }, true],
                ]);
            }
        });

        test("a bucket with nothing held in its unit is plainly short, not unknown", () => {
            const lines = run(
                [eggs("a", 100, "g"), eggs("b", 2, "each")],
                [],
                [plan("a", "2026-11-12"), plan("b", "2026-11-12")],
            );
            expect(lines.map((l) => [l.missing, l.unknown]).sort()).toEqual([
                [{ amount: 100, unit: "g" }, false],
                [{ amount: 2, unit: "each" }, false],
            ]);
        });
    });

    test("an ingredient with no amount is listed only when nothing is held", () => {
        const soup = recipe("soup", 1, [
            { displayName: "Salt", quantity: null, foodId: SALT },
        ]);
        const run = (stock: Parameters<typeof missingForPlan>[2]) =>
            missingForPlan([plan("soup", "2026-11-12")], [soup], stock, {
                from: "2026-11-12",
                days: 7,
            });
        expect(run([])[0]).toMatchObject({
            displayName: "Salt",
            missing: null,
            unmeasured: true,
            unknown: false,
        });
        expect(
            run([{ foodId: SALT, quantity: { amount: 1, unit: "g" } }]),
        ).toEqual([]);
    });

    test("skips plans whose recipe is not given or has no yield", () => {
        const broken = recipe("broken", 0, [
            {
                displayName: "Flour",
                quantity: { amount: 1, unit: "g" },
                foodId: FLOUR,
            },
        ]);
        expect(
            missingForPlan(
                [plan("gone", "2026-11-12"), plan("broken", "2026-11-12")],
                [broken],
                [],
                { from: "2026-11-12", days: 7 },
            ),
        ).toEqual([]);
    });

    test("orders by the first day a food is needed, then by name", () => {
        const lines = missingForPlan(
            [
                plan("pancakes", "2026-11-14", "dinner", 4),
                plan("soup", "2026-11-12", "lunch", 1),
            ],
            [
                pancakes,
                recipe("soup", 1, [
                    {
                        displayName: "Zucchini",
                        quantity: { amount: 1, unit: "each" },
                        foodId: "food-zuc",
                    },
                ]),
            ],
            [],
            { from: "2026-11-12", days: 7 },
        );
        expect(lines.map((l) => l.displayName)).toEqual([
            "Zucchini",
            "Eggs",
            "Flour",
        ]);
    });
});

describe("addMissingToGroceries", () => {
    async function seed() {
        const settings = createMemorySettingsStore();
        const store = await createGroceryStore(settings, HH, "Safeway");
        const grocery = createMemoryGroceryStore();
        const foods = createMemoryFoodsStore();
        const flour = await foods.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Flour" }),
        );
        const eggs = await foods.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                defaultUnit: "each",
            }),
        );
        const salt = await foods.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Salt" }),
        );
        return { settings, store, grocery, foods, flour, eggs, salt };
    }

    function ingredient(food: Food, amount: number | null, unit: string) {
        return {
            displayName: food.name,
            quantity: amount == null ? null : { amount, unit },
            foodId: food.id,
        };
    }

    test("adds each missing food with source plan and the missing amount", async () => {
        const { settings, store, grocery, foods, flour, eggs } = await seed();
        const lines = missingForPlan(
            [plan("p", "2026-11-12", "dinner", 2)],
            [
                recipe("p", 2, [
                    ingredient(flour, 250, "g"),
                    ingredient(eggs, 3, "each"),
                ]),
            ],
            [{ foodId: flour.id, quantity: { amount: 100, unit: "g" } }],
            { from: "2026-11-12", days: 7 },
        );
        const result = await addMissingToGroceries(grocery, settings, foods, {
            householdId: HH,
            lines,
            storeId: store.id,
        });
        expect(
            result.added.map((l) => [l.displayName, l.quantity, l.source]),
        ).toEqual([
            ["Eggs", { amount: 3, unit: "each" }, "plan"],
            ["Flour", { amount: 150, unit: "g" }, "plan"],
        ]);
        expect(result.onList).toEqual([]);
        expect(result.unknown).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect(
            (await grocery.listLines(HH)).every((l) => l.storeId === store.id),
        ).toBe(true);
    });

    test("leaves a food already on the list unchecked, but not a checked one", async () => {
        const { settings, store, grocery, foods, flour, eggs } = await seed();
        const recipes = [
            recipe("p", 1, [
                ingredient(flour, 250, "g"),
                ingredient(eggs, 3, "each"),
            ]),
        ];
        const plans = [plan("p", "2026-11-12")];
        const lines = missingForPlan(plans, recipes, [], {
            from: "2026-11-12",
            days: 7,
        });
        const first = await addMissingToGroceries(grocery, settings, foods, {
            householdId: HH,
            lines,
            storeId: store.id,
        });
        expect(first.added).toHaveLength(2);

        const again = await addMissingToGroceries(grocery, settings, foods, {
            householdId: HH,
            lines,
            storeId: store.id,
        });
        expect(again.added).toEqual([]);
        expect(again.onList.map((o) => o.existing.displayName)).toEqual([
            "Eggs",
            "Flour",
        ]);
        expect(await grocery.listLines(HH)).toHaveLength(2);

        const flourLine = first.added.find((l) => l.displayName === "Flour")!;
        await grocery.updateLine({ ...flourLine, checked: true });
        const third = await addMissingToGroceries(grocery, settings, foods, {
            householdId: HH,
            lines,
            storeId: store.id,
        });
        expect(third.added.map((l) => l.displayName)).toEqual(["Flour"]);
    });

    test("a product already listed stands for its plain food", async () => {
        const { settings, store, grocery, foods, flour } = await seed();
        const brand = await foods.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Flour",
                brand: "King",
                genericFoodId: flour.id,
            }),
        );
        await grocery.insertLine({
            id: crypto.randomUUID(),
            householdId: HH,
            storeId: store.id,
            sectionId: (await settings.listSections(store.id))[0]!.id,
            kind: "food",
            displayName: "Flour",
            quantity: { amount: 100, unit: "g" },
            foodId: brand.id,
            checked: false,
            source: "manual",
            sourceFridgeItemId: null,
            note: null,
        });
        const lines = missingForPlan(
            [plan("p", "2026-11-12")],
            [recipe("p", 1, [ingredient(flour, 100, "g")])],
            [],
            { from: "2026-11-12", days: 7 },
        );
        const result = await addMissingToGroceries(grocery, settings, foods, {
            householdId: HH,
            lines,
        });
        expect(result.added).toEqual([]);
        expect(result.onList).toHaveLength(1);
    });

    async function listManual(
        env: Awaited<ReturnType<typeof seed>>,
        food: Food,
        amount: number,
        unit: string,
        over: { checked?: boolean } = {},
    ) {
        return env.grocery.insertLine({
            id: crypto.randomUUID(),
            householdId: HH,
            storeId: env.store.id,
            sectionId: (await env.settings.listSections(env.store.id))[0]!.id,
            kind: "food",
            displayName: food.name,
            quantity: { amount, unit },
            foodId: food.id,
            checked: over.checked ?? false,
            source: "manual",
            sourceFridgeItemId: null,
            note: null,
        });
    }

    test("a line on the list in the same kind of unit is taken off what is added", async () => {
        const env = await seed();
        const milk = await env.foods.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Milk" }),
        );
        const manual = await listManual(env, milk, 1, "cup");
        const lines = missingForPlan(
            [plan("p", "2026-11-12")],
            [recipe("p", 1, [ingredient(milk, 3, "cup")])],
            [],
            { from: "2026-11-12", days: 7 },
        );
        const result = await addMissingToGroceries(
            env.grocery,
            env.settings,
            env.foods,
            { householdId: HH, lines },
        );
        expect(result.added.map((l) => l.quantity)).toEqual([
            { amount: 2, unit: "cup" },
        ]);
        expect(result.alsoOnList.map((a) => a.existing[0]!.id)).toEqual([
            manual.id,
        ]);
        expect(result.onList).toEqual([]);
    });

    test("a list line in a unit that cannot be compared adds the full amount and is reported", async () => {
        const env = await seed();
        const manual = await listManual(env, env.flour, 1, "cup");
        const lines = missingForPlan(
            [plan("p", "2026-11-12")],
            [recipe("p", 1, [ingredient(env.flour, 250, "g")])],
            [],
            { from: "2026-11-12", days: 7 },
        );
        const result = await addMissingToGroceries(
            env.grocery,
            env.settings,
            env.foods,
            { householdId: HH, lines },
        );
        expect(result.added.map((l) => l.quantity)).toEqual([
            { amount: 250, unit: "g" },
        ]);
        expect(result.alsoOnList).toHaveLength(1);
        expect(result.alsoOnList[0]!.existing.map((l) => l.id)).toEqual([
            manual.id,
        ]);
    });

    test("an unmeasured ingredient is left off when the food is on the list, checked or not", async () => {
        for (const checked of [false, true]) {
            const env = await seed();
            await listManual(env, env.salt, 1, "g", { checked });
            const lines = missingForPlan(
                [plan("p", "2026-11-12")],
                [recipe("p", 1, [ingredient(env.salt, null, "g")])],
                [],
                { from: "2026-11-12", days: 7 },
            );
            const result = await addMissingToGroceries(
                env.grocery,
                env.settings,
                env.foods,
                { householdId: HH, lines },
            );
            expect(result.added).toEqual([]);
            expect(result.onList).toHaveLength(1);
        }
    });

    test("an unknown line is added with the recipe's amount and a notice", async () => {
        const { settings, grocery, foods, flour } = await seed();
        const lines = missingForPlan(
            [plan("p", "2026-11-12")],
            [recipe("p", 1, [ingredient(flour, 2, "cup")])],
            [{ foodId: flour.id, quantity: { amount: 500, unit: "g" } }],
            {
                from: "2026-11-12",
                days: 7,
                foodsById: new Map([[flour.id, factors()]]),
            },
        );
        const result = await addMissingToGroceries(grocery, settings, foods, {
            householdId: HH,
            lines,
        });
        expect(result.added.map((l) => l.quantity)).toEqual([
            { amount: 2, unit: "cup" },
        ]);
        expect(result.unknown).toEqual([
            { line: lines[0]!, notice: unknownMissingNotice(lines[0]!) },
        ]);
        expect(result.unknown[0]!.notice).toContain("Flour");
        expect(result.unknown[0]!.notice).toContain("2 cup");
    });

    test("an ingredient with no amount is added as to taste", async () => {
        const { settings, grocery, foods, salt } = await seed();
        const lines = missingForPlan(
            [plan("p", "2026-11-12")],
            [recipe("p", 1, [ingredient(salt, null, "g")])],
            [],
            { from: "2026-11-12", days: 7 },
        );
        const result = await addMissingToGroceries(grocery, settings, foods, {
            householdId: HH,
            lines,
        });
        expect(result.added).toHaveLength(1);
        expect(result.added[0]).toMatchObject({
            displayName: "Salt",
            source: "plan",
            note: "to taste",
        });
    });

    test("a line with no food is skipped and the rest still go on", async () => {
        const { settings, grocery, foods, flour } = await seed();
        const lines = missingForPlan(
            [plan("p", "2026-11-12")],
            [
                recipe("p", 1, [
                    {
                        displayName: "Mystery",
                        quantity: { amount: 1, unit: "each" },
                        foodId: null,
                    },
                    ingredient(flour, 100, "g"),
                ]),
            ],
            [],
            { from: "2026-11-12", days: 7 },
        );
        const result = await addMissingToGroceries(grocery, settings, foods, {
            householdId: HH,
            lines,
        });
        expect(result.skipped.map((s) => s.line.displayName)).toEqual([
            "Mystery",
        ]);
        expect(result.added.map((l) => l.displayName)).toEqual(["Flour"]);
    });

    test("needs a store to add to", async () => {
        const settings = createMemorySettingsStore();
        const foods = createMemoryFoodsStore();
        const flour = await foods.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Flour" }),
        );
        await expect(
            addMissingToGroceries(createMemoryGroceryStore(), settings, foods, {
                householdId: HH,
                lines: missingForPlan(
                    [plan("p", "2026-11-12")],
                    [recipe("p", 1, [ingredient(flour, 1, "g")])],
                    [],
                    { from: "2026-11-12", days: 7 },
                ),
            }),
        ).rejects.toBeInstanceOf(GroceryInputError);
    });
});

describe("grocery line source plan", () => {
    test("is a known source, and never names a fridge item", async () => {
        await expect(
            resolveGroceryLineSource(undefined, HH, { source: "plan" }),
        ).resolves.toEqual({ source: "plan", sourceFridgeItemId: null });
        await expect(
            resolveGroceryLineSource({ listItems: async () => [] }, HH, {
                source: "plan",
                sourceFridgeItemId: "x",
            }),
        ).rejects.toBeInstanceOf(GroceryInputError);
    });
});
