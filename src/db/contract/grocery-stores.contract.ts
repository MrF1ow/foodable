import { describe, expect, test } from "bun:test";
import type { GroceryListStore } from "../../domain/grocery.js";
import {
    deleteStore,
    reorderStores,
    saveGroceryPreferences,
    storeLineCount,
    type StoreManagementStore,
} from "../../domain/grocery-stores.js";
import {
    createGroceryStore,
    SettingsInputError,
    type SettingsStore,
} from "../../domain/settings.js";
import { sampleGroceryLine, type StoreContractCtx } from "./helpers.js";

export type StoreManagementHarness = {
    settings: SettingsStore;
    grocery: GroceryListStore;
    management: StoreManagementStore;
    /** A store of another household, made by whatever bypasses the actor's own access. */
    seedForeignStore(): Promise<string>;
};

/** Shared by the memory composition and the live adapters. */
export function runStoreManagementContract(
    label: string,
    create: () => StoreManagementHarness,
    reset: () => Promise<void>,
    ctx: () => StoreContractCtx,
): void {
    describe(`${label} store management`, () => {
        async function twoStores() {
            await reset();
            const c = ctx();
            const h = create();
            const a = await createGroceryStore(h.settings, c.householdId, "A");
            const b = await createGroceryStore(h.settings, c.householdId, "B");
            const sectionsA = await h.settings.listSections(a.id);
            const sectionsB = await h.settings.listSections(b.id);
            return { c, h, a, b, sectionsA, sectionsB };
        }

        async function addLine(
            h: StoreManagementHarness,
            c: StoreContractCtx,
            storeId: string,
            sectionId: string,
            displayName: string,
        ) {
            return h.grocery.insertLine(
                sampleGroceryLine(c, {
                    storeId,
                    sectionId,
                    displayName,
                }),
            );
        }

        test("storeLineCount counts one store's lines", async () => {
            const { c, h, a, b, sectionsA } = await twoStores();
            await addLine(h, c, a.id, sectionsA[0]!.id, "Milk");
            await addLine(h, c, a.id, sectionsA[1]!.id, "Eggs");
            expect(
                await storeLineCount(h.management, c.householdId, a.id),
            ).toBe(2);
            expect(
                await storeLineCount(h.management, c.householdId, b.id),
            ).toBe(0);
        });

        test("deleting with moveTo moves every line to the matching section", async () => {
            const { c, h, a, b, sectionsA, sectionsB } = await twoStores();
            const dairyA = sectionsA.find((s) => s.name === "Dairy")!;
            const dairyB = sectionsB.find((s) => s.name === "Dairy")!;
            const otherB = sectionsB.find((s) => s.isOther)!;
            const renamed = sectionsA.find((s) => s.name === "Pantry")!;
            await h.settings.updateSection({ ...renamed, name: "Cupboard" });
            const milk = await addLine(h, c, a.id, dairyA.id, "Milk");
            const rice = await addLine(h, c, a.id, renamed.id, "Rice");
            const kept = await addLine(h, c, b.id, otherB.id, "Bread");

            const result = await deleteStore({ ...h }, c.householdId, a.id, {
                moveTo: b.id,
            });
            expect(result).toEqual({
                movedLines: 2,
                deletedLines: 0,
                clearedDefault: false,
            });

            expect(
                (await h.settings.listStores(c.householdId)).map((s) => s.id),
            ).toEqual([b.id]);
            const lines = await h.grocery.listLines(c.householdId);
            const byId = new Map(lines.map((l) => [l.id, l]));
            expect(byId.get(milk.id)).toMatchObject({
                storeId: b.id,
                sectionId: dairyB.id,
            });
            // No "Cupboard" in the destination: it falls to "Other".
            expect(byId.get(rice.id)).toMatchObject({
                storeId: b.id,
                sectionId: otherB.id,
            });
            expect(byId.get(kept.id)).toMatchObject({ storeId: b.id });
            expect(lines).toHaveLength(3);
        });

        test("deleting without moveTo deletes the store's lines and only those", async () => {
            const { c, h, a, b, sectionsA, sectionsB } = await twoStores();
            await addLine(h, c, a.id, sectionsA[0]!.id, "Milk");
            await addLine(h, c, a.id, sectionsA[1]!.id, "Eggs");
            const kept = await addLine(h, c, b.id, sectionsB[0]!.id, "Bread");

            const result = await deleteStore({ ...h }, c.householdId, a.id);
            expect(result).toEqual({
                movedLines: 0,
                deletedLines: 2,
                clearedDefault: false,
            });
            const lines = await h.grocery.listLines(c.householdId);
            expect(lines.map((l) => l.id)).toEqual([kept.id]);
            expect(await h.settings.listSections(a.id)).toEqual([]);
        });

        test("deleting the default store clears the preference; another default stays", async () => {
            const { c, h, a, b } = await twoStores();
            await saveGroceryPreferences(h.settings, c.householdId, {
                defaultStoreId: a.id,
                useUsualStore: true,
            });
            const first = await deleteStore({ ...h }, c.householdId, a.id);
            expect(first.clearedDefault).toBe(true);
            expect(
                await h.settings.getGroceryPreferences(c.householdId),
            ).toEqual({ defaultStoreId: null, useUsualStore: true });

            const third = await createGroceryStore(
                h.settings,
                c.householdId,
                "C",
            );
            await saveGroceryPreferences(h.settings, c.householdId, {
                defaultStoreId: b.id,
            });
            const second = await deleteStore({ ...h }, c.householdId, third.id);
            expect(second.clearedDefault).toBe(false);
            expect(
                (await h.settings.getGroceryPreferences(c.householdId))
                    .defaultStoreId,
            ).toBe(b.id);
        });

        test("deleting rejects bad targets and writes nothing", async () => {
            const { c, h, a, b, sectionsA } = await twoStores();
            await addLine(h, c, a.id, sectionsA[0]!.id, "Milk");
            const foreign = await h.seedForeignStore();
            for (const [id, moveTo] of [
                [a.id, a.id],
                [a.id, foreign],
                [a.id, crypto.randomUUID()],
                [foreign, b.id],
                [crypto.randomUUID(), undefined],
            ] as const) {
                await expect(
                    deleteStore({ ...h }, c.householdId, id, { moveTo }),
                ).rejects.toBeInstanceOf(SettingsInputError);
            }
            expect(await h.settings.listStores(c.householdId)).toHaveLength(2);
            expect(await h.grocery.listLines(c.householdId)).toHaveLength(1);
        });

        test("a line added after the plan was read aborts the whole deletion", async () => {
            const { c, h, a, b, sectionsA } = await twoStores();
            const milk = await addLine(h, c, a.id, sectionsA[0]!.id, "Milk");
            const staleDelete = {
                storeId: a.id,
                moveTo: null,
                moves: [],
                deleteLineIds: [milk.id],
                clearDefault: false,
            };
            const late = await addLine(h, c, a.id, sectionsA[1]!.id, "Late");
            await expect(
                h.management.applyStoreDeletion(c.householdId, staleDelete),
            ).rejects.toBeInstanceOf(SettingsInputError);
            // Nothing was applied: the store and both lines are still there.
            expect(await h.settings.listStores(c.householdId)).toHaveLength(2);
            const ids = (await h.grocery.listLines(c.householdId)).map(
                (l) => l.id,
            );
            expect(ids.sort()).toEqual([late.id, milk.id].sort());
            expect(b.id).toBeTruthy();
        });

        test("reorderStores writes dense positions", async () => {
            const { c, h, a, b } = await twoStores();
            const third = await createGroceryStore(
                h.settings,
                c.householdId,
                "C",
            );
            const listed = await reorderStores({ ...h }, c.householdId, [
                third.id,
                a.id,
                b.id,
            ]);
            expect(listed.map((s) => [s.id, s.sortOrder])).toEqual([
                [third.id, 0],
                [a.id, 1],
                [b.id, 2],
            ]);
            const again = await reorderStores({ ...h }, c.householdId, [
                b.id,
                third.id,
                a.id,
            ]);
            expect(again.map((s) => s.sortOrder)).toEqual([0, 1, 2]);
            expect(again.map((s) => s.id)).toEqual([b.id, third.id, a.id]);
        });

        test("reorderStores rejects foreign, missing, duplicate and unknown ids", async () => {
            const { c, h, a, b } = await twoStores();
            const foreign = await h.seedForeignStore();
            for (const ids of [
                [a.id, foreign],
                [b.id, a.id, foreign],
                [a.id],
                [a.id, a.id],
                [a.id, b.id, crypto.randomUUID()],
            ]) {
                await expect(
                    reorderStores({ ...h }, c.householdId, ids),
                ).rejects.toBeInstanceOf(SettingsInputError);
            }
            // The adapter refuses a stale list on its own, writing nothing.
            await expect(
                h.management.writeStoreOrder(c.householdId, [b.id]),
            ).rejects.toBeInstanceOf(SettingsInputError);
            const after = await h.settings.listStores(c.householdId);
            expect(after.map((s) => s.id)).toEqual([a.id, b.id]);
        });

        test("preferences default off, round-trip, merge a patch and reject foreign stores", async () => {
            const { c, h, a } = await twoStores();
            expect(
                await h.settings.getGroceryPreferences(c.householdId),
            ).toEqual({ defaultStoreId: null, useUsualStore: false });
            expect(
                await saveGroceryPreferences(h.settings, c.householdId, {
                    defaultStoreId: a.id,
                }),
            ).toEqual({ defaultStoreId: a.id, useUsualStore: false });
            expect(
                await saveGroceryPreferences(h.settings, c.householdId, {
                    useUsualStore: true,
                }),
            ).toEqual({ defaultStoreId: a.id, useUsualStore: true });
            expect(
                await h.settings.getGroceryPreferences(c.householdId),
            ).toEqual({ defaultStoreId: a.id, useUsualStore: true });
            expect(
                await saveGroceryPreferences(h.settings, c.householdId, {
                    defaultStoreId: null,
                }),
            ).toEqual({ defaultStoreId: null, useUsualStore: true });

            const foreign = await h.seedForeignStore();
            await expect(
                saveGroceryPreferences(h.settings, c.householdId, {
                    defaultStoreId: foreign,
                }),
            ).rejects.toBeInstanceOf(SettingsInputError);
            // The adapter checks too, not only the domain function.
            await expect(
                h.settings.setGroceryPreferences(c.householdId, {
                    defaultStoreId: foreign,
                    useUsualStore: false,
                }),
            ).rejects.toBeInstanceOf(SettingsInputError);
            expect(
                await h.settings.getGroceryPreferences(c.householdId),
            ).toEqual({ defaultStoreId: null, useUsualStore: true });
        });
    });
}
