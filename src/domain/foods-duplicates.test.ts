import { describe, expect, test } from "bun:test";
import {
    createMemoryFoodsStore,
    duplicatePairs,
    looseFoodKey,
    newFood,
    normalizeFoodName,
    type Food,
} from "./foods.js";

const HH = "hh-dup";
const HH2 = "hh-dup-2";

function refMap(entries: { id: string; count: number }[]): Map<string, number> {
    return new Map(entries.map((e) => [e.id, e.count]));
}

function withUniqueNorm(f: Food): Food {
    return {
        ...f,
        normalizedName: `${looseFoodKey(f.name)}-${crypto.randomUUID().slice(0, 8)}`,
    };
}

async function insert(
    store: ReturnType<typeof createMemoryFoodsStore>,
    f: Food,
) {
    return store.insertFood(withUniqueNorm(f));
}

describe("duplicatePairs", () => {
    test('"All purpose flour" variants merge', async () => {
        const store = createMemoryFoodsStore();
        const a = await insert(store, {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "All purpose flour",
            }),
            createdAt: "2026-01-02T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
        });
        const b = await insert(store, {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "all-purpose flour",
            }),
            createdAt: "2026-03-04T00:00:00.000Z",
            updatedAt: "2026-03-04T00:00:00.000Z",
        });
        const foods = await store.listFoods(HH);
        const refs = refMap([
            { id: a.id, count: 5 },
            { id: b.id, count: 2 },
        ]);
        const { merges, skipped } = duplicatePairs(foods, refs);
        expect(skipped).toEqual([]);
        expect(merges).toHaveLength(1);
        expect(merges[0]!.keep.id).toBe(a.id);
        expect(merges[0]!.drop.id).toBe(b.id);
        expect(merges[0]!.reason).toContain("more references");
    });

    test("three spellings → two merges, same keep", async () => {
        const store = createMemoryFoodsStore();
        const t1 = "2026-01-01T00:00:00.000Z";
        const t2 = "2026-01-02T00:00:00.000Z";
        const t3 = "2026-01-03T00:00:00.000Z";
        const a = await insert(store, {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "All purpose flour",
            }),
            createdAt: t1,
            updatedAt: t1,
        });
        const b = await insert(store, {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "all-purpose flour",
            }),
            createdAt: t2,
            updatedAt: t2,
        });
        const c = await insert(store, {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "All-Purpose  Flour",
            }),
            createdAt: t3,
            updatedAt: t3,
        });
        const foods = await store.listFoods(HH);
        const refs = refMap([
            { id: a.id, count: 3 },
            { id: b.id, count: 2 },
            { id: c.id, count: 1 },
        ]);
        const { merges, skipped } = duplicatePairs(foods, refs);
        expect(merges).toHaveLength(2);
        expect(skipped).toEqual([]);
        expect(merges[0]!.keep.id).toBe(a.id);
        expect(merges[1]!.keep.id).toBe(a.id);
        expect(merges[1]!.drop.id).toBe(c.id);
    });

    test("accumulated state: D1 fills gramsPerEach, D2 conflicts", async () => {
        const store = createMemoryFoodsStore();
        const tKeep = "2026-01-01T00:00:00.000Z";
        const tD1 = "2026-01-02T00:00:00.000Z";
        const tD2 = "2026-01-03T00:00:00.000Z";
        const keep = await insert(store, {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "Sugar",
            }),
            createdAt: tKeep,
            updatedAt: tKeep,
        });
        const d1 = await insert(store, {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "sugar",
                gramsPerEach: 50,
            }),
            createdAt: tD1,
            updatedAt: tD1,
        });
        const d2 = await insert(store, {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "SUGAR",
                gramsPerEach: 60,
            }),
            createdAt: tD2,
            updatedAt: tD2,
        });
        const foods = await store.listFoods(HH);
        const refs = refMap([
            { id: keep.id, count: 1 },
            { id: d1.id, count: 0 },
            { id: d2.id, count: 0 },
        ]);
        const { merges, skipped } = duplicatePairs(foods, refs);
        expect(merges).toHaveLength(1);
        expect(skipped).toHaveLength(1);
        expect(skipped[0]!.reason).toBe("grams per each differ: 50 vs 60");
        expect(merges[0]!.fieldsFilled).toContain("gramsPerEach");
    });

    test("ledger default unit: blank keep vs each drop skips as g vs each", async () => {
        const store = createMemoryFoodsStore();
        const keep = await insert(store, {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "Beans",
            }),
            defaultUnit: "",
        });
        const drop = await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "beans",
                defaultUnit: "each",
                gramsPerEach: 30,
            }),
        );
        const foods = await store.listFoods(HH);
        const { merges, skipped } = duplicatePairs(
            foods.filter((f) => f.id === keep.id || f.id === drop.id),
            refMap([
                { id: keep.id, count: 1 },
                { id: drop.id, count: 0 },
            ]),
        );
        expect(merges).toHaveLength(0);
        expect(skipped).toHaveLength(1);
        expect(skipped[0]!.reason).toBe("default unit differs: g vs each");
    });

    test("egg / eggs → no pair (different loose keys)", async () => {
        const store = createMemoryFoodsStore();
        await insert(
            store,
            newFood({ householdId: HH, kind: "food", name: "egg" }),
        );
        await insert(
            store,
            newFood({ householdId: HH, kind: "food", name: "eggs" }),
        );
        const foods = await store.listFoods(HH);
        const { merges, skipped } = duplicatePairs(foods, new Map());
        expect(merges).toHaveLength(0);
        expect(skipped).toHaveLength(0);
    });

    test("same loose name food vs supply → different groups", async () => {
        const store = createMemoryFoodsStore();
        await insert(
            store,
            newFood({ householdId: HH, kind: "food", name: "Tape" }),
        );
        await insert(
            store,
            newFood({ householdId: HH, kind: "supply", name: "tape" }),
        );
        const foods = await store.listFoods(HH);
        const { merges } = duplicatePairs(foods, new Map());
        expect(merges).toHaveLength(0);
    });

    test("brand mismatch skips; trim and null merge", async () => {
        const store = createMemoryFoodsStore();
        const acme1 = await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "Milk",
                brand: "Acme",
            }),
        );
        const other = await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "milk",
                brand: "Other",
            }),
        );
        let foods = await store.listFoods(HH);
        expect(duplicatePairs(foods, new Map()).merges).toHaveLength(0);

        const acme2 = await insert(store, {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "Milk",
            }),
            brand: " Acme ",
        });
        foods = await store.listFoods(HH);
        const m1 = duplicatePairs(
            foods.filter((f) => f.id === acme1.id || f.id === acme2.id),
            new Map(),
        );
        expect(m1.merges).toHaveLength(1);

        const plain = await insert(store, {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "Water",
            }),
            brand: "",
        });
        const nullBrand = await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "water",
                brand: null,
            }),
        );
        foods = await store.listFoods(HH);
        const m2 = duplicatePairs(
            foods.filter((f) => f.id === plain.id || f.id === nullBrand.id),
            new Map(),
        );
        expect(m2.merges).toHaveLength(1);
        void other;
    });

    test("archived and generic foods ignored as candidates", async () => {
        const store = createMemoryFoodsStore();
        const older = "2026-01-01T00:00:00.000Z";
        const newer = "2026-02-01T00:00:00.000Z";
        const rolled = "2026-01-15T00:00:00.000Z";
        const live = await insert(store, {
            ...newFood({ householdId: HH, kind: "food", name: "Oats" }),
            createdAt: older,
            updatedAt: older,
        });
        const archived = await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "Oats archived seed",
            }),
        );
        await store.updateFoodRow({
            ...archived,
            name: "oats",
            normalizedName: normalizeFoodName("oats-arch"),
            archivedAt: "2025-01-01T00:00:00.000Z",
        });
        const plain = await insert(store, {
            ...newFood({ householdId: HH, kind: "food", name: "Oats B" }),
            createdAt: newer,
            updatedAt: newer,
        });
        await store.updateFoodRow({
            ...(await store.getFood(HH, plain.id))!,
            name: "Oats",
        });
        const rolledOats = await insert(store, {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "Rolled oats",
            }),
            createdAt: rolled,
            updatedAt: rolled,
        });
        const product = await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "OATS",
                genericFoodId: rolledOats.id,
            }),
        );
        const foods = await store.listFoods(HH);
        const { merges } = duplicatePairs(foods, new Map());
        expect(merges).toHaveLength(1);
        expect(merges[0]!.drop.id).not.toBe(product.id);
        expect(merges[0]!.keep.id).toBe(live.id);
        for (const m of merges) {
            expect(m.keep.id).not.toBe(product.id);
            expect(m.drop.id).not.toBe(product.id);
        }
    });

    test("drop name already another food’s alias → skip", async () => {
        const store = createMemoryFoodsStore();
        const tKeep = "2026-01-01T00:00:00.000Z";
        const tOther = "2026-01-02T00:00:00.000Z";
        const tDup = "2026-01-03T00:00:00.000Z";
        const ap = await insert(store, {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "All purpose flour",
            }),
            createdAt: tKeep,
            updatedAt: tKeep,
        });
        const other = await insert(store, {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "Bread flour",
            }),
            createdAt: tOther,
            updatedAt: tOther,
        });
        await store.setAlias(
            HH,
            normalizeFoodName("all-purpose flour"),
            other.id,
        );
        const dup = await insert(store, {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "all-purpose flour",
            }),
            createdAt: tDup,
            updatedAt: tDup,
        });
        const foods = await store.listFoods(HH);
        const aliasMap = await store.listAllAliases(HH);
        const { merges, skipped } = duplicatePairs(foods, new Map(), aliasMap);
        expect(merges).toHaveLength(0);
        expect(skipped).toHaveLength(1);
        expect(skipped[0]!.reason).toBe(
            `"${dup.name}" is already another name for "${other.name}"`,
        );
        void ap;
    });

    test("conflicting calories skipped; asymmetric protein skips", async () => {
        const store = createMemoryFoodsStore();
        const k = await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "Soup",
                calories: 100,
                proteinG: 5,
            }),
        );
        const d = await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "soup",
                calories: 90,
            }),
        );
        let foods = await store.listFoods(HH);
        let r = duplicatePairs(foods, new Map());
        expect(r.skipped[0]!.reason).toContain("calories");
        expect(r.skipped[0]!.reason).toContain("100");
        expect(r.skipped[0]!.reason).toContain("90");

        const k2 = await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "Stew",
                calories: 50,
                proteinG: 3,
            }),
        );
        const d2 = await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "stew",
                calories: 50,
            }),
        );
        foods = await store.listFoods(HH);
        r = duplicatePairs(
            foods.filter((f) => f.id === k2.id || f.id === d2.id),
            new Map(),
        );
        expect(r.skipped[0]!.reason).toContain("protein");

        const k3 = await insert(
            store,
            newFood({ householdId: HH, kind: "food", name: "Jam" }),
        );
        const d3 = await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "jam",
                calories: 200,
            }),
        );
        foods = await store.listFoods(HH);
        r = duplicatePairs(
            foods.filter((f) => f.id === k3.id || f.id === d3.id),
            refMap([
                { id: k3.id, count: 2 },
                { id: d3.id, count: 1 },
            ]),
        );
        expect(r.merges).toHaveLength(1);
        expect(r.merges[0]!.fieldsFilled).toContain("calories");
        void k;
        void d;
    });

    test("unit factors in fieldsFilled; default unit conflict", async () => {
        const store = createMemoryFoodsStore();
        const k = await insert(
            store,
            newFood({ householdId: HH, kind: "food", name: "Oil" }),
        );
        const d = await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "oil",
                gramsPerMl: 0.9,
            }),
        );
        const foods = await store.listFoods(HH);
        const r = duplicatePairs(
            foods.filter((f) => f.id === k.id || f.id === d.id),
            refMap([
                { id: k.id, count: 1 },
                { id: d.id, count: 0 },
            ]),
        );
        expect(r.merges[0]!.fieldsFilled).toContain("gramsPerMl");

        const a = await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "Honey",
                defaultUnit: "g",
            }),
        );
        const b = await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "honey",
                defaultUnit: "each",
            }),
        );
        const foods2 = await store.listFoods(HH);
        const r2 = duplicatePairs(
            foods2.filter((f) => f.id === a.id || f.id === b.id),
            new Map(),
        );
        expect(r2.skipped[0]!.reason.startsWith("default unit differs")).toBe(
            true,
        );
    });

    test("allergens merge lists fieldsFilled", async () => {
        const store = createMemoryFoodsStore();
        const k = await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "Nut mix",
                allergens: ["peanut"],
            }),
        );
        const d = await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "nut mix",
                allergens: ["tree_nut"],
            }),
        );
        const foods = await store.listFoods(HH);
        const { merges } = duplicatePairs(
            foods.filter((f) => f.id === k.id || f.id === d.id),
            new Map(),
        );
        expect(merges[0]!.fieldsFilled).toContain("allergens");
    });

    test("both have products / usual products → skip", async () => {
        const store = createMemoryFoodsStore();
        const plainA = await insert(
            store,
            newFood({ householdId: HH, kind: "food", name: "Rice" }),
        );
        const plainB = await insert(
            store,
            newFood({ householdId: HH, kind: "food", name: "rice" }),
        );
        await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "Brand A",
                genericFoodId: plainA.id,
            }),
        );
        await insert(
            store,
            newFood({
                householdId: HH,
                kind: "food",
                name: "Brand B",
                genericFoodId: plainB.id,
            }),
        );
        const foods = await store.listFoods(HH);
        const r = duplicatePairs(foods, new Map());
        expect(r.skipped[0]!.reason).toBe("both have products");

        const u1 = crypto.randomUUID();
        const u2 = crypto.randomUUID();
        const u3 = crypto.randomUUID();
        const u4 = crypto.randomUUID();
        const p1: Food = {
            ...newFood({ householdId: HH, kind: "food", name: "Beans" }),
            id: u1,
            normalizedName: `beans-x-${u1.slice(0, 8)}`,
            usualProductId: u3,
        };
        const p2: Food = {
            ...newFood({ householdId: HH, kind: "food", name: "beans" }),
            id: u2,
            normalizedName: `beans-y-${u2.slice(0, 8)}`,
            usualProductId: u4,
        };
        const catalog: Food[] = [
            p1,
            p2,
            {
                ...newFood({
                    householdId: HH,
                    kind: "food",
                    name: "Usual for one",
                    genericFoodId: null,
                }),
                id: u3,
                normalizedName: `usual-can-${u3.slice(0, 8)}`,
            },
            {
                ...newFood({
                    householdId: HH,
                    kind: "food",
                    name: "Usual for two",
                    genericFoodId: null,
                }),
                id: u4,
                normalizedName: `usual-can2-${u4.slice(0, 8)}`,
            },
        ];
        const r2 = duplicatePairs(catalog, new Map());
        expect(r2.skipped[0]!.reason).toBe("both have a usual product");
    });

    test("keep choice: refs, createdAt, id", () => {
        const mk = (id: string, name: string, createdAt: string): Food => ({
            ...newFood({ householdId: HH, kind: "food", name }),
            id,
            normalizedName: `${looseFoodKey(name)}-${id}`,
            createdAt,
            updatedAt: createdAt,
        });

        const foods: Food[] = [
            mk("a", "Salt", "2026-02-01T00:00:00.000Z"),
            mk("b", "salt", "2026-01-01T00:00:00.000Z"),
        ];
        const refs = refMap([
            { id: "a", count: 1 },
            { id: "b", count: 3 },
        ]);
        const { merges } = duplicatePairs(foods, refs);
        expect(merges[0]!.keep.id).toBe("b");
        expect(merges[0]!.reason).toContain("more references");

        const foods2: Food[] = [
            mk("c", "Pepper", "2026-01-02T00:00:00.000Z"),
            mk("d", "pepper", "2026-03-04T00:00:00.000Z"),
        ];
        const refs2 = refMap([
            { id: "c", count: 2 },
            { id: "d", count: 2 },
        ]);
        const r2 = duplicatePairs(foods2, refs2);
        expect(r2.merges[0]!.keep.id).toBe("c");
        expect(r2.merges[0]!.reason).toBe(
            "same references, older (2026-01-02 vs 2026-03-04)",
        );

        const foodsSameDay: Food[] = [
            mk("g", "Cocoa", "2026-06-01T10:00:00.000Z"),
            mk("h", "cocoa", "2026-06-01T12:00:00.000Z"),
        ];
        const rSameDay = duplicatePairs(
            foodsSameDay,
            refMap([
                { id: "g", count: 1 },
                { id: "h", count: 1 },
            ]),
        );
        expect(rSameDay.merges[0]!.keep.id).toBe("g");
        expect(rSameDay.merges[0]!.reason).toBe(
            "same references, older (2026-06-01T10:00:00.000Z vs 2026-06-01T12:00:00.000Z)",
        );

        const foods3: Food[] = [
            mk("e", "Mint", "2026-01-01T00:00:00.000Z"),
            mk("f", "mint", "2026-01-01T00:00:00.000Z"),
        ];
        const refs3 = refMap([
            { id: "e", count: 1 },
            { id: "f", count: 1 },
        ]);
        const r3 = duplicatePairs(foods3, refs3);
        expect(r3.merges[0]!.keep.id).toBe("e");
        expect(r3.merges[0]!.reason).toContain("lower id");
    });

    test("multi-household: groups do not cross", async () => {
        const store = createMemoryFoodsStore();
        await insert(store, {
            ...newFood({ householdId: HH, kind: "food", name: "Sugar" }),
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });
        await insert(store, {
            ...newFood({ householdId: HH, kind: "food", name: "sugar" }),
            createdAt: "2026-01-02T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
        });
        await insert(store, {
            ...newFood({ householdId: HH2, kind: "food", name: "Sugar" }),
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });
        await insert(store, {
            ...newFood({ householdId: HH2, kind: "food", name: "sugar" }),
            createdAt: "2026-01-02T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
        });
        const foods = [
            ...(await store.listFoods(HH)),
            ...(await store.listFoods(HH2)),
        ];
        const { merges } = duplicatePairs(foods, new Map());
        expect(merges).toHaveLength(2);
        const hhIds = new Set(merges.map((m) => m.keep.householdId));
        expect(hhIds.has(HH)).toBe(true);
        expect(hhIds.has(HH2)).toBe(true);
    });
    test("an alias planned earlier in the run blocks a later group", async () => {
        const store = createMemoryFoodsStore();
        const old = "2026-01-01T00:00:00.000Z";
        const later = "2026-02-01T00:00:00.000Z";
        const rows: Food[] = [];
        for (const brand of [null, "King Arthur"]) {
            rows.push(
                await insert(store, {
                    ...newFood({
                        householdId: HH,
                        kind: "food",
                        name: "All purpose flour",
                    }),
                    brand,
                    createdAt: old,
                }),
                await insert(store, {
                    ...newFood({
                        householdId: HH,
                        kind: "food",
                        name: "all-purpose flour",
                    }),
                    brand,
                    createdAt: later,
                }),
            );
        }
        const foods = await store.listFoods(HH);
        const { merges, skipped } = duplicatePairs(foods, new Map());
        expect(merges).toHaveLength(1);
        expect(merges[0]!.keep.brand).toBeNull();
        expect(merges[0]!.drop.id).toBe(rows[1]!.id);
        expect(skipped).toHaveLength(1);
        expect(skipped[0]!.drop.id).toBe(rows[3]!.id);
        expect(skipped[0]!.reason).toBe(
            '"all-purpose flour" is already another name for "All purpose flour"',
        );
    });
});
