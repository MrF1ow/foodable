import { describe, expect, test } from "bun:test";
import { noticeSentence } from "../copy/notices.js";
import {
    createMemoryFoodsStore,
    effectiveFoodsFromListed,
    newFood,
    type Food,
} from "./foods.js";
import { createMemoryFridgeStore, type FridgeItem } from "./fridge.js";
import {
    createMemoryGroceryStore,
    type GroceryAllergenMember,
    type GroceryLine,
} from "./grocery.js";
import {
    createMemoryNoticeDismissalsStore,
    dismissalKey,
    dismissalKeyString,
} from "./notice-dismissals.js";
import {
    allergenConditionNotices,
    type AllergenConditionInput,
} from "./notices-allergens.js";
import { noticesFor } from "./notices-for.js";
import type { Notice } from "./notices.js";
import { createMemoryPlansStore, type RecipePlan } from "./plan.js";
import { createMemoryVariantsStore } from "./recipe-variants.js";
import {
    createMemoryRecipesStore,
    type Recipe,
    type RecipeIngredient,
} from "./recipes.js";
import type { MemberAllergen } from "./rules.js";

const HH = "hh-allergens";
const TODAY = "2026-11-12";

function allergy(
    userId: string,
    allergen: MemberAllergen["allergen"],
    otherLabel: string | null = null,
): MemberAllergen {
    return {
        id: `${userId}-${allergen}-${otherLabel ?? ""}`,
        householdId: HH,
        userId,
        allergen,
        otherLabel,
    };
}

function member(
    userId: string,
    displayName: string,
    allergens: MemberAllergen[],
): GroceryAllergenMember {
    return { userId, displayName, allergens };
}

const ANA = member("ana", "Ana", [allergy("ana", "peanut")]);
const BEN = member("ben", "Ben", [
    allergy("ben", "peanut"),
    allergy("ben", "milk"),
]);

function food(over: Partial<Food> = {}): Food {
    return {
        ...newFood({ householdId: HH, kind: "food", name: "Peanut butter" }),
        id: "pb",
        ...over,
    };
}

/** A food under another name: the catalog keeps one row per normalized name. */
function foodNamed(id: string, name: string, over: Partial<Food> = {}): Food {
    return food({ id, name, normalizedName: name.toLowerCase(), ...over });
}

function line(over: Partial<GroceryLine> = {}): GroceryLine {
    return {
        id: "l1",
        householdId: HH,
        storeId: "s",
        sectionId: "sec",
        kind: "food",
        displayName: "Peanut butter",
        quantity: { amount: 1, unit: "each" },
        foodId: "pb",
        checked: false,
        source: "manual",
        sourceFridgeItemId: null,
        note: null,
        ...over,
    };
}

function item(over: Partial<FridgeItem> = {}): FridgeItem {
    return {
        id: "i1",
        householdId: HH,
        locationId: "loc",
        kind: "food",
        displayName: "Peanut butter",
        quantity: { amount: 1, unit: "each" },
        foodId: "pb",
        ...over,
    };
}

function recipe(over: Partial<Recipe> = {}): Recipe {
    return {
        id: "r1",
        householdId: HH,
        creatorId: "ana",
        name: "Satay",
        yieldPortions: 2,
        instructions: null,
        sourceUrl: null,
        tags: [],
        notes: null,
        prepMinutes: null,
        cookMinutes: null,
        verification: "verified",
        updatedAt: "2026-11-01T00:00:00.000Z",
        ...over,
    } as Recipe;
}

function ingredient(over: Partial<RecipeIngredient> = {}): RecipeIngredient {
    return {
        id: "ri1",
        householdId: HH,
        recipeId: "r1",
        kind: "food",
        displayName: "Peanut butter",
        quantity: { amount: 2, unit: "tbsp" },
        foodId: "pb",
        sortOrder: 0,
        note: null,
        ...over,
    };
}

function plan(over: Partial<RecipePlan> = {}): RecipePlan {
    return {
        id: "p1",
        householdId: HH,
        recipeId: "r1",
        date: TODAY,
        slot: "dinner",
        servings: 2,
        createdBy: null,
        createdAt: "2026-11-01T00:00:00.000Z",
        ...over,
    };
}

function input(
    over: Partial<Omit<AllergenConditionInput, "foodsById">> & {
        foods?: Food[];
    } = {},
): AllergenConditionInput {
    const { foods = [food({ allergens: ["peanut"] })], ...rest } = over;
    return {
        today: TODAY,
        members: [ANA],
        lines: [],
        plans: [],
        recipes: [],
        ingredients: [],
        fridgeItems: [],
        ...rest,
        foodsById: effectiveFoodsFromListed(foods),
    };
}

function keyOf(notice: Notice): string {
    return dismissalKeyString(dismissalKey(notice));
}

describe("grocery.allergen", () => {
    test("an open line whose food has a member's allergen", () => {
        const [notice, ...rest] = allergenConditionNotices(
            input({ lines: [line()] }),
        );
        expect(rest).toEqual([]);
        expect(notice).toEqual({
            code: "grocery.allergen",
            severity: "block",
            subject: { kind: "grocery_line", id: "l1" },
            related: [{ kind: "member", id: "ana", name: "Ana" }],
            params: {
                allergens: ["peanut"],
                name: "Peanut butter",
                foodId: "pb",
            },
        });
        expect(noticeSentence(notice!)).toBe("Contains peanut — Ana.");
    });

    test("a checked line is not a conflict", () => {
        expect(
            allergenConditionNotices(
                input({ lines: [line({ checked: true })] }),
            ),
        ).toEqual([]);
    });

    test("no member has an allergen: nothing, whatever is on the list", () => {
        expect(
            allergenConditionNotices(
                input({
                    members: [member("zed", "Zed", [])],
                    lines: [line()],
                }),
            ),
        ).toEqual([]);
    });

    test("a catalog food without the allergen is clear even if its name says it", () => {
        expect(
            allergenConditionNotices(
                input({
                    foods: [
                        food({ name: "Peanut-free spread", allergens: [] }),
                    ],
                    lines: [line({ displayName: "Peanut-free spread" })],
                }),
            ),
        ).toEqual([]);
    });

    test("a line with no food matches on its name", () => {
        const [notice] = allergenConditionNotices(
            input({
                lines: [line({ displayName: "Peanut brittle", foodId: null })],
            }),
        );
        expect(notice?.code).toBe("grocery.allergen");
        expect(notice?.params).toEqual({
            allergens: ["peanut"],
            name: "Peanut brittle",
        });
    });

    test("a line with no food and no match is unknown, not a conflict", () => {
        expect(
            allergenConditionNotices(
                input({
                    lines: [line({ displayName: "Apples", foodId: null })],
                }),
            ),
        ).toEqual([]);
    });

    test("every member that conflicts is named once, with each allergen label once", () => {
        const [notice, ...rest] = allergenConditionNotices(
            input({
                members: [
                    ANA,
                    BEN,
                    member("cy", "Cy", [allergy("cy", "fish")]),
                ],
                foods: [food({ allergens: ["peanut", "milk"] })],
                lines: [line()],
            }),
        );
        expect(rest).toEqual([]);
        expect(notice?.related.map((r) => r.name)).toEqual(["Ana", "Ben"]);
        expect(notice?.params.allergens).toEqual(["peanut", "milk"]);
    });

    test("'other' allergens match by their label", () => {
        const kiwi = member("kay", "Kay", [allergy("kay", "other", "Kiwi")]);
        const byFoodName = allergenConditionNotices(
            input({
                members: [kiwi],
                foods: [food({ id: "k", name: "Kiwi", allergens: [] })],
                lines: [line({ displayName: "Kiwi smoothie", foodId: "k" })],
            }),
        );
        expect(byFoodName).toHaveLength(1);
        expect(byFoodName[0]?.params.allergens).toEqual(["Kiwi"]);
        const byLineName = allergenConditionNotices(
            input({
                members: [kiwi],
                lines: [line({ displayName: "Gold kiwi", foodId: null })],
            }),
        );
        expect(byLineName).toHaveLength(1);
        expect(byLineName[0]?.params.allergens).toEqual(["kiwi"]);
        expect(
            allergenConditionNotices(
                input({
                    members: [kiwi],
                    foods: [food({ id: "k", name: "Apple", allergens: [] })],
                    lines: [line({ displayName: "Apple", foodId: "k" })],
                }),
            ),
        ).toEqual([]);
    });

    test("one notice per line", () => {
        const notices = allergenConditionNotices(
            input({
                lines: [line(), line({ id: "l2", displayName: "Peanut oil" })],
            }),
        );
        expect(notices.map((n) => n.subject.id)).toEqual(["l1", "l2"]);
    });
});

describe("recipe.allergen", () => {
    const planned = {
        recipes: [recipe()],
        ingredients: [ingredient()],
        plans: [plan()],
    };

    test("a recipe planned today with an ingredient a member is allergic to", () => {
        const [notice, ...rest] = allergenConditionNotices(input(planned));
        expect(rest).toEqual([]);
        expect(notice).toEqual({
            code: "recipe.allergen",
            severity: "block",
            subject: { kind: "recipe", id: "r1" },
            related: [{ kind: "member", id: "ana", name: "Ana" }],
            params: {
                allergens: ["peanut"],
                name: "Satay",
                recipeName: "Satay",
                plannedOn: TODAY,
            },
        });
    });

    test("planned on several days is still one notice, naming the first day", () => {
        const notices = allergenConditionNotices(
            input({
                ...planned,
                plans: [
                    plan({ id: "p2", date: "2026-11-15" }),
                    plan({ id: "p1", date: "2026-11-13" }),
                ],
            }),
        );
        expect(notices).toHaveLength(1);
        expect(notices[0]?.params.plannedOn).toBe("2026-11-13");
    });

    test("the window is today through the sixth day after", () => {
        const at = (date: string) =>
            allergenConditionNotices(
                input({ ...planned, plans: [plan({ date })] }),
            );
        expect(at("2026-11-11")).toEqual([]);
        expect(at("2026-11-12")).toHaveLength(1);
        expect(at("2026-11-18")).toHaveLength(1);
        expect(at("2026-11-19")).toEqual([]);
    });

    test("a recipe takes only its own ingredients: another planned recipe's allergen is not its", () => {
        const notices = allergenConditionNotices(
            input({
                foods: [
                    food({ allergens: ["peanut"] }),
                    food({ id: "lettuce", name: "Lettuce", allergens: [] }),
                ],
                recipes: [
                    recipe(),
                    recipe({ id: "r2", name: "Salad" }),
                    recipe({ id: "r3", name: "Soup" }),
                ],
                ingredients: [
                    ingredient(),
                    ingredient({
                        id: "ri2",
                        recipeId: "r2",
                        foodId: "lettuce",
                        displayName: "Lettuce",
                    }),
                    ingredient({
                        id: "ri3",
                        recipeId: "r3",
                        foodId: null,
                        displayName: "Stock",
                    }),
                ],
                plans: [
                    plan(),
                    plan({ id: "p2", recipeId: "r2" }),
                    plan({ id: "p3", recipeId: "r3" }),
                ],
            }),
        );
        expect(notices.map((n) => [n.subject.id, n.params.name])).toEqual([
            ["r1", "Satay"],
        ]);
    });

    test("a recipe that is not planned is not a conflict", () => {
        expect(
            allergenConditionNotices(input({ ...planned, plans: [] })),
        ).toEqual([]);
    });

    test("a planned recipe with no conflicting ingredient is clear", () => {
        expect(
            allergenConditionNotices(
                input({
                    ...planned,
                    members: [member("cy", "Cy", [allergy("cy", "fish")])],
                }),
            ),
        ).toEqual([]);
    });

    test("an ingredient with no food puts the whole recipe on its names", () => {
        // The one catalogued ingredient's food is clear, so only the names can
        // match: a recipe judged on its foods alone would find nothing.
        const [notice] = allergenConditionNotices(
            input({
                foods: [food({ allergens: [] })],
                recipes: [recipe()],
                ingredients: [
                    ingredient({ foodId: "pb", displayName: "Rice" }),
                    ingredient({
                        id: "ri2",
                        foodId: null,
                        displayName: "Peanut sauce",
                    }),
                ],
                plans: [plan()],
            }),
        );
        expect(notice?.code).toBe("recipe.allergen");
        expect(notice?.params.allergens).toEqual(["peanut"]);
    });

    test("every ingredient catalogued: the foods' allergens decide, not the names", () => {
        expect(
            allergenConditionNotices(
                input({
                    foods: [food({ allergens: [] })],
                    recipes: [recipe()],
                    ingredients: [ingredient({ displayName: "Peanut butter" })],
                    plans: [plan()],
                }),
            ),
        ).toEqual([]);
    });

    test("'other' allergens match an ingredient name by label", () => {
        const kiwi = member("kay", "Kay", [allergy("kay", "other", "Kiwi")]);
        const [notice] = allergenConditionNotices(
            input({
                members: [kiwi],
                foods: [food({ id: "k", name: "Kiwi", allergens: [] })],
                recipes: [recipe()],
                ingredients: [
                    ingredient({ foodId: "k", displayName: "Gold kiwi" }),
                ],
                plans: [plan()],
            }),
        );
        expect(notice?.params.allergens).toEqual(["Kiwi"]);
    });

    test("a plan whose recipe is gone is skipped", () => {
        expect(
            allergenConditionNotices(
                input({ ...planned, recipes: [], plans: [plan()] }),
            ),
        ).toEqual([]);
    });
});

describe("food.product_allergen", () => {
    test("a fridge item whose food has a member's allergen", () => {
        const [notice, ...rest] = allergenConditionNotices(
            input({ fridgeItems: [item()] }),
        );
        expect(rest).toEqual([]);
        expect(notice).toEqual({
            code: "food.product_allergen",
            severity: "block",
            subject: { kind: "fridge_item", id: "i1" },
            related: [{ kind: "member", id: "ana", name: "Ana" }],
            params: {
                allergens: ["peanut"],
                name: "Peanut butter",
                foodId: "pb",
            },
        });
        expect(noticeSentence(notice!)).toBe("Contains peanut — Ana.");
    });

    test("an OFF contains tag counts as it does on the product check", () => {
        const [notice] = allergenConditionNotices(
            input({
                members: [BEN],
                foods: [
                    food({
                        allergens: [],
                        offQuality: {
                            nutriscoreGrade: null,
                            novaGroup: null,
                            ecoscoreGrade: null,
                            additives: null,
                            allergensTags: ["en:milk"],
                            tracesTags: null,
                            ingredientsAnalysisTags: null,
                            labelsTags: null,
                            fetchedAt: "2026-01-01T00:00:00.000Z",
                        },
                    }),
                ],
                fridgeItems: [item()],
            }),
        );
        expect(notice?.params.allergens).toEqual(["milk"]);
    });

    test("a trace is not a conflict: the product check files it as a warning", () => {
        expect(
            allergenConditionNotices(
                input({
                    foods: [
                        food({
                            allergens: [],
                            offQuality: {
                                nutriscoreGrade: null,
                                novaGroup: null,
                                ecoscoreGrade: null,
                                additives: null,
                                allergensTags: [],
                                tracesTags: ["en:peanuts"],
                                ingredientsAnalysisTags: null,
                                labelsTags: null,
                                fetchedAt: "2026-01-01T00:00:00.000Z",
                            },
                        }),
                    ],
                    fridgeItems: [item()],
                }),
            ),
        ).toEqual([]);
    });

    test("an 'other' allergen is not read from a product, as on the product check", () => {
        const kiwi = member("kay", "Kay", [allergy("kay", "other", "Peanut")]);
        expect(
            allergenConditionNotices(
                input({ members: [kiwi], fridgeItems: [item()] }),
            ),
        ).toEqual([]);
    });

    test("an item with no food, or a food that is not listed, is not checked", () => {
        expect(
            allergenConditionNotices(
                input({
                    fridgeItems: [
                        item({ foodId: null }),
                        item({ id: "i2", foodId: "gone" }),
                    ],
                }),
            ),
        ).toEqual([]);
    });

    test("each item is its own conflict, every member that conflicts on it", () => {
        const notices = allergenConditionNotices(
            input({
                members: [ANA, BEN],
                fridgeItems: [item(), item({ id: "i2" })],
            }),
        );
        expect(notices.map((n) => n.subject.id)).toEqual(["i1", "i2"]);
        expect(notices[0]?.related.map((r) => r.name)).toEqual(["Ana", "Ben"]);
    });
});

describe("keys", () => {
    const everything = () =>
        input({
            lines: [line()],
            recipes: [recipe()],
            ingredients: [ingredient()],
            plans: [plan()],
            fridgeItems: [item()],
        });

    test("one key per conflict, the same on every read", () => {
        const first = allergenConditionNotices(everything()).map(keyOf);
        expect(first).toEqual([
            "grocery.allergen|grocery_line|l1|",
            "recipe.allergen|recipe|r1|",
            "food.product_allergen|fridge_item|i1|",
        ]);
        expect(allergenConditionNotices(everything()).map(keyOf)).toEqual(
            first,
        );
    });

    test("the key follows the subject, not who or what conflicts", () => {
        const [before] = allergenConditionNotices(input({ lines: [line()] }));
        const [after] = allergenConditionNotices(
            input({
                members: [ANA, BEN],
                foods: [food({ allergens: ["peanut", "milk"] })],
                lines: [line()],
            }),
        );
        expect(keyOf(after!)).toBe(keyOf(before!));
        expect(after?.params.allergens).toEqual(["peanut", "milk"]);
    });

    test("nothing is produced for a household with nothing to conflict", () => {
        expect(
            allergenConditionNotices(
                input({ members: [], lines: [line()], fridgeItems: [item()] }),
            ),
        ).toEqual([]);
    });
});

describe("noticesFor", () => {
    async function setup() {
        const foods = createMemoryFoodsStore();
        const fridge = createMemoryFridgeStore();
        const grocery = createMemoryGroceryStore();
        const pb = await foods.insertFood({
            ...food({ allergens: ["peanut"] }),
            id: crypto.randomUUID(),
        });
        const open = await grocery.insertLine(
            line({ id: crypto.randomUUID(), foodId: pb.id }),
        );
        const ticked = await grocery.insertLine(
            line({ id: crypto.randomUUID(), foodId: pb.id, checked: true }),
        );
        return {
            deps: {
                foods,
                fridge,
                recipes: createMemoryRecipesStore(),
                dismissals: createMemoryNoticeDismissalsStore(),
                grocery,
                plans: createMemoryPlansStore(),
                allergenMembers: async () => [ANA],
            },
            open,
            ticked,
        };
    }

    test("the conditions come only when the caller opts in", async () => {
        const { deps, open } = await setup();
        const off = await noticesFor(deps, HH, { today: TODAY });
        expect(off.notices).toEqual([]);
        const on = await noticesFor(deps, HH, {
            today: TODAY,
            allergens: true,
        });
        expect(
            on.notices.map((n) => [n.code, n.subject.id, n.severity]),
        ).toEqual([["grocery.allergen", open.id, "block"]]);
    });

    test("without the members nothing is produced and nothing breaks", async () => {
        const { deps } = await setup();
        const { allergenMembers: _members, ...bare } = deps;
        const result = await noticesFor(bare, HH, {
            today: TODAY,
            allergens: true,
        });
        expect(result.notices).toEqual([]);
    });

    test("no member with an allergen asks for no plans", async () => {
        const { deps } = await setup();
        const notices = await noticesFor(
            {
                ...deps,
                allergenMembers: async () => [member("zed", "Zed", [])],
                plans: {
                    ...deps.plans,
                    listPlans: async () => {
                        throw new Error("read the plans for no one");
                    },
                },
            },
            HH,
            { today: TODAY, allergens: true },
        );
        expect(notices.notices).toEqual([]);
    });
});

/** The stores `noticesFor` reads, each call counted by `store.method`. */
function counting<T extends object>(
    store: T,
    calls: Map<string, number>,
    name: string,
): T {
    return new Proxy(store, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== "function") return value;
            return (...args: unknown[]) => {
                const key = `${name}.${String(prop)}`;
                calls.set(key, (calls.get(key) ?? 0) + 1);
                return value.apply(target, args);
            };
        },
    });
}

describe("noticesFor reads", () => {
    async function world(members: GroceryAllergenMember[] = [ANA]) {
        const stores = {
            foods: createMemoryFoodsStore(),
            fridge: createMemoryFridgeStore(),
            grocery: createMemoryGroceryStore(),
            recipes: createMemoryRecipesStore(),
            plans: createMemoryPlansStore(),
        };
        const calls = new Map<string, number>();
        const deps = {
            foods: counting(stores.foods, calls, "foods"),
            fridge: counting(stores.fridge, calls, "fridge"),
            grocery: counting(stores.grocery, calls, "grocery"),
            recipes: counting(stores.recipes, calls, "recipes"),
            plans: counting(stores.plans, calls, "plans"),
            dismissals: createMemoryNoticeDismissalsStore(),
            allergenMembers: async () => {
                calls.set("members", (calls.get("members") ?? 0) + 1);
                return members;
            },
        };
        return { stores, deps, calls };
    }

    type World = Awaited<ReturnType<typeof world>>;

    /** A peanut food on the list, in the fridge and in a recipe planned today. */
    async function seedConflicts({ stores }: World) {
        await stores.foods.insertFood(food({ allergens: ["peanut"] }));
        await stores.grocery.insertLine(line());
        await stores.fridge.insertItem(item());
        await stores.recipes.insertRecipe(recipe());
        await stores.recipes.insertIngredient(ingredient());
        await stores.plans.addPlan({
            householdId: HH,
            recipeId: "r1",
            date: TODAY,
            slot: "dinner",
            servings: 2,
            createdBy: null,
        });
    }

    const read = (w: World, allergens: boolean) => {
        w.calls.clear();
        return noticesFor(w.deps, HH, {
            today: TODAY,
            timezone: "UTC",
            actionable: true,
            includeDismissed: true,
            allergens,
        });
    };

    test("the conditions come from what the read loaded: it asks for the members and nothing else", async () => {
        const w = await world();
        await seedConflicts(w);
        const off = await read(w, false);
        const callsOff = new Map(w.calls);
        const on = await read(w, true);
        const callsOn = new Map(w.calls);
        expect(
            on.notices.map((n) => n.code).filter((c) => c.endsWith("allergen")),
        ).toEqual([
            "grocery.allergen",
            "recipe.allergen",
            "food.product_allergen",
        ]);
        expect(off.notices.some((n) => n.code.endsWith("allergen"))).toBe(
            false,
        );
        // Every store is asked the same number of times, the plans once: the
        // seven-day window is read in place of the three-day one, not after it.
        expect(callsOff.get("plans.listPlans")).toBe(1);
        expect(callsOn.get("plans.listPlans")).toBe(1);
        expect(Object.fromEntries(callsOn)).toEqual({
            ...Object.fromEntries(callsOff),
            members: 1,
        });
        // The rest of the read is the same either way.
        expect(on.notices.filter((n) => !n.code.endsWith("allergen"))).toEqual(
            off.notices,
        );
    });

    test("the one-tap notices see the plans of their three days, not the allergen window", async () => {
        const w = await world();
        await seedConflicts(w);
        // A plan on day five is outside the one-tap notices' three days but
        // inside the allergen window: reading the wider one must not change
        // what they say about it (Rice is missing from the fridge and list).
        await w.stores.recipes.insertRecipe(
            recipe({ id: "r4", name: "Later" }),
        );
        await w.stores.recipes.insertIngredient(
            ingredient({
                id: "ri4",
                recipeId: "r4",
                foodId: "rice",
                displayName: "Rice",
            }),
        );
        await w.stores.foods.insertFood(
            foodNamed("rice", "Rice", { allergens: [] }),
        );
        await w.stores.plans.addPlan({
            householdId: HH,
            recipeId: "r4",
            date: "2026-11-16",
            slot: "dinner",
            servings: 2,
            createdBy: null,
        });
        const off = await read(w, false);
        const on = await read(w, true);
        expect(on.notices.filter((n) => !n.code.endsWith("allergen"))).toEqual(
            off.notices,
        );
    });

    test("no one with an allergen: no plans are read unless the one-tap notices want them", async () => {
        const w = await world([member("zed", "Zed", [])]);
        await seedConflicts(w);
        await noticesFor(w.deps, HH, { today: TODAY, allergens: true });
        expect(w.calls.get("members")).toBe(1);
        expect(w.calls.get("plans.listPlans")).toBeUndefined();
        const on = await read(w, true);
        expect(w.calls.get("plans.listPlans")).toBe(1);
        expect(on.notices.some((n) => n.code.endsWith("allergen"))).toBe(false);
    });

    test("a plain food carries its usual product's allergen onto its lines and items", async () => {
        const w = await world();
        await w.stores.foods.insertFood(
            foodNamed("granola", "Granola", {
                allergens: [],
                usualProductId: "crunchy",
            }),
        );
        await w.stores.foods.insertFood(
            foodNamed("crunchy", "Crunchy Granola", {
                allergens: ["peanut"],
                genericFoodId: "granola",
            }),
        );
        await w.stores.grocery.insertLine(
            line({ foodId: "granola", displayName: "Granola" }),
        );
        await w.stores.fridge.insertItem(
            item({ foodId: "granola", displayName: "Granola" }),
        );
        const { notices } = await noticesFor(w.deps, HH, {
            today: TODAY,
            allergens: true,
        });
        expect(notices.map((n) => [n.code, n.subject.kind])).toEqual([
            ["grocery.allergen", "grocery_line"],
            ["food.product_allergen", "fridge_item"],
        ]);
    });

    test("a line or item on a food the catalog no longer lists is still checked", async () => {
        const w = await world();
        await w.stores.foods.insertFood(
            food({
                allergens: ["peanut"],
                archivedAt: "2026-11-01T00:00:00.000Z",
            }),
        );
        await w.stores.grocery.insertLine(line());
        await w.stores.fridge.insertItem(item());
        const { notices } = await noticesFor(w.deps, HH, {
            today: TODAY,
            allergens: true,
        });
        expect(notices.map((n) => n.code).sort()).toEqual([
            "food.product_allergen",
            "grocery.allergen",
        ]);
        // That one food, read once.
        expect(w.calls.get("foods.getFoodsByIds")).toBe(1);
    });

    test("a planned recipe whose ingredient food is no longer listed is still judged on that food", async () => {
        const w = await world();
        await w.stores.foods.insertFood(
            foodNamed("spread", "Nut spread", {
                allergens: ["peanut"],
                archivedAt: "2026-11-01T00:00:00.000Z",
            }),
        );
        await w.stores.recipes.insertRecipe(recipe());
        await w.stores.recipes.insertIngredient(
            ingredient({ foodId: "spread", displayName: "Spread" }),
        );
        await w.stores.plans.addPlan({
            householdId: HH,
            recipeId: "r1",
            date: TODAY,
            slot: "dinner",
            servings: 2,
            createdBy: null,
        });
        const { notices } = await noticesFor(w.deps, HH, {
            today: TODAY,
            allergens: true,
        });
        expect(
            notices
                .filter((n) => n.code.endsWith("allergen"))
                .map((n) => [n.code, n.subject.id]),
        ).toEqual([["recipe.allergen", "r1"]]);
    });
});

describe("a plan that names people", () => {
    const CAL = member("cal", "Cal", []);
    async function allergenNotices(plans: Partial<RecipePlan>[]) {
        const stores = {
            foods: createMemoryFoodsStore(),
            fridge: createMemoryFridgeStore(),
            grocery: createMemoryGroceryStore(),
            recipes: createMemoryRecipesStore(),
            plans: createMemoryPlansStore(),
        };
        await stores.foods.insertFood(food({ allergens: ["peanut"] }));
        await stores.recipes.insertRecipe(recipe({ yieldPortions: 4 }));
        await stores.recipes.insertIngredient(ingredient());
        for (const over of plans) {
            await stores.plans.addPlan({
                householdId: HH,
                recipeId: "r1",
                date: TODAY,
                slot: "dinner",
                servings: 4,
                createdBy: null,
                ...over,
            });
        }
        const { notices } = await noticesFor(
            {
                ...stores,
                variants: createMemoryVariantsStore(),
                dismissals: createMemoryNoticeDismissalsStore(),
                allergenMembers: async () => [ANA, CAL],
            },
            HH,
            {
                today: TODAY,
                timezone: "UTC",
                actionable: true,
                allergens: true,
            },
        );
        return notices.filter((n) => n.code === "recipe.allergen");
    }

    test("a plan for Cal alone warns nobody: Ana is not eating it, whatever it stores", async () => {
        expect(await allergenNotices([{ memberIds: ["cal"] }])).toEqual([]);
    });

    test("a plan for Ana warns, and a plan for nobody warns for the whole household", async () => {
        expect(await allergenNotices([{ memberIds: ["ana"] }])).toHaveLength(1);
        expect(await allergenNotices([{ memberIds: [] }])).toHaveLength(1);
    });
});
