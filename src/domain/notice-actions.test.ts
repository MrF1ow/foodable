import { describe, expect, test } from "bun:test";
import { PLAN_UNKNOWN_LINE_NOTE } from "../copy/toasts.js";
import { createMemoryFoodsStore, newFood, type Food } from "./foods.js";
import { createMemoryFridgeStore } from "./fridge.js";
import { createMemoryGroceryStore, GroceryInputError } from "./grocery.js";
import { createMemoryNoticeDismissalsStore } from "./notice-dismissals.js";
import { actOnNotice, NoticeActionError } from "./notice-actions.js";
import { createMemoryWeighInStore } from "./notices-actionable.js";
import { dismissNotice, noticesFor } from "./notices-for.js";
import { createMemoryPlansStore } from "./plan.js";
import { createMemoryRecipesStore } from "./recipes.js";
import { createGroceryStore, createMemorySettingsStore } from "./settings.js";

const HH = "hh-act";
const OTHER_HH = "hh-other";
const TODAY = "2026-11-12";
const OPTS = { today: TODAY, timezone: "UTC" };

async function setup(opts: { withStore?: boolean } = {}) {
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const recipes = createMemoryRecipesStore();
    const dismissals = createMemoryNoticeDismissalsStore();
    const grocery = createMemoryGroceryStore();
    const plans = createMemoryPlansStore();
    const settings = createMemorySettingsStore();
    const weighIns = createMemoryWeighInStore([]);
    const store =
        opts.withStore === false
            ? null
            : await createGroceryStore(settings, HH, "Safeway");
    const deps = {
        foods,
        fridge,
        recipes,
        dismissals,
        grocery,
        plans,
        weighIns,
        settings,
    };
    return { deps, foods, grocery, plans, recipes, store };
}

type World = Awaited<ReturnType<typeof setup>>;

function usual(world: World, over: Partial<Food> = {}) {
    return world.foods.insertFood({
        ...newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            defaultUnit: "each",
            restockWhenLow: true,
            usualAmount: { amount: 12, unit: "each" },
            restockLowLevel: 4,
        }),
        ...over,
    });
}

async function plannedRecipe(
    world: World,
    needs: { food: Food; amount: number; unit: string }[],
    date = "2026-11-13",
) {
    const recipe = await world.recipes.insertRecipe({
        id: crypto.randomUUID(),
        householdId: HH,
        creatorId: "u",
        name: "Omelette",
        yieldPortions: 2,
        instructions: null,
        sourceUrl: null,
        tags: [],
        notes: null,
        prepMinutes: null,
        cookMinutes: null,
        verification: "unverified",
        updatedAt: "2026-11-01T00:00:00Z",
    } as never);
    let order = 0;
    for (const need of needs) {
        await world.recipes.insertIngredient({
            id: crypto.randomUUID(),
            householdId: HH,
            recipeId: recipe.id,
            kind: "food",
            displayName: need.food.name,
            quantity: { amount: need.amount, unit: need.unit },
            foodId: need.food.id,
            sortOrder: order++,
            note: null,
        });
    }
    await world.plans.addPlan({
        householdId: HH,
        recipeId: recipe.id,
        date,
        slot: "dinner",
        servings: 2,
    });
    return recipe;
}

function openCodes(world: World) {
    return noticesFor(world.deps, HH, { ...OPTS, actionable: true }).then(
        (result) =>
            result.notices
                .filter((n) =>
                    [
                        "grocery.running_low",
                        "plan.missing_ingredient",
                        "nutrition.weigh_in_due",
                    ].includes(n.code),
                )
                .map((n) => `${n.code}:${n.subject.id}`)
                .sort(),
    );
}

describe("actOnNotice: grocery.running_low", () => {
    test("puts the usual on the list at its usual amount, as a restock line", async () => {
        const world = await setup();
        const eggs = await usual(world);
        const result = await actOnNotice(
            world.deps,
            HH,
            { code: "grocery.running_low", subjectId: eggs.id },
            OPTS,
        );
        expect(result).toEqual({
            status: "added",
            name: "Eggs",
            count: 1,
            checkNames: [],
        });
        const lines = await world.grocery.listLines(HH);
        expect(
            lines.map((l) => [
                l.foodId,
                l.quantity,
                l.source,
                l.storeId,
                l.kind,
            ]),
        ).toEqual([
            [
                eggs.id,
                { amount: 12, unit: "each" },
                "restock",
                world.store!.id,
                "food",
            ],
        ]);
        // The notice itself is gone now that the usual is on the list.
        expect(await openCodes(world)).toEqual([]);
    });

    test("a second tap adds nothing and says the notice no longer applies", async () => {
        const world = await setup();
        const eggs = await usual(world);
        const input = { code: "grocery.running_low", subjectId: eggs.id };
        await actOnNotice(world.deps, HH, input as never, OPTS);
        const again = await actOnNotice(world.deps, HH, input as never, OPTS);
        expect(again).toEqual({ status: "gone" });
        expect(await world.grocery.listLines(HH)).toHaveLength(1);
    });

    test("a usual that is no longer low is a stale tap: nothing is added", async () => {
        const world = await setup();
        const eggs = await usual(world, { restockLowLevel: null });
        // Stocked above the default level (a quarter of 12) now.
        const loc = await world.deps.fridge.insertLocation({
            id: crypto.randomUUID(),
            householdId: HH,
            name: "Fridge",
            sortOrder: 0,
        } as never);
        await world.deps.fridge.insertItem({
            id: crypto.randomUUID(),
            householdId: HH,
            kind: "food",
            displayName: "Eggs",
            foodId: eggs.id,
            quantity: { amount: 10, unit: "each" },
            locationId: loc.id,
            expiresOn: null,
            openedOn: null,
            purchasedOn: null,
        } as never);
        const result = await actOnNotice(
            world.deps,
            HH,
            { code: "grocery.running_low", subjectId: eggs.id },
            OPTS,
        );
        expect(result).toEqual({ status: "gone" });
        expect(await world.grocery.listLines(HH)).toEqual([]);
    });

    test("a dismissed notice is gone, not acted on", async () => {
        const world = await setup();
        const eggs = await usual(world);
        await dismissNotice(
            world.deps,
            HH,
            "user-1",
            {
                code: "grocery.running_low",
                subjectKind: "food",
                subjectId: eggs.id,
                relatedId: "",
            },
            { ...OPTS, actionable: true },
        );
        const result = await actOnNotice(
            world.deps,
            HH,
            { code: "grocery.running_low", subjectId: eggs.id },
            OPTS,
        );
        expect(result).toEqual({ status: "gone" });
        expect(await world.grocery.listLines(HH)).toEqual([]);
    });

    test("another household's food id is gone and writes nothing", async () => {
        const world = await setup();
        const theirs = await world.foods.insertFood({
            ...newFood({
                householdId: OTHER_HH,
                kind: "food",
                name: "Eggs",
                defaultUnit: "each",
                restockWhenLow: true,
                usualAmount: { amount: 12, unit: "each" },
                restockLowLevel: 4,
            }),
        });
        const result = await actOnNotice(
            world.deps,
            HH,
            { code: "grocery.running_low", subjectId: theirs.id },
            OPTS,
        );
        expect(result).toEqual({ status: "gone" });
        expect(await world.grocery.listLines(HH)).toEqual([]);
        expect(await world.grocery.listLines(OTHER_HH)).toEqual([]);
    });

    test("a supply usual goes on the list as a supply", async () => {
        const world = await setup();
        const foil = await usual(world, {
            kind: "supply",
            name: "Foil",
            defaultUnit: "each",
            usualAmount: { amount: 2, unit: "each" },
            restockLowLevel: 1,
        });
        const result = await actOnNotice(
            world.deps,
            HH,
            { code: "grocery.running_low", subjectId: foil.id },
            OPTS,
        );
        expect(result.status).toBe("added");
        const [line] = await world.grocery.listLines(HH);
        expect([line?.kind, line?.foodId, line?.source]).toEqual([
            "supply",
            foil.id,
            "restock",
        ]);
    });

    test("with no store yet the person is told to add one, and nothing is written", async () => {
        const world = await setup({ withStore: false });
        const eggs = await usual(world);
        await expect(
            actOnNotice(
                world.deps,
                HH,
                { code: "grocery.running_low", subjectId: eggs.id },
                OPTS,
            ),
        ).rejects.toThrow(GroceryInputError);
        expect(await world.grocery.listLines(HH)).toEqual([]);
    });
});

describe("actOnNotice: plan.missing_ingredient", () => {
    async function twoMissing() {
        const world = await setup();
        const eggs = await world.foods.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                defaultUnit: "each",
            }),
        );
        const flour = await world.foods.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Flour" }),
        );
        await plannedRecipe(world, [
            { food: eggs, amount: 4, unit: "each" },
            { food: flour, amount: 250, unit: "g" },
        ]);
        return { world, eggs, flour };
    }

    test("adds only that food, at what is missing, with source plan", async () => {
        const { world, eggs, flour } = await twoMissing();
        const result = await actOnNotice(
            world.deps,
            HH,
            { code: "plan.missing_ingredient", subjectId: eggs.id },
            OPTS,
        );
        expect(result).toEqual({
            status: "added",
            name: "Eggs",
            count: 1,
            checkNames: [],
        });
        const lines = await world.grocery.listLines(HH);
        expect(lines.map((l) => [l.foodId, l.quantity, l.source])).toEqual([
            [eggs.id, { amount: 4, unit: "each" }, "plan"],
        ]);
        // The other food's notice is untouched.
        expect(await openCodes(world)).toEqual([
            `plan.missing_ingredient:${flour.id}`,
        ]);
    });

    test("a second tap does not double the line", async () => {
        const { world, eggs } = await twoMissing();
        const input = { code: "plan.missing_ingredient", subjectId: eggs.id };
        await actOnNotice(world.deps, HH, input as never, OPTS);
        const again = await actOnNotice(world.deps, HH, input as never, OPTS);
        expect(again).toEqual({ status: "gone" });
        expect(await world.grocery.listLines(HH)).toHaveLength(1);
    });

    test("a plan removed since the notice was shown is a stale tap", async () => {
        const { world, eggs } = await twoMissing();
        for (const plan of await world.plans.listPlans(
            HH,
            "2026-11-01",
            "2026-12-01",
        )) {
            await world.plans.removePlan(HH, plan.id);
        }
        const result = await actOnNotice(
            world.deps,
            HH,
            { code: "plan.missing_ingredient", subjectId: eggs.id },
            OPTS,
        );
        expect(result).toEqual({ status: "gone" });
        expect(await world.grocery.listLines(HH)).toEqual([]);
    });

    test("never takes an amount from the caller: only the notice's food id counts", async () => {
        const { world, eggs } = await twoMissing();
        await actOnNotice(
            world.deps,
            HH,
            {
                code: "plan.missing_ingredient",
                subjectId: eggs.id,
                // An extra field a form could send; the function has no use for it.
                amount: 999,
            } as never,
            OPTS,
        );
        const [line] = await world.grocery.listLines(HH);
        expect(line?.quantity).toEqual({ amount: 4, unit: "each" });
    });

    test("a food whose stock cannot be counted is added at the full amount and marked", async () => {
        const world = await setup();
        const eggs = await world.foods.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                defaultUnit: "each",
            }),
        );
        // Stock in grams with no grams-per-each: cannot be compared with "each".
        const loc = await world.deps.fridge.insertLocation({
            id: crypto.randomUUID(),
            householdId: HH,
            name: "Fridge",
            sortOrder: 0,
        } as never);
        await world.deps.fridge.insertItem({
            id: crypto.randomUUID(),
            householdId: HH,
            kind: "food",
            displayName: "Eggs",
            foodId: eggs.id,
            quantity: { amount: 300, unit: "g" },
            locationId: loc.id,
            expiresOn: null,
            openedOn: null,
            purchasedOn: null,
        } as never);
        await plannedRecipe(world, [{ food: eggs, amount: 4, unit: "each" }]);
        const result = await actOnNotice(
            world.deps,
            HH,
            { code: "plan.missing_ingredient", subjectId: eggs.id },
            OPTS,
        );
        expect(result).toEqual({
            status: "added",
            name: "Eggs",
            count: 1,
            checkNames: ["Eggs"],
        });
        const [line] = await world.grocery.listLines(HH);
        expect([line?.quantity, line?.note]).toEqual([
            { amount: 4, unit: "each" },
            PLAN_UNKNOWN_LINE_NOTE,
        ]);
    });
});

describe("actOnNotice: other codes", () => {
    test("the weigh-in reminder has no write behind it", async () => {
        const world = await setup();
        await expect(
            actOnNotice(
                world.deps,
                HH,
                { code: "nutrition.weigh_in_due", subjectId: "someone" },
                OPTS,
            ),
        ).rejects.toThrow(NoticeActionError);
    });

    test("an old notice code has no one-tap action here either", async () => {
        const world = await setup();
        await expect(
            actOnNotice(
                world.deps,
                HH,
                { code: "fridge.expiring", subjectId: "x" },
                OPTS,
            ),
        ).rejects.toThrow(NoticeActionError);
    });
});
