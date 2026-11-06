import { expect, test } from "bun:test";
import { missingGramsReason } from "../domain/food-quantity.js";
import {
    effectiveFoodsByIds,
    findOrCreateManualFood,
    createProduct,
    setUsualProduct,
    updateFood,
    createMemoryFoodsStore,
    type Food,
} from "../domain/foods.js";
import type { Notice } from "../domain/notices.js";
import { NOTICE_CODES } from "../domain/notices.js";
import {
    recipeIngredientGaps,
    type RecipeIngredient,
    type RecipeGapNutrient,
} from "../domain/recipes.js";
import { HELP_IDS } from "../web/pages/settings-help.js";
import {
    NOTICE_COPY,
    formatMissingNutrientList,
    noticeSentence,
    UNKNOWN_ALLERGEN_TEXT,
} from "./notices.js";
import { addAllergen, createMemoryRulesStore } from "../domain/rules.js";
import {
    allergenNotices,
    groceryAllergenWarning,
    type GroceryAllergenMember,
} from "../domain/grocery.js";
import { fridgeNotices } from "../domain/stock.js";
import { noticeBadge } from "../web/components/notices.js";

const HH = "household-1";

function noticeFromGap(
    recipeId: string,
    ing: RecipeIngredient,
    food: Food | undefined,
    gapIndex: number,
): Notice {
    const gaps = recipeIngredientGaps(ing, food);
    const gap = gaps[gapIndex];
    if (!gap) throw new Error("missing gap");
    const code = `recipe.${gap.reason}` as Notice["code"];
    const related = gap.usualProduct
        ? [
              {
                  kind: "food" as const,
                  id: gap.usualProduct.id,
                  name: gap.usualProduct.name,
              },
          ]
        : [];
    const params: Record<string, string | number | string[]> = {
        name: gap.displayName,
    };
    if (gap.foodId != null) params.foodId = gap.foodId;
    if (gap.missingNutrients.length > 0) {
        params.missing = [...gap.missingNutrients];
    }
    return {
        code,
        severity: "warn",
        subject: {
            kind: "recipe_ingredient",
            id: gap.ingredientId,
            recipeId,
        },
        related,
        params,
    };
}

test("NOTICE_COPY is complete and well-formed", () => {
    const keys = Object.keys(NOTICE_COPY).sort();
    expect(keys).toEqual([...NOTICE_CODES].sort());
    for (const code of NOTICE_CODES) {
        const entry = NOTICE_COPY[code];
        expect(entry.badge.length).toBeGreaterThan(0);
        expect(typeof entry.sentence).toBe("function");
        expect(HELP_IDS).toContain(entry.help);
        expect(entry.dismissible).toBe(false);
    }
});

test("only fridge.expired sets badgeTone bad", () => {
    const withTone = Object.entries(NOTICE_COPY).filter(
        ([, e]) => e.badgeTone === "bad",
    );
    expect(withTone.map(([code]) => code)).toEqual(["fridge.expired"]);
});

test("fridge.expired badge and pill markup are pinned", () => {
    expect(NOTICE_COPY["fridge.expired"].badge).toBe("Expired");
    const today = "2026-11-06";
    const n = fridgeNotices(
        [
            {
                id: "x",
                displayName: "Milk",
                quantity: { amount: 1, unit: "l" },
                expiresOn: "2026-11-05",
            },
        ],
        today,
    )[0]!;
    expect(noticeBadge(n, { className: "expiry-pill" })).toBe(
        '<span class="pill pill-bad expiry-pill" data-notice="fridge.expired">Expired</span>',
    );
});

test("groceryAllergenWarning and allergenNotices sentences match pinned literals", async () => {
    const rules = createMemoryRulesStore();

    await addAllergen(rules, {
        householdId: HH,
        userId: "bob-id",
        allergen: "peanut",
    });
    const bobAllergens = await rules.listAllergens(HH, "bob-id");
    const membersOne: GroceryAllergenMember[] = [
        { displayName: "Bob", userId: "bob-id", allergens: bobAllergens },
    ];
    const oneName = groceryAllergenWarning("Peanut Butter", membersOne, null);
    expect(oneName?.text).toBe("Contains peanut — Bob.");
    expect(
        noticeSentence(
            allergenNotices(
                { kind: "grocery_line", id: "line-1" },
                "Peanut Butter",
                membersOne,
                null,
            )[0]!,
        ),
    ).toBe(oneName!.text);

    const oneCatalog = groceryAllergenWarning("Skippy", membersOne, ["peanut"]);
    expect(oneCatalog?.text).toBe("Contains peanut — Bob.");
    expect(
        noticeSentence(
            allergenNotices(
                { kind: "grocery_line", id: "" },
                "Skippy",
                membersOne,
                ["peanut"],
            )[0]!,
        ),
    ).toBe(oneCatalog!.text);

    await addAllergen(rules, {
        householdId: HH,
        userId: "ann-id",
        allergen: "peanut",
    });
    const annAllergens = await rules.listAllergens(HH, "ann-id");
    const twoMembers: GroceryAllergenMember[] = [
        { displayName: "Bob", userId: "bob-id", allergens: bobAllergens },
        { displayName: "Ann", userId: "ann-id", allergens: annAllergens },
    ];
    const two = groceryAllergenWarning("Peanut Snack", twoMembers, ["peanut"]);
    expect(two?.text).toBe("Contains peanut — Bob, Ann.");
    expect(groceryAllergenWarning("Peanut Snack", twoMembers, null)?.text).toBe(
        "Contains peanut — Bob, Ann.",
    );

    await addAllergen(rules, {
        householdId: HH,
        userId: "other-id",
        allergen: "other",
        otherLabel: "Mustard",
    });
    const otherAllergens = await rules.listAllergens(HH, "other-id");
    const otherMember: GroceryAllergenMember[] = [
        {
            displayName: "Pat",
            userId: "other-id",
            allergens: otherAllergens,
        },
    ];
    const nameOtherLabel = groceryAllergenWarning(
        "Mustard Sauce",
        otherMember,
        null,
    );
    expect(nameOtherLabel?.text).toBe("Contains mustard — Pat.");

    const catalogOther = groceryAllergenWarning("Condiment", otherMember, [
        "other",
    ]);
    expect(catalogOther?.text).toBe("Contains Mustard — Pat.");

    const unknown = groceryAllergenWarning("Apples", membersOne, null);
    expect(unknown?.text).toBe(UNKNOWN_ALLERGEN_TEXT);
    expect(
        allergenNotices(
            { kind: "grocery_line", id: "" },
            "Apples",
            membersOne,
            null,
        ),
    ).toEqual([]);

    expect(groceryAllergenWarning("Apples", membersOne, [])).toBeNull();
    expect(
        allergenNotices(
            { kind: "grocery_line", id: "" },
            "Apples",
            membersOne,
            [],
        ),
    ).toEqual([]);

    const g = allergenNotices(
        { kind: "grocery_line", id: "line-a" },
        "Skippy",
        membersOne,
        ["peanut"],
    )[0]!;
    expect(g.code).toBe("grocery.allergen");
    expect(g.severity).toBe("block");
    expect(g.related).toEqual([{ kind: "member", id: "bob-id", name: "Bob" }]);
    expect(g.params).toEqual({ allergens: ["peanut"] });

    const r = allergenNotices(
        { kind: "recipe", id: "r99" },
        "Skippy",
        membersOne,
        ["peanut"],
    )[0]!;
    expect(r.code).toBe("recipe.allergen");
    expect(r.subject).toEqual({ kind: "recipe", id: "r99" });
    expect(r.severity).toBe("block");
    expect(r.related).toEqual([{ kind: "member", id: "bob-id", name: "Bob" }]);
    expect(r.params).toEqual({ allergens: ["peanut"] });
});

test("registry sentences match #162 cases and recipeIngredientGaps / missingGramsReason", async () => {
    const foods = createMemoryFoodsStore();
    const plain = await findOrCreateManualFood(
        foods,
        HH,
        "food",
        "Half and half",
    );
    await updateFood(foods, HH, plain.id, { gramsPerMl: 1 });
    const catalog = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const eff = catalog.get(plain.id)!;
    const ing: RecipeIngredient = {
        id: "ing-1",
        householdId: HH,
        recipeId: "r1",
        kind: "food",
        displayName: "Half and half",
        quantity: { amount: 60, unit: "ml" },
        foodId: plain.id,
        sortOrder: 0,
        note: null,
    };

    expect(
        noticeSentence(
            noticeFromGap("r1", { ...ing, foodId: null }, undefined, 0),
        ),
    ).toBe(
        recipeIngredientGaps({ ...ing, foodId: null }, undefined)[0]!.message,
    );
    expect(noticeSentence(noticeFromGap("r1", ing, eff, 0))).toBe(
        "Half and half: no nutrition — add it, or pick a usual product",
    );

    const product = await createProduct(foods, HH, plain.id, {
        name: "Store Half and Half",
        defaultUnit: "ml",
        nutritionSource: "manual",
    });
    await setUsualProduct(foods, HH, plain.id, product.id);
    const withUsual = (await effectiveFoodsByIds(foods, HH, [plain.id])).get(
        plain.id,
    )!;
    expect(noticeSentence(noticeFromGap("r1", ing, withUsual, 0))).toBe(
        "Half and half: no nutrition — its usual product, Store Half and Half, has none either",
    );

    const partial = await findOrCreateManualFood(foods, HH, "food", "Yogurt");
    await updateFood(foods, HH, partial.id, {
        calories: 80,
        proteinG: null,
        carbsG: 6,
        fatG: null,
        nutritionSource: "manual",
    });
    const partialIng: RecipeIngredient = {
        ...ing,
        id: "ing-2",
        displayName: "Yogurt",
        foodId: partial.id,
        quantity: { amount: 100, unit: "g" },
    };
    const partialCat = await effectiveFoodsByIds(foods, HH, [partial.id]);
    expect(
        noticeSentence(
            noticeFromGap("r1", partialIng, partialCat.get(partial.id)!, 0),
        ),
    ).toBe("Yogurt: missing protein and fat");

    await updateFood(foods, HH, partial.id, {
        calories: null,
        proteinG: 2,
        carbsG: 6,
        fatG: 4,
        nutritionSource: "manual",
    });
    const partialCat2 = await effectiveFoodsByIds(foods, HH, [partial.id]);
    expect(
        noticeSentence(
            noticeFromGap("r1", partialIng, partialCat2.get(partial.id)!, 0),
        ),
    ).toBe("Yogurt: missing calories");

    await updateFood(foods, HH, partial.id, {
        calories: null,
        proteinG: null,
        carbsG: 6,
        fatG: null,
        nutritionSource: "manual",
    });
    const partialCat3 = await effectiveFoodsByIds(foods, HH, [partial.id]);
    expect(
        noticeSentence(
            noticeFromGap("r1", partialIng, partialCat3.get(partial.id)!, 0),
        ),
    ).toBe("Yogurt: missing calories, protein and fat");

    const eggs = await findOrCreateManualFood(foods, HH, "food", "Eggs");
    const eggIng: RecipeIngredient = {
        ...ing,
        id: "ing-3",
        displayName: "Eggs",
        foodId: eggs.id,
        quantity: { amount: 2, unit: "each" },
    };
    const eggCat = await effectiveFoodsByIds(foods, HH, [eggs.id]);
    const eggFood = eggCat.get(eggs.id)!;
    expect(noticeSentence(noticeFromGap("r1", eggIng, eggFood, 0))).toBe(
        recipeIngredientGaps(eggIng, eggFood)[0]!.message,
    );
    const eggGramsMsg = missingGramsReason("Eggs", eggIng.quantity, eggFood);
    expect(eggGramsMsg).not.toBeNull();
    expect(noticeSentence(noticeFromGap("r1", eggIng, eggFood, 1))).toBe(
        eggGramsMsg!,
    );

    const badUnit: RecipeIngredient = {
        ...ing,
        id: "ing-4",
        displayName: "Spice",
        quantity: { amount: 1, unit: "pinch" },
    };
    const spiceGrams = missingGramsReason("Spice", badUnit.quantity, eff);
    expect(spiceGrams).not.toBeNull();
    const spiceGaps = recipeIngredientGaps(badUnit, eff);
    const unknownIdx = spiceGaps.findIndex((g) => g.reason === "unknown_unit");
    expect(unknownIdx).toBeGreaterThanOrEqual(0);
    expect(noticeSentence(noticeFromGap("r1", badUnit, eff, unknownIdx))).toBe(
        spiceGrams!,
    );

    const oil = await findOrCreateManualFood(foods, HH, "food", "Oil");
    await updateFood(foods, HH, oil.id, {
        calories: 884,
        proteinG: 0,
        carbsG: 0,
        fatG: 100,
        nutritionSource: "manual",
    });
    const oilIng: RecipeIngredient = {
        ...ing,
        id: "ing-5",
        displayName: "Oil",
        foodId: oil.id,
        quantity: { amount: 15, unit: "ml" },
    };
    const oilFood = (await effectiveFoodsByIds(foods, HH, [oil.id])).get(
        oil.id,
    )!;
    const oilGaps = recipeIngredientGaps(oilIng, oilFood);
    expect(oilGaps.map((g) => g.reason)).toEqual(["missing_grams_per_ml"]);
    const oilSentence = noticeSentence(noticeFromGap("r1", oilIng, oilFood, 0));
    expect(oilSentence).toBe(
        missingGramsReason("Oil", oilIng.quantity, oilFood)!,
    );
    expect(oilSentence).toBe("Oil: set grams per millilitre");
});

test("literal string pins for no_nutrition with usual product", () => {
    const notice: Notice = {
        code: "recipe.no_nutrition",
        severity: "warn",
        subject: {
            kind: "recipe_ingredient",
            id: "i1",
            recipeId: "r1",
        },
        related: [
            {
                kind: "food",
                id: "p1",
                name: "Store Half and Half",
            },
        ],
        params: { name: "Half and half", foodId: "f-plain" },
    };
    expect(noticeSentence(notice)).toBe(
        "Half and half: no nutrition — its usual product, Store Half and Half, has none either",
    );
});

test("formatMissingNutrientList matches 1, 2, 3+ nutrients", () => {
    const one: RecipeGapNutrient[] = ["protein_g"];
    const two: RecipeGapNutrient[] = ["protein_g", "fat_g"];
    const three: RecipeGapNutrient[] = ["calories", "protein_g", "fat_g"];
    expect(formatMissingNutrientList(one)).toBe("protein");
    expect(formatMissingNutrientList(two)).toBe("protein and fat");
    expect(formatMissingNutrientList(three)).toBe("calories, protein and fat");
});
