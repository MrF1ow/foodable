import { test, expect } from "bun:test";
import type { Notice } from "../domain/notices.js";
import { NOTICE_CODES, type NoticeCode } from "../domain/notices.js";
import { noticeSentence } from "../copy/notices.js";
import { noticeToWire, NOTICE_SCHEMA } from "./shared.js";
import { fridgeNotices } from "../domain/stock.js";
import { groceryRestockNotices } from "../domain/restock.js";
import { recipeNotices, type RecipeIngredient } from "../domain/recipes.js";
import { allergenNotices } from "../domain/grocery.js";
import { possibleDuplicateNotices } from "../domain/notices-for.js";
import {
    planMissingNotices,
    runningLowNotices,
    weighInDueNotices,
} from "../domain/notices-actionable.js";
import { checkProductForMember } from "../domain/product-checks.js";
import { addAllergen, createMemoryRulesStore } from "../domain/rules.js";
import {
    createMemoryFoodsStore,
    effectiveFoodsByIds,
    effectiveFoodsFromListed,
    findOrCreateManualFood,
    newFood,
    updateFood,
    type Food,
} from "../domain/foods.js";
import type { GroceryLine } from "../domain/grocery.js";
import type { FridgeItem } from "../domain/fridge.js";

test("noticeToWire maps subjects, action, and message", () => {
    const gap: Notice = {
        code: "recipe.no_nutrition",
        severity: "warn",
        subject: { kind: "recipe_ingredient", id: "ing-1", recipeId: "rec-1" },
        related: [],
        params: { name: "Milk", recipeName: "Oatmeal" },
    };
    const w = noticeToWire(gap);
    expect(NOTICE_SCHEMA.parse(w)).toEqual(w);
    expect(w.subject.recipe_id).toBe("rec-1");
    expect(w.action).toEqual({ label: "Pick usual product" });
    expect(w.message).toBe(noticeSentence(gap));
    expect(w.title).toBe("Milk");
    expect(w.detail).toBe("Oatmeal");
    expect(w.group_key).toBe("recipe_gaps");
    expect(w.group_label).toBe("Recipes");
    expect(w.can_dismiss).toBe(false);
    expect(w.dismiss).toBeNull();

    const recipeOnly: Notice = {
        code: "recipe.allergen",
        severity: "block",
        subject: { kind: "recipe", id: "r1" },
        related: [{ kind: "member", id: "u1", name: "Pat" }],
        params: { allergens: ["peanut"] },
    };
    const wr = noticeToWire(recipeOnly);
    expect(wr.subject.recipe_id).toBeNull();
    expect(wr.action).toBeNull();
    expect(wr.message).toBe(noticeSentence(recipeOnly));
    expect(wr.group_key).toBe("household");
});

test("noticeToWire maps food.possible_duplicate", () => {
    const dup: Notice = {
        code: "food.possible_duplicate",
        severity: "info",
        subject: { kind: "food", id: "f-a" },
        related: [{ kind: "food", id: "f-b", name: "Eggs" }],
        params: { name: "chicken egg", rule: "contains_words", foodId: "f-a" },
    };
    const w = noticeToWire(dup);
    expect(NOTICE_SCHEMA.parse(w)).toEqual(w);
    expect(w.message).toBe(noticeSentence(dup));
    expect(w.action).toEqual({ label: "Review" });
    expect(w.can_dismiss).toBe(true);
    expect(w.dismiss?.related_id).toBe("f-b");
    expect(w.detail).toBe("may be the same as Eggs");
});

const TODAY = "2026-06-01";
const HH = "hh-wire";

function addDays(iso: string, days: number): string {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

function dupFood(over: Partial<Food> & Pick<Food, "id" | "name">): Food {
    const householdId = over.householdId ?? HH;
    return {
        ...newFood({
            householdId,
            kind: over.kind ?? "food",
            name: over.name,
        }),
        ...over,
        householdId,
        kind: over.kind ?? "food",
        createdAt: over.createdAt ?? "2026-01-01T00:00:00.000Z",
        updatedAt: over.updatedAt ?? "2026-01-01T00:00:00.000Z",
    } as Food;
}

function wireIng(
    over: Partial<RecipeIngredient> &
        Pick<RecipeIngredient, "id" | "displayName">,
): RecipeIngredient {
    return {
        householdId: HH,
        recipeId: "rec-wire",
        kind: "food",
        quantity: { amount: 100, unit: "g" },
        foodId: null,
        sortOrder: 0,
        note: null,
        ...over,
    };
}

function fridgeItem(
    over: Partial<FridgeItem> &
        Pick<FridgeItem, "id" | "displayName" | "expiresOn">,
): FridgeItem {
    return {
        householdId: HH,
        locationId: "loc",
        kind: "food",
        foodId: "food-1",
        quantity: { amount: 1, unit: "each" },
        ...over,
    };
}

function restockLine(
    over: Partial<GroceryLine> & Pick<GroceryLine, "id">,
): GroceryLine {
    return {
        householdId: HH,
        storeId: "st",
        sectionId: "sec",
        kind: "food",
        displayName: "Milk",
        quantity: { amount: 1, unit: "l" },
        foodId: "food-1",
        checked: false,
        source: "restock",
        sourceFridgeItemId: "fi-restock",
        note: null,
        ...over,
    };
}

async function producerNotices(): Promise<Notice[]> {
    const out: Notice[] = [];
    out.push(
        ...fridgeNotices(
            [
                {
                    id: "fi-exp",
                    kind: "food",
                    foodId: "f-yog",
                    displayName: "Yogurt",
                    quantity: { amount: 1, unit: "cup" },
                    expiresOn: addDays(TODAY, -1),
                },
                {
                    id: "fi-food",
                    kind: "food",
                    foodId: "f-spin",
                    displayName: "Spinach",
                    quantity: { amount: 1, unit: "bag" },
                    expiresOn: addDays(TODAY, 2),
                },
                {
                    id: "fi-supply",
                    kind: "supply",
                    foodId: null,
                    displayName: "Zip bags",
                    quantity: { amount: 1, unit: "box" },
                    expiresOn: addDays(TODAY, 2),
                },
            ],
            TODAY,
        ),
    );
    const restockFridge = fridgeItem({
        id: "fi-restock",
        displayName: "Whole milk",
        foodId: "f-milk",
        expiresOn: addDays(TODAY, 3),
    });
    out.push(
        ...groceryRestockNotices(
            [restockLine({ id: "gl-restock" })],
            [restockFridge],
            TODAY,
        ),
    );
    const rules = createMemoryRulesStore();
    await addAllergen(rules, {
        householdId: HH,
        userId: "pat-id",
        allergen: "peanut",
    });
    const patAllergens = await rules.listAllergens(HH, "pat-id");
    const members = [
        { displayName: "Pat", userId: "pat-id", allergens: patAllergens },
    ];
    out.push(
        ...allergenNotices(
            { kind: "grocery_line", id: "gl-peanut" },
            "Peanut Butter",
            members,
            null,
        ),
    );
    await addAllergen(rules, {
        householdId: HH,
        userId: "sam-id",
        allergen: "milk",
    });
    const samAllergens = await rules.listAllergens(HH, "sam-id");
    out.push(
        ...allergenNotices(
            { kind: "recipe", id: "rec-a" },
            "Milk chocolate tart",
            [{ displayName: "Sam", userId: "sam-id", allergens: samAllergens }],
            null,
        ),
    );
    out.push(
        ...possibleDuplicateNotices(
            [
                dupFood({ id: "f1", name: "chicken egg" }),
                dupFood({ id: "f2", name: "Eggs" }),
            ],
            new Map(),
            new Set(),
            new Set(),
        ),
    );

    const foods = createMemoryFoodsStore();
    const plain = await findOrCreateManualFood(
        foods,
        HH,
        "food",
        "Half and half",
    );
    await updateFood(foods, HH, plain.id, { gramsPerMl: 1 });
    const catalog = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const vol = await findOrCreateManualFood(foods, HH, "food", "Cream");
    const volCat = await effectiveFoodsByIds(foods, HH, [vol.id]);
    const rId = "rec-wire";
    out.push(
        ...recipeNotices(
            rId,
            [wireIng({ id: "ing-nf", displayName: "Cumin", foodId: null })],
            catalog,
        ),
    );
    out.push(
        ...recipeNotices(
            rId,
            [
                wireIng({
                    id: "ing-na",
                    displayName: "Salt",
                    foodId: plain.id,
                    quantity: null,
                }),
            ],
            catalog,
        ),
    );
    out.push(
        ...recipeNotices(
            rId,
            [
                wireIng({
                    id: "ing-linked",
                    displayName: "Half and half",
                    foodId: plain.id,
                    quantity: { amount: 60, unit: "ml" },
                }),
            ],
            catalog,
        ),
    );
    const partial = await findOrCreateManualFood(foods, HH, "food", "Yogurt");
    await updateFood(foods, HH, partial.id, {
        calories: 80,
        proteinG: null,
        carbsG: 6,
        fatG: null,
        nutritionSource: "manual",
    });
    const partialCat = await effectiveFoodsByIds(foods, HH, [partial.id]);
    out.push(
        ...recipeNotices(
            rId,
            [
                wireIng({
                    id: "ing-partial",
                    displayName: "Yogurt",
                    foodId: partial.id,
                }),
            ],
            partialCat,
        ),
    );
    out.push(
        ...recipeNotices(
            rId,
            [
                wireIng({
                    id: "ing-unit",
                    displayName: "Spice",
                    foodId: plain.id,
                    quantity: { amount: 1, unit: "pinch" },
                }),
            ],
            catalog,
        ),
    );
    const eggs = await findOrCreateManualFood(foods, HH, "food", "Eggs");
    const eggCat = await effectiveFoodsByIds(foods, HH, [eggs.id]);
    out.push(
        ...recipeNotices(
            rId,
            [
                wireIng({
                    id: "ing-egg",
                    displayName: "Eggs",
                    foodId: eggs.id,
                    quantity: { amount: 2, unit: "each" },
                }),
            ],
            eggCat,
        ),
    );
    out.push(
        ...recipeNotices(
            rId,
            [
                wireIng({
                    id: "ing-vol",
                    displayName: "Cream",
                    foodId: vol.id,
                    quantity: { amount: 50, unit: "ml" },
                }),
            ],
            volCat,
        ),
    );
    // Product checks (rate_product): every food.product_* code from one
    // product against one member with an allergy, a dislike and a goal.
    out.push(
        ...checkProductForMember(
            {
                id: "p1",
                name: "Peanut Wheat Bar",
                allergensTags: ["en:peanuts", "en:gluten"],
                tracesTags: ["en:milk"],
                servingNutrition: { calories: 220 },
            },
            {
                id: "u1",
                name: "Alex",
                allergens: ["peanut", "milk", "wheat"],
                dislikes: ["peanut"],
            },
            { remaining: { calories: 500 } },
        ),
    );
    // Running low, missing for the plan, weigh-in due.
    const milk = effectiveFoodsFromListed([
        newFood({
            householdId: HH,
            kind: "food",
            name: "Milk",
            defaultUnit: "ml",
            restockWhenLow: true,
            usualAmount: { amount: 1000, unit: "ml" },
        }),
    ]);
    out.push(
        ...runningLowNotices({
            foodsById: milk,
            stock: [],
            lines: [],
            today: "2026-06-01",
        }),
        ...planMissingNotices({
            plans: [
                {
                    id: "plan-1",
                    householdId: HH,
                    recipeId: "r-bread",
                    date: "2026-06-02",
                    slot: "dinner",
                    servings: 1,
                    createdBy: null,
                    createdAt: "2026-06-01T00:00:00+00:00",
                },
            ],
            recipes: [
                {
                    id: "r-bread",
                    name: "Bread",
                    yieldPortions: 1,
                    ingredients: [
                        {
                            displayName: "Flour",
                            foodId: "flour",
                            quantity: { amount: 200, unit: "g" },
                        },
                    ],
                },
            ],
            stock: [],
            lines: [],
            foodsById: new Map(),
            today: "2026-06-01",
        }),
        ...weighInDueNotices({
            members: [
                {
                    userId: "u1",
                    displayName: "Alex",
                    lastLoggedAt: "2026-05-20T12:00:00Z",
                },
            ],
            today: "2026-06-01",
            timezone: "UTC",
        }),
    );
    return out;
}

test("noticeToWire digest from real producers covers every code", async () => {
    const notices = await producerNotices();
    const byCode = new Map<NoticeCode, Notice[]>();
    for (const notice of notices) {
        const list = byCode.get(notice.code) ?? [];
        list.push(notice);
        byCode.set(notice.code, list);
    }
    for (const code of NOTICE_CODES) {
        expect(byCode.has(code)).toBe(true);
    }
    for (const [code, list] of byCode) {
        for (const notice of list) {
            const w = noticeToWire(notice);
            expect(() => NOTICE_SCHEMA.parse(w)).not.toThrow();
            expect(w.title.length).toBeGreaterThan(0);
            expect(w.group_key.length).toBeGreaterThan(0);
            expect(w.group_label.length).toBeGreaterThan(0);
            if (code === "grocery.allergen") {
                expect(w.title).toBe("peanut");
                expect(w.detail).toBe("Pat");
                expect(w.group_key).toBe("household");
            }
            if (code === "food.possible_duplicate") {
                expect(w.title).toBe("chicken egg");
                expect(w.detail).toBe("may be the same as Eggs");
            }
            if (code === "recipe.no_food") {
                expect(w.title).toBe("Cumin");
                expect(w.group_label).toBe("Recipes");
            }
        }
    }
});

test("fridge.expiring without daysLeft still gets a dated digest detail", async () => {
    const notices = await producerNotices();
    const supply = notices.find(
        (n) => n.code === "fridge.expiring" && n.subject.id === "fi-supply",
    )!;
    const w = noticeToWire(supply);
    expect(w.detail).toBe("Jun 3");
    expect(w.detail_tone).toBe("warn");
});

test("grocery.restocked digest uses weekday wording from the producer", async () => {
    const notices = await producerNotices();
    const restock = notices.find((n) => n.code === "grocery.restocked")!;
    expect(noticeSentence(restock)).toContain("Thursday");
    const w = noticeToWire(restock);
    expect(w.detail).toBe("Thursday");
    expect(w.detail).not.toBe("3 days");
    expect(w.group_key).toBe("running_low");
    expect(w.title).toBe("Whole milk");
});

test("fridge.expired wire detail keeps expiry date when on grocery list", async () => {
    const notices = await producerNotices();
    const notice = notices.find((n) => n.code === "fridge.expired")!;
    const w = noticeToWire(notice);
    expect(w.detail).toContain("expired");
    expect(w.detail).toContain("May 31");
    expect(w.detail).not.toContain("grocery list");
});

test("recipe gap without plannedOn uses neutral group label", () => {
    const notice: Notice = {
        code: "recipe.no_food",
        severity: "warn",
        subject: {
            kind: "recipe_ingredient",
            id: "ing",
            recipeId: "r",
        },
        related: [],
        params: { name: "Cumin", recipeName: "Curry" },
    };
    const w = noticeToWire(notice);
    expect(w.group_label).toBe("Recipes");
    expect(w.detail).toBe("Curry");
});

test("product checks digest as the product with the check as detail", () => {
    const [allergen] = checkProductForMember(
        {
            id: "p1",
            name: "Peanut Bar",
            allergensTags: ["en:peanuts"],
            tracesTags: [],
        },
        { id: "u1", name: "Alex", allergens: ["peanut"], dislikes: [] },
        { remaining: {} },
    );
    const w = noticeToWire(allergen!);
    expect(w.title).toBe("Peanut Bar");
    expect(w.detail).toBe("Contains peanut — Alex.");
    expect(w.group_key).toBe("product_checks");
    expect(w.group_label).toBe("Product checks");
    expect(w.dot_tone).toBe("over");
    expect(w.detail_tone).toBe("over");
});
