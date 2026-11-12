import { expect, test } from "bun:test";
import {
    MAX_SLOT_SUGGESTIONS,
    portionFitsMacros,
    recipesUsingExpiring,
    suggestForSlot,
    type ExpiringItem,
    type MacrosLeft,
    type SuggestionRecipe,
} from "./suggestions.js";
import type { LinkedNeed } from "./linking.js";
import type { RecipeMacros } from "./recipes.js";

const HH = "hh-1";

const EGGS = "food-eggs";
const SPINACH = "food-spinach";
const RICE = "food-rice";
const MILK = "food-milk";
const TOFU = "food-tofu";

function macros(
    calories: number | null,
    over: Partial<RecipeMacros> = {},
): RecipeMacros {
    return {
        calories,
        protein_g: 20,
        carbs_g: 30,
        fat_g: 10,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        incomplete: false,
        ...over,
    };
}

function recipe(
    id: string,
    name: string,
    foodIds: string[],
    macrosPerPortion: RecipeMacros,
    over: { tags?: string[]; verified?: boolean } = {},
): SuggestionRecipe {
    return {
        recipe: {
            id,
            householdId: HH,
            creatorId: "u1",
            name,
            yieldPortions: 2,
            instructions: "Cook it.",
            sourceUrl: null,
            tags: over.tags ?? [],
            notes: null,
            prepMinutes: null,
            cookMinutes: null,
            verification: over.verified === false ? "unverified" : "verified",
            updatedAt: "2026-11-01T00:00:00.000Z",
        },
        ingredients: foodIds.map((foodId, index) => ({
            id: `${id}-i${index}`,
            householdId: HH,
            recipeId: id,
            kind: "food" as const,
            displayName: foodId,
            quantity: { amount: 100, unit: "g" },
            foodId,
            sortOrder: index,
            note: null,
        })),
        macrosPerPortion,
    };
}

function stockOf(...foodIds: string[]): LinkedNeed[] {
    return foodIds.map((foodId) => ({
        foodId,
        quantity: { amount: 1000, unit: "g" },
    }));
}

function expiring(
    id: string,
    foodId: string,
    expiresOn: string,
    displayName = foodId,
): ExpiringItem {
    return { id, displayName, foodId, expiresOn };
}

const ROOM: MacrosLeft = {
    calories: 700,
    protein_g: 60,
    carbs_g: 90,
    fat_g: 30,
};

const OMELETTE = recipe(
    "r-omelette",
    "Spinach omelette",
    [EGGS, SPINACH],
    macros(350),
);
const PILAF = recipe("r-pilaf", "Rice pilaf", [RICE], macros(500));
const HEAVY = recipe("r-heavy", "Big rice bowl", [RICE, EGGS], macros(900));

test("picks the recipe that uses the expiring item", () => {
    const result = suggestForSlot({
        slot: "dinner",
        recipes: [PILAF, OMELETTE],
        stock: stockOf(EGGS, SPINACH, RICE),
        macrosLeft: ROOM,
        expiring: [expiring("f-spinach", SPINACH, "2026-11-12", "Spinach")],
    });
    expect(result.map((s) => s.recipeId)).toEqual(["r-omelette", "r-pilaf"]);
    expect(result[0]!.usesExpiring).toEqual([
        { id: "f-spinach", displayName: "Spinach", expiresOn: "2026-11-12" },
    ]);
    expect(result[1]!.usesExpiring).toEqual([]);
    expect(result[0]!.macrosPerPortion).toEqual({
        calories: 350,
        protein_g: 20,
        carbs_g: 30,
        fat_g: 10,
    });
});

test("excludes recipes whose portion is over the macros left", () => {
    const result = suggestForSlot({
        slot: "dinner",
        recipes: [HEAVY, PILAF],
        stock: stockOf(EGGS, RICE),
        macrosLeft: ROOM,
        expiring: [],
    });
    expect(result.map((s) => s.recipeId)).toEqual(["r-pilaf"]);
});

test("returns an empty list when nothing fits", () => {
    expect(
        suggestForSlot({
            slot: "snack",
            recipes: [OMELETTE, PILAF],
            stock: stockOf(EGGS, SPINACH, RICE),
            macrosLeft: { ...ROOM, calories: 100 },
            expiring: [],
        }),
    ).toEqual([]);
    expect(
        suggestForSlot({
            slot: "snack",
            recipes: [],
            stock: stockOf(EGGS),
            macrosLeft: ROOM,
            expiring: [],
        }),
    ).toEqual([]);
});

test("returns an empty list when the household has no goal to fit", () => {
    expect(
        suggestForSlot({
            slot: "lunch",
            recipes: [PILAF],
            stock: stockOf(RICE),
            macrosLeft: null,
            expiring: [],
        }),
    ).toEqual([]);
});

test("only recipes cookable from stock are suggested", () => {
    const result = suggestForSlot({
        slot: "lunch",
        recipes: [OMELETTE, PILAF],
        // No spinach: the omelette is not cookable.
        stock: stockOf(EGGS, RICE),
        macrosLeft: ROOM,
        expiring: [expiring("f-eggs", EGGS, "2026-11-12")],
    });
    expect(result.map((s) => s.recipeId)).toEqual(["r-pilaf"]);
    // An unverified recipe is never cookable.
    const unverified = recipe("r-new", "New", [RICE], macros(300), {
        verified: false,
    });
    expect(
        suggestForSlot({
            slot: "lunch",
            recipes: [unverified],
            stock: stockOf(RICE),
            macrosLeft: ROOM,
            expiring: [],
        }),
    ).toEqual([]);
});

test("a recipe with incomplete macros is never suggested for macro fit", () => {
    const unknown = recipe(
        "r-unknown",
        "Mystery stew",
        [RICE],
        macros(null, { incomplete: true }),
    );
    // Even when its known part would fit and it uses an expiring item.
    const partial = recipe(
        "r-partial",
        "Partial stew",
        [RICE],
        macros(200, { incomplete: true }),
    );
    expect(
        suggestForSlot({
            slot: "dinner",
            recipes: [unknown, partial],
            stock: stockOf(RICE),
            macrosLeft: ROOM,
            expiring: [expiring("f-rice", RICE, "2026-11-12")],
        }),
    ).toEqual([]);
});

test("an incomplete recipe still shows under Use soon", () => {
    const unknown = recipe(
        "r-unknown",
        "Mystery stew",
        [RICE],
        macros(null, { incomplete: true }),
    );
    const uses = recipesUsingExpiring([unknown], stockOf(RICE), [
        expiring("f-rice", RICE, "2026-11-12", "Rice"),
    ]);
    expect(uses).toEqual([
        {
            item: {
                id: "f-rice",
                displayName: "Rice",
                expiresOn: "2026-11-12",
            },
            recipes: [
                {
                    recipeId: "r-unknown",
                    name: "Mystery stew",
                    incomplete: true,
                },
            ],
        },
    ]);
});

test("Use soon lists only cookable recipes, complete ones first", () => {
    const mystery = recipe(
        "r-a-mystery",
        "A mystery",
        [EGGS],
        macros(null, { incomplete: true }),
    );
    const uses = recipesUsingExpiring(
        [mystery, OMELETTE, PILAF],
        // No spinach in stock: the omelette cannot be cooked.
        stockOf(EGGS, RICE),
        [
            expiring("f-eggs", EGGS, "2026-11-12", "Eggs"),
            expiring("f-tofu", TOFU, "2026-11-13", "Tofu"),
        ],
    );
    expect(uses.map((u) => u.item.id)).toEqual(["f-eggs", "f-tofu"]);
    expect(uses[0]!.recipes.map((r) => r.recipeId)).toEqual(["r-a-mystery"]);
    // Nothing uses the tofu: the row is still there, with no recipes.
    expect(uses[1]!.recipes).toEqual([]);

    const withSpinach = recipesUsingExpiring(
        [mystery, OMELETTE],
        stockOf(EGGS, SPINACH),
        [expiring("f-eggs", EGGS, "2026-11-12", "Eggs")],
    );
    // The complete recipe leads even though "A mystery" sorts first by name.
    expect(withSpinach[0]!.recipes.map((r) => r.recipeId)).toEqual([
        "r-omelette",
        "r-a-mystery",
    ]);
});

test("Use soon puts the expiring item that goes off first first", () => {
    const uses = recipesUsingExpiring([PILAF], stockOf(RICE, MILK), [
        expiring("f-milk", MILK, "2026-11-14", "Milk"),
        expiring("f-rice", RICE, "2026-11-12", "Rice"),
        expiring("f-nodate", EGGS, "", "Undated"),
    ]);
    expect(uses.map((u) => u.item.id)).toEqual(["f-rice", "f-milk"]);
});

test("soonest expiry first, then more expiring items used, then fit", () => {
    const soon = recipe("r-soon", "Spinach rice", [SPINACH, RICE], macros(400));
    const later = recipe("r-later", "Milk rice", [MILK, RICE], macros(400));
    const both = recipe(
        "r-both",
        "Everything bowl",
        [MILK, SPINACH],
        macros(400),
    );
    const stock = stockOf(SPINACH, RICE, MILK);
    const items = [
        expiring("f-spinach", SPINACH, "2026-11-12"),
        expiring("f-milk", MILK, "2026-11-15"),
    ];

    // soon and both share the earliest expiry (spinach); both uses two items.
    expect(
        suggestForSlot({
            slot: "dinner",
            recipes: [later, soon, both],
            stock,
            macrosLeft: ROOM,
            expiring: items,
        }).map((s) => s.recipeId),
    ).toEqual(["r-both", "r-soon"]);

    // Without the spinach pressure, the milk recipes lead the plain one.
    const plain = recipe("r-plain", "Plain rice", [RICE], macros(650));
    expect(
        suggestForSlot({
            slot: "dinner",
            recipes: [plain, later],
            stock,
            macrosLeft: ROOM,
            expiring: [expiring("f-milk", MILK, "2026-11-15")],
        }).map((s) => s.recipeId),
    ).toEqual(["r-later", "r-plain"]);
});

test("among recipes with nothing expiring, the closest fit leads", () => {
    const small = recipe("r-small", "Small", [RICE], macros(200));
    const big = recipe("r-big", "Big", [RICE], macros(650));
    const mid = recipe("r-mid", "Mid", [RICE], macros(400));
    const result = suggestForSlot({
        slot: "dinner",
        recipes: [small, mid, big],
        stock: stockOf(RICE),
        macrosLeft: ROOM,
        expiring: [],
    });
    expect(result.map((s) => s.recipeId)).toEqual(["r-big", "r-mid"]);
    expect(result).toHaveLength(MAX_SLOT_SUGGESTIONS);
});

test("a recipe tagged with the slot name leads its peers, never a filter", () => {
    const dinnerish = recipe("r-d", "Zucchini bake", [RICE], macros(300), {
        tags: ["Dinner"],
    });
    const other = recipe("r-o", "Apple bowl", [RICE], macros(300), {
        tags: ["breakfast"],
    });
    const stock = stockOf(RICE);
    const base = { stock, macrosLeft: ROOM, expiring: [] };
    expect(
        suggestForSlot({
            ...base,
            slot: "dinner",
            recipes: [other, dinnerish],
        }).map((s) => s.recipeId),
    ).toEqual(["r-d", "r-o"]);
    expect(
        suggestForSlot({
            ...base,
            slot: "breakfast",
            recipes: [dinnerish, other],
        }).map((s) => s.recipeId),
    ).toEqual(["r-o", "r-d"]);
    // Expiring still outranks the slot tag.
    const expiringRecipe = recipe("r-e", "Eggs", [EGGS], macros(300));
    expect(
        suggestForSlot({
            slot: "dinner",
            recipes: [dinnerish, expiringRecipe],
            stock: stockOf(RICE, EGGS),
            macrosLeft: ROOM,
            expiring: [expiring("f-eggs", EGGS, "2026-11-12")],
        })[0]!.recipeId,
    ).toBe("r-e");
});

test("ties are broken by name, then id, regardless of input order", () => {
    const a = recipe("r-2", "Same", [RICE], macros(400));
    const b = recipe("r-1", "Same", [RICE], macros(400));
    const c = recipe("r-3", "Another", [RICE], macros(400));
    const run = (recipes: SuggestionRecipe[]) =>
        suggestForSlot({
            slot: "lunch",
            recipes,
            stock: stockOf(RICE),
            macrosLeft: ROOM,
            expiring: [],
        }).map((s) => s.recipeId);
    expect(run([a, b, c])).toEqual(["r-3", "r-1"]);
    expect(run([c, b, a])).toEqual(["r-3", "r-1"]);
    expect(run([b, c, a])).toEqual(["r-3", "r-1"]);
});

test("only calories caps a portion; protein, carbs and fat never exclude", () => {
    const base = {
        slot: "dinner" as const,
        stock: stockOf(RICE),
        expiring: [],
    };
    // 600 kcal and 15 g protein left: a 400 kcal / 35 g protein recipe is
    // suggested, since protein is a target to reach, not a ceiling.
    const rich = recipe(
        "r-rich",
        "Protein bowl",
        [RICE],
        macros(400, { protein_g: 35 }),
    );
    expect(
        suggestForSlot({
            ...base,
            recipes: [rich],
            macrosLeft: { calories: 600, protein_g: 15 },
        }).map((s) => s.recipeId),
    ).toEqual(["r-rich"]);
    // Carbs and fat past what is left do not exclude either.
    expect(
        suggestForSlot({
            ...base,
            recipes: [rich],
            macrosLeft: { calories: 600, carbs_g: 5, fat_g: 1 },
        }),
    ).toHaveLength(1);

    // Protein goal already met (left is negative): a light salad still goes.
    const salad = recipe(
        "r-salad",
        "Salad",
        [RICE],
        macros(150, { protein_g: 5 }),
    );
    expect(
        suggestForSlot({
            ...base,
            recipes: [salad],
            macrosLeft: { calories: 600, protein_g: -5 },
        }).map((s) => s.recipeId),
    ).toEqual(["r-salad"]);

    // A recipe over the calories left is excluded, equal calories fit.
    const big = recipe("r-big", "Big", [RICE], macros(601));
    const exact = recipe("r-exact", "Exact", [RICE], macros(600));
    expect(
        suggestForSlot({
            ...base,
            recipes: [big, exact],
            macrosLeft: { calories: 600, protein_g: 100 },
        }).map((s) => s.recipeId),
    ).toEqual(["r-exact"]);

    // No calorie target: any complete recipe can be suggested.
    expect(
        suggestForSlot({
            ...base,
            recipes: [big],
            macrosLeft: { calories: null, protein_g: 10 },
        }),
    ).toHaveLength(1);
    // Unknown protein, carbs or fat still keeps a recipe out.
    for (const key of ["protein_g", "carbs_g", "fat_g"] as const) {
        expect(
            suggestForSlot({
                ...base,
                recipes: [
                    recipe(
                        "r-gap",
                        "Gap",
                        [RICE],
                        macros(300, { [key]: null }),
                    ),
                ],
                macrosLeft: { calories: 600 },
            }),
        ).toEqual([]);
    }
});

test("ranking: more of the protein still to go, then less carb/fat overshoot, then calorie fit", () => {
    const base = {
        slot: "dinner" as const,
        stock: stockOf(RICE),
        expiring: [],
    };
    const lean = recipe(
        "r-lean",
        "Lean",
        [RICE],
        macros(500, { protein_g: 40 }),
    );
    const light = recipe(
        "r-light",
        "Light",
        [RICE],
        macros(300, { protein_g: 10 }),
    );
    const mid = recipe("r-mid", "Mid", [RICE], macros(450, { protein_g: 25 }));
    const run = (macrosLeft: MacrosLeft, recipes: SuggestionRecipe[]) =>
        suggestForSlot({ ...base, recipes, macrosLeft }).map((s) => s.recipeId);

    // 30 g protein to go: lean covers 30 (capped), mid 25, light 10.
    expect(run({ calories: 700, protein_g: 30 }, [light, mid, lean])).toEqual([
        "r-lean",
        "r-mid",
    ]);
    // Protein covered is capped at what is left: lean and mid tie on 20 g, so
    // the next rule (carb/fat overshoot, here equal) falls to calorie fit.
    expect(run({ calories: 700, protein_g: 20 }, [light, mid, lean])).toEqual([
        "r-lean",
        "r-mid",
    ]);
    // Protein already met: everything ties on protein; less overshoot of the
    // carbs and fat left wins over the closer calorie fit.
    const fatty = recipe(
        "r-fatty",
        "Fatty",
        [RICE],
        macros(690, { protein_g: 20, fat_g: 40 }),
    );
    const tame = recipe(
        "r-tame",
        "Tame",
        [RICE],
        macros(300, { protein_g: 20, fat_g: 10 }),
    );
    expect(
        run({ calories: 700, protein_g: -5, carbs_g: 90, fat_g: 20 }, [
            fatty,
            tame,
        ]),
    ).toEqual(["r-tame", "r-fatty"]);
    // With no overshoot difference the closest calorie fit still decides.
    expect(
        run({ calories: 700, protein_g: -5, carbs_g: 90, fat_g: 90 }, [
            tame,
            fatty,
        ]),
    ).toEqual(["r-fatty", "r-tame"]);
});

test("two packs of one food count once, at the soonest date", () => {
    const family = new Map([
        ["food-eggs-a", { genericFoodId: EGGS }],
        ["food-eggs-b", { genericFoodId: EGGS }],
    ]) as unknown as ReadonlyMap<string, never>;
    const shakshuka = recipe("r-shak", "Shakshuka", [EGGS], macros(400));
    const rival = recipe("r-rival", "Rival", [SPINACH, MILK], macros(400));
    const items = [
        expiring("p-later", "food-eggs-b", "2026-11-14", "Eggs (box 2)"),
        expiring("p-sooner", "food-eggs-a", "2026-11-13", "Eggs (box 1)"),
        expiring("f-spinach", SPINACH, "2026-11-13", "Spinach"),
        expiring("f-milk", MILK, "2026-11-13", "Milk"),
    ];
    const result = suggestForSlot({
        slot: "dinner",
        recipes: [shakshuka, rival],
        stock: stockOf(EGGS, SPINACH, MILK),
        macrosLeft: ROOM,
        expiring: items,
        foodsById: family as never,
    });
    const shak = result.find((s) => s.recipeId === "r-shak")!;
    expect(shak.usesExpiring).toEqual([
        {
            id: "p-sooner",
            displayName: "Eggs (box 1)",
            expiresOn: "2026-11-13",
        },
    ]);
    // Rival uses two distinct foods on the same date, so it leads shakshuka's
    // single family even though shakshuka matches two packs.
    expect(result.map((s) => s.recipeId)).toEqual(["r-rival", "r-shak"]);
});

test("portionFitsMacros: equal calories fit, unknown nutrients do not", () => {
    expect(portionFitsMacros(macros(700), { calories: 700 })).toBe(true);
    expect(portionFitsMacros(macros(701), { calories: 700 })).toBe(false);
    expect(portionFitsMacros(macros(0), { calories: 0 })).toBe(true);
    expect(portionFitsMacros(macros(100), { calories: -50 })).toBe(false);
    // No calorie target: any complete recipe fits.
    expect(portionFitsMacros(macros(5000), { calories: null })).toBe(true);
    // Protein, carbs and fat are never caps.
    expect(
        portionFitsMacros(macros(300), {
            calories: 700,
            protein_g: -5,
            carbs_g: 0,
            fat_g: 0,
        }),
    ).toBe(true);
    // Unknown is not zero.
    for (const key of ["protein_g", "carbs_g", "fat_g"] as const) {
        expect(
            portionFitsMacros(macros(300, { [key]: null }), { calories: 700 }),
        ).toBe(false);
    }
    expect(portionFitsMacros(macros(null), { calories: 700 })).toBe(false);
    expect(portionFitsMacros(macros(300), null)).toBe(false);
});

test("inputs are not mutated and results are plain JSON", () => {
    const recipes = [PILAF, OMELETTE];
    const items = [
        expiring("f-b", RICE, "2026-11-14"),
        expiring("f-a", SPINACH, "2026-11-12"),
    ];
    const before = JSON.stringify({ recipes, items });
    const slot = suggestForSlot({
        slot: "dinner",
        recipes,
        stock: stockOf(EGGS, SPINACH, RICE),
        macrosLeft: ROOM,
        expiring: items,
    });
    const uses = recipesUsingExpiring(
        recipes,
        stockOf(EGGS, SPINACH, RICE),
        items,
    );
    expect(JSON.stringify({ recipes, items })).toBe(before);
    expect(JSON.parse(JSON.stringify(slot))).toEqual(slot);
    expect(JSON.parse(JSON.stringify(uses))).toEqual(uses);
});
