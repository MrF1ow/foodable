import { describe, expect, test } from "bun:test";
import type { SettingsStore } from "../../domain/settings.js";
import {
    sampleGrocerySectionRow,
    sampleGroceryStoreRow,
    type StoreContractCtx,
} from "./helpers.js";

export function runSettingsStoreContract(
    label: string,
    createStore: () => SettingsStore,
    reset: () => Promise<void>,
    ctx: () => StoreContractCtx,
): void {
    describe(`${label} settings store`, () => {
        test("getLocation and setLocation null round-trip", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            expect(await store.getLocation(c.householdId)).toBeNull();
            await store.setLocation(c.householdId, "  Kyiv  ");
            expect(await store.getLocation(c.householdId)).toBe("  Kyiv  ");
            await store.setLocation(c.householdId, null);
            expect(await store.getLocation(c.householdId)).toBeNull();
        });

        test("grocery preferences default off and round-trip", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            expect(await store.getGroceryPreferences(c.householdId)).toEqual({
                defaultStoreId: null,
                useUsualStore: false,
            });
            const row = sampleGroceryStoreRow(c, { name: "Pref" });
            await store.insertStore(row);
            const saved = await store.setGroceryPreferences(c.householdId, {
                defaultStoreId: row.id,
                useUsualStore: true,
            });
            expect(saved).toEqual({
                defaultStoreId: row.id,
                useUsualStore: true,
            });
            expect(await store.getGroceryPreferences(c.householdId)).toEqual(
                saved,
            );
            await store.setGroceryPreferences(c.householdId, {
                defaultStoreId: null,
                useUsualStore: false,
            });
            expect(await store.getGroceryPreferences(c.householdId)).toEqual({
                defaultStoreId: null,
                useUsualStore: false,
            });
        });

        test("listStores and insertStore sort order", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const b = sampleGroceryStoreRow(c, {
                name: "B",
                sortOrder: 1,
            });
            const a = sampleGroceryStoreRow(c, {
                name: "A",
                sortOrder: 0,
            });
            await store.insertStore(b);
            await store.insertStore(a);
            const listed = await store.listStores(c.householdId);
            const ours = listed.filter((s) => s.id === a.id || s.id === b.id);
            expect(ours.map((s) => s.name)).toEqual(["A", "B"]);
        });

        test("updateStore renames in place and is household scoped", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const row = sampleGroceryStoreRow(c, {
                name: "Before",
                sortOrder: 3,
            });
            await store.insertStore(row);
            const updated = await store.updateStore({ ...row, name: "After" });
            expect(updated).toEqual({ ...row, name: "After" });
            const listed = await store.listStores(c.householdId);
            expect(listed.find((s) => s.id === row.id)?.name).toBe("After");
            expect(
                await store.updateStore({
                    ...row,
                    householdId: c.otherHouseholdId,
                    name: "Hijack",
                }),
            ).toBeNull();
            expect(
                await store.updateStore({
                    ...row,
                    id: crypto.randomUUID(),
                }),
            ).toBeNull();
            const again = await store.listStores(c.householdId);
            expect(again.find((s) => s.id === row.id)?.name).toBe("After");
        });

        test("listSections, getSection, insertSection, updateSection", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const high = sampleGrocerySectionRow(c, {
                name: "Snacks",
                sortOrder: 2,
            });
            const low = sampleGrocerySectionRow(c, {
                name: "Spices",
                sortOrder: 0,
            });
            await store.insertSection(high);
            await store.insertSection(low);
            const sections = await store.listSections(c.storeId);
            const ours = sections.filter(
                (s) => s.id === high.id || s.id === low.id,
            );
            expect(ours.map((s) => s.name)).toEqual(["Spices", "Snacks"]);

            const got = await store.getSection(c.householdId, low.id);
            expect(got?.name).toBe("Spices");
            expect(
                await store.getSection(c.householdId, crypto.randomUUID()),
            ).toBeNull();

            const updated = await store.updateSection({
                ...low,
                hidden: true,
            });
            expect(updated?.hidden).toBe(true);
            expect(
                await store.updateSection({
                    ...low,
                    id: crypto.randomUUID(),
                }),
            ).toBeNull();
        });

        test("household scoping on getSection", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const section = sampleGrocerySectionRow(c);
            await store.insertSection(section);
            expect(
                await store.getSection(c.otherHouseholdId, section.id),
            ).toBeNull();
        });
    });
}
