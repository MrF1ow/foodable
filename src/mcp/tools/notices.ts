import { householdToday } from "../../db/restock.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withAnalytics } from "../../analytics.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveNoticeDismissalsStore } from "../../db/notice-dismissals.js";
import { liveRecipesStore } from "../../db/recipes.js";
import {
    dismissNotice,
    noticesFor,
    type NoticesForDeps,
} from "../../domain/notices-for.js";
import { needsAttentionCount } from "../../domain/notices.js";
import { NoticeDismissError } from "../../domain/notice-dismissals.js";
import {
    NOTICE_SCHEMA,
    noticeToWire,
    registerV2OnlyWidgetResource,
    uiMetaForKey,
    type ToolContext,
} from "../shared.js";

export const LIST_NOTICES_OUTPUT_SCHEMA = z.object({
    count: z.number(),
    notices: z.array(NOTICE_SCHEMA),
});

const DISMISS_NOTICE_OUTPUT_SCHEMA = z.object({
    dismissed: z.boolean(),
});

const SUBJECT_KIND_SCHEMA = z.enum([
    "food",
    "recipe",
    "recipe_ingredient",
    "fridge_item",
    "grocery_line",
]);

function noticeDeps(): NoticesForDeps {
    return {
        foods: liveFoodsStore(),
        fridge: liveFridgeStore(),
        recipes: liveRecipesStore(),
        dismissals: liveNoticeDismissalsStore(),
        grocery: liveGroceryStore(),
    };
}

export function registerNoticeTools(server: McpServer, ctx: ToolContext) {
    const { callerHouseholdId, actorUserId, analytics } = ctx;

    registerV2OnlyWidgetResource(server, ctx, {
        key: "attention",
        resourceName: "attention",
        title: "Needs attention",
        description:
            "Household notices grouped for the Needs attention digest card.",
        flag: "widget-attention",
    });

    server.registerTool(
        "list_notices",
        {
            title: "List Notices",
            description:
                "List open household notices that need attention (warnings and suggestions, not allergen blocks). count is the same as the web app's Needs attention badge; filters only narrow notices.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                code: z.string().optional(),
                severity: z.enum(["warn", "info"]).optional(),
                subject_kind: SUBJECT_KIND_SCHEMA.optional(),
            }),
            outputSchema: LIST_NOTICES_OUTPUT_SCHEMA,
            ...uiMetaForKey(ctx, "attention", {
                v2: true,
                flag: "widget-attention",
            }),
        },
        async (input) => {
            return withAnalytics(
                "list_notices",
                async () => {
                    const householdId = await callerHouseholdId();
                    const today = await householdToday(householdId);
                    const { notices: all } = await noticesFor(
                        noticeDeps(),
                        householdId,
                        { today },
                    );
                    const count = needsAttentionCount(all);
                    let notices = all;
                    if (input.code) {
                        notices = notices.filter((n) => n.code === input.code);
                    }
                    if (input.severity) {
                        notices = notices.filter(
                            (n) => n.severity === input.severity,
                        );
                    }
                    if (input.subject_kind) {
                        notices = notices.filter(
                            (n) => n.subject.kind === input.subject_kind,
                        );
                    }
                    const wire = notices.map(noticeToWire);
                    const text =
                        count === 0
                            ? "Nothing needs attention."
                            : `${count} notice(s) need attention.\n` +
                              wire.map((n) => n.message).join("\n");
                    return {
                        content: [{ type: "text", text }],
                        structuredContent: { count, notices: wire },
                    };
                },
                analytics,
            );
        },
    );

    server.registerTool(
        "dismiss_notice",
        {
            title: "Dismiss Notice",
            description:
                "Dismiss an info-level suggestion after the person agrees. Do not call without asking first. Pair notices (for example food.possible_duplicate) require related_id naming the other food in the pair.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                code: z.string(),
                subject_kind: SUBJECT_KIND_SCHEMA,
                subject_id: z.string(),
                related_id: z.string().optional(),
            }),
            outputSchema: DISMISS_NOTICE_OUTPUT_SCHEMA,
        },
        async (input) => {
            return withAnalytics(
                "dismiss_notice",
                async () => {
                    const householdId = await callerHouseholdId();
                    const userId = await actorUserId(undefined);
                    try {
                        const today = await householdToday(householdId);
                        await dismissNotice(
                            noticeDeps(),
                            householdId,
                            userId,
                            {
                                code: input.code as never,
                                subjectKind: input.subject_kind,
                                subjectId: input.subject_id,
                                relatedId: input.related_id,
                            },
                            { today },
                        );
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: "Notice dismissed.",
                                },
                            ],
                            structuredContent: { dismissed: true },
                        };
                    } catch (err) {
                        const message =
                            err instanceof NoticeDismissError
                                ? err.message
                                : err instanceof Error
                                  ? err.message
                                  : "Could not dismiss notice.";
                        return {
                            isError: true,
                            content: [{ type: "text", text: message }],
                            structuredContent: { dismissed: false },
                        };
                    }
                },
                analytics,
            );
        },
    );
}
