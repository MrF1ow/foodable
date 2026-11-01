import { describe, expect, test } from "bun:test";
import type { GroceryLine, GroceryListStore } from "../../domain/grocery.js";

export type StoreContractCtx = {
    householdId: string;
    otherHouseholdId: string;
    storeId: string;
    sectionId: string;
    foodId: string;
};

export function runGroceryListStoreContract(
    label: string,
    createStore: () => GroceryListStore,
    reset: () => Promise<void>,
    ctx: () => StoreContractCtx,
): void {
    describe(`${label} grocery store`, () => {
        test("list, update, delete, and household scoping", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const lineA: GroceryLine = {
                id: crypto.randomUUID(),
                householdId: c.householdId,
                storeId: c.storeId,
                sectionId: c.sectionId,
                kind: "food",
                displayName: "Milk",
                quantity: { amount: 1, unit: "L" },
                foodId: c.foodId,
                checked: false,
            };
            const lineB: GroceryLine = {
                ...lineA,
                id: crypto.randomUUID(),
                displayName: "Bread",
            };
            await store.insertLine(lineB);
            await Bun.sleep(5);
            await store.insertLine(lineA);
            const listed = await store.listLines(c.householdId);
            expect(listed.map((l) => l.displayName)).toEqual(["Bread", "Milk"]);

            expect(await store.listLines(c.otherHouseholdId)).toEqual([]);
            expect(await store.listLines(c.householdId)).toHaveLength(2);

            const updated = await store.updateLine({
                ...lineA,
                checked: true,
            });
            expect(updated?.checked).toBe(true);
            expect(
                await store.updateLine({
                    ...lineA,
                    id: crypto.randomUUID(),
                }),
            ).toBeNull();

            expect(await store.deleteLine(c.householdId, lineB.id)).toBe(true);
            expect(
                await store.deleteLine(c.householdId, crypto.randomUUID()),
            ).toBe(false);
        });
    });
}
