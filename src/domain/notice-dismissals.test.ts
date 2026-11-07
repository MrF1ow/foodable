import { expect, test, describe } from "bun:test";
import {
    createMemoryNoticeDismissalsStore,
    dismissalKey,
    isDismissed,
    normalizePairIds,
    NoticeDismissError,
    assertDismissibleCode,
    type NoticeSubjectKind,
} from "./notice-dismissals.js";
import type { Notice } from "./notices.js";
import { needsAttentionCount } from "./notices.js";
import { dismissNotice, noticesFor, undoDismissal } from "./notices-for.js";
import {
    createMemoryFoodsStore,
    findOrCreateManualFood,
    mergeFoods,
    newFood,
    updateFood,
} from "./foods.js";
import {
    addLocation,
    addManualFood,
    createMemoryFridgeStore,
    deleteItem,
} from "./fridge.js";
import {
    addFridgeItemAdjust,
    createMemoryStockStore,
    discardFridgeItem,
    eatFridgeItem,
    utcTodayFromDate,
} from "./stock.js";
import { clearCheckedLines, createMemoryGroceryStore } from "./grocery.js";
import {
    createMemoryRecipesStore,
    createRecipe,
    removeRecipeIngredient,
} from "./recipes.js";

const HH = "hh-1";

test("normalizePairIds orders uuids", () => {
    const a = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const b = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    expect(normalizePairIds(a, b)).toEqual({
        subjectId: b,
        relatedKey: a,
    });
});

test("dismiss info notice and undo", async () => {
    const dismissals = createMemoryNoticeDismissalsStore();
    const fridge = createMemoryFridgeStore();
    fridge.linkDismissals(dismissals);
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const deps = { foods, fridge, recipes, dismissals };

    await dismissals.insert({
        householdId: HH,
        code: "fridge.expiring",
        subjectKind: "fridge_item",
        subjectId: "f1",
        relatedKey: "",
        dismissedBy: "u1",
    });

    const n: Notice = {
        code: "fridge.expiring",
        severity: "info",
        subject: { kind: "fridge_item", id: "f1" },
        related: [],
        params: { name: "Milk", amount: 1, unit: "l", expiresOn: "2026-01-01" },
    };
    expect(isDismissed(n, await dismissals.listForHousehold(HH))).toBe(true);

    const n2: Notice = { ...n, subject: { kind: "fridge_item", id: "f2" } };
    expect(isDismissed(n2, await dismissals.listForHousehold(HH))).toBe(false);

    expect(() => assertDismissibleCode("fridge.expired")).toThrow(
        NoticeDismissError,
    );
});

test("noticesFor calls listForHousehold once", async () => {
    const dismissals = createMemoryNoticeDismissalsStore();
    let calls = 0;
    const tracking = {
        ...dismissals,
        async listForHousehold(householdId: string) {
            calls += 1;
            return dismissals.listForHousehold(householdId);
        },
    };
    const deps = {
        foods: createMemoryFoodsStore(),
        fridge: createMemoryFridgeStore(),
        recipes: createMemoryRecipesStore(),
        dismissals: tracking,
    };
    await noticesFor(deps, HH);
    expect(calls).toBe(1);
});

function addDaysUtc(iso: string, delta: number): string {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, d! + delta))
        .toISOString()
        .slice(0, 10);
}

async function seedOpenNotices(
    fridge = createMemoryFridgeStore(),
    foods = createMemoryFoodsStore(),
    recipes = createMemoryRecipesStore(),
) {
    const today = utcTodayFromDate();
    const loc = await addLocation(fridge, HH, "Fridge");
    const item = await addManualFood(fridge, foods, {
        householdId: HH,
        locationId: loc.id,
        name: "Yogurt",
        amount: 100,
        unit: "g",
    });
    await fridge.updateItem({
        ...item,
        expiresOn: addDaysUtc(today, 4),
    });
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u1",
        name: "Stew",
        yieldPortions: 2,
    });
    const ingredientId = crypto.randomUUID();
    await recipes.insertIngredient({
        id: ingredientId,
        householdId: HH,
        recipeId: recipe.id,
        kind: "food",
        displayName: "Mystery",
        quantity: { amount: 1, unit: "g" },
        foodId: null,
        sortOrder: 0,
        note: null,
    });
    return { fridge, foods, recipes, item, recipe, ingredientId, today };
}

test("needsAttentionCount matches noticesFor list length and excludes dismissed", async () => {
    const dismissals = createMemoryNoticeDismissalsStore();
    const { fridge, foods, recipes, item } = await seedOpenNotices();
    const deps = { foods, fridge, recipes, dismissals };
    const open = await noticesFor(deps, HH);
    expect(needsAttentionCount(open.notices)).toBe(open.notices.length);
    expect(open.notices.length).toBeGreaterThanOrEqual(2);

    await dismissNotice(deps, HH, "u1", {
        code: "fridge.expiring",
        subjectKind: "fridge_item",
        subjectId: item.id,
    });
    const after = await noticesFor(deps, HH);
    expect(after.notices.some((n) => n.subject.id === item.id)).toBe(false);
    expect(needsAttentionCount(after.notices)).toBe(after.notices.length);
});

async function seedSubjectDismissals(
    dismissals: ReturnType<typeof createMemoryNoticeDismissalsStore>,
    subjectKind: NoticeSubjectKind,
    subjectId: string,
    foodId?: string,
) {
    const unrelatedId = crypto.randomUUID();
    await dismissals.insert({
        householdId: HH,
        code: "fridge.expiring",
        subjectKind,
        subjectId,
        relatedKey: "",
        dismissedBy: "u1",
    });
    await dismissals.insert({
        householdId: HH,
        code: "fridge.expiring",
        subjectKind: "fridge_item",
        subjectId: unrelatedId,
        relatedKey: "",
        dismissedBy: "u1",
    });
    if (foodId && !(subjectKind === "food" && subjectId === foodId)) {
        await dismissals.insert({
            householdId: HH,
            code: "fridge.expiring",
            subjectKind: "food",
            subjectId: foodId,
            relatedKey: "",
            dismissedBy: "u1",
        });
    }
    if (foodId) {
        await dismissals.insert({
            householdId: HH,
            code: "fridge.expiring",
            subjectKind: "food",
            subjectId: crypto.randomUUID(),
            relatedKey: foodId,
            dismissedBy: "u1",
        });
    }
    return { unrelatedId };
}

async function expectTargetDismissalsGone(
    dismissals: ReturnType<typeof createMemoryNoticeDismissalsStore>,
    subjectKind: NoticeSubjectKind,
    subjectId: string,
    foodId?: string,
) {
    const rows = await dismissals.listForHousehold(HH);
    expect(
        rows.some(
            (r) => r.subjectKind === subjectKind && r.subjectId === subjectId,
        ),
    ).toBe(false);
    if (foodId) {
        expect(
            rows.some(
                (r) => r.subjectKind === "food" && r.subjectId === foodId,
            ),
        ).toBe(false);
        expect(rows.some((r) => r.relatedKey === foodId)).toBe(false);
    }
    expect(rows).toHaveLength(1);
}

describe("dismissal cleanup on writers (memory)", () => {
    test("fridge deleteItem", async () => {
        const dismissals = createMemoryNoticeDismissalsStore();
        const fridge = createMemoryFridgeStore();
        fridge.linkDismissals(dismissals);
        const foods = createMemoryFoodsStore();
        const loc = await addLocation(fridge, HH, "Fridge");
        const item = await addManualFood(fridge, foods, {
            householdId: HH,
            locationId: loc.id,
            name: "Milk",
            amount: 1,
            unit: "g",
        });
        await seedSubjectDismissals(dismissals, "fridge_item", item.id);
        expect(await deleteItem(fridge, HH, item.id)).toBe(true);
        await expectTargetDismissalsGone(dismissals, "fridge_item", item.id);
    });

    test("eatFridgeItem to empty", async () => {
        const dismissals = createMemoryNoticeDismissalsStore();
        const fridge = createMemoryFridgeStore();
        const stock = createMemoryStockStore();
        fridge.linkDismissals(dismissals);
        const foods = createMemoryFoodsStore();
        const loc = await addLocation(fridge, HH, "Fridge");
        const food = await findOrCreateManualFood(foods, HH, "food", "Rice");
        const added = await addFridgeItemAdjust(fridge, stock, foods, {
            householdId: HH,
            foodId: food.id,
            locationId: loc.id,
            amount: 50,
            unit: "g",
        });
        await seedSubjectDismissals(dismissals, "fridge_item", added.item!.id);
        await eatFridgeItem(fridge, stock, foods, {
            householdId: HH,
            itemId: added.item!.id,
            amount: 50,
            actorUserId: "u1",
        });
        await expectTargetDismissalsGone(
            dismissals,
            "fridge_item",
            added.item!.id,
        );
    });

    test("discardFridgeItem", async () => {
        const dismissals = createMemoryNoticeDismissalsStore();
        const fridge = createMemoryFridgeStore();
        const stock = createMemoryStockStore();
        fridge.linkDismissals(dismissals);
        const foods = createMemoryFoodsStore();
        const loc = await addLocation(fridge, HH, "Fridge");
        const food = await findOrCreateManualFood(foods, HH, "food", "Beans");
        const added = await addFridgeItemAdjust(fridge, stock, foods, {
            householdId: HH,
            foodId: food.id,
            locationId: loc.id,
            amount: 2,
            unit: "g",
        });
        await seedSubjectDismissals(dismissals, "fridge_item", added.item!.id);
        await discardFridgeItem(fridge, stock, foods, {
            householdId: HH,
            itemId: added.item!.id,
            amount: 2,
            actorUserId: "u1",
        });
        await expectTargetDismissalsGone(
            dismissals,
            "fridge_item",
            added.item!.id,
        );
    });

    test("grocery deleteLine and clearCheckedLines", async () => {
        const dismissals = createMemoryNoticeDismissalsStore();
        const grocery = createMemoryGroceryStore();
        grocery.linkDismissals(dismissals);
        const lineId = crypto.randomUUID();
        const otherId = crypto.randomUUID();
        await grocery.insertLine({
            id: lineId,
            householdId: HH,
            storeId: "s1",
            sectionId: "sec1",
            kind: "food",
            displayName: "Apples",
            quantity: { amount: 1, unit: "g" },
            foodId: null,
            checked: false,
            source: "manual",
            sourceFridgeItemId: null,
        });
        await grocery.insertLine({
            id: otherId,
            householdId: HH,
            storeId: "s1",
            sectionId: "sec1",
            kind: "food",
            displayName: "Bananas",
            quantity: { amount: 1, unit: "g" },
            foodId: null,
            checked: true,
            source: "manual",
            sourceFridgeItemId: null,
        });
        await seedSubjectDismissals(dismissals, "grocery_line", lineId);
        await grocery.deleteLine(HH, lineId);
        await expectTargetDismissalsGone(dismissals, "grocery_line", lineId);

        const checkedId = crypto.randomUUID();
        await grocery.insertLine({
            id: checkedId,
            householdId: HH,
            storeId: "s1",
            sectionId: "sec1",
            kind: "food",
            displayName: "Cherries",
            quantity: { amount: 1, unit: "g" },
            foodId: null,
            checked: true,
            source: "manual",
            sourceFridgeItemId: null,
        });
        await dismissals.insert({
            householdId: HH,
            code: "fridge.expiring",
            subjectKind: "grocery_line",
            subjectId: checkedId,
            relatedKey: "",
            dismissedBy: "u1",
        });
        await clearCheckedLines(grocery, HH);
        const rows = await dismissals.listForHousehold(HH);
        expect(rows.some((r) => r.subjectId === checkedId)).toBe(false);
    });

    test("recipe delete and ingredient removal", async () => {
        const dismissals = createMemoryNoticeDismissalsStore();
        const recipes = createMemoryRecipesStore();
        recipes.linkDismissals(dismissals);
        const recipe = await createRecipe(recipes, {
            householdId: HH,
            creatorId: "u1",
            name: "Soup",
            yieldPortions: 2,
        });
        const ingredientId = crypto.randomUUID();
        await recipes.insertIngredient({
            id: ingredientId,
            householdId: HH,
            recipeId: recipe.id,
            kind: "food",
            displayName: "Carrot",
            quantity: { amount: 1, unit: "g" },
            foodId: null,
            sortOrder: 0,
            note: null,
        });
        await dismissals.insert({
            householdId: HH,
            code: "recipe.no_food",
            subjectKind: "recipe",
            subjectId: recipe.id,
            relatedKey: "",
            dismissedBy: "u1",
        });
        await dismissals.insert({
            householdId: HH,
            code: "recipe.no_food",
            subjectKind: "recipe_ingredient",
            subjectId: ingredientId,
            relatedKey: "",
            dismissedBy: "u1",
        });
        const spareIng = crypto.randomUUID();
        await dismissals.insert({
            householdId: HH,
            code: "fridge.expiring",
            subjectKind: "recipe_ingredient",
            subjectId: spareIng,
            relatedKey: "",
            dismissedBy: "u1",
        });
        expect(await recipes.deleteRecipe(HH, recipe.id)).toBe(true);
        const rows = await dismissals.listForHousehold(HH);
        expect(rows.some((r) => r.subjectId === recipe.id)).toBe(false);
        expect(rows.some((r) => r.subjectId === ingredientId)).toBe(false);
        expect(rows.some((r) => r.subjectId === spareIng)).toBe(true);

        const recipe2 = await createRecipe(recipes, {
            householdId: HH,
            creatorId: "u1",
            name: "Salad",
            yieldPortions: 1,
        });
        const ing2 = crypto.randomUUID();
        await recipes.insertIngredient({
            id: ing2,
            householdId: HH,
            recipeId: recipe2.id,
            kind: "food",
            displayName: "Lettuce",
            quantity: { amount: 1, unit: "g" },
            foodId: null,
            sortOrder: 0,
            note: null,
        });
        await seedSubjectDismissals(dismissals, "recipe_ingredient", ing2);
        expect(
            await removeRecipeIngredient(recipes, HH, recipe2.id, ing2),
        ).toBe(true);
        const afterRemove = await dismissals.listForHousehold(HH);
        expect(afterRemove.some((r) => r.subjectId === ing2)).toBe(false);
        expect(afterRemove.some((r) => r.subjectId === spareIng)).toBe(true);
    });

    test("food archive and mergeFoods", async () => {
        const dismissals = createMemoryNoticeDismissalsStore();
        const foods = createMemoryFoodsStore();
        foods.linkDismissals(dismissals);
        const keep = await foods.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Eggs" }),
        );
        const drop = await foods.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Large eggs" }),
        );
        const unrelatedFridge = crypto.randomUUID();
        await dismissals.insert({
            householdId: HH,
            code: "fridge.expiring",
            subjectKind: "food",
            subjectId: drop.id,
            relatedKey: "",
            dismissedBy: "u1",
        });
        await dismissals.insert({
            householdId: HH,
            code: "fridge.expiring",
            subjectKind: "fridge_item",
            subjectId: unrelatedFridge,
            relatedKey: "",
            dismissedBy: "u1",
        });
        await dismissals.insert({
            householdId: HH,
            code: "fridge.expiring",
            subjectKind: "food",
            subjectId: crypto.randomUUID(),
            relatedKey: drop.id,
            dismissedBy: "u1",
        });
        await updateFood(foods, HH, drop.id, { archived: true });
        let rows = await dismissals.listForHousehold(HH);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.subjectId).toBe(unrelatedFridge);

        const drop2 = await foods.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Yogurt A" }),
        );
        const unrelated2 = crypto.randomUUID();
        await dismissals.insert({
            householdId: HH,
            code: "fridge.expiring",
            subjectKind: "food",
            subjectId: drop2.id,
            relatedKey: "",
            dismissedBy: "u1",
        });
        await dismissals.insert({
            householdId: HH,
            code: "fridge.expiring",
            subjectKind: "fridge_item",
            subjectId: unrelated2,
            relatedKey: "",
            dismissedBy: "u1",
        });
        await dismissals.insert({
            householdId: HH,
            code: "fridge.expiring",
            subjectKind: "food",
            subjectId: crypto.randomUUID(),
            relatedKey: drop2.id,
            dismissedBy: "u1",
        });
        await mergeFoods(foods, HH, keep.id, drop2.id);
        rows = await dismissals.listForHousehold(HH);
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.subjectId).sort()).toEqual(
            [unrelatedFridge, unrelated2].sort(),
        );
    });
});
