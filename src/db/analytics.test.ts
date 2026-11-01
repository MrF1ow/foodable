import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { insertToolAnalytics } from "./analytics.js";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { rows, run, setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "analytics db", (getCtx) => {
    let userId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        ({ userId } = await seedHousehold(sql));
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("insertToolAnalytics persists every field", async () => {
        const record = {
            user_id: userId,
            tool_name: "log_meal",
            success: true,
            duration_ms: 42,
            date_range_days: 7,
            mcp_session_id: "sess-1",
            invoked_at: "2026-03-01T12:00:00.000Z",
        };
        insertToolAnalytics(record);
        await new Promise((r) => setTimeout(r, 50));
        const { sql } = getCtx();
        setSqlForTests(sql);
        const stored = await run(async (tx) =>
            rows(
                tx,
                tx`
                    select *
                    from tool_analytics
                    where user_id = ${userId}
                      and tool_name = ${"log_meal"}
                `,
            ),
        );
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({
            user_id: userId,
            tool_name: "log_meal",
            success: true,
            duration_ms: 42,
            date_range_days: 7,
            mcp_session_id: "sess-1",
        });
        expect(String(stored[0]!.invoked_at)).toMatch(/2026-03-01/);
    });

    test("failure logs warning and does not reject", async () => {
        setSqlForTests(null);
        const calls: unknown[][] = [];
        const prev = console.warn;
        console.warn = (...args: unknown[]) => {
            calls.push(args);
        };
        try {
            insertToolAnalytics({
                user_id: "u",
                tool_name: "x",
                success: false,
                duration_ms: 1,
                invoked_at: new Date().toISOString(),
            });
            await new Promise((r) => setTimeout(r, 20));
            expect(calls.length).toBeGreaterThan(0);
            expect(String(calls[0]?.[0])).toContain(
                "Failed to persist analytics for x:",
            );
        } finally {
            console.warn = prev;
        }
    });
});
