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
} from "./notices.js";

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
