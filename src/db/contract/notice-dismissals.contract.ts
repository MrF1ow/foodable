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
            const olderId = crypto.randomUUID();
            const newerId = crypto.randomUUID();
            await store.insert({
                householdId: c.householdId,
                code: "fridge.expiring",
                subjectKind: "fridge_item",
                subjectId: olderId,
                relatedKey: "",
                dismissedBy: c.userId,
            });
            await Bun.sleep(5);
            await store.insert({
                householdId: c.householdId,
                code: "fridge.expiring",
                subjectKind: "fridge_item",
                subjectId: newerId,
                relatedKey: "",
                dismissedBy: c.userId,
            });
            if (c.sql) {
                await c.sql`
                    update public.notice_dismissals
                    set created_at = ${"2020-01-01T00:00:00.000Z"}
                    where household_id = ${c.householdId}
                      and subject_id = ${olderId}::uuid
                `;
                await c.sql`
                    update public.notice_dismissals
                    set created_at = ${"2030-01-01T00:00:00.000Z"}
                    where household_id = ${c.householdId}
                      and subject_id = ${newerId}::uuid
                `;
            }
            const listed = await store.listForHousehold(c.householdId);
            const newerIdx = listed.findIndex((r) => r.subjectId === newerId);
            const olderIdx = listed.findIndex((r) => r.subjectId === olderId);
            expect(newerIdx).toBeGreaterThanOrEqual(0);
            expect(olderIdx).toBeGreaterThanOrEqual(0);
            expect(newerIdx).toBeLessThan(olderIdx);
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

        test("deleteForRelatedKey removes only matching related key", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const related = crypto.randomUUID();
            const otherRelated = crypto.randomUUID();
            const hit = crypto.randomUUID();
            const spare = crypto.randomUUID();
            await store.insert({
                householdId: c.householdId,
                code: "fridge.expiring",
                subjectKind: "food",
                subjectId: hit,
                relatedKey: related,
                dismissedBy: c.userId,
            });
            await store.insert({
                householdId: c.householdId,
                code: "fridge.expiring",
                subjectKind: "food",
                subjectId: spare,
                relatedKey: otherRelated,
                dismissedBy: c.userId,
            });
            await store.deleteForRelatedKey(c.householdId, related);
            const rows = await store.listForHousehold(c.householdId);
            expect(rows.some((r) => r.subjectId === hit)).toBe(false);
            expect(rows.some((r) => r.subjectId === spare)).toBe(true);
        });
    });
}
