import { householdClock, householdToday } from "../db/restock.js";
import {
    liveNoticesForDeps,
    liveNotificationSyncDeps,
    trySyncHouseholdNotifications,
} from "../db/notifications.js";
import { dismissedKeySet, isDismissedIn } from "../domain/notice-dismissals.js";
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

/**
 * The notices the household has not dismissed: what a page shows. A read made
 * with `includeDismissed` holds the dismissed ones too (so the stored
 * notifications can tell a condition is still true); this takes them out again,
 * by the dismissals the same result carries.
 */
export function withoutHouseholdDismissed<
    T extends Pick<NoticesForResult, "notices" | "dismissals">,
>(result: T): T {
    const dismissed = dismissedKeySet(result.dismissals);
    if (dismissed.size === 0) return result;
    return {
        ...result,
        notices: result.notices.filter((n) => !isDismissedIn(n, dismissed)),
    };
}

/** Seam for tests: how a page load brings the household's stored
 *  notifications up to date from the notices it just read. */
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
    });

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
    const result = await noticesFor(liveNoticesForDeps(), householdId, {
        ...opts,
        today,
        timezone: clock?.timezone,
        // The stored notifications read the dismissed notices too, and the
        // page takes them out again below.
        includeDismissed: opts?.actionable ? true : undefined,
    });
    if (!opts?.actionable) return result;
    await syncNotifications(householdId, result.notices);
    return withoutHouseholdDismissed(result);
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
): Promise<AppChromeBase> {
    const flags = await viewerFlagsFor(viewer);
    const noticeResult: Pick<NoticesForResult, "notices"> =
        prefetched ??
        (await loadHouseholdNotices(viewer.householdId, {
            actionable: true,
        }));
    const loaded = await loadIdentity(viewer);
    // One read for the whole page. A picture is a nicety: if the read fails
    // every page still renders, with initials.
    const identity: ShellIdentity = {
        ...loaded,
        avatarVersions: await loadAvatars(viewer.householdId).catch(
            () => new Map<string, Date>(),
        ),
    };
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
