// The chat cards leave out the nutrients a member switched off (Settings ›
// Nutrients shown). That reaches the card as `hidden_nutrients` in each
// tool's structuredContent, which the SDK checks against the tool's output
// schema, so this runs the real tools over real Postgres on both protocol eras.
import {
    Client,
    StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { upsertProfile } from "../../db/profiles.js";
import { setSqlForTests } from "../../db/sql.js";
import { seedHousehold } from "../../db/testing/fixtures.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { resetFlagsForTests } from "../../flags.js";
import { todayInTz } from "../../domain/tz.js";
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

describeDb(
    pgAvailable !== null,
    "chat cards and hidden nutrients",
    (getCtx) => {
        let userId: string;

        beforeEach(async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            ({ userId } = await seedHousehold(sql));
            await upsertProfile(userId, { timezone: "UTC" });
        });

        afterEach(() => {
            setSqlForTests(null);
            resetFlagsForTests();
        });

        async function cardPayloads(era: Era) {
            const today = todayInTz("UTC");
            return withClient(userId, era, async (call) => {
                const logged = await call("log_meal", {
                    description: "Toast",
                    meal_type: "breakfast",
                    calories: 200,
                    sugar_g: 4,
                });
                const summary = await call("get_nutrition_summary", {
                    start_date: today,
                    end_date: today,
                });
                const trends = await call("get_trends", {});
                const goals = await call("get_goal_progress", {});
                return { logged, summary, trends, goals };
            });
        }

        for (const era of ERAS) {
            const name = era === "legacy" ? "2025-11-25" : era.pin;

            test(`${name}: every card tool sends the switched-off nutrients`, async () => {
                await upsertProfile(userId, {
                    hidden_nutrients: ["caffeine", "sugar"],
                });
                const cards = await cardPayloads(era);
                for (const [tool, result] of Object.entries(cards)) {
                    expect(
                        result.isError ? result.content[0]?.text : false,
                        tool,
                    ).toBe(false);
                    expect(
                        result.structuredContent?.hidden_nutrients,
                        tool,
                    ).toEqual(["sugar", "caffeine"]);
                }
            });

            test(`${name}: with nothing switched off the list is empty, not absent`, async () => {
                const cards = await cardPayloads(era);
                for (const [tool, result] of Object.entries(cards)) {
                    expect(
                        result.isError ? result.content[0]?.text : false,
                        tool,
                    ).toBe(false);
                    expect(
                        result.structuredContent?.hidden_nutrients,
                        tool,
                    ).toEqual([]);
                }
            });
        }
    },
);
