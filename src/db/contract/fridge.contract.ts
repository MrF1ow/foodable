import { describe, expect, test } from "bun:test";
import type { FridgeStore } from "../../domain/fridge.js";
import {
    sampleFridgeItem,
    sampleFridgeLocation,
    type StoreContractCtx,
} from "./helpers.js";

export function runFridgeStoreContract(
    label: string,
    createStore: () => FridgeStore,
    reset: () => Promise<void>,
    ctx: () => StoreContractCtx,
): void {
    describe(`${label} fridge store`, () => {
        test("listLocations, insertLocation, updateLocation, deleteLocation", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const second = sampleFridgeLocation(c, {
                id: crypto.randomUUID(),
                name: "Cellar",
                sortOrder: 0,
            });
            const first = sampleFridgeLocation(c, {
                id: crypto.randomUUID(),
                name: "Garage",
                sortOrder: 1,
            });
            await store.insertLocation(first);
            await store.insertLocation(second);
            const locations = await store.listLocations(c.householdId);
            const ours = locations.filter(
                (l) => l.id === first.id || l.id === second.id,
            );
            expect(ours.map((l) => l.name)).toEqual(["Cellar", "Garage"]);

            const updated = await store.updateLocation({
                ...second,
                name: "Deep freeze",
            });
            expect(updated?.name).toBe("Deep freeze");
            expect(
                await store.updateLocation({
                    ...second,
                    id: crypto.randomUUID(),
                }),
            ).toBeNull();

            expect(await store.deleteLocation(c.householdId, first.id)).toBe(
                true,
            );
            expect(
                await store.deleteLocation(c.householdId, crypto.randomUUID()),
            ).toBe(false);
        });

        test("listItems, insertItem, updateItem, deleteItem", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const item = sampleFridgeItem(c, {
                purchasedOn: "2026-02-01",
                openedOn: null,
                expiresOn: "2026-03-01",
            });
            await store.insertItem(item);
            const listed = await store.listItems(c.householdId);
            expect(listed).toHaveLength(1);
            expect(listed[0]!.expiresOn).toBe("2026-03-01");
            expect(listed[0]!.openedOn).toBeNull();

            const updated = await store.updateItem({
                ...item,
                openedOn: "2026-02-15",
            });
            expect(updated?.openedOn).toBe("2026-02-15");
            expect(
                await store.updateItem({
                    ...item,
                    id: crypto.randomUUID(),
                }),
            ).toBeNull();

            expect(await store.deleteItem(c.householdId, item.id)).toBe(true);
            expect(
                await store.deleteItem(c.householdId, crypto.randomUUID()),
            ).toBe(false);
        });

        test("listItems order by created_at asc", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const later = sampleFridgeItem(c, {
                id: crypto.randomUUID(),
                displayName: "Later",
            });
            const earlier = sampleFridgeItem(c, {
                id: crypto.randomUUID(),
                displayName: "Earlier",
            });
            await store.insertItem(later);
            await store.insertItem(earlier);
            if (c.setFridgeItemCreatedAt) {
                await c.setFridgeItemCreatedAt(
                    later.id,
                    "2026-02-02T00:00:00+00:00",
                );
                await c.setFridgeItemCreatedAt(
                    earlier.id,
                    "2026-02-01T00:00:00+00:00",
                );
            }
            const names = (await store.listItems(c.householdId)).map(
                (i) => i.displayName,
            );
            expect(names).toEqual(["Earlier", "Later"]);
        });

        test("household scoping", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            await store.insertLocation(sampleFridgeLocation(c));
            expect(await store.listLocations(c.otherHouseholdId)).toEqual([]);
        });
    });
}
