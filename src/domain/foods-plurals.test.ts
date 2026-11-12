import { expect, test } from "bun:test";
import {
    createMemoryFoodsStore,
    duplicatePairs,
    findManualFood,
    findUpsertFoodByName,
    looseFoodKey,
    newFood,
    pluralFreeFoodKey,
    resolveFoodForWrite,
    similarFoodsForNames,
    SimilarFoodsError,
    type Food,
    type FoodsStore,
} from "./foods.js";

const HH = "hh-plurals";

async function seeded(names: string[], plurals: boolean) {
    const store = createMemoryFoodsStore();
    store.setPluralsSameFood(HH, plurals);
    const foods: Food[] = [];
    for (const name of names) {
        foods.push(
            await store.insertFood(
                newFood({ householdId: HH, kind: "food", name }),
            ),
        );
    }
    return { store, foods };
}

test("pluralFreeFoodKey pairs regular singulars and plurals", () => {
    const pairs: [string, string][] = [
        ["Egg", "Eggs"],
        ["berry", "berries"],
        ["cookie", "cookies"],
        ["pie", "pies"],
        ["peach", "peaches"],
        ["quiche", "quiches"],
        ["glass", "glasses"],
        ["tomato", "tomatoes"],
        ["kiwi", "kiwis"],
        ["anchovy", "anchovies"],
        ["cheese", "cheeses"],
        ["Green onion", "green onions"],
        ["Brussels sprouts", "brussel sprout"],
        ["french fry", "french fries"],
        ["roe", "roes"],
        ["axe", "axes"],
    ];
    for (const [a, b] of pairs) {
        expect(pluralFreeFoodKey(a)).toBe(pluralFreeFoodKey(b));
    }
});

test("pluralFreeFoodKey leaves -ss, -us and irregular plurals apart", () => {
    expect(pluralFreeFoodKey("Hummus")).toBe("hummus");
    expect(pluralFreeFoodKey("couscous")).toBe("couscous");
    expect(pluralFreeFoodKey("cress")).toBe("cress");
    expect(pluralFreeFoodKey("jus")).toBe("jus");
    expect(pluralFreeFoodKey("Swiss chard")).toBe("swiss chard");
    expect(pluralFreeFoodKey("Asparagus")).toBe("asparagus");
    expect(pluralFreeFoodKey("molasses")).toBe("molasses");
    expect(pluralFreeFoodKey("bass")).not.toBe(pluralFreeFoodKey("base"));
    expect(pluralFreeFoodKey("leaf")).not.toBe(pluralFreeFoodKey("leaves"));
    expect(pluralFreeFoodKey("cook")).not.toBe(pluralFreeFoodKey("cookies"));
    expect(pluralFreeFoodKey("  ")).toBe("");
});

test("pluralFreeFoodKey probe pairs stay aligned", () => {
    const pairs: [string, string][] = [
        ["egg", "eggs"],
        ["potato", "potatoes"],
        ["radish", "radishes"],
        ["box", "boxes"],
        ["cherry", "cherries"],
        ["lentils", "lentil"],
        ["noodle", "noodles"],
        ["oats", "oat"],
        ["tomato", "tomatoes"],
        ["peach", "peaches"],
        ["berry", "berries"],
        ["glass", "glasses"],
        ["base", "bases"],
        ["rose", "roses"],
        ["sauce", "sauces"],
        ["cheese", "cheeses"],
    ];
    for (const [a, b] of pairs) {
        expect(pluralFreeFoodKey(a)).toBe(pluralFreeFoodKey(b));
    }
});

// Pairs a singulariser would join but a household may mean as two foods.
const FALSE_FRIENDS: [string, string][] = [
    ["Date", "Dates"],
    ["Green", "Greens"],
    ["Glass", "Glasses"],
    ["Chip", "Chips"],
    ["Green", "greens"],
];

test("false friends stay distinct with the setting off", async () => {
    for (const [existing, typed] of FALSE_FRIENDS) {
        const { store } = await seeded([existing], false);
        expect(looseFoodKey(existing)).not.toBe(looseFoodKey(typed));
        expect(await findManualFood(store, HH, "food", typed)).toBeNull();
        const resolved = await findUpsertFoodByName(
            store,
            HH,
            "food",
            typed,
            null,
        );
        expect(resolved.kind).toBe("create");
        const created = await resolveFoodForWrite(
            store,
            HH,
            "food",
            { name: typed },
            undefined,
            { onSimilar: "create" },
        );
        expect(created.name).toBe(typed);
        expect(await store.listFoods(HH)).toHaveLength(2);
    }
});

test("setting off: egg is only suggested as Eggs, never matched", async () => {
    const { store, foods } = await seeded(["Eggs"], false);
    expect(await findManualFood(store, HH, "food", "egg")).toBeNull();
    const err = await resolveFoodForWrite(
        store,
        HH,
        "food",
        { name: "egg" },
        undefined,
        { onSimilar: "ask" },
    ).then(
        () => null,
        (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SimilarFoodsError);
    const entries = (err as SimilarFoodsError).entries;
    expect(entries[0]!.candidates[0]!.food.id).toBe(foods[0]!.id);
    expect(await store.listFoods(HH)).toHaveLength(1);
});

test("setting on: egg resolves to Eggs without asking", async () => {
    const { store, foods } = await seeded(["Eggs"], true);
    const eggs = foods[0]!;
    expect((await findManualFood(store, HH, "food", "egg"))?.id).toBe(eggs.id);
    const resolved = await resolveFoodForWrite(
        store,
        HH,
        "food",
        { name: "egg" },
        undefined,
        { onSimilar: "ask" },
    );
    expect(resolved.id).toBe(eggs.id);
    expect(resolved.name).toBe("Eggs");
    expect(await findUpsertFoodByName(store, HH, "food", "egg", null)).toEqual({
        kind: "existing",
        food: expect.objectContaining({ id: eggs.id }),
    });
    expect(await similarFoodsForNames(store, HH, "food", ["egg"])).toEqual([]);
    expect(await store.listFoods(HH)).toHaveLength(1);
});

test("setting on: the exact spelling wins over its plural", async () => {
    const { store, foods } = await seeded(["Egg", "Eggs"], true);
    const [egg, eggs] = foods;
    expect((await findManualFood(store, HH, "food", "eggs"))?.id).toBe(
        eggs!.id,
    );
    expect((await findManualFood(store, HH, "food", "EGG"))?.id).toBe(egg!.id);
});

test("setting on: an irregular plural still creates its own food", async () => {
    const { store } = await seeded(["Bay leaf"], true);
    expect(await findManualFood(store, HH, "food", "Bay leaves")).toBeNull();
});

test("setting on: a branded plural is not reused for a plain name", async () => {
    const store = createMemoryFoodsStore();
    store.setPluralsSameFood(HH, true);
    await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs", brand: "Acme" }),
    );
    const resolved = await findUpsertFoodByName(store, HH, "food", "egg", null);
    expect(resolved.kind).toBe("create");
});

test("setting on is per household", async () => {
    const { store } = await seeded(["Eggs"], true);
    await store.insertFood(
        newFood({ householdId: "other", kind: "food", name: "Eggs" }),
    );
    expect(await findManualFood(store, "other", "food", "egg")).toBeNull();
});

test("a store without the setting behaves as off", async () => {
    const memory = createMemoryFoodsStore();
    memory.setPluralsSameFood(HH, true);
    await memory.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    const { pluralsSameFood: _drop, ...rest } = memory;
    const store: FoodsStore = rest;
    expect(await findManualFood(store, HH, "food", "egg")).toBeNull();
});

function food(name: string, extra: Partial<Food> = {}): Food {
    return {
        ...newFood({ householdId: HH, kind: "food", name }),
        ...extra,
    };
}

test("duplicatePairs lists plural pairs only with plurals on", () => {
    const egg = food("Egg", { createdAt: "2026-01-01T00:00:00.000Z" });
    const eggs = food("Eggs", { createdAt: "2026-01-02T00:00:00.000Z" });
    const refs = new Map<string, number>();
    expect(duplicatePairs([egg, eggs], refs).merges).toEqual([]);
    const on = duplicatePairs([egg, eggs], refs, new Map(), { plurals: true });
    expect(on.merges).toHaveLength(1);
    expect(on.merges[0]!.keep.id).toBe(egg.id);
    expect(on.merges[0]!.drop.id).toBe(eggs.id);
});

test("duplicatePairs plural pairs follow the same agree-or-skip rules", () => {
    const greens = food("Greens", { calories: 20 });
    const green = food("Green", { calories: 35 });
    const report = duplicatePairs([greens, green], new Map(), new Map(), {
        plurals: true,
    });
    expect(report.merges).toEqual([]);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]!.reason).toContain("calories differ");
});

test("duplicatePairs with plurals on keeps false friends of other kinds apart", () => {
    const glass = food("Glass", { kind: "supply" });
    const glasses = food("Glasses");
    const report = duplicatePairs([glass, glasses], new Map(), new Map(), {
        plurals: true,
    });
    expect(report.merges).toEqual([]);
    expect(report.skipped).toEqual([]);
});
