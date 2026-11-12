import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createMemoryGroceryStore } from "../domain/grocery.js";
import { createMemoryStoreManagement } from "../domain/grocery-stores.js";
import {
    createGroceryStore,
    createMemorySettingsStore,
} from "../domain/settings.js";
import { EMPTY_HOUSEHOLD_PREFERENCES } from "../household.js";
import {
    runStoreManagementContract,
    type StoreManagementHarness,
} from "./contract/grocery-stores.contract.js";
import type { StoreContractCtx } from "./contract/helpers.js";
import { liveGroceryStore } from "./grocery.js";
import { liveStoreManagement } from "./grocery-stores.js";
import { getHouseholdConfig, updateHouseholdConfig } from "./household.js";
import { liveSettingsStore } from "./settings.js";
import { setFallbackActorForTests } from "./actor.js";
import { setSqlForTests } from "./sql.js";
import { describeDb } from "./testing/pg.js";
import {
    seedFood,
    seedGroceryStore,
    seedHousehold,
} from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";

const pgAvailable = await findPgBin();

describe("store management (memory)", () => {
    let ctx: StoreContractCtx;
    let harness: StoreManagementHarness;

    beforeEach(() => {
        const settings = createMemorySettingsStore();
        const grocery = createMemoryGroceryStore();
        ctx = {
            householdId: crypto.randomUUID(),
            userId: crypto.randomUUID(),
            otherHouseholdId: crypto.randomUUID(),
            storeId: crypto.randomUUID(),
            sectionId: crypto.randomUUID(),
            foodId: crypto.randomUUID(),
            locationId: crypto.randomUUID(),
        };
        harness = {
            settings,
            grocery,
            management: createMemoryStoreManagement(settings, grocery),
            seedForeignStore: async () =>
                (await createGroceryStore(settings, ctx.otherHouseholdId, "X"))
                    .id,
        };
    });

    runStoreManagementContract(
        "memory",
        () => harness,
        async () => {},
        () => ctx,
    );
});

describeDb(pgAvailable !== null, "store management (live)", (getCtx) => {
    let ctx: StoreContractCtx;

    afterEach(() => setSqlForTests(null));

    async function reseed(): Promise<void> {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const primary = await seedHousehold(sql);
        const other = await seedHousehold(sql);
        // Two households exist; pin the actor so it is not a coin flip.
        setFallbackActorForTests({
            kind: "user",
            userId: primary.userId,
            householdId: primary.householdId,
        });
        const foodId = await seedFood(sql, primary.householdId);
        ctx = {
            householdId: primary.householdId,
            userId: primary.userId,
            otherHouseholdId: other.householdId,
            storeId: crypto.randomUUID(),
            sectionId: crypto.randomUUID(),
            foodId,
            locationId: crypto.randomUUID(),
            sql,
        };
    }

    beforeEach(reseed);

    runStoreManagementContract(
        "live",
        () => ({
            settings: liveSettingsStore(),
            grocery: liveGroceryStore(),
            management: liveStoreManagement(),
            seedForeignStore: () =>
                seedGroceryStore(getCtx().sql, ctx.otherHouseholdId, "X"),
        }),
        reseed,
        () => ctx,
    );

    test("a deletion that fails part-way rolls the moves back", async () => {
        const settings = liveSettingsStore();
        const grocery = liveGroceryStore();
        const management = liveStoreManagement();
        const a = await createGroceryStore(settings, ctx.householdId, "A");
        const b = await createGroceryStore(settings, ctx.householdId, "B");
        const sectionsA = await settings.listSections(a.id);
        const sectionsB = await settings.listSections(b.id);
        const line = await grocery.insertLine({
            id: crypto.randomUUID(),
            householdId: ctx.householdId,
            storeId: a.id,
            sectionId: sectionsA[0]!.id,
            kind: "food",
            displayName: "Milk",
            quantity: { amount: 1, unit: "L" },
            foodId: ctx.foodId,
            checked: false,
            source: "manual",
            sourceFridgeItemId: null,
            note: null,
        });
        await expect(
            management.applyStoreDeletion(ctx.householdId, {
                storeId: a.id,
                moveTo: b.id,
                moves: [
                    { lineId: line.id, sectionId: sectionsB[0]!.id },
                    // Not a line of this store: the second move fails after the first applied.
                    {
                        lineId: crypto.randomUUID(),
                        sectionId: sectionsB[0]!.id,
                    },
                ],
                deleteLineIds: [],
                clearDefault: false,
            }),
        ).rejects.toThrow();
        const lines = await grocery.listLines(ctx.householdId);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ id: line.id, storeId: a.id });
        expect(await settings.listStores(ctx.householdId)).toHaveLength(2);
    });

    test("a store of another household cannot be deleted or reordered through this one", async () => {
        const foreign = await seedGroceryStore(
            getCtx().sql,
            ctx.otherHouseholdId,
            "X",
        );
        await expect(
            liveStoreManagement().applyStoreDeletion(ctx.householdId, {
                storeId: foreign,
                moveTo: null,
                moves: [],
                deleteLineIds: [],
                clearDefault: false,
            }),
        ).rejects.toThrow();
        const [still] = await getCtx().sql`
            select id from public.grocery_stores where id = ${foreign}
        `;
        expect(still).toBeDefined();
    });

    test("household config updates keep the grocery preferences", async () => {
        const settings = liveSettingsStore();
        const store = await createGroceryStore(settings, ctx.householdId, "A");
        await settings.setGroceryPreferences(ctx.householdId, {
            defaultStoreId: store.id,
            useUsualStore: true,
        });
        const config = await getHouseholdConfig(ctx.householdId);
        expect(config.preferences).toEqual(EMPTY_HOUSEHOLD_PREFERENCES);
        await updateHouseholdConfig(ctx.householdId, {
            ...config,
            name: "Renamed",
        });
        expect(await settings.getGroceryPreferences(ctx.householdId)).toEqual({
            defaultStoreId: store.id,
            useUsualStore: true,
        });
        const [row] = await getCtx().sql`
            select household_preferences as prefs from public.households
            where id = ${ctx.householdId}
        `;
        expect(row.prefs["grocery.default_store_id"]).toBe(store.id);
        expect(row.prefs["grocery.use_usual_store"]).toBe(true);
    });
});
