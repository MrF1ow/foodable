// delete_fridge_location against real Postgres, through the real /mcp handler:
// the items under the place leave through the stock ledger (one adjust
// movement each), the same path as removing the place in Settings › Household
// › Fridge places. The guard's own scenario (its undo, with the ledger whole
// afterwards) lives in destructive.db.test.ts.
import {
    Client,
    StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { liveFoodsStore } from "../../db/foods.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveStockStore } from "../../db/stock.js";
import { setSqlForTests } from "../../db/sql.js";
import {
    asUser,
    seedFood,
    seedFridgeLocation,
    seedHousehold,
} from "../../db/testing/fixtures.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { findFoodById } from "../../domain/foods.js";
import { addFridgeItemAdjust, ledgerMatchesStock } from "../../domain/stock.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import { handleMcp } from "../server.js";

const pgAvailable = await findPgBin();

type Result = {
    isError?: boolean;
    content: { type: string; text: string }[];
};

async function callTool(
    userId: string,
    name: string,
    args: Record<string, unknown>,
): Promise<Result> {
    const app = new Hono();
    app.all("/mcp", (c) => {
        c.set("authContext", { kind: "user", userId });
        c.set("tokenClient", "Claude");
        return handleMcp(c);
    });
    const client = new Client({ name: "t", version: "0" });
    await client.connect(
        new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
            fetch: async (url, init) =>
                app.request(new Request(String(url), init)),
        }),
    );
    try {
        return (await client.callTool({ name, arguments: args })) as Result;
    } finally {
        await client.close();
    }
}

describeDb(pgAvailable !== null, "delete_fridge_location (db)", (getCtx) => {
    let householdId: string;
    let ownerId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        setFlagsForTests(createMemoryFlags({}));
        ({ householdId, userId: ownerId } = await seedHousehold(sql));
    });

    afterEach(() => {
        resetFlagsForTests();
        setSqlForTests(null);
    });

    async function stock(locationId: string, name: string, amount: number) {
        const foodId = await seedFood(getCtx().sql, householdId, { name });
        await asUser(
            ownerId,
            () =>
                addFridgeItemAdjust(
                    liveFridgeStore(),
                    liveStockStore(),
                    liveFoodsStore(),
                    { householdId, foodId, amount, unit: "g", locationId },
                ),
            householdId,
        );
        return foodId;
    }

    async function count(table: string): Promise<number> {
        const [row] = await getCtx().sql.unsafe(
            `select count(*)::int as n from public.${table}`,
        );
        return Number(row.n);
    }

    async function ledgerWhole(foodId: string): Promise<boolean> {
        return asUser(
            ownerId,
            async () => {
                const items = (
                    await liveFridgeStore().listItems(householdId)
                ).filter((item) => item.foodId === foodId);
                const movements = await liveStockStore().listMovements(
                    householdId,
                    foodId,
                );
                return ledgerMatchesStock(
                    items,
                    movements,
                    await findFoodById(liveFoodsStore(), householdId, foodId),
                );
            },
            householdId,
        );
    }

    test("deleting a place writes one adjust movement per item and keeps the ledger whole", async () => {
        const freezer = await seedFridgeLocation(
            getCtx().sql,
            householdId,
            "Freezer",
        );
        const pantry = await seedFridgeLocation(
            getCtx().sql,
            householdId,
            "Pantry",
        );
        const peas = await stock(freezer, "Peas", 100);
        const fish = await stock(freezer, "Fish", 200);
        const salt = await stock(pantry, "Salt", 50);
        const before = await count("stock_movements");

        const done = await callTool(ownerId, "delete_fridge_location", {
            id: freezer,
        });
        expect(done.isError).toBeFalsy();
        expect(done.content[0]!.text).toContain("Deleted location");

        expect(await count("fridge_locations")).toBe(1);
        expect(await count("fridge_items")).toBe(1);
        const adjusts = await getCtx().sql.unsafe(
            `select food_id, delta::float as delta
             from public.stock_movements
             where reason = 'adjust' and delta < 0 order by delta`,
        );
        expect(adjusts.map((row: any) => [row.food_id, row.delta])).toEqual([
            [fish, -200],
            [peas, -100],
        ]);
        expect(await count("stock_movements")).toBe(before + 2);
        for (const food of [peas, fish, salt]) {
            expect(await ledgerWhole(food)).toBe(true);
        }
    });

    test("deleting a place with nothing in it writes no movement", async () => {
        const shed = await seedFridgeLocation(
            getCtx().sql,
            householdId,
            "Shed",
        );
        const done = await callTool(ownerId, "delete_fridge_location", {
            id: shed,
        });
        expect(done.isError).toBeFalsy();
        expect(await count("fridge_locations")).toBe(0);
        expect(await count("stock_movements")).toBe(0);
    });
});
