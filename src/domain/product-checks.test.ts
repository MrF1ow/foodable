import { expect, test } from "bun:test";
import { noticeSentence } from "../copy/notices.js";
import {
    checkProductForMember,
    OFF_ALLERGEN_TAG_TO_CODE,
    productMatchesDislike,
    type ProductCheckInput,
    type ProductCheckMember,
} from "./product-checks.js";

const MEMBER: ProductCheckMember = {
    id: "u1",
    name: "Alex",
    allergens: [],
    dislikes: [],
};

function product(
    overrides: Partial<ProductCheckInput> = {},
): ProductCheckInput {
    return {
        id: "f1",
        name: "Snack Bar",
        allergensTags: [],
        tracesTags: [],
        ...overrides,
    };
}

test("OFF allergen tag map covers planned tags", () => {
    expect(OFF_ALLERGEN_TAG_TO_CODE["en:peanuts"]).toBe("peanut");
    expect(OFF_ALLERGEN_TAG_TO_CODE["en:gluten"]).toBeUndefined();
});

test("allergen in contains list blocks for member", () => {
    const member: ProductCheckMember = {
        ...MEMBER,
        allergens: ["peanut"],
    };
    const notices = checkProductForMember(
        product({ allergensTags: ["en:peanuts"] }),
        member,
        { remaining: {} },
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]!.code).toBe("food.product_allergen");
    expect(notices[0]!.severity).toBe("block");
    expect(noticeSentence(notices[0]!)).toBe("Contains peanut — Alex.");
});

test("gluten tag warns when member is wheat-allergic", () => {
    const member: ProductCheckMember = {
        ...MEMBER,
        allergens: ["wheat"],
    };
    const notices = checkProductForMember(
        product({ allergensTags: ["en:gluten"] }),
        member,
        { remaining: {} },
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]!.code).toBe("food.product_gluten");
    expect(notices[0]!.severity).toBe("warn");
    expect(noticeSentence(notices[0]!)).toBe(
        "Possible wheat (contains gluten)",
    );
});

test("gluten tag does nothing without wheat allergy", () => {
    const notices = checkProductForMember(
        product({ allergensTags: ["en:gluten"] }),
        { ...MEMBER, allergens: ["milk"] },
        { remaining: {} },
    );
    expect(notices).toEqual([]);
});

test("trace match warns", () => {
    const member: ProductCheckMember = {
        ...MEMBER,
        allergens: ["peanut"],
    };
    const notices = checkProductForMember(
        product({ tracesTags: ["en:peanuts"] }),
        member,
        { remaining: {} },
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]!.code).toBe("food.product_trace");
    expect(noticeSentence(notices[0]!)).toBe("May contain peanut — Alex.");
});

test("goal info uses serving sugar against remaining", () => {
    const notices = checkProductForMember(
        product({
            servingNutrition: { sugarG: 18 },
        }),
        MEMBER,
        { remaining: { sugar_g: 9 } },
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]!.code).toBe("food.product_goal");
    expect(noticeSentence(notices[0]!)).toBe("18 g sugar, 9 g left today");
});

test("unknown serving nutrition skips goal notices", () => {
    const notices = checkProductForMember(
        product({ servingNutrition: { sugarG: null } }),
        MEMBER,
        { remaining: { sugar_g: 9 } },
    );
    expect(notices).toEqual([]);
});

test("dislike match is case and plural insensitive", () => {
    const member: ProductCheckMember = {
        ...MEMBER,
        dislikes: ["Tomatoes"],
    };
    const notices = checkProductForMember(
        product({
            name: "Salsa",
            ingredientsText: "diced tomato, salt",
        }),
        member,
        { remaining: {} },
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]!.code).toBe("food.product_dislike");
    expect(noticeSentence(notices[0]!)).toBe("Alex dislikes Tomatoes");
});

test("null allergen and trace tags yield no allergen notices", () => {
    const member: ProductCheckMember = {
        ...MEMBER,
        allergens: ["peanut", "milk"],
    };
    const notices = checkProductForMember(
        product({ allergensTags: null, tracesTags: null }),
        member,
        { remaining: {} },
    );
    expect(notices).toEqual([]);
});

test("per-100 g nutrition scales to serving grams", () => {
    const notices = checkProductForMember(
        product({
            per100g: { sugarG: 40 },
            servingGrams: 50,
        }),
        MEMBER,
        { remaining: { sugar_g: 10 } },
    );
    expect(noticeSentence(notices[0]!)).toBe("20 g sugar, 10 g left today");
});

test("explicit wheat tag blocks instead of gluten warn", () => {
    const member: ProductCheckMember = {
        ...MEMBER,
        allergens: ["wheat"],
    };
    const notices = checkProductForMember(
        product({ allergensTags: ["en:gluten", "en:wheat"] }),
        member,
        { remaining: {} },
    );
    expect(notices.some((n) => n.code === "food.product_allergen")).toBe(true);
    expect(notices.some((n) => n.code === "food.product_gluten")).toBe(false);
});

test("milk block and gluten warn both fire for milk and wheat member", () => {
    const member: ProductCheckMember = {
        ...MEMBER,
        allergens: ["milk", "wheat"],
    };
    const notices = checkProductForMember(
        product({ allergensTags: ["en:milk", "en:gluten"] }),
        member,
        { remaining: {} },
    );
    expect(notices).toHaveLength(2);
    expect(noticeSentence(notices[0]!)).toBe("Contains milk — Alex.");
    expect(noticeSentence(notices[1]!)).toBe(
        "Possible wheat (contains gluten)",
    );
});

test("block allergen sentence lists every matched allergen", () => {
    const member: ProductCheckMember = {
        ...MEMBER,
        allergens: ["milk", "wheat"],
    };
    const notices = checkProductForMember(
        product({ allergensTags: ["en:milk", "en:wheat"] }),
        member,
        { remaining: {} },
    );
    expect(notices).toHaveLength(1);
    expect(noticeSentence(notices[0]!)).toBe("Contains milk and wheat — Alex.");
});

test("gluten in traces warns wheat-allergic member", () => {
    const member: ProductCheckMember = {
        ...MEMBER,
        allergens: ["wheat"],
    };
    const notices = checkProductForMember(
        product({ tracesTags: ["en:gluten"] }),
        member,
        { remaining: {} },
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]!.code).toBe("food.product_gluten");
    expect(noticeSentence(notices[0]!)).toBe(
        "Possible wheat (contains gluten)",
    );
});

test("goal notice says none left when remaining is zero or negative", () => {
    const base = product({ servingNutrition: { sugarG: 18, calories: 250 } });
    const sugarZero = checkProductForMember(base, MEMBER, {
        remaining: { sugar_g: 0 },
    });
    expect(noticeSentence(sugarZero[0]!)).toBe("18 g sugar, none left today");
    const sugarNeg = checkProductForMember(base, MEMBER, {
        remaining: { sugar_g: -5 },
    });
    expect(noticeSentence(sugarNeg[0]!)).toBe("18 g sugar, none left today");
    const calPos = checkProductForMember(base, MEMBER, {
        remaining: { calories: 40 },
    });
    expect(noticeSentence(calPos[0]!)).toBe(
        "250 calories, 40 calories left today",
    );
    const calNone = checkProductForMember(base, MEMBER, {
        remaining: { calories: 0 },
    });
    expect(noticeSentence(calNone[0]!)).toBe("250 calories, none left today");
});

test("dislike matching avoids substring false positives", () => {
    expect(productMatchesDislike(product({ name: "Eggplant" }), "egg")).toBe(
        false,
    );
    expect(
        productMatchesDislike(product({ name: "Coconut Milk" }), "nut"),
    ).toBe(false);
    expect(
        productMatchesDislike(product({ name: "Nutmeg Spice" }), "nut"),
    ).toBe(false);
    expect(productMatchesDislike(product({ name: "Licorice" }), "rice")).toBe(
        false,
    );
    expect(
        productMatchesDislike(product({ name: "Shellfish Soup" }), "fish"),
    ).toBe(false);
    expect(
        productMatchesDislike(product({ name: "Peanut Butter" }), "pea"),
    ).toBe(false);
});

test("dislike matching handles plurals and multi-word phrases", () => {
    expect(
        productMatchesDislike(
            product({
                name: "Fruit cup",
                ingredientsText: "sugar, berry puree",
            }),
            "berries",
        ),
    ).toBe(true);
    expect(
        productMatchesDislike(
            product({
                name: "Salsa",
                ingredientsText: "diced tomato, salt",
            }),
            "tomatoes",
        ),
    ).toBe(true);
    expect(
        productMatchesDislike(
            product({
                name: "Vanilla ice cream",
                ingredientsText: "milk, cream",
            }),
            "ice cream",
        ),
    ).toBe(true);
});
