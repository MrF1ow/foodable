import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withAnalytics } from "../../analytics.js";
import {
    notificationSentence,
    NOTIFICATION_KIND_LABELS,
} from "../../copy/notifications.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { listHouseholdMembers } from "../../db/household.js";
import { liveNoticeDismissalsStore } from "../../db/notice-dismissals.js";
import {
    liveNotificationSyncDeps,
    trySyncHouseholdNotifications,
} from "../../db/notifications.js";
import { liveRecipePlansStore } from "../../db/plans.js";
import { liveRecipesStore, liveRecipeVariantsStore } from "../../db/recipes.js";
import { householdClock } from "../../db/restock.js";
import { liveWeighInStore } from "../../db/weigh-ins.js";
import { AGENT_UNDO_HINT } from "../../domain/agent-actions.js";
import {
    NoticeDismissError,
    type NoticeDismissalsStore,
} from "../../domain/notice-dismissals.js";
import {
    dismissNotice,
    type NoticesForDeps,
} from "../../domain/notices-for.js";
import type { NoticeCode } from "../../domain/notices.js";
import {
    kindForNoticeCode,
    NOTIFICATION_KIND_IDS,
    NOTIFICATION_KINDS,
    type NotificationKind,
} from "../../domain/notification-kinds.js";
import {
    dismiss,
    inboxFor,
    isNewNotification,
    markRead,
    NotificationActionError,
    resolveSnoozeUntil,
    setPref,
    snooze,
    kindEnabled,
    type NotificationRow,
    type NotificationsStore,
} from "../../domain/notifications.js";
import { can } from "../../domain/permissions.js";
import { APP_PATHS } from "../../web/route-map.js";
import {
    idTag,
    registerWidgetResource,
    subjectIdTag,
    uiMetaForKey,
    withUndo,
    type ToolContext,
} from "../shared.js";

const KIND_SCHEMA = z.enum(NOTIFICATION_KIND_IDS);

export const NOTIFICATION_SCHEMA = z.object({
    id: z.string(),
    kind: KIND_SCHEMA,
    bucket: z.enum(["personal", "household"]),
    message: z.string(),
    created_at: z.string(),
    read: z.boolean(),
    snoozed_until: z.string().nullable(),
    can_dismiss_for_everyone: z.boolean(),
    subject: z.object({ kind: z.string(), id: z.string() }).nullable(),
    open: z.string(),
});
export type WireNotification = z.infer<typeof NOTIFICATION_SCHEMA>;

export const LIST_NOTICES_OUTPUT_SCHEMA = z.object({
    count: z.number(),
    notifications: z.array(NOTIFICATION_SCHEMA),
});

const DISMISS_NOTICE_OUTPUT_SCHEMA = z.object({
    dismissed: z.boolean(),
});

export const SNOOZE_NOTICE_OUTPUT_SCHEMA = z.object({
    snoozed: z.boolean(),
    snoozed_until: z.string().nullable(),
    for_everyone: z.boolean(),
});

export const MARK_NOTICES_READ_OUTPUT_SCHEMA = z.object({
    marked_read: z.number(),
});

const SETTING_SCHEMA = z.object({
    kind: KIND_SCHEMA,
    label: z.string(),
    enabled: z.boolean(),
    can_turn_off: z.boolean(),
});

export const GET_NOTIFICATION_SETTINGS_OUTPUT_SCHEMA = z.object({
    settings: z.array(SETTING_SCHEMA),
});

export const SET_NOTIFICATION_SETTINGS_OUTPUT_SCHEMA = SETTING_SCHEMA;

const SUBJECT_KIND_SCHEMA = z.enum([
    "food",
    "recipe",
    "recipe_ingredient",
    "fridge_item",
    "grocery_line",
    "member",
]);

/** The stores `dismissNotice` reads to find a data-quality mark. */
function noticeDeps(): NoticesForDeps {
    return {
        foods: liveFoodsStore(),
        fridge: liveFridgeStore(),
        recipes: liveRecipesStore(),
        dismissals: liveNoticeDismissalsStore(),
        grocery: liveGroceryStore(),
        plans: liveRecipePlansStore(),
        variants: liveRecipeVariantsStore(),
        weighIns: liveWeighInStore(),
    };
}

/** Where the household app shows what a notification is about. */
function openPath(row: NotificationRow): string {
    const id = row.subjectId;
    switch (row.kind) {
        case "food_expiring":
            return APP_PATHS.kitchenFridge;
        case "running_low":
            // Where the inbox's own row opens.
            return APP_PATHS.kitchenGroceries;
        case "weigh_in_due":
            return APP_PATHS.nutrition;
        case "allergens":
            // What the conflict is about: a planned recipe, a fridge item, a
            // food, or (the default) an open grocery line.
            switch (row.subjectKind) {
                case "recipe":
                    return id
                        ? `${APP_PATHS.recipes}/${id}`
                        : APP_PATHS.recipes;
                case "fridge_item":
                    return APP_PATHS.kitchenFridge;
                case "food":
                    return id
                        ? `${APP_PATHS.product}/${id}`
                        : APP_PATHS.kitchenGroceries;
                default:
                    return APP_PATHS.kitchenGroceries;
            }
        case "recipe_changes":
            return APP_PATHS.recipes;
        case "week_plan_changes":
            // The week strip is on the Recipes page; a recipe's own page does
            // not show where it is planned.
            return APP_PATHS.recipes;
        case "new_usuals":
            return APP_PATHS.kitchenUsuals;
    }
}

/** One stored notification as the tools send it. `agentMayDismiss` is whether
 * the guard would let this person's agent dismiss for everyone now (see
 * `ToolContext.agentMayRun`), so the flag is true only where the call would
 * be allowed. */
export function notificationToWire(
    row: NotificationRow,
    names: ReadonlyMap<string, string>,
    agentMayDismiss: boolean,
    now: Date = new Date(),
): WireNotification {
    // A snooze that has run out no longer holds the row back: it reads as
    // not snoozed, as the inbox treats it.
    const snoozedUntil =
        row.snoozedUntil !== null && row.snoozedUntil > now.toISOString()
            ? row.snoozedUntil
            : null;
    const actorName =
        (row.actorUserId ? names.get(row.actorUserId) : undefined) ?? "Someone";
    return {
        id: row.id,
        kind: row.kind,
        bucket: row.bucket,
        message: notificationSentence(row, actorName),
        created_at: row.createdAt,
        read: !isNewNotification(row, now),
        snoozed_until: snoozedUntil,
        can_dismiss_for_everyone:
            row.bucket === "household" &&
            NOTIFICATION_KINDS[row.kind].canDisable &&
            agentMayDismiss,
        subject:
            row.subjectKind && row.subjectId
                ? { kind: row.subjectKind, id: row.subjectId }
                : null,
        open: openPath(row),
    };
}

/** One text line: the sentence, what to know before acting on it, then every
 * id an agent can pass on, each labelled by the input that takes it. A snoozed
 * row is waiting, not unread: the count above leaves it out, so its line says
 * only when it comes back. */
function lineOf(n: WireNotification, waiting: boolean): string {
    const status = [
        n.read || waiting ? null : "unread",
        waiting && n.snoozed_until ? `snoozed until ${n.snoozed_until}` : null,
        n.kind === "allergens" ? "can't be dismissed or snoozed" : null,
    ].filter((part): part is string => part !== null);
    return `${n.message}${status.length ? ` (${status.join(", ")})` : ""}${idTag(n.id, "notification_id")}${n.subject ? subjectIdTag(n.subject.kind, n.subject.id) : ""}`;
}

function memberNames(
    members: readonly { userId: string; displayName: string }[],
): Map<string, string> {
    return new Map(members.map((m) => [m.userId, m.displayName]));
}

/** What a person gets for each kind: the registry default unless they chose. */
async function settingsFor(
    store: NotificationsStore,
    householdId: string,
    userId: string,
) {
    const prefs = await store.listPrefs(householdId, userId);
    return NOTIFICATION_KIND_IDS.map((kind) => ({
        kind,
        label: NOTIFICATION_KIND_LABELS[kind],
        enabled: kindEnabled(prefs, kind),
        can_turn_off: NOTIFICATION_KINDS[kind].canDisable,
    }));
}

const CODE_IN_INBOX =
    "That notice is in the inbox: list it with list_notices and pass its notification_id instead.";

/** The guard's undo sentence with this tool's one condition. Undo puts every
 * copy back or none, so it is refused once someone has changed their own copy
 * since (snoozed or dismissed it again). Any other sentence (nothing to undo,
 * or not undoable) is left as it is. */
function undoUnlessChanged(undo: string): string {
    return undo === AGENT_UNDO_HINT
        ? `${AGENT_UNDO_HINT.slice(0, -1)}, unless someone has changed their copy since.`
        : undo;
}

/** A failed dismiss_notice, in the shape every failure of it has had. */
function dismissFailed(message: string) {
    return {
        isError: true as const,
        content: [{ type: "text" as const, text: message }],
        structuredContent: { dismissed: false },
    };
}

type Recorder = Parameters<Parameters<ToolContext["runDestructive"]>[1]>[0];

/** Wraps the household-wide dismissals so the one a dismiss for everyone
 * creates is recorded for undo. The store answers a dismissal that is already
 * there with the existing row, so the insert carries an id of its own: the row
 * came back with that id only when this call created it. One that was already
 * there (made in the app, or by a call beside this one) is not this action's,
 * and undo must not remove it. */
function recordingDismissals(
    dismissals: NoticeDismissalsStore,
    rec: Recorder,
    wrote: { value: boolean },
): NoticeDismissalsStore {
    return {
        ...dismissals,
        async insert(row) {
            const id = crypto.randomUUID();
            const inserted = await dismissals.insert({ ...row, id });
            if (inserted.id === id) {
                rec.inserted("notice_dismissals", [id]);
                wrote.value = true;
            }
            return inserted;
        },
    };
}

/** Wraps the notification rows a dismiss or a snooze for everyone changes so
 * each is recorded, as it was, before it changes. */
function recordingStore(
    store: NotificationsStore,
    rec: Recorder,
): NotificationsStore {
    return {
        ...store,
        async update(householdId, ids, patch) {
            await rec.captureByIds("notifications", [...ids], "updated");
            return store.update(householdId, ids, patch);
        },
        async updateOpenByKey(householdId, noticeKey, patch, options) {
            const open = (await store.listForHousehold(householdId)).filter(
                (row) =>
                    row.noticeKey === noticeKey &&
                    row.resolvedAt === null &&
                    (!options?.skipDismissed || row.dismissedAt === null) &&
                    // The rows the store leaves as they are are not recorded.
                    !(
                        options?.keepOwnSnoozeFrom !== undefined &&
                        row.snoozedUntil !== null &&
                        row.snoozedBy === row.recipientUserId &&
                        row.snoozedUntil >= options.keepOwnSnoozeFrom
                    ),
            );
            await rec.captureByIds(
                "notifications",
                open.map((row) => row.id),
                "updated",
            );
            return store.updateOpenByKey(
                householdId,
                noticeKey,
                patch,
                options,
            );
        },
    };
}

export function registerNoticeTools(server: McpServer, ctx: ToolContext) {
    const { callerActor, analytics, runDestructive, agentMayRun } = ctx;
    registerWidgetResource(server, {
        key: "attention",
        resourceName: "attention",
        title: "Notifications",
        description:
            "The person's notification inbox as one card: unread count and what is waiting.",
    });

    server.registerTool(
        "list_notices",
        {
            title: "List Notifications",
            description:
                "List the acting person's notification inbox, newest first. count is the unread across both buckets; bucket only narrows the list. Snoozed ones are left out unless include_snoozed. Each carries its notification_id, whether the person may dismiss it for everyone, and its app path. Allergen notifications cannot be dismissed or snoozed: they clear when the cause is fixed. Data-quality marks on a recipe or food are in get_recipe and get_food, not here.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                bucket: z.enum(["all", "personal", "household"]).optional(),
                include_snoozed: z.boolean().optional(),
            }),
            outputSchema: LIST_NOTICES_OUTPUT_SCHEMA,
            ...uiMetaForKey(ctx, "attention"),
        },
        async (input) => {
            return withAnalytics(
                "list_notices",
                async () => {
                    const person = await callerActor();
                    const { householdId, userId } = person;
                    const deps = liveNotificationSyncDeps();
                    // An agent may read with no page load before it: bring the
                    // stored rows up to what is true now.
                    await trySyncHouseholdNotifications(deps, householdId);
                    const now = new Date();
                    const [{ timezone }, rows, prefs, dismissals, members] =
                        await Promise.all([
                            householdClock(householdId),
                            deps.store.listForRecipient(householdId, userId),
                            deps.store.listPrefs(householdId, userId),
                            deps.dismissals.listForHousehold(householdId),
                            listHouseholdMembers(householdId),
                        ]);
                    const inbox = inboxFor({
                        rows,
                        prefs,
                        now,
                        householdDismissals: dismissals,
                        timezone,
                    });
                    const bucket = input.bucket ?? "all";
                    const shown = [
                        ...inbox.today,
                        ...inbox.earlier,
                        ...(input.include_snoozed ? inbox.snoozed : []),
                    ].filter(
                        (row) => bucket === "all" || row.bucket === bucket,
                    );
                    const names = memberNames(members);
                    const agentMayDismiss = await agentMayRun("dismiss_notice");
                    const notifications = shown.map((row) =>
                        notificationToWire(row, names, agentMayDismiss, now),
                    );
                    const count = inbox.unread;
                    // The unread count leaves snoozed rows out, so a list that
                    // includes them says how many they are.
                    const waiting = new Set(inbox.snoozed.map((row) => row.id));
                    const snoozedShown = notifications.filter((n) =>
                        waiting.has(n.id),
                    ).length;
                    const text =
                        notifications.length === 0
                            ? count === 0
                                ? "Nothing needs attention."
                                : `${count} unread, none in this list.`
                            : `${count} unread${snoozedShown > 0 ? ` (${snoozedShown} snoozed)` : ""}.\n` +
                              notifications
                                  .map((n) => lineOf(n, waiting.has(n.id)))
                                  .join("\n");
                    return {
                        content: [{ type: "text" as const, text }],
                        structuredContent: { count, notifications },
                    };
                },
                analytics,
            );
        },
    );

    server.registerTool(
        "dismiss_notice",
        {
            title: "Dismiss Notification",
            description:
                'Dismiss a notification, only after the person agrees. Pass notification_id from list_notices with scope "me" (the default: leaves only your inbox) or "everyone" (owner or admin, household ones: leaves every inbox; recorded in Settings › AI connections, undoable there for 24 hours unless someone has changed their copy since). A data-quality mark from get_recipe, get_food or get_week_plan is dismissed for the household with the fields in its dismiss: code, subject_kind, subject_id, and related_id whenever it is not null (the other food of a pair, or what the dismissal is held for).',
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                notification_id: z.string().optional(),
                scope: z.enum(["me", "everyone"]).optional(),
                code: z.string().optional(),
                subject_kind: SUBJECT_KIND_SCHEMA.optional(),
                subject_id: z.string().optional(),
                related_id: z.string().optional(),
            }),
            outputSchema: DISMISS_NOTICE_OUTPUT_SCHEMA,
        },
        async (input) => {
            return withAnalytics(
                "dismiss_notice",
                async () => {
                    const person = await callerActor();
                    const { householdId, userId } = person;
                    if (input.notification_id !== undefined) {
                        if (
                            input.code ||
                            input.subject_kind ||
                            input.subject_id ||
                            input.related_id
                        ) {
                            return dismissFailed(
                                "Pass either notification_id or a data-quality mark's code, subject_kind and subject_id, not both.",
                            );
                        }
                        const scope = input.scope ?? "me";
                        const deps = liveNotificationSyncDeps();
                        const now = new Date();
                        try {
                            if (scope === "me") {
                                const changed = await dismiss(deps, {
                                    householdId,
                                    actor: person,
                                    id: input.notification_id,
                                    scope,
                                    now,
                                });
                                return {
                                    content: [
                                        {
                                            type: "text" as const,
                                            text:
                                                changed.length > 0
                                                    ? "Dismissed for you."
                                                    : "Already dismissed.",
                                        },
                                    ],
                                    structuredContent: { dismissed: true },
                                };
                            }
                            // For everyone changes what other people see: it
                            // goes through the guard, so it is recorded and can
                            // be undone, and is refused unless the person may.
                            const row = await deps.store.get(
                                householdId,
                                input.notification_id,
                            );
                            if (!row) {
                                throw new NotificationActionError(
                                    "not_found",
                                    "No such notification.",
                                );
                            }
                            const names = memberNames(
                                await listHouseholdMembers(householdId),
                            );
                            const sentence = notificationSentence(
                                row,
                                (row.actorUserId
                                    ? names.get(row.actorUserId)
                                    : undefined) ?? "Someone",
                            );
                            const run = await runDestructive(
                                "dismiss_notice",
                                async (rec) => {
                                    const wroteDismissal = { value: false };
                                    const changed = await dismiss(
                                        {
                                            store: recordingStore(
                                                deps.store,
                                                rec,
                                            ),
                                            dismissals: recordingDismissals(
                                                deps.dismissals,
                                                rec,
                                                wroteDismissal,
                                            ),
                                        },
                                        {
                                            householdId,
                                            actor: person,
                                            id: row.id,
                                            scope,
                                            now,
                                        },
                                    );
                                    const didChange =
                                        wroteDismissal.value ||
                                        changed.length > 0;
                                    return {
                                        value: didChange,
                                        summary: `Dismissed for everyone: ${sentence}`,
                                        changed: didChange,
                                    };
                                },
                                { target: row.recipientUserId },
                            );
                            if (run.refused) {
                                return {
                                    ...run.result,
                                    structuredContent: { dismissed: false },
                                };
                            }
                            return {
                                content: [
                                    {
                                        type: "text" as const,
                                        text: run.value
                                            ? withUndo(
                                                  "Dismissed for everyone.",
                                                  undoUnlessChanged(run.undo),
                                              )
                                            : "Already dismissed for everyone.",
                                    },
                                ],
                                structuredContent: { dismissed: true },
                            };
                        } catch (err) {
                            if (err instanceof NotificationActionError) {
                                return dismissFailed(err.reason);
                            }
                            throw err;
                        }
                    }

                    // A data-quality mark: dismissed for the household, as it
                    // always was.
                    if (input.scope !== undefined) {
                        return dismissFailed(
                            "scope applies to notification_id. A data-quality mark is dismissed for the whole household.",
                        );
                    }
                    if (
                        !input.code ||
                        !input.subject_kind ||
                        !input.subject_id
                    ) {
                        return dismissFailed(
                            "Pass notification_id (from list_notices), or a data-quality mark's code, subject_kind and subject_id.",
                        );
                    }
                    if (kindForNoticeCode(input.code as NoticeCode) !== null) {
                        return dismissFailed(CODE_IN_INBOX);
                    }
                    try {
                        const { today, timezone } =
                            await householdClock(householdId);
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
                            { today, timezone, actionable: true },
                        );
                        return {
                            content: [
                                {
                                    type: "text" as const,
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
                        return dismissFailed(message);
                    }
                },
                analytics,
                undefined,
                { outcome: refusedOutcome },
            );
        },
    );

    server.registerTool(
        "snooze_notice",
        {
            title: "Snooze Notification",
            description:
                'Hide a notification until later, only after the person agrees. until is "tomorrow" (9:00 household time), "week", or an exact time like 2026-12-01T08:30 (household time unless it carries an offset; at most a year ahead). A member snoozes their own copy; an owner or admin snoozing a household one snoozes it for everyone, recorded and undoable for 24 hours in Settings › AI connections unless someone has changed their copy since.',
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                notification_id: z.string(),
                until: z.string(),
            }),
            outputSchema: SNOOZE_NOTICE_OUTPUT_SCHEMA,
        },
        async (input) => {
            return withAnalytics(
                "snooze_notice",
                async () => {
                    const person = await callerActor();
                    const { householdId } = person;
                    const deps = liveNotificationSyncDeps();
                    const now = new Date();
                    try {
                        const { timezone } = await householdClock(householdId);
                        const until = resolveSnoozeUntil(
                            input.until === "tomorrow" || input.until === "week"
                                ? input.until
                                : { at: input.until },
                            now,
                            timezone,
                        );
                        const row = await deps.store.get(
                            householdId,
                            input.notification_id,
                        );
                        const request = {
                            householdId,
                            actor: person,
                            id: input.notification_id,
                            until,
                            now,
                        };
                        // An owner or admin snoozing a household notification
                        // snoozes every member's copy, over what they set
                        // themselves: that goes through the guard, so it is
                        // recorded and can be undone. Everything else (a
                        // member's own snooze, a personal row, a row that is
                        // not the person's or cannot be snoozed) is a plain
                        // write, and the domain refuses what it must.
                        const forEveryone =
                            row !== null &&
                            row.recipientUserId === person.userId &&
                            row.resolvedAt === null &&
                            row.bucket === "household" &&
                            NOTIFICATION_KINDS[row.kind].canDisable &&
                            can(person, "notification.snooze_everyone").ok;
                        if (forEveryone) {
                            const names = memberNames(
                                await listHouseholdMembers(householdId),
                            );
                            const sentence = notificationSentence(
                                row,
                                (row.actorUserId
                                    ? names.get(row.actorUserId)
                                    : undefined) ?? "Someone",
                            );
                            const run = await runDestructive(
                                "snooze_notice",
                                async (rec) => {
                                    const changed = await snooze(
                                        {
                                            store: recordingStore(
                                                deps.store,
                                                rec,
                                            ),
                                            dismissals: deps.dismissals,
                                        },
                                        request,
                                    );
                                    return {
                                        value: null,
                                        summary: `Snoozed for everyone until ${until.toISOString()}: ${sentence}`,
                                        changed: changed.length > 0,
                                    };
                                },
                                { target: row.recipientUserId },
                            );
                            if (run.refused) return run.result;
                            return snoozed(
                                withUndo(
                                    `Snoozed until ${until.toISOString()}, for every member.`,
                                    undoUnlessChanged(run.undo),
                                ),
                                until,
                                true,
                            );
                        }
                        await snooze(deps, request);
                        return snoozed(
                            `Snoozed until ${until.toISOString()}.`,
                            until,
                            false,
                        );
                    } catch (err) {
                        if (err instanceof NotificationActionError) {
                            throw new Error(err.reason);
                        }
                        throw err;
                    }
                },
                analytics,
                undefined,
                { outcome: refusedOutcome },
            );
        },
    );

    server.registerTool(
        "mark_notices_read",
        {
            title: "Mark Notifications Read",
            description:
                'Mark the acting person\'s notifications read: notification_ids (from list_notices) or "all" for every unread one.',
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                notification_ids: z.union([
                    z.array(z.string()).min(1).max(200),
                    z.literal("all"),
                ]),
            }),
            outputSchema: MARK_NOTICES_READ_OUTPUT_SCHEMA,
        },
        async (input) => {
            return withAnalytics(
                "mark_notices_read",
                async () => {
                    const person = await callerActor();
                    const { householdId } = person;
                    const deps = liveNotificationSyncDeps();
                    if (input.notification_ids === "all") {
                        // "all" is every row the inbox shows, so bring it up
                        // to date first.
                        await trySyncHouseholdNotifications(deps, householdId);
                    }
                    try {
                        const changed = await markRead(deps, {
                            householdId,
                            actor: person,
                            ids: input.notification_ids,
                            now: new Date(),
                        });
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text:
                                        changed.length === 0
                                            ? "Nothing was unread."
                                            : `Marked ${changed.length} read.`,
                                },
                            ],
                            structuredContent: { marked_read: changed.length },
                        };
                    } catch (err) {
                        if (err instanceof NotificationActionError) {
                            throw new Error(err.reason);
                        }
                        throw err;
                    }
                },
                analytics,
            );
        },
    );

    server.registerTool(
        "get_notification_settings",
        {
            title: "Get Notification Settings",
            description:
                "Which kinds of notification the acting person gets. Allergens is always on.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({}),
            outputSchema: GET_NOTIFICATION_SETTINGS_OUTPUT_SCHEMA,
        },
        async () => {
            return withAnalytics(
                "get_notification_settings",
                async () => {
                    const { householdId, userId } = await callerActor();
                    const settings = await settingsFor(
                        liveNotificationSyncDeps().store,
                        householdId,
                        userId,
                    );
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: settings
                                    .map(
                                        (s) =>
                                            `${s.label} [kind: ${s.kind}]: ${s.enabled ? "on" : "off"}${s.can_turn_off ? "" : " (always on)"}`,
                                    )
                                    .join("\n"),
                            },
                        ],
                        structuredContent: { settings },
                    };
                },
                analytics,
            );
        },
    );

    server.registerTool(
        "set_notification_settings",
        {
            title: "Set Notification Settings",
            description:
                "Turn one kind of notification on or off for the acting person, only after they agree. An off kind is hidden from the inbox and, for what other people do, not recorded. Allergens cannot be turned off.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                kind: KIND_SCHEMA,
                enabled: z.boolean(),
            }),
            outputSchema: SET_NOTIFICATION_SETTINGS_OUTPUT_SCHEMA,
        },
        async (input) => {
            return withAnalytics(
                "set_notification_settings",
                async () => {
                    const person = await callerActor();
                    const { householdId, userId } = person;
                    const deps = liveNotificationSyncDeps();
                    try {
                        await setPref(deps, {
                            householdId,
                            actor: person,
                            userId,
                            kind: input.kind as NotificationKind,
                            enabled: input.enabled,
                            now: new Date(),
                        });
                    } catch (err) {
                        if (err instanceof NotificationActionError) {
                            throw new Error(err.reason);
                        }
                        throw err;
                    }
                    const setting = (
                        await settingsFor(deps.store, householdId, userId)
                    ).find((s) => s.kind === input.kind)!;
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `${setting.label} is ${setting.enabled ? "on" : "off"}.`,
                            },
                        ],
                        structuredContent: setting,
                    };
                },
                analytics,
            );
        },
    );
}

/** A snooze, as the tool answers it. */
function snoozed(text: string, until: Date, forEveryone: boolean) {
    return {
        content: [{ type: "text" as const, text }],
        structuredContent: {
            snoozed: true,
            snoozed_until: until.toISOString(),
            for_everyone: forEveryone,
        },
    };
}

/** A refused dismiss_notice or snooze_notice is a failure in the analytics, not a success. */
function refusedOutcome(result: object): {
    success: boolean;
    errorCategory?: string;
} {
    return "isError" in result && result.isError === true
        ? { success: false, errorCategory: "refused" }
        : { success: true };
}
