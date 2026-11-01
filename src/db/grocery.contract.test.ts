import { afterEach, beforeEach, describe } from "bun:test";
import { createMemoryGroceryStore } from "../domain/grocery.js";
import { liveGroceryStore } from "./grocery.js";
import {
    runGroceryListStoreContract,
    type StoreContractCtx,
} from "./contract/grocery.contract.js";
import { describeDb } from "./testing/pg.js";
import {
    seedFood,
    seedGrocerySection,
    seedGroceryStore,
    seedHousehold,
} from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

let memoryCtx: StoreContractCtx;

describe("grocery store contract", () => {
    beforeEach(() => {
        memoryCtx = {
            householdId: crypto.randomUUID(),
            otherHouseholdId: crypto.randomUUID(),
            storeId: crypto.randomUUID(),
            sectionId: crypto.randomUUID(),
            foodId: crypto.randomUUID(),
        };
    });

    runGroceryListStoreContract(
        "memory",
        () => createMemoryGroceryStore(),
        async () => {},
        () => memoryCtx,
    );
});

describeDb(pgAvailable !== null, "grocery store contract live", (getCtx) => {
    let ctx: StoreContractCtx;

    afterEach(() => {
        setSqlForTests(null);
    });

    beforeEach(async () => {
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
        ctx = {
            householdId: primary.householdId,
            otherHouseholdId: crypto.randomUUID(),
            storeId,
            sectionId,
            foodId,
        };
    });

    runGroceryListStoreContract(
        "live",
        () => liveGroceryStore(),
        async () => {
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
            ctx = {
                householdId: primary.householdId,
                otherHouseholdId: crypto.randomUUID(),
                storeId,
                sectionId,
                foodId,
            };
        },
        () => ctx,
    );
});
