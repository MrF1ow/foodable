import { householdToday } from "../db/restock.js";
import { liveGroceryStore } from "../db/grocery.js";
import { liveNoticeDismissalsStore } from "../db/notice-dismissals.js";
import { liveFoodsStore } from "../db/foods.js";
import { liveFridgeStore } from "../db/fridge.js";
import { liveRecipesStore } from "../db/recipes.js";
import {
    needsAttentionCount,
    tabDotsFromNotices,
    type Notice,
} from "../domain/notices.js";
import { noticesFor, type NoticesForResult } from "../domain/notices-for.js";
import { buildFlagContext } from "../flags.js";
import type { HouseholdMember } from "../household.js";
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
    /** The new shell's sidebar and account chip. Only loaded when `ui-v2` is
     *  on for the viewer, so a viewer on the old shell costs no extra query. */
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

export function attentionFromNotices(
    result: NoticesForResult,
): AttentionChrome {
    return {
        count: needsAttentionCount(result.notices),
        tabs: tabDotsFromNotices(result.notices),
    };
}

export async function loadHouseholdNotices(
    householdId: string,
    opts?: {
        refCounts?: ReadonlyMap<string, number>;
        /** The household date the caller already looked up, so one request reads one date. */
        today?: string;
    },
): Promise<NoticesForResult> {
    const today = opts?.today ?? (await householdToday(householdId));
    return noticesFor(
        {
            foods: liveFoodsStore(),
            fridge: liveFridgeStore(),
            recipes: liveRecipesStore(),
            dismissals: liveNoticeDismissalsStore(),
            grocery: liveGroceryStore(),
        },
        householdId,
        { ...opts, today },
    );
}

export async function viewerChromeWithAttention(
    profile: { theme?: string | null; timezone?: string | null } | null,
    viewer: HouseholdMember,
    prefetched?: NoticesForResult,
    /** Seam for tests: how the new shell's household identity is loaded. */
    loadIdentity: (
        viewer: HouseholdMember,
    ) => Promise<ShellIdentity> = loadShellIdentity,
): Promise<AppChromeBase> {
    const noticeResult =
        prefetched ?? (await loadHouseholdNotices(viewer.householdId));
    const flags = await viewerFlagsFor(viewer);
    const identity = flags.uiV2 ? await loadIdentity(viewer) : undefined;
    const tz =
        profile?.timezone && validateTz(profile.timezone)
            ? profile.timezone
            : "UTC";
    return {
        theme: resolveTheme(profile?.theme),
        attention: attentionFromNotices(noticeResult),
        householdPossibleDuplicates: householdPossibleDuplicateCount(
            noticeResult.notices,
        ),
        flags,
        ...(flags.uiV2 ? { v2Timezone: tz } : {}),
        ...(identity ? { identity } : {}),
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

/** Household name and member count for the new shell's sidebar. The viewer's
 *  own name and role come from the membership the caller already holds. */
export async function loadShellIdentity(
    viewer: HouseholdMember,
): Promise<ShellIdentity> {
    const [config, members] = await Promise.all([
        getHouseholdConfig(viewer.householdId),
        listHouseholdMembers(viewer.householdId),
    ]);
    return {
        viewerName: viewer.displayName,
        viewerRole: viewer.role,
        householdName: config.name,
        memberCount: members.length,
    };
}
