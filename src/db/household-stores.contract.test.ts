import { afterEach, beforeEach, describe } from "bun:test";
import { createMemoryFoodsStore } from "../domain/foods.js";
import { createMemoryFridgeStore } from "../domain/fridge.js";
import { createMemoryGroceryStore } from "../domain/grocery.js";
import { createMemoryRecipesStore } from "../domain/recipes.js";
import { createMemoryRulesStore } from "../domain/rules.js";
import { createMemorySettingsStore } from "../domain/settings.js";
import { createMemoryStockStore } from "../domain/stock.js";
import { runFoodsStoreContract } from "./contract/foods.contract.js";
import { runFridgeStoreContract } from "./contract/fridge.contract.js";
import { runGroceryListStoreContract } from "./contract/grocery.contract.js";
import type { StoreContractCtx } from "./contract/helpers.js";
import { runRecipesStoreContract } from "./contract/recipes.contract.js";
import { runRulesStoreContract } from "./contract/rules.contract.js";
import { runSettingsStoreContract } from "./contract/settings.contract.js";
import { runStockStoreContract } from "./contract/stock.contract.js";
import { runNoticeDismissalsStoreContract } from "./contract/notice-dismissals.contract.js";
import { createMemoryNoticeDismissalsStore } from "../domain/notice-dismissals.js";
import { liveNoticeDismissalsStore } from "./notice-dismissals.js";
import { liveFoodsStore } from "./foods.js";
import { liveFridgeStore } from "./fridge.js";
import { liveGroceryStore } from "./grocery.js";
import { liveRecipesStore } from "./recipes.js";
import { liveRulesStore } from "./rules.js";
import { liveSettingsStore } from "./settings.js";
import { liveStockStore } from "./stock.js";
import { describeDb } from "./testing/pg.js";
import {
    asUser,
    seedFood,
    seedFridgeItem,
    seedFridgeLocation,
    seedGrocerySection,
    seedGroceryStore,
    seedHousehold,
} from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

type MemoryGrocery = ReturnType<typeof createMemoryGroceryStore> & {
    __paritySetLineCreatedAt(id: string, createdAt: string): void;
};
type MemoryFridge = ReturnType<typeof createMemoryFridgeStore> & {
    __paritySetItemCreatedAt(id: string, createdAt: string): void;
};
type MemoryRules = ReturnType<typeof createMemoryRulesStore> & {
    __paritySetAllergenCreatedAt(id: string, createdAt: string): void;
    __paritySetDislikeCreatedAt(id: string, createdAt: string): void;
};

type MemoryRefs = {
    grocery: MemoryGrocery;
    fridge: MemoryFridge;
    rules: MemoryRules;
};

describe("household store contracts (memory)", () => {
    let ctx: StoreContractCtx;
    let refs: MemoryRefs;

    beforeEach(() => {
        refs = {
            grocery: createMemoryGroceryStore() as MemoryGrocery,
            fridge: createMemoryFridgeStore() as MemoryFridge,
            rules: createMemoryRulesStore() as MemoryRules,
        };
        ctx = {
            householdId: crypto.randomUUID(),
            userId: crypto.randomUUID(),
            otherHouseholdId: crypto.randomUUID(),
            storeId: crypto.randomUUID(),
            sectionId: crypto.randomUUID(),
            foodId: crypto.randomUUID(),
            locationId: crypto.randomUUID(),
            ensureFridgeItem: async () => crypto.randomUUID(),
            setLineCreatedAt: async (id, createdAt) => {
                refs.grocery.__paritySetLineCreatedAt(id, createdAt);
            },
            setFridgeItemCreatedAt: async (id, createdAt) => {
                refs.fridge.__paritySetItemCreatedAt(id, createdAt);
            },
            setAllergenCreatedAt: async (id, createdAt) => {
                refs.rules.__paritySetAllergenCreatedAt(id, createdAt);
            },
            setDislikeCreatedAt: async (id, createdAt) => {
                refs.rules.__paritySetDislikeCreatedAt(id, createdAt);
            },
        };
    });

    runStockStoreContract(
        "memory",
        () => createMemoryStockStore(),
        async () => {},
        () => ctx,
    );
    runGroceryListStoreContract(
        "memory",
        () => refs.grocery,
        async () => {},
        () => ctx,
    );
    runFridgeStoreContract(
        "memory",
        () => refs.fridge,
        async () => {},
        () => ctx,
    );
    runSettingsStoreContract(
        "memory",
        () => createMemorySettingsStore(),
        async () => {},
        () => ctx,
    );
    runRulesStoreContract(
        "memory",
        () => refs.rules,
        async () => {},
        () => ctx,
    );
    runRecipesStoreContract(
        "memory",
        () => createMemoryRecipesStore(),
        async () => {},
        () => ctx,
    );
    runFoodsStoreContract(
        "memory",
        () => createMemoryFoodsStore(),
        async () => {},
        () => ctx,
    );
    runNoticeDismissalsStoreContract(
        "memory",
        () => createMemoryNoticeDismissalsStore(),
        async () => {},
        () => ctx,
    );
});

describeDb(
    pgAvailable !== null,
    "household store contracts (live)",
    (getCtx) => {
        let ctx: StoreContractCtx;

        afterEach(() => setSqlForTests(null));

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
            const locationId = await seedFridgeLocation(
                sql,
                primary.householdId,
            );
            ctx = {
                householdId: primary.householdId,
                userId: primary.userId,
                otherHouseholdId: crypto.randomUUID(),
                storeId,
                sectionId,
                foodId,
                locationId,
                ensureFridgeItem: () =>
                    seedFridgeItem(
                        sql,
                        primary.householdId,
                        locationId,
                        foodId,
                    ),
                sql,
                ensureMember: async () => {
                    const memberId = crypto.randomUUID();
                    await sql`
                        insert into public.users (id, email)
                        values (${memberId}, ${`member-${memberId}@foodable.test`})
                    `;
                    await sql`
                        insert into public.household_members (
                            household_id, user_id, role, display_name
                        )
                        values (${primary.householdId}, ${memberId}, ${"member"}, ${"Member"})
                    `;
                    return memberId;
                },
                asMember: (memberId, fn) =>
                    asUser(memberId, fn, primary.householdId),
                setLineCreatedAt: async (lineId, createdAt) => {
                    await sql`
                        update public.grocery_lines
                        set created_at = ${createdAt}::timestamptz
                        where id = ${lineId}
                    `;
                },
                setFridgeItemCreatedAt: async (itemId, createdAt) => {
                    await sql`
                        update public.fridge_items
                        set created_at = ${createdAt}::timestamptz
                        where id = ${itemId}
                    `;
                },
                setAllergenCreatedAt: async (id, createdAt) => {
                    await sql`
                        update public.member_allergens
                        set created_at = ${createdAt}::timestamptz
                        where id = ${id}
                    `;
                },
                setDislikeCreatedAt: async (id, createdAt) => {
                    await sql`
                        update public.member_dislikes
                        set created_at = ${createdAt}::timestamptz
                        where id = ${id}
                    `;
                },
            };
        }

        beforeEach(async () => {
            await reseed();
        });

        runStockStoreContract(
            "live",
            () => liveStockStore(),
            reseed,
            () => ctx,
        );
        runGroceryListStoreContract(
            "live",
            () => liveGroceryStore(),
            reseed,
            () => ctx,
        );
        runFridgeStoreContract(
            "live",
            () => liveFridgeStore(),
            reseed,
            () => ctx,
        );
        runSettingsStoreContract(
            "live",
            () => liveSettingsStore(),
            reseed,
            () => ctx,
        );
        runRulesStoreContract(
            "live",
            () => liveRulesStore(),
            reseed,
            () => ctx,
        );
        runRecipesStoreContract(
            "live",
            () => liveRecipesStore(),
            reseed,
            () => ctx,
        );
        runFoodsStoreContract(
            "live",
            () => liveFoodsStore(),
            reseed,
            () => ctx,
        );
        runNoticeDismissalsStoreContract(
            "live",
            () => liveNoticeDismissalsStore(),
            reseed,
            () => ctx,
        );
    },
);
