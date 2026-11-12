import { describe, expect, test } from "bun:test";
import type { StockStore } from "../../domain/stock.js";
import { sampleMovement, type StoreContractCtx } from "./helpers.js";

export function runStockStoreContract(
    label: string,
    createStore: () => StockStore,
    reset: () => Promise<void>,
    ctx: () => StoreContractCtx,
): void {
    describe(`${label} stock store`, () => {
        test("insertMovement, listMovements, and linkMeal", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const older = sampleMovement(c, {
                id: crypto.randomUUID(),
                createdAt: "2026-01-01T10:00:00+00:00",
            });
            const newer = sampleMovement(c, {
                id: crypto.randomUUID(),
                createdAt: "2026-01-03T10:00:00+00:00",
            });
            await store.insertMovement(older);
            await store.insertMovement(newer);
            const listed = await store.listMovements(c.householdId);
            expect(listed.map((m) => m.id)).toEqual([newer.id, older.id]);

            const mealId = crypto.randomUUID();
            await store.linkMeal(c.householdId, newer.id, mealId);
            const linked = await store.listMovements(c.householdId);
            expect(linked.find((m) => m.id === newer.id)?.mealId).toBe(mealId);
        });

        test("listMovements filters by food and null fields round-trip", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const row = sampleMovement(c, {
                fridgeItemId: null,
                groceryLineId: null,
                recipeId: null,
                mealId: null,
                actorUserId: null,
            });
            await store.insertMovement(row);
            const listed = await store.listMovements(c.householdId, c.foodId);
            expect(listed).toHaveLength(1);
            expect(listed[0]!.fridgeItemId).toBeNull();
            expect(listed[0]!.actorUserId).toBeNull();
        });

        test("listMovements since keeps movements at or after it", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const before = sampleMovement(c, {
                id: crypto.randomUUID(),
                createdAt: "2026-01-01T10:00:00+00:00",
            });
            const at = sampleMovement(c, {
                id: crypto.randomUUID(),
                createdAt: "2026-01-02T00:00:00+00:00",
            });
            const after = sampleMovement(c, {
                id: crypto.randomUUID(),
                createdAt: "2026-01-03T10:00:00+00:00",
            });
            for (const m of [before, at, after]) await store.insertMovement(m);
            const since = "2026-01-02T00:00:00.000Z";
            const all = await store.listMovements(
                c.householdId,
                undefined,
                since,
            );
            expect(all.map((m) => m.id)).toEqual([after.id, at.id]);
            const byFood = await store.listMovements(
                c.householdId,
                c.foodId,
                since,
            );
            expect(byFood.map((m) => m.id)).toEqual([after.id, at.id]);
        });

        test("hasMovement says whether the household's ledger holds that id", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const row = sampleMovement(c);
            expect(await store.hasMovement(c.householdId, row.id)).toBe(false);
            await store.insertMovement(row);
            expect(await store.hasMovement(c.householdId, row.id)).toBe(true);
            expect(await store.hasMovement(c.otherHouseholdId, row.id)).toBe(
                false,
            );
        });

        test("insertMovement refuses an id the ledger already holds", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const row = sampleMovement(c);
            await store.insertMovement(row);
            await expect(
                store.insertMovement({ ...row, delta: 5 }),
            ).rejects.toThrow();
            const listed = await store.listMovements(c.householdId);
            expect(listed).toHaveLength(1);
            expect(listed[0]!.delta).toBe(1);
        });

        test("household scoping on listMovements", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            await store.insertMovement(sampleMovement(c));
            expect(await store.listMovements(c.otherHouseholdId)).toEqual([]);
        });
    });
}
