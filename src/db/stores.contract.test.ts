import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createMemoryFoodsStore } from "../domain/foods.js";
import { createMemoryRecipesStore } from "../domain/recipes.js";
import { createMemoryStockStore } from "../domain/stock.js";
import { liveFridgeStore } from "./fridge.js";
import { liveFoodsStore } from "./foods.js";
import { liveRecipesStore } from "./recipes.js";
import { liveRulesStore } from "./rules.js";
import { liveSettingsStore } from "./settings.js";
import { liveStockStore } from "./stock.js";
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

type LiveCtx = {
    householdId: string;
    userId: string;
    storeId: string;
    sectionId: string;
    foodId: string;
    locationId: string;
};

describe("household store contracts (memory)", () => {
    test("stock insert and list ordering", async () => {
        const stock = createMemoryStockStore();
        const householdId = crypto.randomUUID();
        const foodId = crypto.randomUUID();
        const m1 = {
            id: crypto.randomUUID(),
            householdId,
            foodId,
            fridgeItemId: null,
            delta: 1,
            unit: "g",
            reason: "purchase" as const,
            groceryLineId: null,
            recipeId: null,
            mealId: null,
            actorUserId: null,
            createdAt: "2026-01-01T12:00:00+00:00",
        };
        const m2 = {
            ...m1,
            id: crypto.randomUUID(),
            createdAt: "2026-01-02T12:00:00+00:00",
        };
        await stock.insertMovement(m1);
        await stock.insertMovement(m2);
        const listed = await stock.listMovements(householdId, undefined);
        expect(listed.map((m) => m.id)).toEqual([m2.id, m1.id]);
    });

    test("foods alias upsert and listAllAliases", async () => {
        const foods = createMemoryFoodsStore();
        const householdId = crypto.randomUUID();
        const foodId = crypto.randomUUID();
        await foods.insertFood({
            id: foodId,
            householdId,
            kind: "food",
            name: "Apple",
            normalizedName: "apple",
            defaultUnit: "g",
            brand: null,
            gramsPerEach: null,
            gramsPerMl: null,
            calories: null,
            proteinG: null,
            carbsG: null,
            fatG: null,
            fiberG: null,
            sugarG: null,
            alcoholG: null,
            caffeineMg: null,
            nutritionSource: null,
            allergens: [],
            offSourceId: null,
            createdBy: null,
            archivedAt: null,
            createdAt: "2026-01-01T00:00:00+00:00",
            updatedAt: "2026-01-01T00:00:00+00:00",
        });
        await foods.setAlias(householdId, "fruit", foodId);
        await foods.setAlias(householdId, "fruit", foodId);
        const map = await foods.listAllAliases(householdId);
        expect(map.get(foodId)).toEqual(["fruit"]);
    });

    test("recipes portion upsert", async () => {
        const recipes = createMemoryRecipesStore();
        const householdId = crypto.randomUUID();
        const recipeId = crypto.randomUUID();
        const userId = crypto.randomUUID();
        await recipes.insertRecipe({
            id: recipeId,
            householdId,
            creatorId: userId,
            name: "Soup",
            yieldPortions: 4,
            instructions: null,
            sourceUrl: null,
            tags: ["quick"],
            notes: null,
            prepMinutes: null,
            cookMinutes: null,
        });
        await recipes.upsertPortion({
            recipeId,
            householdId,
            userId,
            portionCount: 2,
        });
        const again = await recipes.upsertPortion({
            recipeId,
            householdId,
            userId,
            portionCount: 3,
        });
        expect(again.portionCount).toBe(3);
    });
});

describeDb(
    pgAvailable !== null,
    "household store contracts (live)",
    (getCtx) => {
        let ctx: LiveCtx;

        afterEach(() => setSqlForTests(null));

        beforeEach(async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const seeded = await seedHousehold(sql);
            const storeId = await seedGroceryStore(sql, seeded.householdId);
            const sectionId = await seedGrocerySection(
                sql,
                seeded.householdId,
                storeId,
            );
            const foodId = await seedFood(sql, seeded.householdId);
            const locationId = await seedFridgeLocation(
                sql,
                seeded.householdId,
            );
            ctx = {
                householdId: seeded.householdId,
                userId: seeded.userId,
                storeId,
                sectionId,
                foodId,
                locationId,
            };
        });

        test("live stock and fridge round-trip null dates", async () => {
            const stock = liveStockStore();
            const fridge = liveFridgeStore();
            const movement = await stock.insertMovement({
                id: crypto.randomUUID(),
                householdId: ctx.householdId,
                foodId: ctx.foodId,
                fridgeItemId: null,
                delta: 5,
                unit: "g",
                reason: "adjust",
                groceryLineId: null,
                recipeId: null,
                mealId: null,
                actorUserId: ctx.userId,
                createdAt: new Date().toISOString(),
            });
            expect(movement.delta).toBe(5);

            const item = await fridge.insertItem({
                id: crypto.randomUUID(),
                householdId: ctx.householdId,
                locationId: ctx.locationId,
                kind: "food",
                displayName: "Yogurt",
                quantity: { amount: 1, unit: "each" },
                foodId: ctx.foodId,
                purchasedOn: null,
                openedOn: null,
                expiresOn: null,
            });
            expect(item.expiresOn).toBeNull();
        });

        test("live settings location and rules", async () => {
            const settings = liveSettingsStore();
            await settings.setLocation(ctx.householdId, "  Kyiv  ");
            expect(await settings.getLocation(ctx.householdId)).toBe(
                "  Kyiv  ",
            );
            const rules = liveRulesStore();
            const rule = await rules.insertStoreRule({
                id: crypto.randomUUID(),
                householdId: ctx.householdId,
                storeId: ctx.storeId,
                body: "No junk",
                sortOrder: 0,
            });
            expect((await rules.listStoreRules(ctx.storeId))[0]!.id).toBe(
                rule.id,
            );
        });

        test("live foods barcode upsert", async () => {
            const foods = liveFoodsStore();
            const otherFood = await seedFood(getCtx().sql, ctx.householdId, {
                name: "Other",
            });
            await foods.setBarcode(
                ctx.householdId,
                "1234567890123",
                ctx.foodId,
            );
            await foods.setBarcode(ctx.householdId, "1234567890123", otherFood);
            expect(
                await foods.getBarcodeFoodId(ctx.householdId, "1234567890123"),
            ).toBe(otherFood);
        });

        test("live recipes portion upsert", async () => {
            const recipes = liveRecipesStore();
            const recipeId = crypto.randomUUID();
            await recipes.insertRecipe({
                id: recipeId,
                householdId: ctx.householdId,
                creatorId: ctx.userId,
                name: "Stew",
                yieldPortions: 2,
                instructions: null,
                sourceUrl: null,
                tags: [],
                notes: null,
                prepMinutes: null,
                cookMinutes: null,
            });
            const portion = await recipes.upsertPortion({
                recipeId,
                householdId: ctx.householdId,
                userId: ctx.userId,
                portionCount: 1,
            });
            expect(portion.portionCount).toBe(1);
        });
    },
);
