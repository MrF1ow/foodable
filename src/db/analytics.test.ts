import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AnalyticsRecord } from "../analytics.js";
import { insertToolAnalytics } from "./analytics.js";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { closeSql, rows, run, setSqlForTests } from "./sql.js";

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
            error_category: null,
            mcp_session_id: "sess-1",
            invoked_at: "2026-03-01T12:00:00.000Z",
        } as unknown as AnalyticsRecord;
        insertToolAnalytics(record);
        // oxlint-disable-next-line foodable/no-wall-clock-waits -- insertToolAnalytics is fire-and-forget and returns no promise to await
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
            error_category: null,
        });
        expect(String(stored[0]!.invoked_at)).toMatch(/2026-03-01/);
    });

    test("failure logs warning and does not reject", async () => {
        const prevUrl = process.env.DATABASE_URL;
        delete process.env.DATABASE_URL;
        setSqlForTests(null);
        await closeSql();
        const calls: unknown[][] = [];
        const prev = console.warn;
        let warnedOnce!: () => void;
        const warned = new Promise<void>((resolve) => {
            warnedOnce = resolve;
        });
        console.warn = (...args: unknown[]) => {
            calls.push(args);
            warnedOnce();
        };
        try {
            insertToolAnalytics({
                user_id: "u",
                tool_name: "x",
                success: false,
                duration_ms: 1,
                invoked_at: new Date().toISOString(),
            });
            await warned;
            expect(calls).toEqual([
                ["Failed to persist analytics for x:", "Missing DATABASE_URL"],
            ]);
        } finally {
            console.warn = prev;
            if (prevUrl === undefined) delete process.env.DATABASE_URL;
            else process.env.DATABASE_URL = prevUrl;
            const { sql } = getCtx();
            setSqlForTests(sql);
        }
    });
});
