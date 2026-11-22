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

        test("the agents switch defaults to Allowed and round-trips beside the grocery preferences", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            expect(await store.getAgentDestructiveAllowed(c.householdId)).toBe(
                true,
            );
            const row = sampleGroceryStoreRow(c, { name: "Switch" });
            await store.insertStore(row);
            await store.setGroceryPreferences(c.householdId, {
                defaultStoreId: row.id,
                useUsualStore: true,
            });
            expect(
                await store.setAgentDestructiveAllowed(c.householdId, false),
            ).toBe(false);
            expect(await store.getAgentDestructiveAllowed(c.householdId)).toBe(
                false,
            );
            // Neither write disturbs the other's keys.
            expect(await store.getGroceryPreferences(c.householdId)).toEqual({
                defaultStoreId: row.id,
                useUsualStore: true,
            });
            await store.setGroceryPreferences(c.householdId, {
                defaultStoreId: null,
                useUsualStore: false,
            });
            expect(await store.getAgentDestructiveAllowed(c.householdId)).toBe(
                false,
            );
            expect(
                await store.setAgentDestructiveAllowed(c.householdId, true),
            ).toBe(true);
            expect(await store.getAgentDestructiveAllowed(c.householdId)).toBe(
                true,
            );
        });

        test("a member's agents switch is their own: off until set, and one member's never moves another's", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const other = c.ensureMember
                ? await c.ensureMember()
                : crypto.randomUUID();
            // A member added the way the app adds one starts Off.
            expect(
                await store.getMemberAgentsCanDelete(c.householdId, other),
            ).toBe(false);
            // Someone who is not a member of the household has no switch.
            expect(
                await store.getMemberAgentsCanDelete(
                    c.householdId,
                    crypto.randomUUID(),
                ),
            ).toBe(false);
            expect(
                await store.setMemberAgentsCanDelete(
                    c.householdId,
                    other,
                    true,
                ),
            ).toBe(true);
            expect(
                await store.getMemberAgentsCanDelete(c.householdId, other),
            ).toBe(true);
            // Neither the household's switch nor another household's member moves with it.
            expect(await store.getAgentDestructiveAllowed(c.householdId)).toBe(
                true,
            );
            expect(
                await store.getMemberAgentsCanDelete(c.otherHouseholdId, other),
            ).toBe(false);
            await store.setAgentDestructiveAllowed(c.householdId, false);
            expect(
                await store.getMemberAgentsCanDelete(c.householdId, other),
            ).toBe(true);
            expect(
                await store.setMemberAgentsCanDelete(
                    c.householdId,
                    other,
                    false,
                ),
            ).toBe(false);
            expect(
                await store.getMemberAgentsCanDelete(c.householdId, other),
            ).toBe(false);
            expect(await store.getAgentDestructiveAllowed(c.householdId)).toBe(
                false,
            );
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

        test("deleteSection removes the section, is household scoped and false when it is gone", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const section = sampleGrocerySectionRow(c, { name: "Doomed" });
            const kept = sampleGrocerySectionRow(c, { name: "Kept" });
            await store.insertSection(section);
            await store.insertSection(kept);
            // Another household's id is not this household's to delete.
            expect(
                await store.deleteSection(c.otherHouseholdId, section.id),
            ).toBe(false);
            expect(
                await store.getSection(c.householdId, section.id),
            ).not.toBeNull();
            expect(await store.deleteSection(c.householdId, section.id)).toBe(
                true,
            );
            expect(
                await store.getSection(c.householdId, section.id),
            ).toBeNull();
            expect(
                (await store.listSections(c.storeId)).map((s) => s.name),
            ).toContain("Kept");
            expect(
                (await store.listSections(c.storeId)).map((s) => s.name),
            ).not.toContain("Doomed");
            expect(await store.deleteSection(c.householdId, section.id)).toBe(
                false,
            );
            expect(
                await store.deleteSection(c.householdId, crypto.randomUUID()),
            ).toBe(false);
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
