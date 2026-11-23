/**
 * The Notifications inbox and what it does to a notification: dismiss, snooze,
 * and Settings › Notifications, the page and the post that turn a kind on or
 * off (from the inbox's menu or from the page itself). These only adapt: the rules (who may dismiss for
 * everyone, which kinds never move) are phase 2's `dismiss`, `snooze` and
 * `setPref`, which ask `can()`. A success answers 303 back to the inbox with no
 * toast; a refusal renders the inbox in place with the reason and a 4xx.
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { listHouseholdMembers } from "../../db/household.js";
import { getProfile } from "../../db/profiles.js";
import { householdClock } from "../../db/restock.js";
import {
    NOTIFICATION_KINDS,
    isNotificationKind,
} from "../../domain/notification-kinds.js";
import {
    NotificationActionError,
    dismiss,
    markRead,
    resolveSnoozeUntil,
    setPref,
    snooze,
    type NotificationsDeps,
} from "../../domain/notifications.js";
import { can } from "../../domain/permissions.js";
import type { HouseholdMember } from "../../household.js";
import {
    liveInboxReadDeps,
    loadInbox,
    loadViewerNotices,
    newInboxRows,
    viewerChromeWithAttention,
    type AppChromeBase,
} from "../attention.js";
import type { NoticesForResult } from "../../domain/notices-for.js";
import { formText } from "../form.js";
import { requireMember, siteMember } from "../middleware.js";
import {
    inboxHref,
    parseInboxBucket,
    renderNotificationsPage,
    type InboxBucket,
} from "../pages/v2/notifications.js";
import {
    NOTIFICATIONS_SETTINGS_PATH,
    renderSettingsNotificationsV2Page,
} from "../pages/v2/settings-notifications.js";

/** What a page load works out before it reads the inbox: the stored rows
 * brought up to date, and the zone "today" is told in. */
export type NotificationsPrepared = {
    timezone: string;
    profile: Awaited<ReturnType<typeof getProfile>>;
    notices: Pick<NoticesForResult, "notices">;
};

export type NotificationsRouteDeps = {
    /** Who may use the routes: a household member by default. */
    auth: MiddlewareHandler;
    notifications: NotificationsDeps;
    now: () => Date;
    /** The household's zone: a snooze's "tomorrow" is told in it. */
    timezone(viewer: HouseholdMember): Promise<string>;
    /** Display names of the household's members, for who did what in an event
     * row. Read only when the inbox shows one. */
    memberNames(viewer: HouseholdMember): Promise<ReadonlyMap<string, string>>;
    /** Brings the household's stored notifications up to date. */
    prepare(viewer: HouseholdMember): Promise<NotificationsPrepared>;
    chrome(
        viewer: HouseholdMember,
        prepared: NotificationsPrepared,
    ): Promise<AppChromeBase>;
};

/** The zone the inbox counts days in: the household's, the same clock that
 * decides when food is expiring, so a row never reads "expired" for an item
 * the Fridge still shows as expiring today. */
const householdZone = async (viewer: HouseholdMember): Promise<string> =>
    (await householdClock(viewer.householdId)).timezone;

function liveDeps(): NotificationsRouteDeps {
    return {
        auth: requireMember,
        notifications: liveInboxReadDeps(),
        now: () => new Date(),
        timezone: householdZone,
        memberNames: async (viewer) =>
            new Map(
                (await listHouseholdMembers(viewer.householdId)).map((m) => [
                    m.userId,
                    m.displayName,
                ]),
            ),
        prepare: async (viewer) => {
            const [profile, notices, timezone] = await Promise.all([
                getProfile(viewer.userId),
                loadViewerNotices(viewer),
                householdZone(viewer),
            ]);
            return { timezone, profile, notices };
        },
        chrome: (viewer, prepared) =>
            viewerChromeWithAttention(
                prepared.profile,
                viewer,
                prepared.notices,
            ),
    };
}

type RefusalStatus = 400 | 403 | 404 | 422;

function statusOf(err: NotificationActionError): RefusalStatus {
    switch (err.code) {
        case "forbidden":
            return 403;
        case "not_found":
            return 404;
        case "locked":
            return 422;
        case "invalid":
            return 400;
    }
}

function actorOf(viewer: HouseholdMember) {
    return { userId: viewer.userId, role: viewer.role };
}

/** A load nobody looked at: a HEAD (Hono answers it with the GET handler), or
 * a speculative fetch, which the browser or a proxy says with Sec-Purpose (the
 * standard header), X-Sec-Purpose (older Chromium) or the legacy Purpose. */
function isUnseenLoad(c: Context): boolean {
    if (c.req.method === "HEAD") return true;
    return ["purpose", "sec-purpose", "x-sec-purpose"].some((name) =>
        (c.req.header(name) ?? "").toLowerCase().includes("prefetch"),
    );
}

export function createNotificationsRoutes(
    overrides: Partial<NotificationsRouteDeps> = {},
): Hono {
    const deps: NotificationsRouteDeps = { ...liveDeps(), ...overrides };
    const router = new Hono();

    /** The inbox page. Opening it marks what it shows as read, so the dot in
     * the shell is already off on this response. */
    async function renderInbox(
        c: Context,
        viewer: HouseholdMember,
        bucket: InboxBucket,
        outcome: {
            error?: string;
            status?: RefusalStatus;
            unseen?: boolean;
        } = {},
    ) {
        const now = deps.now();
        const prepared = await deps.prepare(viewer);
        const inbox = await loadInbox(deps.notifications, viewer, {
            now,
            timezone: prepared.timezone,
            bucket,
        });
        // A HEAD or a speculative fetch has not shown the page to anyone, so
        // it must not clear the dot.
        if (outcome.error === undefined && !outcome.unseen) {
            // markRead stamps every new row, one back from its snooze too,
            // so the dot clears until the next snooze ends.
            const fresh = newInboxRows(inbox, now).map((row) => row.id);
            // Marking read is a courtesy to the dot: a row gone since the
            // list, or a store error, must not take the inbox down.
            try {
                if (fresh.length > 0) {
                    await markRead(deps.notifications, {
                        householdId: viewer.householdId,
                        actor: actorOf(viewer),
                        ids: fresh,
                        now,
                    });
                }
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : String(err);
                console.error(
                    `[notifications] household=${viewer.householdId.slice(0, 8)} mark read failed: ${message}`,
                );
            }
        }
        const shown = [...inbox.today, ...inbox.earlier, ...inbox.snoozed];
        // A name is a nicety: a failed read leaves "Someone" in its place.
        let memberNames: ReadonlyMap<string, string> | undefined;
        if (shown.some((row) => row.source === "event")) {
            try {
                memberNames = await deps.memberNames(viewer);
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : String(err);
                console.error(
                    `[notifications] household=${viewer.householdId.slice(0, 8)} member names failed: ${message}`,
                );
            }
        }
        const chrome = await deps.chrome(viewer, prepared);
        return c.html(
            renderNotificationsPage({
                chrome,
                inbox,
                bucket,
                canDismissEveryone: can(
                    actorOf(viewer),
                    "notification.dismiss_everyone",
                ).ok,
                timezone: prepared.timezone,
                now,
                memberNames,
                error: outcome.error,
            }),
            outcome.status ?? 200,
        );
    }

    /** Settings › Notifications: the viewer's own choice for each kind. */
    async function renderSettings(
        c: Context,
        viewer: HouseholdMember,
        outcome: { error?: string; status?: RefusalStatus } = {},
    ) {
        const prepared = await deps.prepare(viewer);
        const [prefs, chrome] = await Promise.all([
            deps.notifications.store.listPrefs(
                viewer.householdId,
                viewer.userId,
            ),
            deps.chrome(viewer, prepared),
        ]);
        return c.html(
            renderSettingsNotificationsV2Page({
                chrome,
                prefs,
                error: outcome.error,
            }),
            outcome.status ?? 200,
        );
    }

    /** Runs one action: 303 back to where it came from (the inbox, or
     * Settings › Notifications when `to` says so), or that page in place with
     * the reason when the domain refuses. */
    async function act(
        c: Context,
        run: (viewer: HouseholdMember, now: Date) => Promise<void>,
        body: Record<string, string | File | (string | File)[]>,
        to: "inbox" | "settings" = "inbox",
    ) {
        const viewer = siteMember(c);
        const bucket = parseInboxBucket(formText(body, "bucket"));
        try {
            await run(viewer, deps.now());
        } catch (err) {
            if (err instanceof NotificationActionError) {
                const outcome = {
                    error: err.reason,
                    status: statusOf(err),
                };
                return to === "settings"
                    ? renderSettings(c, viewer, outcome)
                    : renderInbox(c, viewer, bucket, outcome);
            }
            throw err;
        }
        // toast: none
        return c.redirect(
            to === "settings" ? NOTIFICATIONS_SETTINGS_PATH : inboxHref(bucket),
            303,
        );
    }

    router.get("/notifications", deps.auth, (c) =>
        renderInbox(c, siteMember(c), parseInboxBucket(c.req.query("bucket")), {
            unseen: isUnseenLoad(c),
        }),
    );

    router.post("/notifications/:id/dismiss", deps.auth, async (c) => {
        const body = await c.req.parseBody();
        const id = c.req.param("id");
        const scope = formText(body, "scope");
        return act(
            c,
            async (viewer, now) => {
                await dismiss(deps.notifications, {
                    householdId: viewer.householdId,
                    actor: actorOf(viewer),
                    id,
                    scope: scope as "me" | "everyone",
                    now,
                });
            },
            body,
        );
    });

    router.post("/notifications/:id/snooze", deps.auth, async (c) => {
        const body = await c.req.parseBody();
        const id = c.req.param("id");
        const until = formText(body, "until");
        return act(
            c,
            async (viewer, now) => {
                const timezone = await deps.timezone(viewer);
                await snooze(deps.notifications, {
                    householdId: viewer.householdId,
                    actor: actorOf(viewer),
                    id,
                    until: resolveSnoozeUntil(
                        until as "tomorrow" | "week",
                        now,
                        timezone,
                    ),
                    now,
                });
            },
            body,
        );
    });

    router.get(NOTIFICATIONS_SETTINGS_PATH, deps.auth, (c) =>
        renderSettings(c, siteMember(c)),
    );

    router.post(NOTIFICATIONS_SETTINGS_PATH, deps.auth, async (c) => {
        const body = await c.req.parseBody();
        const kind = formText(body, "kind");
        const enabled = formText(body, "enabled");
        // Only the two pages that post here may be returned to: any other
        // value goes back to the inbox, so this is never an open redirect.
        const to =
            formText(body, "return") === NOTIFICATIONS_SETTINGS_PATH
                ? "settings"
                : "inbox";
        return act(
            c,
            async (viewer, now) => {
                if (!isNotificationKind(kind)) {
                    throw new NotificationActionError(
                        "invalid",
                        "That is not a notification kind.",
                    );
                }
                // Allergens has no switch: whatever the post says, it stays on.
                if (!NOTIFICATION_KINDS[kind].canDisable) {
                    throw new NotificationActionError(
                        "locked",
                        "Allergen notifications can't be turned off.",
                    );
                }
                if (enabled !== "true" && enabled !== "false") {
                    throw new NotificationActionError(
                        "invalid",
                        "A preference is on or off.",
                    );
                }
                await setPref(deps.notifications, {
                    householdId: viewer.householdId,
                    actor: actorOf(viewer),
                    userId: viewer.userId,
                    kind,
                    enabled: enabled === "true",
                    now,
                });
            },
            body,
            to,
        );
    });

    return router;
}

export const notificationsRoutes = createNotificationsRoutes();
