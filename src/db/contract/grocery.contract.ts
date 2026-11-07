import { describe, expect, test } from "bun:test";
import type { GroceryListStore } from "../../domain/grocery.js";
import { sampleGroceryLine, type StoreContractCtx } from "./helpers.js";

export function runGroceryListStoreContract(
    label: string,
    createStore: () => GroceryListStore,
    reset: () => Promise<void>,
    ctx: () => StoreContractCtx,
): void {
    describe(`${label} grocery store`, () => {
        test("listLines order by created_at, update, delete, scoping", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            // Created order (bread first) differs from both insert order and
            // name order, so only `order by created_at` passes.
            const milk = sampleGroceryLine(c, {
                id: crypto.randomUUID(),
                displayName: "Apple",
            });
            const bread = sampleGroceryLine(c, {
                id: crypto.randomUUID(),
                displayName: "Zucchini",
            });
            // Whole-object equality: a store must return exactly the domain
            // shape, with no extra internal fields.
            expect(await store.insertLine(milk)).toEqual(milk);
            expect(await store.insertLine(bread)).toEqual(bread);
            if (c.setLineCreatedAt) {
                await c.setLineCreatedAt(milk.id, "2026-02-02T00:00:00+00:00");
                await c.setLineCreatedAt(bread.id, "2026-02-01T00:00:00+00:00");
            }
            const listed = await store.listLines(c.householdId);
            expect(listed).toEqual([bread, milk]);

            expect(await store.listLines(c.otherHouseholdId)).toEqual([]);

            const updated = await store.updateLine({
                ...milk,
                checked: true,
            });
            expect(updated?.checked).toBe(true);
            expect(
                await store.updateLine({
                    ...milk,
                    id: crypto.randomUUID(),
                }),
            ).toBeNull();

            expect(await store.deleteLine(c.householdId, bread.id)).toBe(true);
            expect(
                await store.deleteLine(c.householdId, crypto.randomUUID()),
            ).toBe(false);
        });

        test("source and sourceFridgeItemId round-trip", async () => {
            await reset();
            const c = ctx();
            if (!c.ensureFridgeItem) {
                throw new Error(
                    "contract ctx must set ensureFridgeItem for source round-trip",
                );
            }
            const sourceFridgeItemId = await c.ensureFridgeItem();
            const store = createStore();
            const recipeLine = sampleGroceryLine(c, {
                id: crypto.randomUUID(),
                displayName: "From recipe",
                source: "recipe",
                sourceFridgeItemId: null,
            });
            const restockLine = sampleGroceryLine(c, {
                id: crypto.randomUUID(),
                displayName: "Restock milk",
                source: "restock",
                sourceFridgeItemId,
            });
            expect(await store.insertLine(recipeLine)).toEqual(recipeLine);
            expect(await store.insertLine(restockLine)).toEqual(restockLine);
            const listed = await store.listLines(c.householdId);
            expect(listed).toEqual(
                expect.arrayContaining([recipeLine, restockLine]),
            );
            const updated = await store.updateLine({
                ...restockLine,
                source: "notice",
            });
            expect(updated).toEqual({ ...restockLine, source: "notice" });
        });
    });
}
