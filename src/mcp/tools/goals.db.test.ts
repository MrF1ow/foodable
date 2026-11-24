// set_nutrition_goals with `clear: true` and no date or range, against real
// Postgres through the real /mcp handler: it removes every per-day override the
// person has (past and future, any number of them) and nothing else, is
// recorded and undoable like the dated clear, and is refused by the same
// switches. Both protocol eras run it.
import {
    Client,
    StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { liveAgentActionDeps } from "../../db/agent-actions.js";
import { liveSettingsStore } from "../../db/settings.js";
import { setSqlForTests } from "../../db/sql.js";
import {
    asUser,
    seedHousehold,
    seedMember,
} from "../../db/testing/fixtures.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { undoAgentAction } from "../../domain/agent-actions.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import { handleMcp } from "../server.js";

const pgAvailable = await findPgBin();

type Era = "legacy" | { pin: "2026-07-28" };
const ERAS: Era[] = ["legacy", { pin: "2026-07-28" }];
type Result = {
    isError?: boolean;
    structuredContent?: Record<string, any>;
    content: { type: string; text: string }[];
};

const UNDO_SENTENCE =
    "The household can undo this for 24 hours in Settings › AI connections.";
const REFUSAL = "Any agent can delete is Off in Settings › AI connections.";
const OTHER_PERSON =
    "An agent can only add, change or delete the entries of the person it acts for.";

async function callTool(
    userId: string,
    era: Era,
    name: string,
    args: Record<string, unknown>,
): Promise<Result> {
    const app = new Hono();
    app.all("/mcp", (c) => {
        c.set("authContext", { kind: "user", userId });
        c.set("tokenClient", "Claude");
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
        return (await client.callTool({
            name,
            arguments: args,
        })) as Result;
    } finally {
        await client.close();
    }
}

const text = (r: Result) => r.content.map((c) => c.text).join("\n");

describeDb(
    pgAvailable !== null,
    "set_nutrition_goals clear all (db)",
    (ctx) => {
        let householdId: string;
        let ownerId: string;

        beforeEach(async () => {
            const { sql, truncateAll } = ctx();
            await truncateAll();
            setSqlForTests(sql);
            setFlagsForTests(createMemoryFlags({}));
            ({ householdId, userId: ownerId } = await seedHousehold(sql));
            await sql`
            insert into public.nutrition_goals (
                user_id, daily_calories, daily_protein_g, goal_name, goal_note
            ) values (${ownerId}, ${2200}, ${140}, ${"Recomp"}, ${"slow"})
        `;
        });

        afterEach(() => {
            resetFlagsForTests();
            setSqlForTests(null);
        });

        const days = (who: string, dates: string[]) =>
            Promise.all(
                dates.map(
                    (date) => ctx().sql`
                    insert into public.nutrition_goal_days (
                        household_id, user_id, date, daily_calories
                    ) values (${householdId}, ${who}, ${date}::date, ${2400})
                `,
                ),
            );
        const dayDates = async (who: string): Promise<string[]> =>
            (
                (await ctx().sql`
                select date::text as date from public.nutrition_goal_days
                where user_id = ${who} order by date
            `) as { date: string }[]
            ).map((r) => r.date);
        const standing = async () =>
            (
                await ctx().sql`
                select daily_calories, daily_protein_g::float as daily_protein_g,
                    goal_name, goal_note
                from public.nutrition_goals where user_id = ${ownerId}
            `
            )[0];
        const actions = () =>
            ctx().sql`
            select * from public.agent_actions where household_id = ${householdId}
            order by created_at
        ` as Promise<Record<string, any>[]>;

        for (const era of ERAS) {
            const name = era === "legacy" ? "2025-11-25" : "2026-07-28";
            test(`${name}: clear with no date removes every override, past and far future, and only those`, async () => {
                const other = await seedMember(ctx().sql, householdId, {
                    agentsCanDelete: true,
                });
                // More than one 92-day window apart, a day long gone, and another
                // person's override that must stay.
                const mine = [
                    "2020-03-01",
                    "2026-01-15",
                    "2026-06-01",
                    "2099-01-01",
                ];
                await days(ownerId, mine);
                await days(other, ["2026-06-01"]);
                const before = await standing();

                const result = await callTool(
                    ownerId,
                    era,
                    "set_nutrition_goals",
                    {
                        clear: true,
                    },
                );
                expect(result.isError).toBeFalsy();
                expect(text(result)).toContain(
                    "Cleared 4 per-day goal overrides on every day.",
                );
                expect(text(result)).toContain(UNDO_SENTENCE);
                expect(result.structuredContent?.scope).toBe("days");
                expect(await dayDates(ownerId)).toEqual([]);
                expect(await dayDates(other)).toEqual(["2026-06-01"]);
                // The standing targets, name and note are untouched.
                expect(await standing()).toEqual(before);

                const [entry] = await actions();
                expect(entry).toMatchObject({
                    tool: "set_nutrition_goals",
                    destructive: true,
                    undoable: true,
                    member_id: ownerId,
                });
                expect(entry!.summary).toContain(
                    "Cleared 4 per-day goal overrides on every day",
                );
                expect(entry!.snapshot).not.toBeNull();

                const out = await undoAgentAction(liveAgentActionDeps(), {
                    householdId,
                    userId: ownerId,
                    actionId: entry!.id,
                    now: new Date(),
                });
                expect(out.status).toBe("undone");
                expect(await dayDates(ownerId)).toEqual(mine);
                expect(await dayDates(other)).toEqual(["2026-06-01"]);
            });
        }

        test("targets, name and note passed as null in the same call are cleared too", async () => {
            await days(ownerId, ["2026-06-01"]);
            const result = await callTool(
                ownerId,
                "legacy",
                "set_nutrition_goals",
                {
                    clear: true,
                    daily_calories: null,
                    daily_protein_g: null,
                    goal_name: null,
                    goal_note: null,
                },
            );
            expect(result.isError).toBeFalsy();
            expect(text(result)).toContain("Cleared 1 per-day goal override");
            expect(await dayDates(ownerId)).toEqual([]);
            expect(await standing()).toEqual({
                daily_calories: null,
                daily_protein_g: null,
                goal_name: null,
                goal_note: null,
            });
            // Both parts are one recorded step, so one undo puts both back.
            const recorded = await actions();
            expect(recorded.length).toBe(1);
            expect(JSON.stringify(recorded)).toContain(
                "from the default goals",
            );
        });

        test("with no overrides it changes nothing and leaves no entry", async () => {
            const result = await callTool(
                ownerId,
                "legacy",
                "set_nutrition_goals",
                {
                    clear: true,
                },
            );
            expect(result.isError).toBeFalsy();
            expect(await actions()).toEqual([]);
        });

        test("a call whose defaults half is refused clears nothing and records no undo", async () => {
            await days(ownerId, ["2026-06-01", "2099-01-01"]);
            const result = await callTool(
                ownerId,
                "legacy",
                "set_nutrition_goals",
                { clear: true, target_weight: 2, unit: "kg" },
            );
            expect(result.isError).toBe(true);
            expect(await dayDates(ownerId)).toEqual([
                "2026-06-01",
                "2099-01-01",
            ]);
            expect(await actions()).toEqual([]);
            expect((await standing())?.daily_calories).toBe(2200);
        });

        test("a defaults write the database refuses clears nothing and records no undo", async () => {
            await days(ownerId, ["2026-06-01", "2099-01-01"]);
            const result = await callTool(
                ownerId,
                "legacy",
                "set_nutrition_goals",
                { clear: true, daily_water_ml: 3_000_000_000 },
            );
            expect(result.isError).toBe(true);
            expect(await dayDates(ownerId)).toEqual([
                "2026-06-01",
                "2099-01-01",
            ]);
            expect(await actions()).toEqual([]);
        });

        test("refused while agents may not delete, a call that also sets targets writes none of them", async () => {
            await days(ownerId, ["2026-06-01"]);
            await asUser(
                ownerId,
                () =>
                    liveSettingsStore().setAgentDestructiveAllowed(
                        householdId,
                        false,
                    ),
                householdId,
            );
            const result = await callTool(
                ownerId,
                "legacy",
                "set_nutrition_goals",
                { clear: true, daily_calories: 2500, goal_name: "Cut" },
            );
            expect(result.isError).toBe(true);
            expect(text(result)).toContain(REFUSAL);
            expect(await dayDates(ownerId)).toEqual(["2026-06-01"]);
            expect((await standing())?.daily_calories).toBe(2200);
            expect(await actions()).toEqual([]);
        });

        test("it is refused while agents may not delete, and keeps every override", async () => {
            await days(ownerId, ["2026-06-01", "2099-01-01"]);
            await asUser(
                ownerId,
                () =>
                    liveSettingsStore().setAgentDestructiveAllowed(
                        householdId,
                        false,
                    ),
                householdId,
            );
            const result = await callTool(
                ownerId,
                "legacy",
                "set_nutrition_goals",
                {
                    clear: true,
                },
            );
            expect(result.isError).toBe(true);
            expect(text(result)).toContain(REFUSAL);
            expect(await dayDates(ownerId)).toEqual([
                "2026-06-01",
                "2099-01-01",
            ]);
            expect(await actions()).toEqual([]);
        });

        test("it is refused when aimed at another person, and keeps their overrides", async () => {
            const a = await seedMember(ctx().sql, householdId, {
                agentsCanDelete: true,
                displayName: "Ann",
            });
            const b = await seedMember(ctx().sql, householdId, {
                agentsCanDelete: true,
                displayName: "Bea",
            });
            await days(b, ["2026-06-01"]);
            for (const era of ERAS) {
                const result = await callTool(a, era, "set_nutrition_goals", {
                    clear: true,
                    target_member: b,
                });
                expect(result.isError).toBe(true);
                expect(text(result)).toContain(OTHER_PERSON);
            }
            expect(await dayDates(b)).toEqual(["2026-06-01"]);
            expect(await actions()).toEqual([]);
        });
    },
);
