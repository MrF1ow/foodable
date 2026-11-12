import { SQL } from "bun";
import { afterEach, expect, test } from "bun:test";
import {
    cookClaimId,
    cookRecipe,
    putAwayGroceryLines,
    type StockStore,
} from "../domain/stock.js";
import { freezeFridgeItem } from "../domain/fridge.js";
import { addRecipeManualIngredient, createRecipe } from "../domain/recipes.js";
import { liveFoodsStore } from "./foods.js";
import { liveFridgeStore } from "./fridge.js";
import { liveGroceryStore } from "./grocery.js";
import { liveRecipesStore } from "./recipes.js";
import { inStockTransaction, liveStockStore } from "./stock.js";
import { describeDb } from "./testing/pg.js";
import {
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

describeDb(pgAvailable !== null, "kitchen domain db", (getCtx) => {
    afterEach(() => setSqlForTests(null));

    test("putAwayGroceryLines writes per-line location and expiry", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const fridgeLoc = await seedFridgeLocation(sql, householdId, "Fridge");
        const pantryLoc = await seedFridgeLocation(sql, householdId, "Pantry");
        const foodA = await seedFood(sql, householdId, { name: "Apples" });
        const foodB = await seedFood(sql, householdId, { name: "Oats" });
        const storeId = await seedGroceryStore(sql, householdId);
        const sectionId = await seedGrocerySection(sql, householdId, storeId);
        const lineA = crypto.randomUUID();
        const lineB = crypto.randomUUID();
        await sql`
            insert into public.grocery_lines (
                id, household_id, store_id, section_id, kind, display_name,
                amount, unit, food_id, checked
            )
            values
                (${lineA}, ${householdId}, ${storeId}, ${sectionId}, ${"food"}, ${"Apples"}, ${3}, ${"each"}, ${foodA}, ${false}),
                (${lineB}, ${householdId}, ${storeId}, ${sectionId}, ${"food"}, ${"Oats"}, ${500}, ${"g"}, ${foodB}, ${false})
        `;
        const grocery = liveGroceryStore();
        const fridge = liveFridgeStore();
        const stock = liveStockStore();
        const foods = liveFoodsStore();
        await putAwayGroceryLines(grocery, fridge, stock, foods, {
            householdId,
            lineIds: [lineA, lineB],
            perLine: {
                [lineA]: {
                    locationId: fridgeLoc,
                    expiresOn: "2026-07-01",
                },
                [lineB]: {
                    locationId: pantryLoc,
                    expiresOn: "2026-12-31",
                },
            },
        });
        const items = await sql`
            select location_id::text, expires_on::text, food_id::text
            from public.fridge_items
            where household_id = ${householdId}
            order by display_name asc
        `;
        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({
            location_id: fridgeLoc,
            expires_on: "2026-07-01",
            food_id: foodA,
        });
        expect(items[1]).toMatchObject({
            location_id: pantryLoc,
            expires_on: "2026-12-31",
            food_id: foodB,
        });
        const lines = await sql`
            select id from public.grocery_lines where household_id = ${householdId}
        `;
        expect(lines).toHaveLength(0);
    });

    test("putAwayGroceryLines rejects a bad line without partial writes", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const fridgeLoc = await seedFridgeLocation(sql, householdId);
        const foodA = await seedFood(sql, householdId, { name: "Milk" });
        const foodB = await seedFood(sql, householdId, { name: "Bread" });
        const storeId = await seedGroceryStore(sql, householdId);
        const sectionId = await seedGrocerySection(sql, householdId, storeId);
        const lineA = crypto.randomUUID();
        const lineB = crypto.randomUUID();
        await sql`
            insert into public.grocery_lines (
                id, household_id, store_id, section_id, kind, display_name,
                amount, unit, food_id, checked
            )
            values
                (${lineA}, ${householdId}, ${storeId}, ${sectionId}, ${"food"}, ${"Milk"}, ${1}, ${"l"}, ${foodA}, ${false}),
                (${lineB}, ${householdId}, ${storeId}, ${sectionId}, ${"food"}, ${"Bread"}, ${1}, ${"each"}, ${foodB}, ${false})
        `;
        const grocery = liveGroceryStore();
        const fridge = liveFridgeStore();
        const stock = liveStockStore();
        const foods = liveFoodsStore();
        await expect(
            putAwayGroceryLines(grocery, fridge, stock, foods, {
                householdId,
                lineIds: [lineA, lineB],
                perLine: {
                    [lineA]: { locationId: fridgeLoc },
                    [lineB]: { locationId: crypto.randomUUID() },
                },
            }),
        ).rejects.toThrow();
        const items = await sql`
            select id from public.fridge_items where household_id = ${householdId}
        `;
        expect(items).toHaveLength(0);
        const movements = await sql`
            select id from public.stock_movements where household_id = ${householdId}
        `;
        expect(movements).toHaveLength(0);
        const lines = await sql`
            select id from public.grocery_lines where household_id = ${householdId}
        `;
        expect(lines).toHaveLength(2);
    });

    test("freezeFridgeItem updates location and expiry on the row", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const fridgeLoc = await seedFridgeLocation(sql, householdId, "Fridge");
        await seedFridgeLocation(sql, householdId, "Freezer");
        const foodId = await seedFood(sql, householdId, { name: "Berries" });
        const itemId = await seedFridgeItem(
            sql,
            householdId,
            fridgeLoc,
            foodId,
            {
                amount: 2,
                unit: "cup",
            },
        );
        await sql`
            update public.fridge_items
            set purchased_on = ${"2026-02-01"},
                opened_on = ${"2026-02-10"},
                expires_on = ${"2026-02-15"}
            where id = ${itemId}
        `;
        const freezerLoc = (
            await sql`
                select id::text from public.fridge_locations
                where household_id = ${householdId} and lower(name) = 'freezer'
            `
        )[0]!.id as string;
        const fridge = liveFridgeStore();
        const frozen = await freezeFridgeItem(
            fridge,
            householdId,
            itemId,
            "2026-06-01",
        );
        expect(frozen.locationId).toBe(freezerLoc);
        expect(frozen.expiresOn).toBe("2026-06-01");
        expect(frozen.purchasedOn).toBe("2026-02-01");
        expect(frozen.openedOn).toBe("2026-02-10");
        expect(frozen.quantity).toEqual({ amount: 2, unit: "cup" });
        const [row] = await sql`
            select location_id::text, expires_on::text, purchased_on::text, opened_on::text, amount, unit
            from public.fridge_items
            where id = ${itemId}
        `;
        expect(row).toMatchObject({
            location_id: freezerLoc,
            expires_on: "2026-06-01",
            purchased_on: "2026-02-01",
            opened_on: "2026-02-10",
            unit: "cup",
        });
        expect(Number(row!.amount)).toBe(2);
    });
    /** A household with 500 g each of flour and sugar and a recipe that uses 100 g and 50 g of them. */
    async function seedPancakes(sql: SQL) {
        const { userId, householdId } = await seedHousehold(sql);
        const loc = await seedFridgeLocation(sql, householdId, "Pantry");
        const flour = await seedFood(sql, householdId, { name: "Flour" });
        const sugar = await seedFood(sql, householdId, { name: "Sugar" });
        await seedFridgeItem(sql, householdId, loc, flour, {
            displayName: "Flour",
            amount: 500,
        });
        await seedFridgeItem(sql, householdId, loc, sugar, {
            displayName: "Sugar",
            amount: 500,
        });
        const recipes = liveRecipesStore();
        const foods = liveFoodsStore();
        const recipe = await createRecipe(recipes, {
            householdId,
            creatorId: userId,
            name: "Pancakes",
            yieldPortions: 2,
        });
        for (const [name, amount] of [
            ["Flour", 100],
            ["Sugar", 50],
        ] as const) {
            await addRecipeManualIngredient(recipes, foods, {
                householdId,
                recipeId: recipe.id,
                name,
                amount,
                unit: "g",
            });
        }
        const cook = (stock: StockStore, submitKey?: string) =>
            inStockTransaction(() =>
                cookRecipe(recipes, liveFridgeStore(), stock, foods, {
                    householdId,
                    recipeId: recipe.id,
                    totalPortions: 2,
                    actorUserId: userId,
                    submitKey,
                }),
            );
        const stockLeft = async () => {
            const rows = await sql`
                select display_name, amount::float8 as amount
                from public.fridge_items
                where household_id = ${householdId}
                order by display_name
            `;
            return Object.fromEntries(
                rows.map((r: { display_name: string; amount: number }) => [
                    r.display_name,
                    r.amount,
                ]),
            );
        };
        const cookRows = async () => {
            const [row] = await sql`
                select count(*)::int as n
                from public.stock_movements
                where household_id = ${householdId} and reason = 'cook'
            `;
            return row.n as number;
        };
        return { householdId, recipeId: recipe.id, cook, stockLeft, cookRows };
    }

    test("a cook that throws part way takes nothing from the fridge", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const pantry = await seedPancakes(sql);
        const real = liveStockStore();
        let written = 0;
        const failing: StockStore = {
            ...real,
            async insertMovement(row) {
                // The first ingredient is taken and recorded; the second's
                // ledger row fails.
                if (written++ === 1) throw new Error("ledger down");
                return real.insertMovement(row);
            },
        };

        await expect(pantry.cook(failing)).rejects.toThrow("ledger down");

        expect(await pantry.stockLeft()).toEqual({
            Flour: 500,
            Sugar: 500,
        });
        expect(await pantry.cookRows()).toBe(0);
    });

    test("a cook takes each ingredient and records it in one commit", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const pantry = await seedPancakes(sql);

        const cooked = await pantry.cook(liveStockStore(), "sheet-1");

        expect(cooked.alreadyCooked).toBeUndefined();
        expect(cooked.shortfalls).toEqual([]);
        expect(await pantry.stockLeft()).toEqual({ Flour: 400, Sugar: 450 });
        expect(await pantry.cookRows()).toBe(2);
        const [claim] = await sql`
            select id::text from public.stock_movements
            where id = ${cookClaimId(pantry.householdId, pantry.recipeId, "sheet-1")}
        `;
        expect(claim).toBeDefined();
    });

    test("the same sheet cooked again takes nothing", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const pantry = await seedPancakes(sql);
        await pantry.cook(liveStockStore(), "sheet-1");
        const before = await pantry.stockLeft();

        const again = await pantry.cook(liveStockStore(), "sheet-1");

        expect(again.alreadyCooked).toBe(true);
        expect(await pantry.stockLeft()).toEqual(before);
        expect(await pantry.cookRows()).toBe(2);
    });

    test("a cook that loses the race to the same sheet is rolled back whole", async () => {
        const { sql, truncateAll, pg } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const pantry = await seedPancakes(sql);
        const [flour] = await sql`
            select food_id::text from public.fridge_items
            where household_id = ${pantry.householdId} limit 1
        `;
        // Another request for the same sheet is mid-cook: its claim row is
        // written but not yet committed, so this cook cannot see it.
        const other = new SQL(pg.url, { prepare: false, max: 1 });
        const observer = new SQL(pg.url, { prepare: false, max: 1 });
        const claimId = cookClaimId(
            pantry.householdId,
            pantry.recipeId,
            "sheet-1",
        );
        let commit!: () => void;
        const committed = new Promise<void>((r) => (commit = r));
        let claimed!: () => void;
        const isClaimed = new Promise<void>((r) => (claimed = r));
        const midCook = other.begin(async (tx) => {
            await tx`
                insert into public.stock_movements (
                    id, household_id, food_id, delta, unit, reason
                )
                values (${claimId}, ${pantry.householdId}, ${flour!.food_id}, ${-100}, ${"g"}, ${"cook"})
            `;
            claimed();
            await committed;
        });
        try {
            await isClaimed;
            const cooking = pantry.cook(liveStockStore(), "sheet-1");
            // Its claim row now waits on the other's uncommitted one.
            const deadline = Date.now() + 5_000;
            for (;;) {
                const [row] = await observer`
                    select count(*)::int as n from pg_stat_activity
                    where datname = current_database()
                      and wait_event_type = 'Lock'
                `;
                if (row.n >= 1) break;
                if (Date.now() > deadline) throw new Error("cook never waited");
                // oxlint-disable-next-line foodable/no-wall-clock-waits -- polls pg_stat_activity for a session blocked on a lock; Postgres emits no event to await
                await Bun.sleep(10);
            }
            commit();
            await midCook;

            await expect(cooking).rejects.toThrow();
            // Rolled back: only the other request's row is in the ledger, and
            // none of this cook's ingredients left the fridge.
            expect(await pantry.cookRows()).toBe(1);
            expect(await pantry.stockLeft()).toEqual({
                Flour: 500,
                Sugar: 500,
            });
            expect(
                await liveStockStore().hasMovement(pantry.householdId, claimId),
            ).toBe(true);
        } finally {
            commit();
            await Promise.allSettled([midCook]);
            await Promise.all([other.close(), observer.close()]);
        }
    });
});
