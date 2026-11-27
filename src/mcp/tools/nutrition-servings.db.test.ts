// A quick meal's servings (set by Today's edit sheet) say how its totals were
// made, so update_meal keeps them through an edit that leaves the totals alone
// and clears them when it sets the totals itself. Real tools, real Postgres,
// both protocol eras.
import {
    Client,
    StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { getMealById, updateMeal } from "../../db/nutrition.js";
import { setSqlForTests } from "../../db/sql.js";
import { seedHousehold } from "../../db/testing/fixtures.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { resetFlagsForTests } from "../../flags.js";
import { handleMcp } from "../server.js";

const pgAvailable = await findPgBin();

type Era = "legacy" | { pin: "2026-07-28" };
const ERAS: Era[] = ["legacy", { pin: "2026-07-28" }];

type Result = {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content: { type: string; text: string }[];
};

async function withClient<T>(
    userId: string,
    era: Era,
    run: (
        call: (name: string, args?: Record<string, unknown>) => Promise<Result>,
    ) => Promise<T>,
): Promise<T> {
    const app = new Hono();
    app.all("/mcp", (c) => {
        c.set("authContext", { kind: "user", userId });
        return handleMcp(c);
    });
    const client = new Client(
        { name: "t", version: "0" },
        { versionNegotiation: { mode: era } },
    );
    await client.connect(
        new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
            fetch: async (url, init) =>
                app.request(new Request(String(url), init)),
        }),
    );
    try {
        return await run(
            async (name, args) =>
                (await client.callTool({
                    name,
                    arguments: args ?? {},
                })) as Result,
        );
    } finally {
        await client.close();
    }
}

describeDb(pgAvailable !== null, "update_meal and servings", (getCtx) => {
    let userId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        ({ userId } = await seedHousehold(sql));
    });

    afterEach(() => {
        setSqlForTests(null);
        resetFlagsForTests();
    });

    for (const era of ERAS) {
        const name = era === "legacy" ? "2025-11-25" : era.pin;

        async function twoServingMeal(
            call: (
                name: string,
                args?: Record<string, unknown>,
            ) => Promise<Result>,
        ): Promise<string> {
            const logged = await call("log_meal", {
                description: "Pasta plate",
                meal_type: "dinner",
                calories: 300,
                protein_g: 20,
            });
            expect(logged.isError).toBeFalsy();
            const { sql } = getCtx();
            const [row] = await sql`
                select id from public.meals where user_id = ${userId}
            `;
            const id = row.id as string;
            // What the edit sheet writes when it saves 2 servings.
            await updateMeal(userId, id, {
                calories: 600,
                protein_g: 40,
                servings: 2,
            });
            return id;
        }

        test(`${name}: update_meal changing only the description keeps servings`, async () => {
            await withClient(userId, era, async (call) => {
                const id = await twoServingMeal(call);
                const res = await call("update_meal", {
                    id,
                    description: "Pasta plate with salad",
                });
                expect(res.isError).toBeFalsy();
                const meal = await getMealById(userId, id);
                expect(meal!.description).toBe("Pasta plate with salad");
                expect(meal!.servings).toBe(2);
                expect(meal!.calories).toBe(600);
            });
        });

        test(`${name}: update_meal changing time, notes or meal type keeps servings`, async () => {
            await withClient(userId, era, async (call) => {
                const id = await twoServingMeal(call);
                const res = await call("update_meal", {
                    id,
                    notes: "late",
                    meal_type: "snack",
                    logged_at: "2026-03-01T21:00:00Z",
                });
                expect(res.isError).toBeFalsy();
                const meal = await getMealById(userId, id);
                expect(meal!.servings).toBe(2);
                expect(meal!.meal_type).toBe("snack");
            });
        });

        test(`${name}: update_meal setting calories clears servings`, async () => {
            await withClient(userId, era, async (call) => {
                const id = await twoServingMeal(call);
                const res = await call("update_meal", { id, calories: 500 });
                expect(res.isError).toBeFalsy();
                const meal = await getMealById(userId, id);
                expect(meal!.calories).toBe(500);
                expect(meal!.servings).toBeNull();
            });
        });
    }
});
