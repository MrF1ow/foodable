import { expect, mock, test } from "bun:test";
import { addLocation, createMemoryFridgeStore } from "./fridge.js";
import {
    createMemoryFoodsStore,
    ledgerDefaultUnit,
    looseFoodKey,
    mergeFoods,
    newFood,
    normalizeFoodName,
    type Food,
    type MemoryFoodsStore,
} from "./foods.js";
import {
    addFridgeItemAdjust,
    createMemoryStockStore,
    ledgerMatchesStock,
} from "./stock.js";
import {
    formatMergeJobReport,
    runMergeJob,
    type MergeJobDeps,
} from "./food-merge-job.js";

const HH = "hh-job";

function withUniqueNorm(f: Food): Food {
    return {
        ...f,
        normalizedName: `${looseFoodKey(f.name)}-${crypto.randomUUID().slice(0, 8)}`,
    };
}

function copyFoodRow(f: Food): Food {
    return {
        ...f,
        allergens: [...f.allergens],
    };
}

async function snapshotStores(
    foods: MemoryFoodsStore,
    fridge: ReturnType<typeof createMemoryFridgeStore>,
    stock: ReturnType<typeof createMemoryStockStore>,
) {
    const listed = (await foods.listFoods(HH))
        .map(copyFoodRow)
        .sort((a, b) => a.id.localeCompare(b.id));
    const aliases = await foods.listAllAliases(HH);
    const aliasSnapshot = [...aliases.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, list]) => [id, [...list].sort()] as const);
    const refs = [...foods.refs]
        .map((r) => ({ ...r }))
        .sort((a, b) => {
            const byFood = a.foodId.localeCompare(b.foodId);
            if (byFood !== 0) return byFood;
            return JSON.stringify(a).localeCompare(JSON.stringify(b));
        });
    const fridgeItems = (await fridge.listItems(HH))
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id));
    const movements = (await stock.listMovements(HH))
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id));
    return {
        foods: listed,
        aliases: aliasSnapshot,
        refs,
        fridge: fridgeItems,
        movements,
    };
}

test("dry run: no writes, merge never called", async () => {
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    foods.linkRefs(fridge);
    foods.linkRefs(stock);

    const keep = await foods.insertFood(
        withUniqueNorm(
            newFood({ householdId: HH, kind: "food", name: "Merge me" }),
        ),
    );
    const drop = await foods.insertFood(
        withUniqueNorm(
            newFood({ householdId: HH, kind: "food", name: "merge-me" }),
        ),
    );
    foods.trackRef(keep.id, HH);
    foods.trackRef(drop.id, HH);
    const loc = await addLocation(fridge, HH, "Pantry");
    for (const food of [keep, drop]) {
        await addFridgeItemAdjust(fridge, stock, foods, {
            householdId: HH,
            foodId: food.id,
            amount: 40,
            unit: "g",
            locationId: loc.id,
        });
    }

    const before = await snapshotStores(foods, fridge, stock);
    expect(before.fridge).toHaveLength(2);
    expect(before.movements).toHaveLength(2);
    const mergeMock = mock((_h: string, _k: string, _d: string) =>
        Promise.reject(new Error("merge should not run")),
    );

    const report = await runMergeJob(
        {
            listHouseholdIds: async () => [HH],
            store: foods,
            merge: mergeMock as MergeJobDeps["merge"],
        },
        { apply: false },
    );

    expect(mergeMock).not.toHaveBeenCalled();
    expect(await snapshotStores(foods, fridge, stock)).toEqual(before);
    expect(report.households[0]!.merges.length).toBeGreaterThan(0);
});

test("apply: merges dry-run pairs, alias and ledger consistent", async () => {
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    foods.linkRefs(fridge);
    foods.linkRefs(stock);
    const loc = await addLocation(fridge, HH, "Pantry");

    const older = "2026-01-01T00:00:00.000Z";
    const newer = "2026-02-01T00:00:00.000Z";
    const keep = await foods.insertFood({
        ...withUniqueNorm(
            newFood({ householdId: HH, kind: "food", name: "Dup oats x" }),
        ),
        createdAt: older,
        updatedAt: older,
    });
    const drop = await foods.insertFood({
        ...withUniqueNorm(
            newFood({ householdId: HH, kind: "food", name: "dup-oats-x" }),
        ),
        createdAt: newer,
        updatedAt: newer,
    });
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: keep.id,
        amount: 100,
        unit: "g",
        locationId: loc.id,
    });
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: drop.id,
        amount: 50,
        unit: "g",
        locationId: loc.id,
    });

    const dry = await runMergeJob(
        {
            listHouseholdIds: async () => [HH],
            store: foods,
            merge: (h, k, d) => mergeFoods(foods, h, k, d),
        },
        { apply: false },
    );
    const planned = dry.households[0]!.merges;
    expect(planned.length).toBe(1);

    const spy = mock((householdId: string, k: string, d: string) =>
        mergeFoods(foods, householdId, k, d),
    );

    const report = await runMergeJob(
        {
            listHouseholdIds: async () => [HH],
            store: foods,
            merge: spy as MergeJobDeps["merge"],
        },
        { apply: true },
    );

    expect(spy.mock.calls.map((c) => c.slice(1))).toEqual([
        [planned[0]!.keep.id, planned[0]!.drop.id],
    ]);
    expect(report.mergedCount).toBe(1);

    const kept = (await foods.getFood(HH, keep.id))!;
    const dropped = await foods.getFood(HH, drop.id);
    expect(dropped?.archivedAt).toBeTruthy();
    const aliasId = await foods.getAliasFoodId(
        HH,
        normalizeFoodName(drop.name),
    );
    expect(aliasId).toBe(keep.id);

    const items = await fridge.listItems(HH);
    const movements = await stock.listMovements(HH);
    expect(ledgerMatchesStock(items, movements, kept)).toBe(true);
});

test("second apply is a no-op", async () => {
    const foods = createMemoryFoodsStore();
    const k = await foods.insertFood(
        withUniqueNorm(
            newFood({ householdId: HH, kind: "food", name: "Pomme" }),
        ),
    );
    const d = await foods.insertFood(
        withUniqueNorm(
            newFood({ householdId: HH, kind: "food", name: "pomme" }),
        ),
    );
    await mergeFoods(foods, HH, k.id, d.id);

    const spy = mock(async (householdId: string, ka: string, dr: string) =>
        mergeFoods(foods, householdId, ka, dr),
    );
    const report = await runMergeJob(
        {
            listHouseholdIds: async () => [HH],
            store: foods,
            merge: spy as MergeJobDeps["merge"],
        },
        { apply: true },
    );
    expect(report.mergedCount).toBe(0);
    expect(spy).not.toHaveBeenCalled();
});

test("one failing merge: next pair still merges", async () => {
    const foods = createMemoryFoodsStore();
    const stamp = "2026-01-01T00:00:00.000Z";
    // Loose-key duplicates with different normalized_name strings so both can exist in the memory store.
    const a = await foods.insertFood({
        ...newFood({ householdId: HH, kind: "food", name: "Dup one" }),
        id: "00000000-0000-0000-0000-0000000000a1",
        createdAt: stamp,
        updatedAt: stamp,
    });
    const b = await foods.insertFood({
        ...newFood({ householdId: HH, kind: "food", name: "dup-one" }),
        id: "00000000-0000-0000-0000-0000000000b1",
        createdAt: stamp,
        updatedAt: stamp,
    });
    await foods.insertFood({
        ...newFood({ householdId: HH, kind: "food", name: "Dup two" }),
        id: "00000000-0000-0000-0000-0000000000c2",
        createdAt: stamp,
        updatedAt: stamp,
    });
    await foods.insertFood({
        ...newFood({ householdId: HH, kind: "food", name: "dup-two" }),
        id: "00000000-0000-0000-0000-0000000000d2",
        createdAt: stamp,
        updatedAt: stamp,
    });

    const failingDropId = b.id;
    const spy = mock(
        async (householdId: string, keepId: string, dropId: string) => {
            if (dropId === failingDropId) {
                throw new Error("boom");
            }
            return mergeFoods(foods, householdId, keepId, dropId);
        },
    );

    const report = await runMergeJob(
        {
            listHouseholdIds: async () => [HH],
            store: foods,
            merge: spy as MergeJobDeps["merge"],
        },
        { apply: true },
    );

    expect(report.failedCount).toBe(1);
    expect(report.mergedCount).toBe(1);
    const results = report.households[0]!.merges.map((m) => m.result);
    expect(results.some((r) => r?.status === "failed")).toBe(true);
    expect(results.some((r) => r?.status === "merged")).toBe(true);
});

test("formatMergeJobReport: DRY line, labels, skip, empty", () => {
    const text = formatMergeJobReport({
        mode: "dry-run",
        households: [
            {
                householdId: "h1",
                merges: [
                    {
                        keep: {
                            id: "k1",
                            householdId: "h1",
                            kind: "food",
                            name: "Alpha",
                            brand: "Acme",
                            references: 2,
                            createdAt: "2026-01-01T00:00:00.000Z",
                        },
                        drop: {
                            id: "d1",
                            householdId: "h1",
                            kind: "food",
                            name: "alpha",
                            brand: "Acme",
                            references: 1,
                            createdAt: "2026-02-01T00:00:00.000Z",
                        },
                        reason: "more references (2 vs 1)",
                        fieldsFilled: ["calories"],
                    },
                ],
                skipped: [
                    {
                        keep: {
                            id: "k2",
                            householdId: "h1",
                            kind: "food",
                            name: "Beta",
                            brand: null,
                            references: 0,
                            createdAt: "2026-01-01T00:00:00.000Z",
                        },
                        drop: {
                            id: "d2",
                            householdId: "h1",
                            kind: "food",
                            name: "beta",
                            brand: null,
                            references: 0,
                            createdAt: "2026-02-01T00:00:00.000Z",
                        },
                        reason: "calories differ: 1 vs 2",
                    },
                ],
            },
        ],
        mergedCount: 0,
        failedCount: 0,
        skippedCount: 1,
    });
    expect(text).toContain(
        "DRY RUN — nothing was written. Re-run with --apply to merge.",
    );
    expect(text).toContain("KEEP");
    expect(text).toContain("Alpha");
    expect(text).toContain('"alpha"');
    expect(text).toContain("calories differ");

    const empty = formatMergeJobReport({
        mode: "dry-run",
        households: [{ householdId: "h0", merges: [], skipped: [] }],
        mergedCount: 0,
        failedCount: 0,
        skippedCount: 0,
    });
    expect(empty).toContain("Nothing to merge.");
});

test("merge-duplicate-foods --help exits 0 without DATABASE_URL", () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const proc = Bun.spawnSync(
        ["bun", "run", "scripts/merge-duplicate-foods.ts", "--help"],
        {
            cwd: process.cwd(),
            env,
            stdout: "pipe",
            stderr: "pipe",
        },
    );
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain("Usage:");
});

test("dry run skips merge when drop name is another food's alias", async () => {
    const foods = createMemoryFoodsStore();
    const tKeep = "2026-01-01T00:00:00.000Z";
    const tOther = "2026-01-02T00:00:00.000Z";
    const tDup = "2026-01-03T00:00:00.000Z";
    const ap = await foods.insertFood(
        withUniqueNorm({
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "All purpose flour",
            }),
            createdAt: tKeep,
            updatedAt: tKeep,
        }),
    );
    const other = await foods.insertFood(
        withUniqueNorm({
            ...newFood({ householdId: HH, kind: "food", name: "Bread flour" }),
            createdAt: tOther,
            updatedAt: tOther,
        }),
    );
    await foods.setAlias(HH, normalizeFoodName("all-purpose flour"), other.id);
    await foods.insertFood(
        withUniqueNorm({
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "all-purpose flour",
            }),
            createdAt: tDup,
            updatedAt: tDup,
        }),
    );

    const mergeMock = mock(() =>
        Promise.reject(new Error("merge should not run")),
    );
    const reportDry = await runMergeJob(
        {
            listHouseholdIds: async () => [HH],
            store: foods,
            merge: mergeMock as MergeJobDeps["merge"],
        },
        { apply: false },
    );
    expect(mergeMock).not.toHaveBeenCalled();
    expect(reportDry.households[0]!.merges).toHaveLength(0);
    expect(reportDry.households[0]!.skipped).toHaveLength(1);

    const spy = mock(async (householdId: string, k: string, d: string) =>
        mergeFoods(foods, householdId, k, d),
    );
    const reportApply = await runMergeJob(
        {
            listHouseholdIds: async () => [HH],
            store: foods,
            merge: spy as MergeJobDeps["merge"],
        },
        { apply: true },
    );
    expect(spy).not.toHaveBeenCalled();
    expect(reportApply.mergedCount).toBe(0);
    void ap;
});

test("ledger: blank default unit keep vs each drop is not merged", async () => {
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    foods.linkRefs(fridge);
    foods.linkRefs(stock);
    const loc = await addLocation(fridge, HH, "Shelf");

    const keep = await foods.insertFood(
        withUniqueNorm({
            ...newFood({ householdId: HH, kind: "food", name: "Lentils" }),
            defaultUnit: "",
        }),
    );
    const drop = await foods.insertFood(
        withUniqueNorm({
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "lentils",
                defaultUnit: "each",
                gramsPerEach: 200,
            }),
        }),
    );
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: keep.id,
        amount: 10,
        unit: "g",
        locationId: loc.id,
    });
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: keep.id,
        amount: 10,
        unit: "g",
        locationId: loc.id,
    });
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: drop.id,
        amount: 1,
        unit: "each",
        locationId: loc.id,
    });

    const report = await runMergeJob(
        {
            listHouseholdIds: async () => [HH],
            store: foods,
            merge: (h, k, d) => mergeFoods(foods, h, k, d),
        },
        { apply: false },
    );
    expect(report.households[0]!.merges).toHaveLength(0);

    const kFood = (await foods.getFood(HH, keep.id))!;
    const dFood = (await foods.getFood(HH, drop.id))!;
    const items = await fridge.listItems(HH);
    const movements = await stock.listMovements(HH);
    expect(ledgerMatchesStock(items, movements, kFood)).toBe(true);
    expect(ledgerMatchesStock(items, movements, dFood)).toBe(true);
    expect(ledgerDefaultUnit(kFood)).toBe("g");
    expect(ledgerDefaultUnit(dFood)).toBe("each");
});

test("apply: a one-sided gramsPerMl fill keeps the ml ledger matched", async () => {
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    foods.linkRefs(fridge);
    foods.linkRefs(stock);
    const loc = await addLocation(fridge, HH, "Fridge");

    const keep = await foods.insertFood({
        ...withUniqueNorm(
            newFood({ householdId: HH, kind: "food", name: "Milk" }),
        ),
        createdAt: "2026-01-01T00:00:00.000Z",
    });
    const drop = await foods.insertFood({
        ...withUniqueNorm(
            newFood({
                householdId: HH,
                kind: "food",
                name: "milk.",
                gramsPerMl: 1.03,
            }),
        ),
        createdAt: "2026-02-01T00:00:00.000Z",
    });
    for (let i = 0; i < 2; i++) {
        await addFridgeItemAdjust(fridge, stock, foods, {
            householdId: HH,
            foodId: keep.id,
            amount: 15,
            unit: "ml",
            locationId: loc.id,
        });
    }

    const report = await runMergeJob(
        {
            listHouseholdIds: async () => [HH],
            store: foods,
            merge: (h, k, d) => mergeFoods(foods, h, k, d),
        },
        { apply: true },
    );
    expect(report.mergedCount).toBe(1);
    expect(report.households[0]!.merges[0]!.fieldsFilled).toContain(
        "gramsPerMl",
    );

    const kept = (await foods.getFood(HH, keep.id))!;
    expect(kept.gramsPerMl).toBe(1.03);
    const items = await fridge.listItems(HH);
    const movements = await stock.listMovements(HH);
    expect(ledgerMatchesStock(items, movements, kept)).toBe(true);
});
