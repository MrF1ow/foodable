import { expect, test } from "bun:test";
import {
    createMemoryNoticeDismissalsStore,
    dismissalKey,
    isDismissed,
    normalizePairIds,
    NoticeDismissError,
    assertDismissibleCode,
} from "./notice-dismissals.js";
import type { Notice } from "./notices.js";
import { dismissNotice, noticesFor, undoDismissal } from "./notices-for.js";
import { createMemoryFoodsStore } from "./foods.js";
import { createMemoryFridgeStore } from "./fridge.js";
import { createMemoryRecipesStore } from "./recipes.js";

const HH = "hh-1";

test("normalizePairIds orders uuids", () => {
    const a = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const b = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    expect(normalizePairIds(a, b)).toEqual({
        subjectId: b,
        relatedKey: a,
    });
});

test("dismiss info notice and undo", async () => {
    const dismissals = createMemoryNoticeDismissalsStore();
    const fridge = createMemoryFridgeStore();
    fridge.linkDismissals(dismissals);
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const deps = { foods, fridge, recipes, dismissals };

    await dismissals.insert({
        householdId: HH,
        code: "fridge.expiring",
        subjectKind: "fridge_item",
        subjectId: "f1",
        relatedKey: "",
        dismissedBy: "u1",
    });

    const n: Notice = {
        code: "fridge.expiring",
        severity: "info",
        subject: { kind: "fridge_item", id: "f1" },
        related: [],
        params: { name: "Milk", amount: 1, unit: "l", expiresOn: "2026-01-01" },
    };
    expect(isDismissed(n, await dismissals.listForHousehold(HH))).toBe(true);

    const n2: Notice = { ...n, subject: { kind: "fridge_item", id: "f2" } };
    expect(isDismissed(n2, await dismissals.listForHousehold(HH))).toBe(false);

    expect(() => assertDismissibleCode("fridge.expired")).toThrow(
        NoticeDismissError,
    );
});

test("noticesFor calls listForHousehold once", async () => {
    const dismissals = createMemoryNoticeDismissalsStore();
    let calls = 0;
    const tracking = {
        ...dismissals,
        async listForHousehold(householdId: string) {
            calls += 1;
            return dismissals.listForHousehold(householdId);
        },
    };
    const deps = {
        foods: createMemoryFoodsStore(),
        fridge: createMemoryFridgeStore(),
        recipes: createMemoryRecipesStore(),
        dismissals: tracking,
    };
    await noticesFor(deps, HH);
    expect(calls).toBe(1);
});
