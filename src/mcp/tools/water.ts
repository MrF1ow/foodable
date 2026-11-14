import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
    insertWater,
    getWaterByDate,
    getWaterInRange,
    deleteWater,
} from "../../db/nutrition.js";
import { getUserTimezone } from "../../db/profiles.js";
import { withAnalytics } from "../../analytics.js";
import { todayInTz, dateInTz } from "../../domain/tz.js";
import {
    sumWater,
    LOGGED_AT_FORMS,
    LOGGED_AT_OMIT_IF_NOW,
    resolveWriteTimestamp,
    resolveDateWindow,
} from "../shared.js";
import { destructiveOutcome, withUndo, type ToolContext } from "../shared.js";
import type { WaterEntry } from "../../db/nutrition.js";

export function registerWaterTools(server: McpServer, ctx: ToolContext) {
    const {
        personSchema,
        nutritionWriteSchema,
        actorUserId,
        writeUserId,
        analytics,
        runDestructive,
    } = ctx;
    server.registerTool(
        "log_water",
        {
            title: "Log Water",
            description:
                "Log a hydration entry in milliliters. If the user gives a volume in another unit (cups, oz, liters), convert it: 1 cup = 240 ml, 1 fl oz = 30 ml, 1 L = 1000 ml. If only 'a glass' is mentioned, ask for the size or assume 250 ml and confirm.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: nutritionWriteSchema({
                amount_ml: z.coerce
                    .number()
                    .int()
                    .positive()
                    .describe("Amount in milliliters (integer, > 0)."),
                logged_at: z
                    .string()
                    .optional()
                    .describe(
                        "When this actually happened (defaults to now). " +
                            LOGGED_AT_FORMS +
                            LOGGED_AT_OMIT_IF_NOW,
                    ),
                notes: z
                    .string()
                    .optional()
                    .describe("Optional notes (e.g. 'tea', 'post-workout')."),
                idempotency_key: z
                    .string()
                    .min(1)
                    .max(255)
                    .optional()
                    .describe(
                        "Optional stable key for safe retries. You normally don't need to set this: when omitted, the server derives a stable key from the entry content (including logged_at), so replaying the identical call returns the original entry instead of duplicating it. Pass a UUID only to force-override that behavior. Do NOT reuse a key for genuinely different sips.",
                    ),
            }),
        },
        async ({ user_id, target_member, ...waterArgs }) => {
            return withAnalytics(
                "log_water",
                async () => {
                    const userId = await writeUserId(user_id, target_member);
                    const { iso, note } = await resolveWriteTimestamp(
                        userId,
                        waterArgs.logged_at,
                    );
                    const { entry, deduplicated } = await insertWater(userId, {
                        ...waterArgs,
                        logged_at: iso,
                    });
                    const prefix = deduplicated
                        ? "Already logged (idempotent retry)"
                        : "Water logged";
                    return {
                        content: [
                            {
                                type: "text",
                                text: `${prefix}: ${entry.amount_ml} ml at ${entry.logged_at}${entry.notes ? ` (${entry.notes})` : ""}. ID: ${entry.id}${note}`,
                            },
                        ],
                    };
                },
                analytics,
            );
        },
    );

    server.registerTool(
        "get_water",
        {
            title: "Get Water",
            description:
                "Get water intake total and entries. Omit date/from/to for today; pass date for one local day; pass from and to (inclusive, YYYY-MM-DD) for a range. Do not mix date with from/to.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: personSchema({
                date: z
                    .string()
                    .optional()
                    .describe(
                        "Single local day (YYYY-MM-DD). Defaults to today.",
                    ),
                from: z
                    .string()
                    .optional()
                    .describe(
                        "Range start (YYYY-MM-DD), inclusive. Requires to.",
                    ),
                to: z
                    .string()
                    .optional()
                    .describe(
                        "Range end (YYYY-MM-DD), inclusive. Requires from.",
                    ),
            }),
        },
        async (args) => {
            return withAnalytics(
                "get_water",
                async () => {
                    const userId = await actorUserId(args.user_id, "read");
                    const tz = await getUserTimezone(userId);
                    const window = resolveDateWindow(args, todayInTz(tz));
                    const entries = window.single
                        ? await getWaterByDate(userId, window.start, tz)
                        : await getWaterInRange(
                              userId,
                              window.start,
                              window.end,
                              tz,
                          );
                    if (entries.length === 0) {
                        const empty = window.single
                            ? window.start === todayInTz(tz)
                                ? "No water logged today."
                                : `No water logged on ${window.start}.`
                            : `No water found between ${window.start} and ${window.end}.`;
                        return {
                            content: [{ type: "text", text: empty }],
                        };
                    }
                    const lineOf = (e: WaterEntry) =>
                        `- ${e.amount_ml} ml at ${e.logged_at}${e.notes ? ` (${e.notes})` : ""} [id: ${e.id}]`;
                    if (window.single) {
                        const total = sumWater(entries);
                        const lines = entries.map(lineOf);
                        const label =
                            window.start === todayInTz(tz)
                                ? "Total"
                                : `Total on ${window.start}`;
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `${label}: ${total} ml (${entries.length} entr${entries.length === 1 ? "y" : "ies"})\n\n${lines.join("\n")}`,
                                },
                            ],
                        };
                    }
                    const byDate = new Map<string, WaterEntry[]>();
                    for (const e of entries) {
                        const date = dateInTz(e.logged_at, tz);
                        const existing = byDate.get(date) ?? [];
                        existing.push(e);
                        byDate.set(date, existing);
                    }
                    const sections: string[] = [];
                    for (const [date, dayEntries] of [
                        ...byDate.entries(),
                    ].sort()) {
                        const total = sumWater(dayEntries);
                        const header = `## ${date} (${total} ml, ${dayEntries.length} entr${dayEntries.length === 1 ? "y" : "ies"})`;
                        sections.push(
                            `${header}\n${dayEntries.map(lineOf).join("\n")}`,
                        );
                    }
                    return {
                        content: [
                            {
                                type: "text",
                                text: sections.join("\n\n"),
                            },
                        ],
                    };
                },
                analytics,
                { date: args.date, from: args.from, to: args.to },
            );
        },
    );

    server.registerTool(
        "delete_water",
        {
            title: "Delete Water Entry",
            description: "Delete a water log entry by ID.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: nutritionWriteSchema({
                id: z.string().describe("UUID of the water entry to delete"),
            }),
        },
        async ({ id, user_id, target_member }) => {
            return withAnalytics(
                "delete_water",
                async () => {
                    const userId = await writeUserId(user_id, target_member);
                    const run = await runDestructive(
                        "delete_water",
                        async (rec) => {
                            await rec.captureByIds(
                                "water_log",
                                [id],
                                "deleted",
                            );
                            const deleted = await deleteWater(userId, id);
                            return {
                                value: deleted,
                                summary: `Deleted water entry ${id}`,
                                changed: deleted,
                            };
                        },
                    );
                    if (run.refused) return run.result;
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: withUndo(
                                    run.value
                                        ? `Water entry ${id} deleted.`
                                        : `No water entry found with id ${id}.`,
                                    run.undo,
                                ),
                            },
                        ],
                    };
                },
                analytics,
                undefined,
                { outcome: destructiveOutcome },
            );
        },
    );
}
