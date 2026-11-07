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
import type { AppTabId, ViewerChrome } from "./shell.js";
import { resolveTheme } from "./shell.js";

export type AttentionChrome = {
    count: number;
    tabs: Partial<Record<AppTabId, boolean>>;
};

export type AppChromeBase = ViewerChrome & {
    attention: AttentionChrome;
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
    opts?: { refCounts?: ReadonlyMap<string, number> },
): Promise<NoticesForResult> {
    const today = await householdToday(householdId);
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
    profile: { theme?: string | null } | null,
    householdId: string,
    prefetched?: NoticesForResult,
): Promise<AppChromeBase> {
    const noticeResult =
        prefetched ?? (await loadHouseholdNotices(householdId));
    return {
        theme: resolveTheme(profile?.theme),
        attention: attentionFromNotices(noticeResult),
        householdPossibleDuplicates: householdPossibleDuplicateCount(
            noticeResult.notices,
        ),
    };
}
