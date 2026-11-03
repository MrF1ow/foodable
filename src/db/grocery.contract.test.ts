import { afterEach, beforeEach, describe } from "bun:test";
import { createMemoryGroceryStore } from "../domain/grocery.js";
import { liveGroceryStore } from "./grocery.js";
import { runGroceryListStoreContract } from "./contract/grocery.contract.js";
import type { StoreContractCtx } from "./contract/helpers.js";
import { describeDb } from "./testing/pg.js";
import {
    seedFood,
    seedFridgeLocation,
    seedGrocerySection,
    seedGroceryStore,
    seedHousehold,
} from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

describe("grocery store contract", () => {
    let memoryCtx: StoreContractCtx;
    let grocery: ReturnType<typeof createMemoryGroceryStore> & {
        __paritySetLineCreatedAt(id: string, createdAt: string): void;
    };

    beforeEach(() => {
        grocery = createMemoryGroceryStore() as typeof grocery;
        memoryCtx = {
            householdId: crypto.randomUUID(),
            userId: crypto.randomUUID(),
            otherHouseholdId: crypto.randomUUID(),
            storeId: crypto.randomUUID(),
            sectionId: crypto.randomUUID(),
            foodId: crypto.randomUUID(),
            locationId: crypto.randomUUID(),
            setLineCreatedAt: async (id, createdAt) => {
                grocery.__paritySetLineCreatedAt(id, createdAt);
            },
        };
    });

    runGroceryListStoreContract(
        "memory",
        () => grocery,
        async () => {},
        () => memoryCtx,
    );
});

describeDb(pgAvailable !== null, "grocery store contract live", (getCtx) => {
    let ctx: StoreContractCtx;

    afterEach(() => {
        setSqlForTests(null);
    });

    async function reseed(): Promise<void> {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const primary = await seedHousehold(sql);
        const storeId = await seedGroceryStore(sql, primary.householdId);
        const sectionId = await seedGrocerySection(
            sql,
            primary.householdId,
            storeId,
        );
        const foodId = await seedFood(sql, primary.householdId);
        const locationId = await seedFridgeLocation(sql, primary.householdId);
        ctx = {
            householdId: primary.householdId,
            userId: primary.userId,
            otherHouseholdId: crypto.randomUUID(),
            storeId,
            sectionId,
            foodId,
            locationId,
            sql,
            setLineCreatedAt: async (lineId, createdAt) => {
                await sql`
                    update public.grocery_lines
                    set created_at = ${createdAt}::timestamptz
                    where id = ${lineId}
                `;
            },
        };
    }

    beforeEach(async () => {
        await reseed();
    });

    runGroceryListStoreContract(
        "live",
        () => liveGroceryStore(),
        reseed,
        () => ctx,
    );
});
