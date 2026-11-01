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
            const milk = sampleGroceryLine(c, {
                id: crypto.randomUUID(),
                displayName: "Milk",
            });
            const bread = sampleGroceryLine(c, {
                id: crypto.randomUUID(),
                displayName: "Bread",
            });
            await store.insertLine(milk);
            await store.insertLine(bread);
            if (c.setLineCreatedAt) {
                await c.setLineCreatedAt(milk.id, "2026-02-02T00:00:00+00:00");
                await c.setLineCreatedAt(bread.id, "2026-02-01T00:00:00+00:00");
            }
            const listed = await store.listLines(c.householdId);
            expect(listed.map((l) => l.displayName)).toEqual(["Bread", "Milk"]);

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
    });
}
