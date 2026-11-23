import { householdClock, householdToday } from "../db/restock.js";
import {
    liveNoticesForDeps,
    liveNotificationSyncDeps,
    trySyncHouseholdNotifications,
} from "../db/notifications.js";
import { liveNoticeDismissalsStore } from "../db/notice-dismissals.js";
import { liveNotificationsStore } from "../db/notifications.js";
import { dismissedKeySet, isDismissedIn } from "../domain/notice-dismissals.js";
import { NOTIFICATION_KINDS } from "../domain/notification-kinds.js";
import {
    inboxFor,
    type Inbox,
    type NotificationRow,
    type NotificationsDeps,
} from "../domain/notifications.js";
import type { NotificationBucket } from "../domain/notification-kinds.js";
import {
    needsAttentionCount,
    tabDotsFromNotices,
    type Notice,
} from "../domain/notices.js";
import { noticesFor, type NoticesForResult } from "../domain/notices-for.js";
import { buildFlagContext } from "../flags.js";
import type { HouseholdMember } from "../household.js";
import { getAvatarVersions } from "../db/avatars.js";
import { getHouseholdConfig, listHouseholdMembers } from "../db/household.js";
import { loadViewerFlags, type ViewerFlags } from "../viewer-flags.js";
import type { AppTabId, ShellIdentity, ViewerChrome } from "./shell.js";
import { validateTz } from "../domain/tz.js";
import { resolveTheme } from "./shell.js";

export type AttentionChrome = {
    count: number;
    tabs: Partial<Record<AppTabId, boolean>>;
};

export type AppChromeBase = ViewerChrome & {
    attention: AttentionChrome;
    flags: ViewerFlags;
    /** The shell's sidebar and account chip. */
    identity?: ShellIdentity;
    v2Timezone?: string;
    v2LogSheet?: Omit<
        import("./pages/v2/log-sheet.js").RenderLogSheetsOpts,
        "timezone"
    >;
    /** Open `food.possible_duplicate` notices (Household sub-nav badge). */
    householdPossibleDuplicates?: number;
    /** The bell's dot: the viewer has a notification they have not seen. */
    notificationsUnread?: boolean;
};

export function householdPossibleDuplicateCount(
    notices: readonly Notice[],
): number {
    return notices.filter((n) => n.code === "food.possible_duplicate").length;
}

/**
 * The tab dots of the notices that come with a one-tap action, which the
 * prefixes do not cover. Kitchen lights for a usual running low, Today and
 * Recipes for what a planned recipe is missing (both show This week), and Today
 * for the viewer's own weigh-in (a reminder about someone else has nothing to
 * tap here).
 */
export function actionableTabDots(
    notices: readonly Notice[],
    viewerUserId: string,
): Partial<Record<AppTabId, boolean>> {
    const tabs: Partial<Record<AppTabId, boolean>> = {};
    for (const notice of notices) {
        if (notice.code === "grocery.running_low") tabs.grocery = true;
        if (notice.code === "plan.missing_ingredient") {
            tabs.nutrition = true;
            tabs.recipes = true;
        }
        if (
            notice.code === "nutrition.weigh_in_due" &&
            notice.subject.id === viewerUserId
        ) {
            tabs.nutrition = true;
        }
    }
    return tabs;
}

export function attentionFromNotices(
    result: Pick<NoticesForResult, "notices">,
    /** The viewer: its one-tap notices light their tabs too. */
    viewerUserId?: string,
): AttentionChrome {
    return {
        count: needsAttentionCount(result.notices),
        tabs: {
            ...tabDotsFromNotices(result.notices),
            ...(viewerUserId
                ? actionableTabDots(result.notices, viewerUserId)
                : {}),
        },
    };
}

const ALLERGEN_CODES: ReadonlySet<string> = new Set(
    NOTIFICATION_KINDS.allergens.noticeCodes,
);

/**
 * The notices a page shows. A read made for the stored notifications holds
 * more than that: the notices the household dismissed (so the sync can tell a
 * condition is still true) and the Allergens conditions (which the pages and
 * tools show where they are made: the grocery list, the recipe, the product
 * check). This takes both out again, by the dismissals the same result
 * carries.
 */
export function shownOnPage<
    T extends Pick<NoticesForResult, "notices" | "dismissals">,
>(result: T): T {
    const dismissed = dismissedKeySet(result.dismissals);
    const shown = result.notices.filter(
        (n) => !ALLERGEN_CODES.has(n.code) && !isDismissedIn(n, dismissed),
    );
    return shown.length === result.notices.length
        ? result
        : { ...result, notices: shown };
}

/** Seam for tests: how a page load brings the household's stored
 *  notifications up to date from the notices it just read (with the dismissed
 *  ones and the Allergens conditions in them, as a sync needs). */
export type SyncStoredNotifications = (
    householdId: string,
    notices: readonly Notice[],
) => Promise<unknown>;

/** Logs a failure and carries on: a page never waits on, or breaks for, the
 *  notifications behind its bell. */
const syncStoredNotifications: SyncStoredNotifications = (
    householdId,
    notices,
) =>
    trySyncHouseholdNotifications(liveNotificationSyncDeps(), householdId, {
        notices,
        allergens: true,
    });

/**
 * The notices deps for a page's read, with one guard on the members' allergens.
 * That read is for the stored notifications, so a page never waits on it or
 * breaks for it: when it fails it reads as no members, and `read()` says it
 * did not succeed, so the caller does not hand the sync a read that would
 * look like "no one has an allergen" and resolve every Allergens row.
 */
function pageNoticesDeps(): {
    deps: ReturnType<typeof liveNoticesForDeps>;
    allergensRead(): boolean;
} {
    const deps = liveNoticesForDeps();
    const members = deps.allergenMembers;
    let ok = true;
    return {
        deps: {
            ...deps,
            allergenMembers: members
                ? async (householdId) => {
                      try {
                          return await members(householdId);
                      } catch (err) {
                          ok = false;
                          const message =
                              err instanceof Error ? err.message : String(err);
                          console.error(
                              `[notifications] household=${householdId.slice(0, 8)} allergen read failed: ${message}`,
                          );
                          return [];
                      }
                  }
                : undefined,
        },
        allergensRead: () => ok,
    };
}

export async function loadHouseholdNotices(
    householdId: string,
    opts?: {
        refCounts?: ReadonlyMap<string, number>;
        /** The household date the caller already looked up, so one request reads one date. */
        today?: string;
        /** The household clock the caller already read, so it is not read again. */
        clock?: { today: string; timezone: string };
        /**
         * Also load the notices that come with a one-tap action (running low,
         * missing for the plan, weigh-in due). This is the page's own read:
         * it also brings the household's stored notifications up to date from
         * the same notices, so one request still computes them once.
         */
        actionable?: boolean;
    },
    syncNotifications: SyncStoredNotifications = syncStoredNotifications,
): Promise<NoticesForResult> {
    const clock = opts?.actionable
        ? (opts.clock ?? (await householdClock(householdId)))
        : null;
    const today =
        opts?.today ?? clock?.today ?? (await householdToday(householdId));
    const { deps, allergensRead } = pageNoticesDeps();
    const result = await noticesFor(deps, householdId, {
        ...opts,
        today,
        timezone: clock?.timezone,
        // The stored notifications read the dismissed notices and the
        // Allergens conditions too, and the page takes them out again below.
        includeDismissed: opts?.actionable ? true : undefined,
        allergens: opts?.actionable ? true : undefined,
    });
    if (!opts?.actionable) return result;
    if (allergensRead()) await syncNotifications(householdId, result.notices);
    return shownOnPage(result);
}

/** The household's notices for a signed-in viewer, the one-tap ones included.
 *  The read also brings the household's stored notifications up to date (see
 *  `loadHouseholdNotices`), and the notices it returns are what the page shows. */
export async function loadViewerNotices(
    viewer: HouseholdMember,
    opts?: { refCounts?: ReadonlyMap<string, number>; today?: string },
    /** Seam for tests: how the household's notices are loaded. */
    load: typeof loadHouseholdNotices = loadHouseholdNotices,
): Promise<NoticesForResult> {
    return load(viewer.householdId, {
        ...opts,
        actionable: true,
    });
}

/** What the inbox reads: the stored rows, and the household dismissals that
 * hide a condition for everyone. */
export type InboxReadDeps = Pick<NotificationsDeps, "store" | "dismissals">;

export function liveInboxReadDeps(): InboxReadDeps {
    return {
        store: liveNotificationsStore(),
        dismissals: liveNoticeDismissalsStore(),
    };
}

/** Whether a row counts as new to its person: never opened, or back from a
 * snooze that ended after they last opened it. The bell's dot and the inbox
 * both ask this, so they agree. */
export function isNewInInbox(
    row: Pick<NotificationRow, "readAt" | "snoozedUntil">,
    now: Date,
): boolean {
    if (row.readAt === null) return true;
    return (
        row.snoozedUntil !== null &&
        row.snoozedUntil <= now.toISOString() &&
        row.readAt < row.snoozedUntil
    );
}

/** The shown rows of an inbox that are new to its person. */
export function newInboxRows(inbox: Inbox, now: Date): NotificationRow[] {
    return [...inbox.today, ...inbox.earlier].filter((row) =>
        isNewInInbox(row, now),
    );
}

/** One person's inbox, from their stored rows and their choices. The sync that
 * keeps the rows true runs in the page load before this. */
export async function loadInbox(
    deps: InboxReadDeps,
    viewer: Pick<HouseholdMember, "householdId" | "userId">,
    opts: {
        now: Date;
        timezone: string;
        bucket?: NotificationBucket | "all";
    },
): Promise<Inbox> {
    const [rows, prefs, householdDismissals] = await Promise.all([
        deps.store.listForRecipient(viewer.householdId, viewer.userId),
        deps.store.listPrefs(viewer.householdId, viewer.userId),
        deps.dismissals.listForHousehold(viewer.householdId),
    ]);
    return inboxFor({
        rows,
        prefs,
        now: opts.now,
        bucket: opts.bucket,
        householdDismissals,
        timezone: opts.timezone,
    });
}

/** Whether the bell shows its dot: something unread is in the inbox. A page
 * never breaks for its bell, so a failed read is logged and shows no dot. */
export async function loadNotificationsUnread(
    viewer: Pick<HouseholdMember, "householdId" | "userId">,
    deps: InboxReadDeps = liveInboxReadDeps(),
    now: Date = new Date(),
): Promise<boolean> {
    try {
        const inbox = await loadInbox(deps, viewer, {
            now,
            timezone: "UTC",
        });
        return newInboxRows(inbox, now).length > 0;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
            `[notifications] household=${viewer.householdId.slice(0, 8)} unread read failed: ${message}`,
        );
        return false;
    }
}

export async function viewerChromeWithAttention(
    profile: { theme?: string | null; timezone?: string | null } | null,
    viewer: HouseholdMember,
    /** Notices the caller already loaded (Today's own), so they are not loaded twice. */
    prefetched?: Pick<NoticesForResult, "notices">,
    /** Seam for tests: how the shell's household identity is loaded. */
    loadIdentity: (
        viewer: HouseholdMember,
    ) => Promise<ShellIdentity> = loadShellIdentity,
    /** Seam for tests: how the household's picture versions are loaded. */
    loadAvatars: (
        householdId: string,
    ) => Promise<ReadonlyMap<string, Date>> = getAvatarVersions,
    /** Seam for tests: whether the bell has something new. */
    loadUnread: (
        viewer: HouseholdMember,
    ) => Promise<boolean> = loadNotificationsUnread,
): Promise<AppChromeBase> {
    const flags = await viewerFlagsFor(viewer);
    const noticeResult: Pick<NoticesForResult, "notices"> =
        prefetched ??
        (await loadHouseholdNotices(viewer.householdId, {
            actionable: true,
        }));
    // One read for the whole page. A picture is a nicety: if the read fails
    // every page still renders, with initials.
    const [loaded, avatarVersions, notificationsUnread] = await Promise.all([
        loadIdentity(viewer),
        loadAvatars(viewer.householdId).catch(() => new Map<string, Date>()),
        // The dot is a nicety like the picture: a seam that throws must not
        // reject the page's chrome.
        Promise.resolve()
            .then(() => loadUnread(viewer))
            .catch((err: unknown) => {
                const message =
                    err instanceof Error ? err.message : String(err);
                console.error(
                    `[notifications] household=${viewer.householdId.slice(0, 8)} unread read failed: ${message}`,
                );
                return false;
            }),
    ]);
    const identity: ShellIdentity = { ...loaded, avatarVersions };
    const tz =
        profile?.timezone && validateTz(profile.timezone)
            ? profile.timezone
            : "UTC";
    return {
        theme: resolveTheme(profile?.theme),
        attention: attentionFromNotices(noticeResult, viewer.userId),
        householdPossibleDuplicates: householdPossibleDuplicateCount(
            noticeResult.notices,
        ),
        flags,
        v2Timezone: tz,
        identity,
        notificationsUnread,
    };
}

/** The viewer's flags. Pure (no query), so the Settings routes, which do not
 *  load notices, can ask for them without touching the database. */
export function viewerFlagsFor(viewer: HouseholdMember): Promise<ViewerFlags> {
    return loadViewerFlags(
        buildFlagContext({
            auth: { kind: "user", userId: viewer.userId },
            member: viewer,
        }),
    );
}

/** Household name and member count for the shell's sidebar. The viewer's
 *  own name and role come from the membership the caller already holds. */
export async function loadShellIdentity(
    viewer: HouseholdMember,
): Promise<ShellIdentity> {
    const [config, members] = await Promise.all([
        getHouseholdConfig(viewer.householdId),
        listHouseholdMembers(viewer.householdId),
    ]);
    return {
        viewerUserId: viewer.userId,
        viewerName: viewer.displayName,
        viewerRole: viewer.role,
        householdName: config.name,
        memberCount: members.length,
    };
}
