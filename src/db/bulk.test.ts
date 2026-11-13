import { afterEach, beforeEach, expect, test } from "bun:test";
import type { SQL } from "bun";
import { BulkSelectionError, discardFridgeItems } from "../domain/bulk.js";
import { createProduct, setUsualSchedule } from "../domain/foods.js";
import { isUsualFood, runRestockCheck } from "../domain/restock.js";
import { liveRestockCheckDeps } from "../restock-runner.js";
import { getHouseholdConfig, updateHouseholdConfig } from "./household.js";
import { createRecipe, RecipeForbiddenError } from "../domain/recipes.js";
import type { StockStore } from "../domain/stock.js";
import {
    bulkDeleteSavedItems,
    bulkDiscardFridgeItems,
    bulkLockKey,
    bulkRemoveUsuals,
    inBulkTransaction,
} from "./bulk.js";
import { liveFoodsStore } from "./foods.js";
import { liveFridgeStore } from "./fridge.js";
import { liveRecipesStore } from "./recipes.js";
import { liveStockStore } from "./stock.js";
import { setFallbackActorForTests } from "./actor.js";
import { setSqlForTests } from "./sql.js";
import { describeDb, householdOwnerActor } from "./testing/pg.js";
import {
    seedFood,
    seedFridgeItem,
    seedFridgeLocation,
    seedGroceryStore,
    seedHousehold,
} from "./testing/fixtures.js";
import { raceOnUniqueKey } from "./testing/lock-race.js";
import { findPgBin } from "./testing/pg-temp.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "bulk actions db", (getCtx) => {
    let sql: SQL;
    let householdId: string;
    let userId: string;

    beforeEach(async () => {
        const ctx = getCtx();
        await ctx.truncateAll();
        sql = ctx.sql;
        setSqlForTests(sql);
        ({ householdId, userId } = await seedHousehold(sql));
    });

    afterEach(() => setSqlForTests(null));

    async function seedFridge(names: string[]) {
        const locationId = await seedFridgeLocation(sql, householdId);
        const items: string[] = [];
        for (const name of names) {
            const foodId = await seedFood(sql, householdId, { name });
            items.push(
                await seedFridgeItem(sql, householdId, locationId, foodId, {
                    displayName: name,
                    amount: 3,
                    unit: "each",
                }),
            );
        }
        return { locationId, items };
    }

    const fridgeNames = async () =>
        (
            (await sql`
                select display_name from public.fridge_items
                where household_id = ${householdId}
                order by display_name
            `) as { display_name: string }[]
        ).map((r) => r.display_name);

    const discardRows = async () =>
        (await sql`
            select delta::float8 as delta, actor_user_id
            from public.stock_movements
            where household_id = ${householdId} and reason = 'discard'
        `) as { delta: number; actor_user_id: string | null }[];

    test("discard writes one discard movement per item as the member", async () => {
        const { items } = await seedFridge(["Yogurt", "Spinach", "Cheese"]);
        const result = await bulkDiscardFridgeItems({
            householdId,
            itemIds: [items[0]!, items[1]!],
            actorUserId: userId,
        });
        expect(result).toEqual({ status: "applied", count: 2 });
        expect(await fridgeNames()).toEqual(["Cheese"]);
        const rows = await discardRows();
        expect(rows).toHaveLength(2);
        expect(rows.every((r) => r.delta === -3)).toBe(true);
        expect(rows.every((r) => r.actor_user_id === userId)).toBe(true);
    });

    test("discard with one id that is not there takes nothing from the fridge", async () => {
        const { items } = await seedFridge(["Yogurt", "Spinach"]);
        await expect(
            bulkDiscardFridgeItems({
                householdId,
                itemIds: [items[0]!, crypto.randomUUID()],
            }),
        ).rejects.toBeInstanceOf(BulkSelectionError);
        expect(await fridgeNames()).toEqual(["Spinach", "Yogurt"]);
        expect(await discardRows()).toHaveLength(0);
    });

    test("a discard that throws part way leaves every item and the ledger as they were", async () => {
        const { items } = await seedFridge(["Yogurt", "Spinach", "Cheese"]);
        const real = liveStockStore();
        let written = 0;
        const failing: StockStore = {
            ...real,
            async insertMovement(row) {
                written += 1;
                if (written === 2) throw new Error("ledger write failed");
                return real.insertMovement(row);
            },
        };
        await expect(
            inBulkTransaction(householdId, "fridge-discard", () =>
                discardFridgeItems(
                    liveFridgeStore(),
                    failing,
                    liveFoodsStore(),
                    { householdId, itemIds: items },
                ),
            ),
        ).rejects.toThrow("ledger write failed");
        expect(written).toBe(2);
        expect(await fridgeNames()).toEqual(["Cheese", "Spinach", "Yogurt"]);
        expect(await discardRows()).toHaveLength(0);
    });

    test("a repeated discard is answered as done and writes nothing more", async () => {
        const { items } = await seedFridge(["Yogurt"]);
        const input = { householdId, itemIds: items, actorUserId: userId };
        await bulkDiscardFridgeItems(input);
        expect(await bulkDiscardFridgeItems(input)).toEqual({
            status: "already",
            count: 0,
        });
        expect(await discardRows()).toHaveLength(1);
    });

    test("two discards of the same items at once discard them once", async () => {
        const { pg, sql: owner } = getCtx();
        const { items } = await seedFridge(["Yogurt", "Spinach"]);
        const key = bulkLockKey(householdId, "fridge-discard");
        // The holder takes the batch's lock first, so both submits queue
        // behind it and then run one after the other.
        const [a, b] = await raceOnUniqueKey({
            url: pg.url,
            restoreSql: owner,
            blockInsert: (tx) =>
                tx`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
            run: () =>
                bulkDiscardFridgeItems({
                    householdId,
                    itemIds: items,
                    actorUserId: userId,
                }),
        });
        expect([a.status, b.status].sort()).toEqual(["already", "applied"]);
        expect(await discardRows()).toHaveLength(2);
    });

    async function seedUsual(name: string) {
        const foods = liveFoodsStore();
        const plainId = await seedFood(sql, householdId, { name });
        const product = await createProduct(foods, householdId, plainId, {
            name: `${name} (store brand)`,
            makeUsual: true,
        });
        return { plainId, productId: product.id };
    }

    const genericOf = async (id: string) =>
        (
            await sql`select generic_food_id from public.foods where id = ${id}`
        )[0].generic_food_id as string | null;

    test("removing usuals unlinks their products in one go", async () => {
        const milk = await seedUsual("Milk");
        const eggs = await seedUsual("Eggs");
        const butter = await seedUsual("Butter");
        const result = await bulkRemoveUsuals({
            householdId,
            foodIds: [milk.plainId, eggs.plainId],
        });
        expect(result).toEqual({ status: "applied", count: 2 });
        expect(await genericOf(milk.productId)).toBeNull();
        expect(await genericOf(eggs.productId)).toBeNull();
        expect(await genericOf(butter.productId)).toBe(butter.plainId);
        expect(
            await bulkRemoveUsuals({
                householdId,
                foodIds: [milk.plainId, eggs.plainId],
            }),
        ).toEqual({ status: "already", count: 0 });
    });

    test("a removed usual is no longer one: the restock runner leaves it off Groceries", async () => {
        const foods = liveFoodsStore();
        const milk = await seedUsual("Milk");
        const eggs = await seedUsual("Eggs");
        for (const id of [milk.plainId, eggs.plainId]) {
            await setUsualSchedule(foods, householdId, id, {
                restockSchedule: "weekly",
                restockWhenLow: true,
            });
        }
        const storeId = await seedGroceryStore(sql, householdId, "Costco");
        await sql`
            insert into public.grocery_sections (
                id, household_id, store_id, name, sort_order, hidden, is_other
            )
            values (
                ${crypto.randomUUID()}, ${householdId}, ${storeId},
                ${"Other"}, ${99}, ${false}, ${true}
            )
        `;
        const base = await getHouseholdConfig(householdId);
        await updateHouseholdConfig(householdId, {
            ...base,
            preferences: {
                ...base.preferences,
                timezone: "UTC",
                restock: {
                    enabled: true,
                    weekday: 6,
                    time: "00:00",
                    lastRunOn: null,
                },
            },
        });

        await bulkRemoveUsuals({ householdId, foodIds: [milk.plainId] });

        const listed = await foods.listFoods(householdId);
        expect(listed.filter(isUsualFood).map((f) => f.name)).toEqual(["Eggs"]);
        const [row] = await sql`
            select restock_schedule, restock_every_weeks, restock_paused,
                   restock_when_low, restock_low_level, last_restocked_on
            from public.foods where id = ${milk.plainId}::uuid
        `;
        expect(row).toEqual({
            restock_schedule: null,
            restock_every_weeks: null,
            restock_paused: false,
            restock_when_low: false,
            restock_low_level: null,
            last_restocked_on: null,
        });

        setFallbackActorForTests(null);
        try {
            await runRestockCheck(
                liveRestockCheckDeps(),
                new Date("2026-06-06T12:00:00.000Z"),
            );
        } finally {
            setFallbackActorForTests(householdOwnerActor);
        }
        const lines = (await sql`
            select food_id from public.grocery_lines
            where household_id = ${householdId} and source = ${"restock"}
        `) as { food_id: string }[];
        // The usual that stayed is added; the removed one is not.
        expect(lines.map((l) => l.food_id)).toEqual([eggs.plainId]);
    });

    test("removing usuals with a food that is not one writes nothing", async () => {
        const milk = await seedUsual("Milk");
        const salt = await seedFood(sql, householdId, { name: "Salt" });
        await expect(
            bulkRemoveUsuals({
                householdId,
                foodIds: [milk.plainId, salt],
            }),
        ).rejects.toBeInstanceOf(BulkSelectionError);
        expect(await genericOf(milk.productId)).toBe(milk.plainId);
    });

    async function seedSaved() {
        const oats = await seedFood(sql, householdId, { name: "Oats" });
        const recipes = liveRecipesStore();
        const mine = await createRecipe(recipes, {
            householdId,
            creatorId: userId,
            name: "Porridge",
            yieldPortions: 2,
        });
        const peer = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${peer}, ${`peer-${peer}@foodable.test`})
        `;
        await sql`
            insert into public.household_members (
                household_id, user_id, role, display_name
            )
            values (${householdId}, ${peer}, ${"member"}, ${"Peer"})
        `;
        const theirs = await createRecipe(recipes, {
            householdId,
            creatorId: peer,
            name: "Paella",
            yieldPortions: 4,
        });
        return { oats, mine: mine.id, theirs: theirs.id, peer };
    }

    const recipeCount = async () =>
        Number(
            (
                await sql`
                    select count(*)::int as n from public.recipes
                    where household_id = ${householdId}
                `
            )[0].n,
        );

    const archived = async (id: string) =>
        (await sql`select archived_at from public.foods where id = ${id}`)[0]
            .archived_at !== null;

    test("saved items: foods are archived, recipes deleted, and a repeat is done", async () => {
        const { oats, mine, theirs } = await seedSaved();
        const input = {
            householdId,
            foodIds: [oats],
            recipeIds: [mine, theirs],
            actor: { userId, isOwner: true },
        };
        expect(await bulkDeleteSavedItems(input)).toEqual({
            status: "applied",
            count: 3,
        });
        expect(await archived(oats)).toBe(true);
        expect(await recipeCount()).toBe(0);
        expect(await bulkDeleteSavedItems(input)).toEqual({
            status: "already",
            count: 0,
        });
    });

    test("saved items: a recipe the member cannot delete stops the whole batch", async () => {
        const { oats, mine, theirs, peer } = await seedSaved();
        await expect(
            bulkDeleteSavedItems({
                householdId,
                foodIds: [oats],
                recipeIds: [mine, theirs],
                actor: { userId: peer, isOwner: false },
            }),
        ).rejects.toBeInstanceOf(RecipeForbiddenError);
        expect(await archived(oats)).toBe(false);
        expect(await recipeCount()).toBe(2);
    });
});
