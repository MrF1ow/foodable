import { describe, expect, test } from "bun:test";
import type { RulesStore } from "../../domain/rules.js";
import {
    sampleAllergen,
    sampleDislike,
    samplePersonRule,
    sampleStoreRule,
    type StoreContractCtx,
} from "./helpers.js";

export function runRulesStoreContract(
    label: string,
    createStore: () => RulesStore,
    reset: () => Promise<void>,
    ctx: () => StoreContractCtx,
): void {
    describe(`${label} rules store`, () => {
        test("listStoreRules and insertStoreRule", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const second = sampleStoreRule(c, { sortOrder: 1, body: "B" });
            const first = sampleStoreRule(c, { sortOrder: 0, body: "A" });
            await store.insertStoreRule(second);
            await store.insertStoreRule(first);
            expect(
                (await store.listStoreRules(c.storeId)).map((r) => r.body),
            ).toEqual(["A", "B"]);
        });

        test("listPersonRules, insertPersonRule, deletePersonRule", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const rule = samplePersonRule(c);
            await store.insertPersonRule(rule);
            expect(
                await store.listPersonRules(c.householdId, c.userId),
            ).toHaveLength(1);
            expect(
                await store.deletePersonRule({
                    householdId: c.householdId,
                    userId: c.userId,
                    id: rule.id,
                }),
            ).toBe(true);
            expect(
                await store.deletePersonRule({
                    householdId: c.householdId,
                    userId: c.userId,
                    id: crypto.randomUUID(),
                }),
            ).toBe(false);
        });

        test("listAllergens, insertAllergen, deleteAllergen by created_at", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            // Created order (first) differs from insert and name order.
            const second = sampleAllergen(c, { allergen: "egg" });
            const first = sampleAllergen(c, { allergen: "milk" });
            await store.insertAllergen(second);
            await store.insertAllergen(first);
            if (c.setAllergenCreatedAt) {
                await c.setAllergenCreatedAt(
                    first.id,
                    "2026-01-01T00:00:00+00:00",
                );
                await c.setAllergenCreatedAt(
                    second.id,
                    "2026-01-02T00:00:00+00:00",
                );
            }
            expect(
                (await store.listAllergens(c.householdId, c.userId)).map(
                    (a) => a.allergen,
                ),
            ).toEqual(["milk", "egg"]);
            expect(
                await store.deleteAllergen({
                    householdId: c.householdId,
                    userId: c.userId,
                    id: first.id,
                }),
            ).toBe(true);
        });

        test("listDislikes, insertDislike, deleteDislike", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            // Created order (first) differs from insert and name order.
            const second = sampleDislike(c, { displayName: "A" });
            const first = sampleDislike(c, { displayName: "Z" });
            await store.insertDislike(second);
            await store.insertDislike(first);
            if (c.setDislikeCreatedAt) {
                await c.setDislikeCreatedAt(
                    first.id,
                    "2026-01-01T00:00:00+00:00",
                );
                await c.setDislikeCreatedAt(
                    second.id,
                    "2026-01-02T00:00:00+00:00",
                );
            }
            expect(
                (await store.listDislikes(c.householdId, c.userId)).map(
                    (d) => d.displayName,
                ),
            ).toEqual(["Z", "A"]);
            expect(
                await store.deleteDislike({
                    householdId: c.householdId,
                    userId: c.userId,
                    id: second.id,
                }),
            ).toBe(true);
        });

        test("household scoping on listStoreRules", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            await store.insertStoreRule(sampleStoreRule(c));
            expect(await store.listStoreRules(crypto.randomUUID())).toEqual([]);
        });
    });
}
