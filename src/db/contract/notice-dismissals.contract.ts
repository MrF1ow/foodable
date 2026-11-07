import { describe, expect, test } from "bun:test";
import type { NoticeDismissalsStore } from "../../domain/notice-dismissals.js";
import type { StoreContractCtx } from "./helpers.js";

export function runNoticeDismissalsStoreContract(
    label: string,
    createStore: () => NoticeDismissalsStore,
    reset: () => Promise<void>,
    ctx: () => StoreContractCtx,
): void {
    describe(`${label} notice dismissals store`, () => {
        test("insert, list newest first, idempotent duplicate, delete", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const first = await store.insert({
                householdId: c.householdId,
                code: "fridge.expiring",
                subjectKind: "fridge_item",
                subjectId: crypto.randomUUID(),
                relatedKey: "",
                dismissedBy: c.userId,
            });
            const dup = await store.insert({
                householdId: c.householdId,
                code: first.code,
                subjectKind: first.subjectKind,
                subjectId: first.subjectId,
                relatedKey: first.relatedKey,
                dismissedBy: c.userId,
            });
            expect(dup.id).toBe(first.id);
            const listed = await store.listForHousehold(c.householdId);
            expect(listed[0]!.id).toBe(first.id);
            const removed = await store.delete(c.householdId, {
                code: first.code,
                subjectKind: first.subjectKind,
                subjectId: first.subjectId,
                relatedKey: first.relatedKey,
            });
            expect(removed).toBe(true);
        });

        test("household isolation and deleteForSubject", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const subjectId = crypto.randomUUID();
            await store.insert({
                householdId: c.householdId,
                code: "fridge.expiring",
                subjectKind: "fridge_item",
                subjectId,
                relatedKey: "",
                dismissedBy: c.userId,
            });
            expect(await store.listForHousehold(c.otherHouseholdId)).toEqual(
                [],
            );
            await store.deleteForSubject(
                c.householdId,
                "fridge_item",
                subjectId,
            );
            expect(await store.listForHousehold(c.householdId)).toEqual([]);
        });
    });
}
